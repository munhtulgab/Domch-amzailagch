"""Facebook Messenger integration against a fake Graph API."""
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from _lib import db as dbmod  # noqa: E402
from _lib import messenger  # noqa: E402
from _lib.app import app  # noqa: E402

TOKEN = "test-admin-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
APP_ID = "123456789012345"
APP_SECRET = "s3cr3t-app-secret-0123456789"
PAGE_TOKEN = "EAAPageToken0123456789abcdefXYZ"
HTTPS = {"x-forwarded-proto": "https", "x-forwarded-host": "domch.example"}
PAGES_READ_ERROR = ("(#100) Object does not exist, cannot be loaded due to missing permission or reviewable feature, or does not"
                    " support this operation. This endpoint requires the 'pages_read_engagement' permission")
SCOPES = ["pages_messaging", "pages_manage_metadata", "pages_show_list"]
TOKENS = {
    PAGE_TOKEN: {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777", "scopes": SCOPES, "expires_at": 0},
    "EAAUserToken000000000000000": {"app_id": APP_ID, "type": "USER", "is_valid": True, "scopes": SCOPES},
    "EAAOtherAppToken00000000000": {"app_id": "999", "type": "PAGE", "is_valid": True, "profile_id": "777", "scopes": SCOPES},
    "EAANoScopeToken000000000000": {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777",
                                    "scopes": ["pages_show_list"]},
    "EAAMessagingOnlyToken000000": {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777",
                                    "scopes": ["pages_messaging", "pages_show_list"]},
}


class FakeGraph:
    def __init__(self):
        self.calls = []
        self.fail = {}

    def __call__(self, request: httpx.Request):
        url = urlparse(str(request.url))
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = url.path.replace(f"/{messenger.GRAPH_VERSION}/", "")
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, path, q, body))
        if path in self.fail:
            code, sub, msg = self.fail[path]
            return httpx.Response(400, json={"error": {"message": msg, "code": code, "error_subcode": sub}})
        if q.get("appsecret_proof"):
            proof = hmac.new(APP_SECRET.encode(), q["access_token"].encode(), hashlib.sha256).hexdigest()
            if proof != q["appsecret_proof"]:
                return httpx.Response(400, json={"error": {"message": "Invalid appsecret_proof provided in the API argument", "code": 100}})
        if path == "debug_token":
            if q.get("access_token") != f"{APP_ID}|{APP_SECRET}":
                return httpx.Response(400, json={"error": {"message": "Invalid OAuth access token signature.", "code": 190}})
            return httpx.Response(200, json={"data": TOKENS.get(q["input_token"], {
                "is_valid": False, "error": {"code": 190, "message": "Invalid OAuth access token."}})})
        if request.method == "GET" and path in ("me", "777"):
            # what a Messenger-only token gets when reading the Page node (the reported error)
            return httpx.Response(400, json={"error": {"code": 100, "message": PAGES_READ_ERROR}})
        if path == f"{APP_ID}/subscriptions":
            assert q["access_token"] == f"{APP_ID}|{APP_SECRET}"
            return httpx.Response(200, json={"success": True})
        if path == "777/subscribed_apps":
            if q.get("access_token") == "EAAMessagingOnlyToken000000":
                return httpx.Response(400, json={"error": {"code": 200, "message": "(#200) Requires pages_manage_metadata permission to manage the object"}})
            return httpx.Response(200, json={"success": True})
        if path == "me/messages":
            return httpx.Response(200, json={"recipient_id": body["recipient"]["id"], "message_id": f"m_out_{len(self.calls)}"})
        if path == "me/messenger_profile":
            return httpx.Response(200, json={"result": "success"})
        if path.startswith("psid"):
            return httpx.Response(200, json={"first_name": "Бат", "last_name": "Дорж"})
        return httpx.Response(404, json={"error": {"message": "unknown " + path, "code": 803}})


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID", "D1_DATABASE_ID",
                 "CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LOCAL_DB_PATH", str(tmp_path / "m.db"))
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    dbmod.reset_db()
    yield
    dbmod.reset_db()


@pytest.fixture
def fb(monkeypatch):
    fake = FakeGraph()
    monkeypatch.setattr(messenger, "http", httpx.Client(transport=httpx.MockTransport(fake)))
    return fake


@pytest.fixture
def client():
    return TestClient(app)


def connect(client, **extra):
    body = {"app_id": APP_ID, "app_secret": APP_SECRET, "page_token": PAGE_TOKEN, "button": True, "connect": True}
    body.update(extra)
    return client.put("/api/admin/messenger", json=body, headers={**AUTH, **HTTPS})


def signed(payload: dict, secret=APP_SECRET):
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"x-hub-signature-256": sig, "content-type": "application/json"}


def event(psid="psid-1", text="Сайн байна уу", mid="m1"):
    return {"object": "page", "entry": [{"id": "777", "time": 0, "messaging": [{
        "sender": {"id": psid}, "recipient": {"id": "777"}, "timestamp": int(time.time() * 1000),
        "message": {"mid": mid, "text": text},
    }]}]}


def test_save_connects_and_hides_secrets(client, fb):
    res = connect(client)
    assert res.status_code == 200, res.text
    steps = {s["key"]: s for s in res.json()["steps"]}
    assert all(s["ok"] for s in steps.values()), steps
    assert "777" in steps["token"]["message"] and "хугацаагүй" in steps["token"]["message"]
    cfg = res.json()["config"]
    assert cfg["page_id"] == "777" and cfg["connected_at"]
    assert cfg["webhook_url"] == "https://domch.example/api/messenger/webhook"
    assert cfg["app_secret"] == {"set": True, "hint": "…6789"}
    assert PAGE_TOKEN not in json.dumps(cfg) and APP_SECRET not in json.dumps(cfg)
    sub = next(c for c in fb.calls if c[1] == f"{APP_ID}/subscriptions")
    assert sub[2]["callback_url"] == cfg["webhook_url"] and sub[2]["verify_token"] == cfg["verify_token"]
    content = client.get("/api/content").json()
    assert content["messenger"] == {"enabled": True, "link": "https://m.me/777"}
    dump = json.dumps(content)
    assert PAGE_TOKEN not in dump and APP_SECRET not in dump and cfg["verify_token"] not in dump


def test_saving_again_keeps_secrets(client, fb):
    connect(client)
    res = client.put("/api/admin/messenger", json={"app_id": APP_ID, "app_secret": "", "page_token": "",
                                                    "auto_reply": "Баярлалаа!", "button": False},
                     headers={**AUTH, **HTTPS})
    assert res.status_code == 200
    cfg = res.json()["config"]
    assert cfg["page_token"]["set"] and cfg["connected_at"] and cfg["auto_reply"] == "Баярлалаа!" and not cfg["button"]
    assert client.get("/api/content").json()["messenger"]["enabled"] is False


def test_bad_credentials(client, fb):
    bad = connect(client, page_token="EAAWrongToken0000000000000")
    steps = bad.json()["steps"]
    assert steps[0]["key"] == "token" and not steps[0]["ok"] and "хүчингүй" in steps[0]["message"]
    wrong_secret = connect(client, app_secret="another-secret-000000000")
    assert "App Secret буруу" in wrong_secret.json()["steps"][0]["message"]
    for token, text in (("EAAUserToken000000000000000", "USER token"), ("EAAOtherAppToken00000000000", "өөр аппынх"),
                        ("EAANoScopeToken000000000000", "pages_messaging")):
        step = connect(client, page_token=token).json()["steps"][0]
        assert not step["ok"] and text in step["message"], step
    invalid = client.put("/api/admin/messenger", json={"app_id": "abc", "page_token": "short"}, headers=AUTH)
    assert invalid.status_code == 422 and {"app_id", "page_token"} <= set(invalid.json()["fields"])


def test_http_only_site_skips_webhook(client, fb):
    res = client.put("/api/admin/messenger", json={"app_id": APP_ID, "app_secret": APP_SECRET,
                                                    "page_token": PAGE_TOKEN}, headers=AUTH)
    steps = {s["key"]: s for s in res.json()["steps"]}
    assert steps["token"]["ok"] and not steps["webhook"]["ok"] and steps["page"]["ok"]
    assert not res.json()["config"]["connected_at"]


def test_webhook_verify(client, fb):
    cfg = connect(client).json()["config"]
    ok = client.get("/api/messenger/webhook", params={"hub.mode": "subscribe", "hub.verify_token": cfg["verify_token"],
                                                      "hub.challenge": "1158201444"})
    assert ok.status_code == 200 and ok.text == "1158201444"
    bad = client.get("/api/messenger/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1"})
    assert bad.status_code == 403


def test_webhook_receive_reply_and_auto_reply(client, fb):
    connect(client, auto_reply="Сайн байна уу! Удахгүй хариулна.")
    raw, headers = signed(event())
    assert client.post("/api/messenger/webhook", content=raw, headers=headers).text == "EVENT_RECEIVED"
    # Facebook retries: the same mid is stored once
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    raw2, headers2 = signed(event(text="Үнэ хэд вэ?", mid="m2"))
    client.post("/api/messenger/webhook", content=raw2, headers=headers2)
    sent = [c for c in fb.calls if c[1] == "me/messages"]
    assert len(sent) == 1 and sent[0][3]["message"]["text"].startswith("Сайн байна уу!")

    summary = client.get("/api/admin/summary", headers=AUTH).json()
    assert summary["counts"]["messenger_unread"] == 2
    threads = client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"]
    assert threads[0]["name"] == "Бат Дорж" and threads[0]["unread"] == 2 and threads[0]["can_reply"]
    convo = client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()
    assert [m["direction"] for m in convo["items"]] == ["in", "out", "in"]
    assert client.get("/api/admin/summary", headers=AUTH).json()["counts"]["messenger_unread"] == 0

    assert client.post("/api/admin/messenger/threads/psid-1/reply", json={"text": "250 мл нь салбараас лавлана уу."},
                       headers=AUTH).status_code == 200
    assert len(client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()["items"]) == 4

    fb.fail["me/messages"] = (10, 2018278, "Message sent outside of allowed window")
    late = client.post("/api/admin/messenger/threads/psid-1/reply", json={"text": "Сайн уу"}, headers=AUTH)
    assert late.status_code == 502 and "24 цаг" in late.json()["message"]
    assert client.delete("/api/admin/messenger/threads/psid-1", headers=AUTH).status_code == 200


def test_webhook_rejects_bad_signature(client, fb):
    connect(client)
    raw, headers = signed(event(), secret="wrong-secret")
    assert client.post("/api/messenger/webhook", content=raw, headers=headers).status_code == 403
    assert client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"] == []


def test_echo_and_page_messages_ignored(client, fb):
    connect(client)
    payload = event(psid="777")
    payload["entry"][0]["messaging"].append({"sender": {"id": "psid-2"}, "recipient": {"id": "777"}, "timestamp": 0,
                                             "message": {"mid": "e1", "text": "echo", "is_echo": True}})
    raw, headers = signed(payload)
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"] == []


def test_disconnect(client, fb):
    connect(client)
    res = client.delete("/api/admin/messenger", headers=AUTH)
    assert res.status_code == 200 and not res.json()["config"]["page_token"]["set"]
    assert any(c[0] == "DELETE" and c[1] == "777/subscribed_apps" for c in fb.calls)
    assert client.get("/api/content").json()["messenger"]["enabled"] is False


def test_admin_only(client, fb):
    assert client.get("/api/admin/messenger").status_code == 401
    assert client.put("/api/admin/messenger", json={}).status_code == 401


def test_messenger_only_token_without_page_read_permission(client, fb):
    """The reported case: the Page node cannot be read, but debug_token still identifies the Page."""
    res = connect(client)
    steps = res.json()["steps"]
    assert all(s["ok"] for s in steps), steps
    assert res.json()["config"]["page_id"] == "777" and res.json()["config"]["page_name"] == ""
    assert not any(c[0] == "GET" and c[1] == "me" for c in fb.calls)


def test_page_name_when_available(client, fb, monkeypatch):
    original = fb.__call__

    def with_name(request):
        if request.method == "GET" and request.url.path.endswith("/777"):
            return httpx.Response(200, json={"id": "777", "name": "DOMCH"})
        return original(request)

    monkeypatch.setattr(messenger, "http", httpx.Client(transport=httpx.MockTransport(with_name)))
    res = connect(client)
    assert res.json()["config"]["page_name"] == "DOMCH" and "DOMCH" in res.json()["steps"][0]["message"]


def test_token_without_manage_metadata(client, fb):
    """The second reported case: pages_messaging only. Token and webhook pass; the Page is subscribed by hand."""
    res = connect(client, page_token="EAAMessagingOnlyToken000000")
    steps = {st["key"]: st for st in res.json()["steps"]}
    assert steps["token"]["ok"] and steps["webhook"]["ok"]
    assert not steps["page"]["ok"] and steps["page"]["warn"] and "Add subscriptions" in steps["page"]["message"]
    cfg = res.json()["config"]
    assert cfg["connected_at"] and cfg["page_subscribed"] == "manual" and not cfg["last_event_at"]
    # once the Page is subscribed in the dashboard, the first event confirms it
    raw, headers = signed(event())
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert client.get("/api/admin/messenger", headers=AUTH).json()["last_event_at"]
    assert client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"][0]["psid"] == "psid-1"


FAQ = [
    {"q": "Үнэ хэд вэ?", "a": "Үнийг ойрын салбараас лавлана уу."},
    {"q": "Хаанаас авах вэ?", "a": "Салбаруудыг сайтаас харна уу."},
]


def post_event(client, ev):
    raw, headers = signed(ev)
    return client.post("/api/messenger/webhook", content=raw, headers=headers)


def sent_texts(fb):
    return [c[3]["message"] for c in fb.calls if c[1] == "me/messages"]


def save_welcome(client, **body):
    data = {"greeting": "ДОМЧ — спиртгүй ам зайлагч.", "auto_reply": "Сайн байна уу! Доороос сонгоно уу.", "faq": FAQ}
    data.update(body)
    return client.put("/api/admin/messenger/welcome", json=data, headers={**AUTH, **HTTPS})


def test_reported_case_first_message_before_auto_reply_was_set(client, fb):
    """A person wrote before the auto reply existed; once it is saved, their next message gets it."""
    connect(client)
    post_event(client, event(text="Сн", mid="a1"))
    assert sent_texts(fb) == []
    assert save_welcome(client).json()["sync"]["ok"]
    post_event(client, event(text="Сн", mid="a2"))
    msgs = sent_texts(fb)
    assert len(msgs) == 1 and msgs[0]["text"].startswith("Сайн байна уу!")
    assert [q["title"] for q in msgs[0]["quick_replies"]] == ["Үнэ хэд вэ?", "Хаанаас авах вэ?"]
    post_event(client, event(text="Баярлалаа", mid="a3"))
    assert len(sent_texts(fb)) == 1  # same conversation: no second welcome


def test_welcome_syncs_messenger_profile(client, fb):
    connect(client)
    res = save_welcome(client)
    assert res.status_code == 200 and res.json()["sync"]["ok"]
    prof = next(c for c in fb.calls if c[0] == "POST" and c[1] == "me/messenger_profile")[3]
    assert prof["greeting"] == [{"locale": "default", "text": "ДОМЧ — спиртгүй ам зайлагч."}]
    assert prof["get_started"] == {"payload": "GET_STARTED"}
    assert [c["payload"] for c in prof["ice_breakers"][0]["call_to_actions"]] == ["FAQ_0", "FAQ_1"]
    cfg = res.json()["config"]
    assert cfg["faq"] == FAQ and cfg["profile_synced_at"]
    bad = client.put("/api/admin/messenger/welcome", json={"greeting": "x" * 161, "faq": [{"q": "x" * 21, "a": ""}]},
                     headers=AUTH)
    assert bad.status_code == 422 and {"greeting", "faq.0.q", "faq.0.a"} <= set(bad.json()["fields"])


def test_quick_questions_are_answered(client, fb):
    connect(client)
    save_welcome(client)
    quick = event(text="Хаанаас авах вэ?", mid="q1")
    quick["entry"][0]["messaging"][0]["message"]["quick_reply"] = {"payload": "FAQ_1"}
    post_event(client, quick)
    msgs = sent_texts(fb)
    assert msgs[-1]["text"] == "Салбаруудыг сайтаас харна уу."
    assert [q["payload"] for q in msgs[-1]["quick_replies"]] == ["FAQ_0"]
    post_event(client, event(text="үнэ хэд вэ", mid="q2"))  # typed text matching a question
    assert sent_texts(fb)[-1]["text"] == "Үнийг ойрын салбараас лавлана уу."
    ice = {"object": "page", "entry": [{"id": "777", "messaging": [{"sender": {"id": "psid-9"}, "recipient": {"id": "777"},
           "timestamp": int(time.time() * 1000), "postback": {"title": "Үнэ хэд вэ?", "payload": "FAQ_0", "mid": "pb1"}}]}]}
    post_event(client, ice)
    assert sent_texts(fb)[-1]["text"] == "Үнийг ойрын салбараас лавлана уу."
    start = {"object": "page", "entry": [{"id": "777", "messaging": [{"sender": {"id": "psid-9"}, "recipient": {"id": "777"},
             "timestamp": int(time.time() * 1000), "postback": {"title": "Эхлэх", "payload": "GET_STARTED", "mid": "pb2"}}]}]}
    post_event(client, start)
    assert sent_texts(fb)[-1]["text"].startswith("Сайн байна уу!")


def test_failed_auto_reply_is_visible_to_admin(client, fb):
    connect(client)
    save_welcome(client)
    fb.fail["me/messages"] = (10, None, "(#10) Application does not have permission for this action")
    post_event(client, event(mid="f1"))
    err = client.get("/api/admin/messenger", headers=AUTH).json()["last_error"]
    assert err["context"] == "Автомат хариу илгээх" and "Эрх" in err["message"]
    assert len(client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"]) == 1  # message still stored


def test_send_welcome_manually(client, fb):
    connect(client)
    post_event(client, event(mid="w1"))
    save_welcome(client)
    assert client.post("/api/admin/messenger/threads/psid-1/welcome", headers=AUTH).status_code == 200
    assert sent_texts(fb)[-1]["text"].startswith("Сайн байна уу!")
