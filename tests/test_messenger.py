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
    "EAAUserWithIgToken000000000": {"app_id": APP_ID, "type": "USER", "is_valid": True,
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages"]},
    "EAAUserNoPagesToken00000000": {"app_id": APP_ID, "type": "USER", "is_valid": True, "scopes": SCOPES},
    "EAASystemUserToken000000000": {"app_id": APP_ID, "type": "SYSTEM_USER", "is_valid": True, "expires_at": 0,
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages", "business_management"]},
    "EAASystemUserNoAssets000000": {"app_id": APP_ID, "type": "SYSTEM_USER", "is_valid": True, "scopes": SCOPES},
    "EAASystemUserNoList00000000": {"app_id": APP_ID, "type": "SYSTEM_USER", "is_valid": True,
                                    "scopes": ["pages_messaging", "instagram_basic", "instagram_manage_messages"],
                                    "granular_scopes": [{"scope": "pages_messaging", "target_ids": ["777"]}]},
    "EAASystemUserIgOnly00000000": {"app_id": APP_ID, "type": "SYSTEM_USER", "is_valid": True,
                                    "scopes": ["instagram_basic", "instagram_manage_comments", "instagram_content_publish",
                                               "instagram_manage_messages", "public_profile"]},
    "EAASystemUserFull0000000000": {"app_id": APP_ID, "type": "SYSTEM_USER", "is_valid": True, "expires_at": 0,
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages"],
                                    "granular_scopes": [{"scope": "pages_messaging", "target_ids": ["777"]},
                                                        {"scope": "instagram_basic", "target_ids": ["17841400000000001"]}]},
    "EAAPageNoIgGranular0000000": {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777", "expires_at": 0,
                                   "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages"]},
    "EAAUserBizPageToken00000000": {"app_id": APP_ID, "type": "USER", "is_valid": True,
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages", "pages_utility_messaging",
                                                        "public_profile"],
                                    "granular_scopes": [{"scope": "pages_messaging", "target_ids": ["777"]},
                                                        {"scope": "instagram_basic", "target_ids": ["17841400000000001"]}]},
    "EAAUserBizNoEngage000000000": {"app_id": APP_ID, "type": "USER", "is_valid": True,
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages"],
                                    "granular_scopes": [{"scope": "pages_messaging", "target_ids": ["777"]}]},
    "EAAUserBizMgmtToken00000000": {"app_id": APP_ID, "type": "USER", "is_valid": True,
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages", "business_management"],
                                    "granular_scopes": [{"scope": "pages_messaging", "target_ids": ["777"]},
                                                        {"scope": "instagram_basic", "target_ids": ["17841400000000001"]}]},
    "EAAAppTypeToken000000000000": {"app_id": APP_ID, "type": "APP", "is_valid": True, "scopes": []},
    "EAAOtherAppToken00000000000": {"app_id": "999", "type": "PAGE", "is_valid": True, "profile_id": "777", "scopes": SCOPES},
    "EAANoScopeToken000000000000": {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777",
                                    "scopes": ["pages_show_list"]},
    "EAAMessagingOnlyToken000000": {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777",
                                    "scopes": ["pages_messaging", "pages_show_list"]},
    "EAAWithInstagramToken000000": {"app_id": APP_ID, "type": "PAGE", "is_valid": True, "profile_id": "777",
                                    "scopes": SCOPES + ["instagram_basic", "instagram_manage_messages"],
                                    "granular_scopes": [{"scope": "pages_messaging", "target_ids": ["777"]},
                                                        {"scope": "instagram_manage_messages", "target_ids": ["17841400000000001"]}]},
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
        if q.get("access_token") in ("EAALongUserBizNoEngage000000000", "EAALongUserBizMgmtToken00000000"):
            if path == "me/accounts":
                return httpx.Response(200, json={"data": []})
            if path == "me/businesses":
                return httpx.Response(200, json={"data": [{"id": "biz1"}]})
            if path == "biz1/owned_pages":
                return httpx.Response(200, json={"data": [{"id": "777", "name": "ДОМЧ", "access_token": "EAAWithInstagramToken000000"}]})
            if path == "777":
                return httpx.Response(400, json={"error": {"code": 100, "message": PAGES_READ_ERROR}})
        if path == "me/accounts" and q.get("access_token") == "EAALongUserBizPageToken00000000":
            if "instagram_business_account" in q.get("fields", ""):
                return httpx.Response(400, json={"error": {"code": 100, "message": PAGES_READ_ERROR}})
            return httpx.Response(200, json={"data": []})  # a Page managed through the Business portfolio
        if request.method == "GET" and path == "777" and q.get("access_token") == "EAALongUserBizPageToken00000000":
            if q.get("fields") != "access_token":
                return httpx.Response(400, json={"error": {"code": 100, "message": PAGES_READ_ERROR}})
            return httpx.Response(200, json={"access_token": "EAAWithInstagramToken000000"})
        if request.method == "GET" and path == "777" and q.get("access_token") == "EAASystemUserNoList00000000":
            return httpx.Response(200, json={"id": "777", "name": "ДОМЧ", "access_token": "EAAWithInstagramToken000000",
                                             "instagram_business_account": {"id": "17841400000000001"}})
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
        if path == "oauth/access_token":  # short-lived user token → long-lived
            assert q["client_secret"] == APP_SECRET and q["grant_type"] == "fb_exchange_token"
            return httpx.Response(200, json={"access_token": "EAALong" + q["fb_exchange_token"][3:], "expires_in": 5183944})
        if path == "me/accounts":
            pages = {
                "EAALongUserToken000000000000000": [{"id": "777", "name": "ДОМЧ", "access_token": PAGE_TOKEN}],
                "EAASystemUserFull0000000000": [{"id": "777", "name": "ДОМЧ", "access_token": "EAAPageNoIgGranular0000000"}],
                "EAASystemUserToken000000000": [
                    {"id": "777", "name": "ДОМЧ", "access_token": "EAAWithInstagramToken000000",
                     "instagram_business_account": {"id": "17841400000000001"}}],
                "EAALongUserWithIgToken000000000": [
                    {"id": "888", "name": "Өөр Page", "access_token": "EAAOtherPageToken0000000000"},
                    {"id": "777", "name": "ДОМЧ", "access_token": "EAAWithInstagramToken000000",
                     "instagram_business_account": {"id": "17841400000000001"}}],
            }.get(q["access_token"], [])
            return httpx.Response(200, json={"data": pages})
        if path == "me/messages":
            return httpx.Response(200, json={"recipient_id": body["recipient"]["id"], "message_id": f"m_out_{len(self.calls)}"})
        if path == "me/messenger_profile":
            return httpx.Response(200, json={"result": "success"})
        if path == "17841400000000001":
            return httpx.Response(200, json={"id": path, "username": "domch.mn"})
        if path == "777/messages":
            return httpx.Response(200, json={"recipient_id": body["recipient"]["id"], "message_id": f"ig_out_{len(self.calls)}"})
        if path.startswith("igsid"):
            return httpx.Response(200, json={"name": "Сарнай", "username": "sarnai"})
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
    monkeypatch.setattr(messenger, "INBOX_GRACE", 0)
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
    assert all(s["ok"] for k, s in steps.items() if k != "instagram"), steps
    assert steps["instagram"]["warn"] and "instagram_manage_messages" in steps["instagram"]["message"]
    assert "777" in steps["token"]["message"] and "хугацаагүй" in steps["token"]["message"]
    cfg = res.json()["config"]
    assert cfg["page_id"] == "777" and cfg["connected_at"]
    assert cfg["webhook_url"] == "https://domch.gem.mn/api/messenger/webhook"  # always the primary domain
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
    for token, text in (("EAAOtherAppToken00000000000", "өөр аппынх"), ("EAANoScopeToken000000000000", "pages_messaging"),
                        ("IGAAInstagramLoginToken0000", "Instagram-аар нэвтэрч"), ("EAAAppTypeToken000000000000", "APP token")):
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
    assert all(s["ok"] for s in steps if s["key"] != "instagram"), steps
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


IG_ID = "17841400000000001"


def ig_event(igsid="igsid-1", text="Сайн байна уу, үнэ хэд вэ?", mid="ig1", echo=False):
    sender, recipient = (IG_ID, igsid) if echo else (igsid, IG_ID)
    message = {"mid": mid, "text": text}
    if echo:
        message["is_echo"] = True
    return {"object": "instagram", "entry": [{"id": IG_ID, "time": 0, "messaging": [{
        "sender": {"id": sender}, "recipient": {"id": recipient}, "timestamp": int(time.time() * 1000), "message": message}]}]}


def test_instagram_connects_with_the_same_page_token(client, fb):
    res = connect(client, page_token="EAAWithInstagramToken000000")
    steps = {s["key"]: s for s in res.json()["steps"]}
    assert steps["instagram"]["ok"] and "@domch.mn" in steps["instagram"]["message"]
    sub = [c for c in fb.calls if c[1] == f"{APP_ID}/subscriptions"]
    assert {c[2]["object"] for c in sub} == {"page", "instagram"}
    cfg = res.json()["config"]
    assert cfg["ig_id"] == IG_ID and cfg["ig_username"] == "domch.mn" and cfg["ig_status"] == "1" and cfg["connected_at"]


def test_instagram_dm_is_stored_and_answered(client, fb):
    connect(client, page_token="EAAWithInstagramToken000000", auto_reply="Сайн байна уу! ДОМЧ-д тавтай морил.")
    raw, headers = signed(ig_event())
    assert client.post("/api/messenger/webhook", content=raw, headers=headers).text == "EVENT_RECEIVED"
    sends = [c for c in fb.calls if c[1] == "777/messages"]
    assert len(sends) == 1 and sends[0][3]["recipient"] == {"id": "igsid-1"}
    thread = client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"][0]
    assert thread["channel"] == "instagram" and thread["name"] == "Сарнай"
    # the echo of our own reply is not mistaken for a person typing in the Instagram app
    raw, headers = signed(ig_event(text="Сайн байна уу! ДОМЧ-д тавтай морил.", mid=sends[0][3] and "ig_out_echo", echo=True))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    convo = client.get("/api/admin/messenger/threads/igsid-1", headers=AUTH).json()
    assert convo["channel"] == "instagram" and convo["ai_paused_until"] == ""
    # an admin reply goes out through Instagram too
    assert client.post("/api/admin/messenger/threads/igsid-1/reply", json={"text": "Баярлалаа!"}, headers=AUTH).status_code == 200
    assert [c for c in fb.calls if c[1] == "777/messages"][-1][3]["message"]["text"] == "Баярлалаа!"
    # a reply typed in the Instagram app pauses the AI for this person
    raw, headers = signed(ig_event(text="Ажилтан хариулж байна", mid="ig-human", echo=True))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    convo = client.get("/api/admin/messenger/threads/igsid-1", headers=AUTH).json()
    assert any(m["kind"] == "inbox" for m in convo["items"])


def test_instagram_ice_breakers_follow_the_welcome(client, fb):
    connect(client, page_token="EAAWithInstagramToken000000")
    res = client.put("/api/admin/messenger/welcome", headers={**AUTH, **HTTPS},
                     json={"auto_reply": "Сайн байна уу!", "faq": [{"q": "Үнэ хэд вэ?", "a": "Салбараас лавлана уу."}]})
    assert "Instagram" in res.json()["sync"]["message"]
    ig = [c for c in fb.calls if c[1] == "me/messenger_profile" and c[2].get("platform") == "instagram"]
    assert ig and ig[0][3]["ice_breakers"][0]["call_to_actions"][0]["payload"] == "FAQ_0"


# ------------------------------------------------------------------ primary domain (domch.gem.mn)

OLD = "https://domchamzailagch.vercel.app"
OLD_HOST = {"x-forwarded-proto": "https", "x-forwarded-host": "domchamzailagch.vercel.app"}


def post_event_via(client, ev, host_headers):
    raw, headers = signed(ev)
    return client.post("/api/messenger/webhook", content=raw, headers={**headers, **host_headers})


def subscriptions(fb):
    return [c for c in fb.calls if c[1] == f"{APP_ID}/subscriptions"]


def test_primary_domain_is_used_everywhere_but_locally(client, monkeypatch):
    from _lib import common

    class Req:
        def __init__(self, headers, scheme="http", netloc="testserver"):
            self.headers = headers
            self.url = type("U", (), {"scheme": scheme, "netloc": netloc})()

    assert common.site_url(Req(OLD_HOST)) == "https://domch.gem.mn"
    assert common.site_url(Req({"host": "domch.gem.mn"}, scheme="https")) == "https://domch.gem.mn"
    assert common.site_url(Req({"host": "localhost:5173"})) == "http://localhost:5173"
    assert common.site_url(Req({"host": "127.0.0.1:8000"})) == "http://127.0.0.1:8000"
    assert common.site_url(Req({"x-forwarded-proto": "https", "x-forwarded-host": "test.local"})) == "https://test.local"
    assert common.public_links(f"Салбарууд: {OLD}/#where, https://domch-amzailagch.vercel.app") == \
        "Салбарууд: https://domch.gem.mn/#where, https://domch.gem.mn"
    assert common.public_links("https://other-site.vercel.app/x") == "https://other-site.vercel.app/x"
    monkeypatch.setenv("SITE_URL", "https://www.domch.mn/")
    assert common.site_url(Req(OLD_HOST)) == "https://www.domch.mn"


def test_replies_never_link_to_the_old_address(client, fb):
    connect(client)
    save_welcome(client, faq=[{"q": "Хаанаас авах вэ?", "a": f"Салбаруудыг эндээс харна уу: {OLD}/#where"}])
    quick = event(text="Хаанаас авах вэ?", mid="l1")
    quick["entry"][0]["messaging"][0]["message"]["quick_reply"] = {"payload": "FAQ_0"}
    post_event_via(client, quick, OLD_HOST)
    text = sent_texts(fb)[-1]["text"]
    assert text == "Салбаруудыг эндээс харна уу: https://domch.gem.mn/#where"
    thread = client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()
    assert all("vercel.app" not in (m["text"] or "") for m in thread["items"])


def test_webhook_moves_to_the_primary_domain(client, fb):
    connect(client)
    messenger.store(dbmod.get_db(), {"webhook_url": f"{OLD}/api/messenger/webhook"})  # registered before the move
    view = client.get("/api/admin/messenger", headers={**AUTH, **HTTPS}).json()
    assert view["webhook_saved"] != view["webhook_url"] == "https://domch.gem.mn/api/messenger/webhook"

    fb.calls.clear()
    post_event_via(client, event(text="Сайн уу", mid="w1"), OLD_HOST)  # Facebook still calls the old address
    subs = subscriptions(fb)
    assert [s[2]["object"] for s in subs] == ["page"]
    assert subs[0][2]["callback_url"] == "https://domch.gem.mn/api/messenger/webhook"
    cfg = messenger.load(dbmod.get_db())
    assert cfg["webhook_url"] == "https://domch.gem.mn/api/messenger/webhook"

    fb.calls.clear()
    post_event_via(client, event(text="Баярлалаа", mid="w2"), OLD_HOST)
    assert subscriptions(fb) == []  # already moved


def test_failed_webhook_move_keeps_the_old_one_and_waits(client, fb):
    connect(client, page_token="EAAWithInstagramToken000000")
    messenger.store(dbmod.get_db(), {"webhook_url": f"{OLD}/api/messenger/webhook"})
    fb.calls.clear()
    fb.fail[f"{APP_ID}/subscriptions"] = (2200, None, "Callback verification failed")
    post_event_via(client, event(text="Сайн уу", mid="f1"), OLD_HOST)
    cfg = messenger.load(dbmod.get_db())
    assert cfg["webhook_url"] == f"{OLD}/api/messenger/webhook" and cfg["webhook_tried_at"]
    assert "шинэ хаяг" in messenger.parse_error(cfg)["context"]
    del fb.fail[f"{APP_ID}/subscriptions"]
    fb.calls.clear()
    post_event_via(client, event(text="Сайн уу", mid="f2"), OLD_HOST)
    assert subscriptions(fb) == []  # retried at most once an hour
    messenger.store(dbmod.get_db(), {"webhook_tried_at": "2000-01-01 00:00:00"})
    post_event_via(client, event(text="Сайн уу", mid="f3"), OLD_HOST)
    assert [s[2]["object"] for s in subscriptions(fb)] == ["page", "instagram"]  # Instagram moves along
    assert messenger.load(dbmod.get_db())["webhook_url"] == "https://domch.gem.mn/api/messenger/webhook"


# ------------------------------------------------------------------ user token from Graph API Explorer

def test_user_token_from_graph_explorer_becomes_a_page_token(client, fb):
    """The fix for «Token-д instagram_manage_messages эрх алга»: a user token with the Instagram permissions."""
    res = connect(client, page_token="EAAUserWithIgToken000000000")
    steps = res.json()["steps"]
    assert steps[0]["key"] == "exchange" and steps[0]["ok"] and "«ДОМЧ»" in steps[0]["message"]
    assert steps[1]["key"] == "token" and steps[1]["ok"]
    ig = next(s for s in steps if s["key"] == "instagram")
    assert ig["ok"] and "@domch.mn" in ig["message"]
    cfg = messenger.load(dbmod.get_db())
    assert cfg["page_token"] == "EAAWithInstagramToken000000"  # the Page with the Instagram account, not «Өөр Page»
    assert cfg["ig_status"] == "1" and cfg["page_id"] == "777"
    exchange = next(c for c in fb.calls if c[1] == "oauth/access_token")
    assert exchange[2]["fb_exchange_token"] == "EAAUserWithIgToken000000000"  # long-lived first: the Page token never expires
    assert "EAAUserWithIg" not in json.dumps(client.get("/api/admin/messenger", headers=AUTH).json())


def test_user_token_keeps_the_connected_page(client, fb):
    connect(client)  # Page 777 connected with the Messenger token
    res = connect(client, page_token="EAAUserToken000000000000000").json()["steps"]
    assert res[0]["ok"] and messenger.load(dbmod.get_db())["page_token"] == PAGE_TOKEN


def test_user_token_without_pages_says_so(client, fb):
    step = connect(client, page_token="EAAUserNoPagesToken00000000").json()["steps"][0]
    assert not step["ok"] and "Page олдсонгүй" in step["message"] and "Нэвтрэх цонхонд" in step["message"]


def test_missing_instagram_permission_lists_what_the_token_has(client, fb):
    steps = connect(client).json()["steps"]
    ig = next(s for s in steps if s["key"] == "instagram")
    assert ig["warn"] and "instagram_basic, instagram_manage_messages эрх алга" in ig["message"]
    assert "одоо байгаа эрх: pages_messaging, pages_manage_metadata, pages_show_list" in ig["message"]
    assert "developers.facebook.com/tools/explorer" in ig["message"] and "хугацаагүй" in ig["message"]
    assert "«Page access token» талбарт" in ig["message"]


def test_reported_case_system_user_token_gives_page_and_instagram(client, fb):
    """«Энэ нь SYSTEM_USER token байна»: a system user token now works for Messenger and Instagram together."""
    steps = connect(client, page_token="EAASystemUserToken000000000").json()["steps"]
    assert steps[0] == {"key": "exchange", "label": "System user token → Page token", "ok": True, "warn": False,
                        "message": "«ДОМЧ» Page-ийн хугацаагүй token үүсгэж хадгаллаа"}
    assert next(s for s in steps if s["key"] == "instagram")["ok"]
    assert messenger.load(dbmod.get_db())["page_token"] == "EAAWithInstagramToken000000"
    assert not any(c[1] == "oauth/access_token" for c in fb.calls)  # a system user token is not exchanged


def test_system_user_without_the_page_assigned_says_how(client, fb):
    step = connect(client, page_token="EAASystemUserNoAssets000000").json()["steps"][0]
    assert not step["ok"] and "Assign assets" in step["message"]
    assert "token-ийн эрх: pages_messaging, pages_manage_metadata, pages_show_list; Page олгогдсон: үгүй" in step["message"]


def test_system_user_without_page_list_finds_the_page_by_id(client, fb):
    """me/accounts is empty without pages_show_list; the Page granted to the token is asked for directly."""
    steps = connect(client, page_token="EAASystemUserNoList00000000").json()["steps"]
    assert steps[0]["key"] == "exchange" and steps[0]["ok"]
    assert messenger.load(dbmod.get_db())["page_token"] == "EAAWithInstagramToken000000"


def test_a_failing_new_token_keeps_the_working_one(client, fb):
    connect(client)  # working Messenger token
    steps = connect(client, page_token="EAANoScopeToken000000000000").json()["steps"]
    assert steps[-1]["key"] == "kept" and steps[-1]["warn"]
    cfg = messenger.load(dbmod.get_db())
    assert cfg["page_token"] == PAGE_TOKEN and cfg["connected_at"] and cfg["page_id"] == "777"


def test_reported_case_instagram_only_system_user_token(client, fb):
    """«token-ийн эрх: instagram_basic, …, public_profile; Page олгогдсон: үгүй»: say which Page permissions to tick."""
    step = connect(client, page_token="EAASystemUserIgOnly00000000").json()["steps"][0]
    assert not step["ok"] and "Facebook Page-ийн эрх огт алга" in step["message"]
    assert "pages_show_list, pages_messaging, pages_manage_metadata-г сонгоно" in step["message"]
    assert "Assign assets" in step["message"]


def test_reported_case_instagram_found_from_the_system_user_grant(client, fb):
    """«Энэ Page-тэй холбосон Instagram аккаунт олдсонгүй»: the Page token alone could not read the link, but the
    Instagram account was granted to the system user, so it is taken from there."""
    steps = connect(client, page_token="EAASystemUserFull0000000000").json()["steps"]
    ig = next(s for s in steps if s["key"] == "instagram")
    assert ig["ok"] and "@domch.mn" in ig["message"], ig
    cfg = messenger.load(dbmod.get_db())
    assert cfg["ig_id"] == "17841400000000001" and cfg["page_token"] == "EAAPageNoIgGranular0000000"


def test_reported_case_link_unreadable_without_pages_read_engagement(client, fb):
    """«(#100) … requires the 'pages_read_engagement' permission»: subscribe Instagram anyway, learn the account
    from the first DM."""
    steps = connect(client, page_token="EAAPageNoIgGranular0000000").json()["steps"]
    ig = next(s for s in steps if s["key"] == "instagram")
    assert ig["warn"] and "webhook бүртгэгдлээ" in ig["message"] and "pages_read_engagement" in ig["message"]
    assert [c[2]["object"] for c in fb.calls if c[1] == f"{APP_ID}/subscriptions"][-1] == "instagram"
    assert messenger.load(dbmod.get_db())["ig_status"] == "pending"
    raw, headers = signed(ig_event(text="Сайн байна уу", mid="first-ig"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    cfg = messenger.load(dbmod.get_db())
    assert cfg["ig_status"] == "1" and cfg["ig_id"] == IG_ID and cfg["ig_username"] == "domch.mn"
    view = client.get("/api/admin/messenger/threads", headers=AUTH).json()
    assert any(t.get("channel") == "instagram" for t in view["items"])


# ------------------------------------------------------------------ separate Instagram token

def test_reported_case_messenger_and_instagram_each_with_their_own_token(client, fb):
    """The system user token could not message customers on Messenger: Messenger keeps its own Page token,
    Instagram gets the system user token in its own field."""
    steps = connect(client, ig_token="EAASystemUserToken000000000").json()["steps"]
    by = {s["key"]: s for s in steps}
    assert by["token"]["ok"] and by["instagram"]["ok"] and "@domch.mn" in by["instagram"]["message"]
    cfg = messenger.load(dbmod.get_db())
    assert cfg["page_token"] == PAGE_TOKEN and cfg["ig_page_token"] == "EAAWithInstagramToken000000"
    view = client.get("/api/admin/messenger", headers=AUTH).json()
    assert view["ig_token"]["set"] and "EAASystem" not in json.dumps(view)
    save_welcome(client)
    fb.calls.clear()
    raw, headers = signed(ig_event(text="Үнэ хэд вэ?", mid="two-1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    raw, headers = signed(event(psid="psid-two", text="Сайн уу", mid="two-2"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    tokens = {c[1]: c[2]["access_token"] for c in fb.calls if c[1] in ("777/messages", "me/messages")}
    assert tokens == {"777/messages": "EAAWithInstagramToken000000", "me/messages": PAGE_TOKEN}
    # removing it puts Instagram back on the Messenger token
    res = client.put("/api/admin/messenger", json={"ig_token_clear": True, "connect": True}, headers={**AUTH, **HTTPS})
    assert not res.json()["config"]["ig_token"]["set"] and messenger.load(dbmod.get_db())["ig_page_token"] == ""


def test_instagram_token_problems_do_not_touch_messenger(client, fb):
    steps = connect(client, ig_token="EAAOtherAppToken00000000000").json()["steps"]
    by = {s["key"]: s for s in steps}
    assert by["token"]["ok"] and by["instagram"]["warn"] and "өөр аппынх" in by["instagram"]["message"]
    assert messenger.load(dbmod.get_db())["connected_at"]


def test_reported_case_review_refusal_is_explained(client, fb):
    """«Cannot message users who are not admins, developers or testers of the app …»"""
    connect(client)
    fb.fail["me/messages"] = (10, 2018336, "(#10) Cannot message users who are not admins, developers or testers of the app"
                              " until pages_messaging permission is reviewed and the app is live.")
    save_welcome(client)
    raw, headers = signed(event(psid="psid-new", text="Сайн уу", mid="rv1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    err = client.get("/api/admin/messenger", headers=AUTH).json()["last_error"]
    assert "зөвхөн апп дээр эрхтэй" in err["message"] and "Graph API Explorer" in err["message"]


def test_changing_the_messenger_token_keeps_instagram(client, fb):
    connect(client, ig_token="EAASystemUserToken000000000")
    steps = connect(client, page_token="EAAMessagingOnlyToken000000").json()["steps"]  # a new Messenger token only
    assert next(s for s in steps if s["key"] == "instagram")["ok"]
    cfg = messenger.load(dbmod.get_db())
    assert cfg["ig_id"] == "17841400000000001" and cfg["page_token"] == "EAAMessagingOnlyToken000000"


def test_reported_case_business_page_without_pages_read_engagement(client, fb):
    """«Page олдсонгүй (… Page олгогдсон: тийм)»: the Page is asked for its token with the fields any token may read."""
    steps = connect(client, page_token="EAAUserBizPageToken00000000").json()["steps"]
    by = {s["key"]: s for s in steps}
    assert by["exchange"]["ok"] and by["token"]["ok"] and by["instagram"]["ok"], steps
    cfg = messenger.load(dbmod.get_db())
    assert cfg["page_token"] == "EAAWithInstagramToken000000" and cfg["ig_id"] == "17841400000000001"


def test_reported_case_business_page_needs_pages_read_engagement(client, fb):
    """«Page олгогдсон: тийм; Facebook: (#100) … requires the 'pages_read_engagement' permission»: say what to add."""
    step = connect(client, page_token="EAAUserBizNoEngage000000000").json()["steps"][0]
    assert not step["ok"] and "pages_read_engagement болон business_management эрхийг нэмж" in step["message"]


def test_business_management_finds_the_page_through_the_portfolio(client, fb):
    steps = connect(client, page_token="EAAUserBizMgmtToken00000000").json()["steps"]
    by = {s["key"]: s for s in steps}
    assert by["exchange"]["ok"] and by["instagram"]["ok"], steps
    assert messenger.load(dbmod.get_db())["page_token"] == "EAAWithInstagramToken000000"


def test_reported_case_messenger_token_without_instagram_keeps_instagram_on_the_old_token(client, fb):
    """Instagram works with the system user's token; a Messenger-only token («Generate access tokens») is added for
    Messenger: Instagram keeps going with the token it had."""
    connect(client, page_token="EAASystemUserToken000000000")  # → Page token with Instagram (works for Instagram)
    assert messenger.load(dbmod.get_db())["ig_status"] == "1"
    steps = connect(client, page_token="EAAMessagingOnlyToken000000").json()["steps"]
    by = {s["key"]: s for s in steps}
    assert by["token"]["ok"] and by["instagram"]["ok"] and by["ig_kept"]["ok"], steps
    cfg = messenger.load(dbmod.get_db())
    assert cfg["page_token"] == "EAAMessagingOnlyToken000000"
    assert cfg["ig_token"] == "EAAWithInstagramToken000000" and cfg["ig_page_token"] == "EAAWithInstagramToken000000"


def test_connecting_pushes_the_greeting_screen_again(client, fb):
    """After a token change the greeting and quick questions are sent to Facebook with the new token."""
    connect(client)
    save_welcome(client)
    fb.calls.clear()
    steps = connect(client, page_token="EAAWithInstagramToken000000").json()["steps"]
    assert next(s for s in steps if s["key"] == "profile")["ok"]
    profile = [c for c in fb.calls if c[1] == "me/messenger_profile" and c[0] == "POST"]
    assert profile and profile[0][2]["access_token"] == "EAAWithInstagramToken000000"
    assert any((c[3] or {}).get("platform") == "instagram" for c in profile)  # Instagram's quick questions too


# ------------------------------------------------------------------ conversation list (D1 reads)

def _msg(db, psid, direction, text, at, mid=None, is_read=0):
    db.run("INSERT OR IGNORE INTO messenger_messages (psid, direction, kind, text, mid, is_read, created_at)"
           " VALUES (?, ?, 'message', ?, ?, ?, ?)", (psid, direction, text, mid, is_read, at))


def _threads(client):
    return {t["psid"]: t for t in client.get("/api/admin/messenger/threads", headers=AUTH).json()["items"]}


def test_thread_list_is_kept_by_triggers(client):
    db = dbmod.get_db()
    _msg(db, "a", "in", "сайн уу", "2026-11-10 01:00:00", mid="m1")
    _msg(db, "a", "in", "үнэ хэд вэ", "2026-11-10 01:00:05", mid="m2")
    _msg(db, "a", "in", "үнэ хэд вэ", "2026-11-10 01:00:05", mid="m2")  # retried delivery: ignored
    _msg(db, "a", "out", "4 500₮", "2026-11-10 01:00:09", is_read=1)
    _msg(db, "b", "in", "хаана авах вэ", "2026-11-10 02:00:00", mid="m3")
    t = _threads(client)
    assert list(t) == ["b", "a"]  # newest conversation first
    assert (t["a"]["unread"], t["a"]["last_text"], t["a"]["last_direction"]) == (2, "4 500₮", "out")
    assert t["a"]["last_in_at"] == "2026-11-10 01:00:05" and t["a"]["last_at"] == "2026-11-10 01:00:09"
    summary = client.get("/api/admin/summary?events=0", headers=AUTH).json()
    assert summary["counts"]["messenger_unread"] == 3 and "events" not in summary

    client.get("/api/admin/messenger/threads/a", headers=AUTH)  # opening the conversation reads it
    assert _threads(client)["a"]["unread"] == 0 and _threads(client)["b"]["unread"] == 1
    assert client.delete("/api/admin/messenger/threads/a", headers=AUTH).status_code == 200
    assert list(_threads(client)) == ["b"]


def test_thread_list_is_backfilled_for_older_databases(client, monkeypatch):
    db = dbmod.get_db()
    db.script("DROP TRIGGER trg_messenger_thread_in; DROP TRIGGER trg_messenger_thread_read; DROP TABLE messenger_threads;")
    _msg(db, "old", "in", "асуулт", "2026-11-01 01:00:00", mid="o1")
    _msg(db, "old", "out", "хариу", "2026-11-01 01:00:03", is_read=1)
    monkeypatch.setattr(messenger, "_schema_ready", False)
    t = _threads(client)["old"]
    assert (t["unread"], t["last_text"], t["last_in_at"]) == (1, "хариу", "2026-11-01 01:00:00")
    _msg(db, "old", "in", "дахиад", "2026-11-01 02:00:00", mid="o2")  # triggers work after the upgrade
    assert _threads(client)["old"]["unread"] == 2


def test_thread_list_pages_counts_and_filters(client, fb):
    connect(client)
    db = dbmod.get_db()
    for i in range(7):
        db.run("INSERT INTO messenger_messages (psid, direction, kind, text, mid, created_at, is_read)"
               " VALUES (?, 'in', 'message', ?, ?, ?, ?)", (f"p{i}", f"мессеж {i}", f"m{i}", f"2026-11-0{i + 1} 10:00:00", i % 3 != 0))
    first = client.get("/api/admin/messenger/threads?limit=3", headers=AUTH).json()
    assert [t["psid"] for t in first["items"]] == ["p6", "p5", "p4"] and first["has_more"]
    assert first["total"] == 7 and first["unread_total"] == 3  # p0, p3, p6
    rest = client.get("/api/admin/messenger/threads?limit=3&offset=6&counts=0", headers=AUTH).json()
    assert [t["psid"] for t in rest["items"]] == ["p0"] and not rest["has_more"] and "total" not in rest
    unread = client.get("/api/admin/messenger/threads?unread=1", headers=AUTH).json()["items"]
    assert [t["psid"] for t in unread] == ["p6", "p3", "p0"]
    found = client.get("/api/admin/messenger/threads?q=мессеж 4", headers=AUTH).json()["items"]
    assert [t["psid"] for t in found] == ["p4"]


def test_insights_topics_and_partner_requests_from_chats(client, fb):
    from _lib import insights

    connect(client)
    for i, (psid, text) in enumerate([("a", "Үнэ хэд вэ?"), ("b", "une hed we"), ("a", "Хүргэлт байгаа юу"),
                                      ("c", "Манай эмийн сан борлуулмаар байна, бөөний үнэ хэд вэ"), ("c", "99112233 руу залгаарай"),
                                      ("d", "Hi"), ("e", "Азид байхгүй байна"), ("c", "Гэрээт борлуулагч болох уу")]):
        assert post_event(client, event(psid=psid, text=text, mid=f"mx{i}")).status_code == 200
    # the chat already made one partner request for «c»; a second partnership message updates it, never duplicates
    rows = dbmod.get_db().all("SELECT * FROM partner_requests WHERE source_ref = 'messenger:c'")
    assert len(rows) == 1 and "Гэрээт" in rows[0]["message"] and rows[0]["source"] == "messenger" and rows[0]["kind"] == "pharmacy"
    insights._cache.clear()
    data = client.get("/api/admin/messenger/insights", headers=AUTH).json()
    topics = {t["key"]: t for t in data["topics"]}
    assert topics["price"]["people"] == 3 and topics["delivery"]["people"] == 1 and topics["stock"]["people"] == 1
    assert topics["partner"]["people"] == 1 and topics["greeting"]["people"] == 1
    assert data["people"] == 5 and data["top_questions"][0]["people"] == 2  # «Үнэ хэд вэ?» and «une hed we» are one question
    assert data["partners_added"] == 0
    inbox = client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"]
    assert len(inbox) == 1 and inbox[0]["source"] == "messenger"
    # deleting it is remembered: the next look at the chats does not bring it back
    client.delete(f"/api/admin/inbox/partners/{inbox[0]['id']}", headers=AUTH)
    insights._cache.clear()
    client.get("/api/admin/messenger/insights", headers=AUTH)
    post_event(client, event(psid="c", text="Хамтран ажиллах уу", mid="mx99"))
    assert client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"] == []


def test_chat_partner_links_to_site_request_with_same_phone(client, fb):
    connect(client)
    client.post("/api/partners", json={"kind": "pharmacy", "org": "Номин эмийн сан", "contact_name": "Сараа", "phone": "9911 2233",
                                       "consent": True})
    post_event(client, event(psid="z", text="Бөөнөөр авмаар байна 9911-2233", mid="mz1"))
    items = client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"]
    assert len(items) == 1 and items[0]["source_ref"] == "messenger:z"


def test_chat_partner_request_asks_for_phone_once_and_saves_it(client, fb):
    from _lib import insights

    connect(client)
    post_event(client, event(psid="w", text="Бөөний үнээр авч зарах гэсэн юм", mid="w1"))
    texts = [m.get("text", "") for m in sent_texts(fb)]
    assert texts.count(insights.ASK_PHONE) == 1
    post_event(client, event(psid="w", text="Гэрээт борлуулагч болох уу", mid="w2"))
    assert [m.get("text", "") for m in sent_texts(fb)].count(insights.ASK_PHONE) == 1  # asked once only
    before = len(sent_texts(fb))
    post_event(client, event(psid="w", text="9911 2233", mid="w3"))
    after = [m.get("text", "") for m in sent_texts(fb)][before:]
    assert after == [insights.THANK_PHONE.format(phone="9911-2233")]  # just the thanks, no AI answer to a bare number
    row = dbmod.get_db().one("SELECT phone FROM partner_requests WHERE source_ref = 'messenger:w'")
    assert row["phone"] == "9911-2233"
    shown = client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"]
    assert [r["source_ref"] for r in shown] == ["messenger:w"]


def test_chat_partner_with_phone_in_first_message_is_not_asked(client, fb):
    from _lib import insights

    connect(client)
    post_event(client, event(psid="v", text="Эмийн сандаа нийлүүлмээр байна, утас 8811-2233", mid="v1"))
    assert insights.ASK_PHONE not in [m.get("text", "") for m in sent_texts(fb)]
    assert dbmod.get_db().one("SELECT phone FROM partner_requests WHERE source_ref = 'messenger:v'")["phone"] == "8811-2233"


def test_admin_sets_partner_phone(client, fb):
    connect(client)
    post_event(client, event(psid="u", text="Хамтран ажиллах уу", mid="u1"))
    assert client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"] == []  # no phone: not shown yet
    assert client.get("/api/admin/summary?events=0", headers=AUTH).json()["counts"]["partners_new"] == 0
    row = dbmod.get_db().one("SELECT id, phone FROM partner_requests WHERE source_ref = 'messenger:u'")
    assert row["phone"] is None
    assert client.patch(f"/api/admin/inbox/partners/{row['id']}", headers=AUTH, json={"phone": "abc"}).status_code == 422
    assert client.patch(f"/api/admin/inbox/partners/{row['id']}", headers=AUTH, json={"phone": ""}).status_code == 422
    assert client.patch(f"/api/admin/inbox/partners/{row['id']}", headers=AUTH, json={"phone": "99001122"}).status_code == 200
    assert client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"][0]["phone"] == "9900-1122"
    assert client.get("/api/admin/summary?events=0", headers=AUTH).json()["counts"]["partners_new"] == 1
    assert client.patch(f"/api/admin/inbox/questions/{row['id']}", headers=AUTH, json={"phone": "99001122"}).status_code == 422
