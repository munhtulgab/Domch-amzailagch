"""Gemini answers grounded in the knowledge base, doctor tips and FAQs (fake Gemini + fake Graph API)."""
import json
import time
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
    monkeypatch.setattr(messenger, "INBOX_GRACE", 0)
    monkeypatch.setattr(messenger, "AI_GATHER", 0)
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
                                                              "body": "Онлайн дэлгүүрээр хүргэлттэй: https://domchamzailagch.vercel.app/#where",
                                                              "active": True})
    res = client.post("/api/admin/ai/test", json={"question": "Хүүхэд хэрэглэж болох уу?"}, headers={**AUTH, **HTTPS})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["answer"] == gem.reply  # markdown stripped, thought parts dropped
    system = gem.calls[-1][3]["systemInstruction"]["parts"][0]["text"]
    assert "Хэрэглэх заавар" in system and "Онлайн захиалга" in system
    assert "Буйлны арчилгаа" in system and "Д. Болд" in system
    assert "Эмчийн видео зөвлөгөөг энд байршуулна" not in system  # sample tips are left out
    assert "https://domch.gem.mn/#where" in system and "Үргэлж эелдэг бай." in system
    assert "vercel.app" not in system  # old links in the knowledge base point at the primary domain
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
    # no AI and only sample branches: the matching knowledge entry still answers
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
    post(client, event(text="zzzz qqqq", mid="o3"))  # nothing to match: a holding reply that still points somewhere
    assert texts(fb)[-1].startswith("Таны асуултыг хүлээн авлаа") and "http" in texts(fb)[-1]
    post(client, event(text="Une", mid="o4"))  # «үнэ» typed in Latin letters still finds the price
    assert "мл" in texts(fb)[-1] and not texts(fb)[-1].startswith("Таны асуултыг")


def test_fallback_chain_skips_previews_and_aliases():
    cfg = {"model": "gemini-flash-lite-latest", "models": json.dumps(
        ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.5-transcribe",
         "gemini-3-flash-preview", "gemini-flash-latest", "gemini-omni-flash-preview", "gemini-flash-lite-latest"])}
    assert ai.fallback_chain(cfg) == ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]
    cfg["model"] = "gemini-3.8-flash"
    assert ai.fallback_chain(cfg) == ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.7-flash"]


def test_quota_wait_is_read_from_the_error():
    assert ai.quota_wait("Please retry in 4h4m26.427s.") == 4 * 3600 + 4 * 60 + 26
    assert ai.quota_wait("Please retry in 26.4s.") == 30  # at least half a minute
    assert ai.quota_wait("Please retry in 2m5s") == 125
    assert ai.quota_wait("Generate content requests per day limit exceeded") == 6 * 3600
    assert ai.quota_wait("Resource has been exhausted") == 60


def test_reported_case_daily_quota_skips_the_model_and_lists_every_try(client, gem, fb, monkeypatch):
    """gemini-3.8-flash: «limit: 20 … per day … retry in 4h»: the other models answer, the spent one is skipped."""
    connect(client)
    enable(client)
    spent = {"gemini-3.5-flash:"}

    def quota(request):
        if any(m in request.url.path for m in spent):
            return httpx.Response(429, json={"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message":
                "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests,"
                " limit: 20. Generate content requests per day limit exceeded on Free Tier. Please retry in 4h4m26s."}})
        return gem(request)
    monkeypatch.setattr(ai, "http", httpx.Client(transport=httpx.MockTransport(quota)))
    client.put("/api/admin/ai", json={"model": "gemini-3.5-flash"}, headers=AUTH)
    post(client, event(text="Орц нь юу вэ?", mid="d1"))
    assert texts(fb)[-1] == gem.reply
    tried = [c[1].rsplit("/", 1)[-1].split(":")[0] for c in gem.calls if c[1].endswith(":generateContent")]
    assert tried == ["gemini-3.5-flash-lite"]  # the spent model answered 429 before the fake saw it
    resting = json.loads(ai.load(dbmod.get_db())["cooldown"])
    assert list(resting) == ["gemini-3.5-flash"]

    gem.calls.clear()
    post(client, event(text="Хэрэглэх заавар?", mid="d2"))
    assert texts(fb)[-1] == gem.reply
    tried = [c[1].rsplit("/", 1)[-1].split(":")[0] for c in gem.calls if c[1].endswith(":generateContent")]
    assert tried == ["gemini-3.5-flash-lite"]  # skipped straight to the model that still has quota

    spent.add("gemini-3.5-flash-lite:")
    post(client, event(text="Хүүхэд хэрэглэж болох уу?", mid="d3"))
    reason = client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]["reason"]
    assert "gemini-3.5-flash-lite: хязгаар дууссан" in reason and "gemini-3.5-flash: хязгаар дууссан" in reason


def test_latin_script_questions_find_the_knowledge_when_ai_is_down(client, gem, fb):
    connect(client)
    enable(client)
    gem.status = 429
    db = dbmod.get_db()
    assert ai.local_answer(db, "esvel hnaas awah bolomjtoi be").startswith("Худалдаалах цэгүүдийг")
    assert "мл" in ai.local_answer(db, "Vne")
    post(client, event(text="esvel hnaas awah we", mid="lt1"))
    assert texts(fb)[-1].startswith("Худалдаалах цэгүүдийг")
    post(client, event(text="hurgelt bga yu, hnaas awah we", mid="lt2"))  # delivery: the fixed answer, AI or not
    assert "Эсвэл e-Монос болон Health point" in texts(fb)[-1] and "/#where" in texts(fb)[-1]


# ------------------------------------------------------------------ no double greetings, stickers

def page_event(psid="dup-1", text=None, mid="d1", ts=None, echo=False, sticker=None, attachment=None):
    message = {"mid": mid}
    if text is not None:
        message["text"] = text
    if sticker:
        message["sticker_id"] = int(sticker)
        message["attachments"] = [{"type": "image", "payload": {"url": "https://x/s.png", "sticker_id": int(sticker)}}]
    if attachment:
        message["attachments"] = [{"type": attachment, "payload": {"url": "https://x/photo.jpg"}}]
    if echo:
        message["is_echo"] = True
        message["app_id"] = 263902037430900  # Meta Business Suite, not this site
    sender, recipient = ("777", psid) if echo else (psid, "777")
    return {"object": "page", "entry": [{"id": "777", "time": 0, "messaging": [{
        "sender": {"id": sender}, "recipient": {"id": recipient},
        "timestamp": ts or int(time.time() * 1000), "message": message}]}]}


def sent(fb):
    return [c[3]["message"] for c in fb.calls if c[1] == "me/messages" and "message" in (c[3] or {})]


def test_reported_case_first_question_gets_one_answer_not_welcome_plus_answer(client, gem, fb):
    """«Hed be» → welcome, then «Сайн байна уу? … 4,500 төгрөг»: now only the answer, with the buttons."""
    connect(client)
    enable(client)
    client.put("/api/admin/messenger/welcome", json={"auto_reply": "Сайн байна уу! ДОМЧ-д тавтай морил.",
               "faq": [{"q": "Үнэ хэд вэ?", "a": "4500₮"}]}, headers=AUTH)
    gem.reply = "Сайн байна уу? ДОМЧ 250 мл нь 4,500 төгрөг."
    post(client, page_event(text="Hed be", mid="h1"))
    msgs = sent(fb)
    assert len(msgs) == 1 and msgs[0]["text"] == "ДОМЧ 250 мл нь 4,500 төгрөг.\n" + ai.PRICE_NOTE  # no second «Сайн байна уу»
    assert [q["title"] for q in msgs[0]["quick_replies"]] == ["Үнэ хэд вэ?"]
    post(client, page_event(text="Hurgelter avj bolhu", mid="h2"))  # delivery: the online pharmacies, no buttons again
    assert "Эсвэл e-Монос болон Health point" in sent(fb)[-1]["text"] and "quick_replies" not in sent(fb)[-1]
    post(client, page_event(text="Tsewerleh hugatsaa hed ve", mid="h2b"))
    assert sent(fb)[-1]["text"].startswith("ДОМЧ") and "quick_replies" not in sent(fb)[-1]
    # someone who greets first still gets the welcome only
    post(client, page_event(psid="dup-2", text="Сайн байна уу", mid="h3"))
    assert sent(fb)[-1]["text"] == "Сайн байна уу! ДОМЧ-д тавтай морил."


def test_reported_case_two_quick_messages_get_one_answer(client, gem, fb, monkeypatch):
    """«Sn bnu» + «Am zailagch hed we» a second apart → two AI answers; now the second one answers both."""
    connect(client)
    enable(client)
    post(client, page_event(text="Сайн уу", mid="g0"))  # conversation already started
    before = len(sent(fb))
    gem.reply = "250 мл нь 4 500 төгрөг."
    second = page_event(text="Am zailagch hed we", mid="g2")
    original = messenger.wait_to_gather
    pending = [second]

    def gather(received_at):  # the next message arrives while the first one waits
        if pending:
            post(client, pending.pop())
        original(received_at)

    monkeypatch.setattr(messenger, "wait_to_gather", gather)
    post(client, page_event(text="Sn bnu, medeelel awii", mid="g1"))
    replies = [m["text"] for m in sent(fb)[before:]]
    assert len(replies) == 1 and replies[0].startswith("250 мл")


def test_reported_case_meta_instant_reply_is_not_duplicated(client, gem, fb, monkeypatch):
    """«?» → Page Inbox's own greeting 3 s later, then the AI's: now the site stays quiet when Meta already answered."""
    connect(client)
    enable(client)
    post(client, page_event(text="Сайн уу", mid="q0"))  # conversation already started
    before = len(sent(fb))
    now = int(time.time() * 1000)
    instant = page_event(text="Сайн байна уу? 🌿 ДОМЧ ам зайлагчийн албан ёсны хаягт тавтай морилно уу.",
                         mid="meta-instant", ts=now + 3000, echo=True)
    # Meta's instant reply arrives while the site waits a moment before answering «?»
    monkeypatch.setattr(messenger, "wait_for_inbox", lambda received_at: post(client, instant))
    post(client, page_event(text="?", mid="q1", ts=now))
    assert len(sent(fb)) == before
    convo = client.get("/api/admin/messenger/threads/dup-1", headers=AUTH).json()
    assert convo["ai_paused_until"] == ""  # Meta's automatic reply is not a person taking over
    assert "Page Inbox" in client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]["reason"]


def test_a_person_typing_in_the_page_inbox_still_pauses_the_ai(client, gem, fb):
    connect(client)
    enable(client)
    now = int(time.time() * 1000)
    post(client, page_event(text="Хүргэлт байгаа юу?", mid="p1", ts=now - 120000))
    post(client, page_event(text="Тийм, хүргэлт бий.", mid="p2", ts=now, echo=True))  # two minutes later
    assert client.get("/api/admin/messenger/threads/dup-1", headers=AUTH).json()["ai_paused_until"]


def test_like_sticker_gets_a_reply_once(client, gem, fb):
    connect(client)
    enable(client)
    client.put("/api/admin/messenger/welcome", json={"auto_reply": "Сайн байна уу!", "faq": [{"q": "Үнэ хэд вэ?", "a": "4500₮"}]},
               headers=AUTH)
    post(client, page_event(text="Үнэ нь хэд вэ?", mid="s0"))
    post(client, page_event(sticker="369239263222822", mid="s1"))  # 👍
    msg = sent(fb)[-1]
    assert msg["text"] == messenger.LIKE_REPLY and msg["quick_replies"][0]["title"] == "Үнэ хэд вэ?"
    convo = client.get("/api/admin/messenger/threads/dup-1", headers=AUTH).json()
    assert any(m["direction"] == "in" and m["text"] == "👍" for m in convo["items"])  # not «[image хавсралт]»
    count = len(sent(fb))
    post(client, page_event(sticker="369239343222814", mid="s2"))  # another like soon after: no repeat
    assert len(sent(fb)) == count
    post(client, page_event(sticker="1234567890", mid="s3"))  # any other sticker
    assert sent(fb)[-1]["text"] == messenger.STICKER_REPLY
    post(client, page_event(attachment="image", mid="s4"))  # a real photo
    assert sent(fb)[-1]["text"] == messenger.FILE_REPLY


def test_like_as_the_first_message_gets_the_welcome(client, gem, fb):
    connect(client)
    enable(client)
    client.put("/api/admin/messenger/welcome", json={"auto_reply": "Сайн байна уу! Тавтай морил.", "faq": []}, headers=AUTH)
    post(client, page_event(psid="like-1", sticker="369239263222822", mid="l1"))
    assert [m["text"] for m in sent(fb)] == ["Сайн байна уу! Тавтай морил."]


# ------------------------------------------------------------------ factory price reminder

def test_price_note():
    assert ai.price_note("250 мл нь 4500 төгрөг.") == "250 мл нь 4500 төгрөг.\n" + ai.PRICE_NOTE
    assert ai.price_note("500 мл — 7 500₮") .endswith(ai.PRICE_NOTE)
    already = "4 500₮. Эмийн санд үүнээс өндөр байж болно."
    assert ai.price_note(already) == already  # not twice
    assert ai.price_note("Насанд хүрэгчид 25 мл-ээр 10 секунд зайлна.") == "Насанд хүрэгчид 25 мл-ээр 10 секунд зайлна."


def test_prices_always_come_with_the_reminder(client, gem, fb):
    connect(client)
    enable(client)
    dbmod.get_db().run("UPDATE products SET price = CASE WHEN volume_ml = 250 THEN 4500 ELSE 7500 END")
    items = ai.knowledge_items(dbmod.get_db())
    prices = next(i for i in items if i["title"] == "Савлагаа ба үнэ")
    assert prices["text"].startswith("250 мл: 4 500₮ (үйлдвэрийн үнэ)\n500 мл: 7 500₮ (үйлдвэрийн үнэ)")
    assert "(үйлдвэрийн үнэ)" in prices["text"] and ai.PRICE_NOTE in prices["text"]
    assert "үйлдвэрийн үнэ бөгөөд эмийн сан, дэлгүүрт үүнээс өндөр" in ai.system_prompt(items, "https://domch.gem.mn", "")
    gem.reply = "ДОМЧ 250 мл нь 4,500 төгрөг, 500 мл нь 7,500 төгрөг."  # the model forgot the reminder
    post(client, page_event(psid="price-1", text="Үнэ нь хэд вэ?", mid="pr1"))
    assert sent(fb)[-1]["text"] == "ДОМЧ 250 мл нь 4,500 төгрөг, 500 мл нь 7,500 төгрөг.\n" + ai.PRICE_NOTE
    # a quick-question answer with prices gets it too; a reply typed by staff is sent as written
    client.put("/api/admin/messenger/welcome", json={"auto_reply": "Сайн байна уу!",
               "faq": [{"q": "Үнэ хэд вэ?", "a": "250 мл — 4 500₮, 500 мл — 7 500₮."}]}, headers=AUTH)
    ev = page_event(psid="price-1", text="Үнэ хэд вэ?", mid="pr2")
    ev["entry"][0]["messaging"][0]["message"]["quick_reply"] = {"payload": "FAQ_0"}
    post(client, ev)
    assert sent(fb)[-1]["text"].endswith(ai.PRICE_NOTE)
    client.post("/api/admin/messenger/threads/price-1/reply", json={"text": "Манайд 4 500₮ байна."}, headers=AUTH)
    assert sent(fb)[-1]["text"] == "Манайд 4 500₮ байна."
