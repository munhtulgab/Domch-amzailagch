"""Gemini answers grounded in the knowledge base, doctor tips and FAQs (fake Gemini + fake Graph API)."""
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tests"))

from _lib import ai, messenger  # noqa: E402
from _lib import db as dbmod  # noqa: E402
from _lib.app import app  # noqa: E402
from test_messenger import APP_ID, AUTH, HTTPS, FakeGraph, connect, event, signed  # noqa: E402

KEY = "AIzaSyFakeGeminiKey0123456789abcdef"
MODELS = [
    {"name": "models/gemini-3.5-flash", "supportedGenerationMethods": ["generateContent", "countTokens"]},
    {"name": "models/gemini-3.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.6-flash-preview", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-3.5-flash-image", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/text-embedding-005", "supportedGenerationMethods": ["embedContent"]},
]


class FakeGemini:
    def __init__(self):
        self.calls = []
        self.reply = "Домч спирт агуулаагүй. Хүүхэд эцэг эхийн хяналтан дор хэрэглэнэ."
        self.status = 200
        self.overloaded = []

    def __call__(self, request: httpx.Request):
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, request.url.path, request.headers.get("x-goog-api-key"), body))
        if request.headers.get("x-goog-api-key") != KEY:
            return httpx.Response(400, json={"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}})
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"models": MODELS})
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"message": "Resource has been exhausted"}})
        if any(m in request.url.path for m in self.overloaded):
            return httpx.Response(503, json={"error": {"code": 503, "status": "UNAVAILABLE", "message":
                                  "This model is currently experiencing high demand. Spikes in demand are usually temporary."}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [
            {"text": "thinking...", "thought": True}, {"text": f"**{self.reply}**"}]}, "finishReason": "STOP"}]})


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID", "D1_DATABASE_ID",
                 "CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LOCAL_DB_PATH", str(tmp_path / "ai.db"))
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin-token")
    dbmod.reset_db()
    yield
    dbmod.reset_db()


@pytest.fixture
def gem(monkeypatch):
    fake = FakeGemini()
    monkeypatch.setattr(ai, "http", httpx.Client(transport=httpx.MockTransport(fake)))
    return fake


@pytest.fixture
def fb(monkeypatch):
    fake = FakeGraph()
    monkeypatch.setattr(messenger, "http", httpx.Client(transport=httpx.MockTransport(fake)))
    return fake


@pytest.fixture
def client():
    return TestClient(app)


def enable(client, **extra):
    body = {"gemini_key": KEY, "enabled": True, "instructions": "Үргэлж эелдэг бай."}
    body.update(extra)
    return client.put("/api/admin/ai", json=body, headers=AUTH)


def texts(fb):
    return [c[3]["message"]["text"] for c in fb.calls if c[1] == "me/messages" and "message" in (c[3] or {})]


def test_save_key_lists_models_and_hides_key(client, gem):
    res = enable(client)
    assert res.status_code == 200 and res.json()["check"]["ok"]
    cfg = res.json()["config"]
    assert cfg["model"] == "gemini-3.5-flash" and cfg["enabled"]
    assert cfg["models"] == ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash-preview"]
    assert cfg["gemini_key"] == {"set": True, "hint": "…cdef"} and KEY not in json.dumps(cfg)
    assert cfg["counts"]["knowledge"] == 8  # starter entries
    assert KEY not in json.dumps(client.get("/api/content").json())
    chosen = client.put("/api/admin/ai", json={"model": "gemini-3.5-flash-lite"}, headers=AUTH).json()["config"]
    assert chosen["model"] == "gemini-3.5-flash-lite"


def test_bad_key(client, gem):
    res = client.put("/api/admin/ai", json={"gemini_key": "AIzaWrongKey000000000000000"}, headers=AUTH)
    assert not res.json()["check"]["ok"] and "API key" in res.json()["check"]["message"]
    assert client.put("/api/admin/ai", json={"gemini_key": "short"}, headers=AUTH).status_code == 422


def test_test_question_uses_knowledge_and_real_tips(client, gem):
    enable(client)
    tip = client.post("/api/admin/t/tips", headers=AUTH, json={"title": "Буйлны арчилгаа", "body": "Зөөлөн сойз хэрэглэнэ.",
                                                                 "doctor_name": "Д. Болд", "active": True})
    assert tip.status_code == 201
    client.post("/api/admin/t/knowledge", headers=AUTH, json={"topic": "buy", "title": "Онлайн захиалга",
                                                              "body": "Онлайн дэлгүүрээр хүргэлттэй.", "active": True})
    res = client.post("/api/admin/ai/test", json={"question": "Хүүхэд хэрэглэж болох уу?"}, headers={**AUTH, **HTTPS})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["answer"] == gem.reply  # markdown stripped, thought parts dropped
    system = gem.calls[-1][3]["systemInstruction"]["parts"][0]["text"]
    assert "Хэрэглэх заавар" in system and "Онлайн захиалга" in system
    assert "Буйлны арчилгаа" in system and "Д. Болд" in system
    assert "Эмчийн видео зөвлөгөөг энд байршуулна" not in system  # sample tips are left out
    assert "https://domch.example/#where" in system and "Үргэлж эелдэг бай." in system
    assert gem.calls[-1][3]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "minimal"}
    assert any("Мэдлэгийн сан: Хэрэглэх заавар" == s for s in out["sources"])


def test_messenger_answers_with_ai(client, gem, fb):
    connect(client)
    enable(client)
    raw, headers = signed(event(text="Хүүхэд хэрэглэж болох уу?", mid="ai1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert texts(fb) == [gem.reply]
    assert any((c[3] or {}).get("sender_action") == "typing_on" for c in fb.calls)
    convo = client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()["items"]
    assert [m["kind"] for m in convo] == ["message", "ai"]
    # follow-up keeps the conversation history
    raw, headers = signed(event(text="Хэдэн удаа хэрэглэх вэ?", mid="ai2"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    contents = gem.calls[-1][3]["contents"]
    assert [c["role"] for c in contents] == ["user", "model", "user"]


def test_greeting_gets_welcome_only_and_question_gets_both(client, gem, fb):
    connect(client)
    enable(client)
    client.put("/api/admin/messenger/welcome", headers={**AUTH, **HTTPS},
               json={"auto_reply": "Сайн байна уу! ДОМЧ-д тавтай морил.", "faq": []})
    raw, headers = signed(event(text="Сайн байна уу", mid="g1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert texts(fb) == ["Сайн байна уу! ДОМЧ-д тавтай морил."]
    raw, headers = signed(event(psid="psid-7", text="Сайн байна уу, орц нь юу вэ?", mid="g2"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert texts(fb)[-2:] == ["Сайн байна уу! ДОМЧ-д тавтай морил.", gem.reply]


def test_ai_stays_quiet_after_a_human_reply(client, gem, fb):
    connect(client)
    enable(client)
    raw, headers = signed(event(text="Үнэ хэд вэ?", mid="h1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    client.post("/api/admin/messenger/threads/psid-1/reply", json={"text": "Сайн байна уу, би туслая."}, headers=AUTH)
    calls = len(gem.calls)
    raw, headers = signed(event(text="500 мл хэд вэ?", mid="h2"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert len(gem.calls) == calls and texts(fb)[-1] == "Сайн байна уу, би туслая."


def test_ai_failure_falls_back_and_is_reported(client, gem, fb):
    connect(client)
    enable(client)
    gem.status = 429
    raw, headers = signed(event(text="Хаанаас авах вэ, Дархан?", mid="f1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    # no AI: the matching knowledge entry still answers
    assert len(texts(fb)) == 1 and texts(fb)[0].startswith("Худалдаалах цэгүүдийг сайтын")
    err = client.get("/api/admin/ai", headers=AUTH).json()["last_error"]
    assert err["context"] == "Messenger хариулт" and "quota" in err["message"]


def test_disabled_ai_does_nothing(client, gem, fb):
    connect(client)
    enable(client, enabled=False)
    raw, headers = signed(event(text="Орц юу вэ?", mid="d1"))
    client.post("/api/messenger/webhook", content=raw, headers=headers)
    assert texts(fb) == [] and not any(c[1].endswith(":generateContent") for c in gem.calls)


def test_knowledge_table_crud(client):
    items = client.get("/api/admin/t/knowledge", headers=AUTH).json()["items"]
    assert len(items) == 8 and items[0]["title"] == "ДОМЧ гэж юу вэ?"
    bad = client.post("/api/admin/t/knowledge", headers=AUTH, json={"title": "x", "body": "", "topic": "nope"})
    assert bad.status_code == 422 and {"body", "topic"} <= set(bad.json()["fields"])
    ok = client.post("/api/admin/t/knowledge", headers=AUTH, json={"title": "Хадгалалт", "body": "Сэрүүн газар.", "topic": ""})
    assert ok.status_code == 201


def test_select_prefers_matching_entries():
    items = [{"source": "s", "title": f"Сэдэв {i}", "text": "x" * 900, "keys": ""} for i in range(40)]
    items.append({"source": "s", "title": "Хүүхдийн хэрэглээ", "text": "Хүүхэд эцэг эхийн хяналтан дор.", "keys": "хүүхэд"})
    chosen = ai.select(items, "Хүүхдэд хэрэглэж болох уу?", budget=3000)
    assert chosen[0]["title"] == "Хүүхдийн хэрэглээ" and len(chosen) < len(items)


def test_unsupported_server_location_is_explained(client, monkeypatch):
    def blocked(request):
        return httpx.Response(400, json={"error": {"code": 400, "status": "FAILED_PRECONDITION",
                                                   "message": "User location is not supported for the API use."}})
    monkeypatch.setattr(ai, "http", httpx.Client(transport=httpx.MockTransport(blocked)))
    monkeypatch.setenv("VERCEL_REGION", "hkg1")
    res = client.put("/api/admin/ai", json={"gemini_key": KEY}, headers=AUTH).json()
    assert not res["check"]["ok"] and "hkg1" in res["check"]["message"] and "Япон" in res["check"]["message"]
    assert res["config"]["gemini_key"]["set"]  # the key is kept, so «Key шалгах» works after a redeploy


def test_function_region_supports_gemini():
    region = json.loads((ROOT / "vercel.json").read_text())["regions"]
    assert region and not any(r.startswith("hkg") for r in region)  # Hong Kong is not a Gemini API region


def post(client, ev):
    raw, headers = signed(ev)
    return client.post("/api/messenger/webhook", content=raw, headers=headers)


def test_reported_case_old_manual_reply_does_not_block_ai(client, gem, fb):
    """A test reply typed by the admin earlier must not keep the AI silent (it used to for 12 hours)."""
    connect(client)
    enable(client)
    post(client, event(text="Hi", mid="r1"))
    dbmod.get_db().run("INSERT INTO messenger_messages (psid, direction, kind, text) VALUES ('psid-1', 'out', 'reply', 'хш')")
    post(client, event(text="Medeelel og", mid="r2"))
    assert texts(fb)[-1] == gem.reply
    assert gem.calls[-1][3]["contents"][-1]["parts"][0]["text"] == "Medeelel og"
    assert "латин" in gem.calls[-1][3]["systemInstruction"]["parts"][0]["text"]
    decision = client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]
    assert decision["reason"].startswith("AI хариулсан")


def test_pause_after_admin_reply_is_configurable_and_reversible(client, gem, fb):
    connect(client)
    enable(client, pause_minutes=0)
    post(client, event(text="Үнэ хэд вэ?", mid="p1"))
    res = client.post("/api/admin/messenger/threads/psid-1/reply", json={"text": "Би туслая."}, headers=AUTH).json()
    assert res["ai_paused_until"] == ""
    post(client, event(text="500 мл хэд вэ?", mid="p2"))
    assert texts(fb)[-1] == gem.reply  # no pause configured
    client.put("/api/admin/ai", json={"pause_minutes": 30}, headers=AUTH)
    res = client.post("/api/admin/messenger/threads/psid-1/reply", json={"text": "Салбараас лавлана уу."}, headers=AUTH).json()
    assert res["ai_paused_until"]
    post(client, event(text="Баярлалаа, өөр асуулт байна", mid="p3"))
    assert texts(fb)[-1] == "Салбараас лавлана уу."
    assert "түр зогссон" in client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]["reason"]
    thread = client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()
    assert thread["ai_on"] and thread["ai_paused_until"]
    assert client.post("/api/admin/messenger/threads/psid-1/ai", json={"paused": False}, headers=AUTH).json()["ai_paused_until"] == ""
    post(client, event(text="Орц нь юу вэ?", mid="p4"))
    assert texts(fb)[-1] == gem.reply
    client.post("/api/admin/messenger/threads/psid-1/ai", json={"paused": True}, headers=AUTH)
    calls = len(gem.calls)
    post(client, event(text="Хүргэлт байгаа юу?", mid="p5"))
    assert len(gem.calls) == calls
    assert client.put("/api/admin/ai", json={"pause_minutes": 7}, headers=AUTH).status_code == 422


def test_page_inbox_reply_pauses_ai_and_own_echo_is_ignored(client, gem, fb):
    connect(client)
    enable(client)
    post(client, event(text="Сайн уу, үнэ?", mid="e1"))
    own = {"object": "page", "entry": [{"id": "777", "messaging": [{"sender": {"id": "777"}, "recipient": {"id": "psid-1"},
           "timestamp": 1, "message": {"mid": "echo-own", "is_echo": True, "app_id": int(APP_ID), "text": gem.reply}}]}]}
    post(client, own)
    assert client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()["ai_paused_until"] == ""
    human = {"object": "page", "entry": [{"id": "777", "messaging": [{"sender": {"id": "777"}, "recipient": {"id": "psid-1"},
             "timestamp": 2, "message": {"mid": "echo-human", "is_echo": True, "app_id": 263902037430900, "text": "Ажилтан байна"}}]}]}
    post(client, human)
    thread = client.get("/api/admin/messenger/threads/psid-1", headers=AUTH).json()
    assert thread["ai_paused_until"] and any(m["kind"] == "inbox" and m["text"] == "Ажилтан байна" for m in thread["items"])


def test_reported_case_overloaded_model_falls_back(client, gem, fb):
    """«This model is currently experiencing high demand» on the chosen model: the next stable Flash answers."""
    connect(client)
    enable(client)
    client.put("/api/admin/ai", json={"model": "gemini-3.5-flash-lite"}, headers=AUTH)
    gem.overloaded = ["gemini-3.5-flash-lite:"]
    post(client, event(text="💰 Үнэ хэд вэ?", mid="o1"))
    assert texts(fb) == [gem.reply]
    tried = [c[1].rsplit("/", 1)[-1] for c in gem.calls if c[1].endswith(":generateContent")]
    assert tried == ["gemini-3.5-flash-lite:generateContent", "gemini-3.5-flash:generateContent"]
    decision = client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]["reason"]
    assert "gemini-3.5-flash," in decision


def test_all_models_overloaded_sends_the_holding_reply(client, gem, fb):
    connect(client)
    enable(client)
    gem.overloaded = ["gemini-"]
    post(client, event(text="Орц нь юу вэ?", mid="o2"))
    assert texts(fb)[-1].startswith("Шүүсэн ус, жамц давс")  # knowledge entry «Орц найрлага»
    assert "ачаалалтай" in client.get("/api/admin/ai", headers=AUTH).json()["last_error"]["message"]
    assert "мэдлэгийн сангаас" in client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]["reason"]
    post(client, event(text="Une", mid="o3"))  # nothing to match: a holding reply that still points somewhere
    assert texts(fb)[-1].startswith("Таны асуултыг хүлээн авлаа") and "http" in texts(fb)[-1]


def test_fallback_chain_skips_previews_and_aliases():
    cfg = {"model": "gemini-flash-lite-latest", "models": json.dumps(
        ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.5-transcribe",
         "gemini-3-flash-preview", "gemini-flash-latest", "gemini-omni-flash-preview", "gemini-flash-lite-latest"])}
    assert ai.fallback_chain(cfg) == ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]
    cfg["model"] = "gemini-3.8-flash"
    assert ai.fallback_chain(cfg) == ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.7-flash"]
