"""Where to buy over Messenger: ask which district / aimag, then list the branches there (fake Graph API)."""
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tests"))

from _lib import ai, messenger, places  # noqa: E402
from _lib import db as dbmod  # noqa: E402
from _lib.app import app  # noqa: E402
from test_messenger import AUTH, TOKEN, FakeGraph, connect, event, save_welcome, sent_texts, signed  # noqa: E402

UB = "Улаанбаатар"


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID", "D1_DATABASE_ID",
                 "CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LOCAL_DB_PATH", str(tmp_path / "p.db"))
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


def add(client, chain, name, city, district=None, **extra):
    body = {"chain": chain, "name": name, "city": city, "district": district, "active": True, "sizes": "250,500"}
    body.update(extra)
    res = client.post("/api/admin/t/branches", headers=AUTH, json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.fixture
def stocked(client):
    add(client, "Хүрмэн эмийн сан", "Хүрмэн Сансар", UB, "Баянзүрх", address="БЗД 1-р хороо, 5а байр",
        hours="Өдөр бүр 09:00–22:00", lat="47.924", lng="106.941")
    add(client, "Тавин Ус эмийн сан", "Жуков салбар", UB, "Баянзүрх", phone="8807-0162")
    for i in range(6):
        add(client, "Ази Фарма", f"Ази-{i} ЭХНТ", UB, "Баянзүрх", lat=str(47.9 + i / 100), lng="106.95")
    add(client, "Хүрмэн эмийн сан", "Хүрмэн Зайсан", UB, "Хан-Уул", address="ХУД, ХААИС")
    add(client, "Ази Фарма", "Дархан ЭХНТ", "Дархан-Уул", "Дархан", address="Болор худалдааны төв 1 давхар",
        phone="7037-4343", hours="08:30–17:30")


def post(client, text=None, mid="m1", payload=None, psid="psid-1"):
    ev = event(psid=psid, text=text or "", mid=mid)
    if payload:
        ev["entry"][0]["messaging"][0]["message"]["quick_reply"] = {"payload": payload}
    raw, headers = signed(ev)
    return client.post("/api/messenger/webhook", content=raw, headers=headers)


def last(fb):
    return sent_texts(fb)[-1]


def buttons(message):
    return [(q["title"], q["payload"]) for q in message.get("quick_replies") or []]


# ------------------------------------------------------------------ recognising places

@pytest.mark.parametrize("text,city,district", [
    ("Баянзүрхэд хаана зарагддаг вэ?", UB, "Баянзүрх"),
    ("bzd", UB, "Баянзүрх"),
    ("БЗД 1-р хороо", UB, "Баянзүрх"),
    ("Хан-Уулд", UB, "Хан-Уул"),
    ("han uul", UB, "Хан-Уул"),
    ("Зайсан орчим", UB, "Хан-Уул"),
    ("Сүхбаатар", UB, "Сүхбаатар"),
    ("Сүхбаатар аймагт", "Сүхбаатар", None),
    ("Дарханд", "Дархан-Уул", None),
    ("erdenet hotod", "Орхон", None),
    ("Говь-Алтай", "Говь-Алтай", None),
    ("uvurkhangai", "Өвөрхангай", None),
    ("Увс", "Увс", None),
    ("Улаанбаатар", UB, None),
])
def test_find_place(text, city, district):
    place = places.find_place(text)
    assert place and place["city"] == city and place["district"] == district


@pytest.mark.parametrize("text", ["Орц нь юу вэ?", "шүүсэн ус", "худалдаа", "хадаасан цэцгийн ханд", "Үнэ хэд вэ?"])
def test_no_place(text):
    assert places.find_place(text) is None


@pytest.mark.parametrize("text,expected", [
    ("Хаанаас авах вэ?", True),
    ("Ямар эмийн сангаар зарагддаг вэ?", True),
    ("Танай салбарууд хаана байдаг вэ", True),
    ("esvel hnaas awah bolomjtoi be", True),
    ("darhan hotod haana zaragddag we", True),
    ("Хаана үйлдвэрлэдэг вэ?", False),
    ("Орц нь юу вэ?", False),
    ("Хүүхэд хэрэглэж болох уу", False),
])
def test_where_intent(text, expected):
    assert places.where_intent(text) is expected


# ------------------------------------------------------------------ Messenger

def test_where_question_asks_the_district_then_lists_six(client, fb, stocked):
    connect(client)
    post(client, "Хаанаас авах вэ?", mid="w1")
    ask = last(fb)
    assert ask["text"] == places.ASK
    assert buttons(ask)[0] == ("Баянзүрх", f"WHERE:{UB}|Баянзүрх")  # busiest district first
    assert ("Хан-Уул", f"WHERE:{UB}|Хан-Уул") in buttons(ask) and buttons(ask)[-1] == ("Орон нутаг", "WHERE_RURAL")

    post(client, "Баянзүрх", mid="w2")  # typed instead of tapped
    text = last(fb)["text"]
    assert text.startswith("📍 Баянзүрх дүүрэг\nДОМЧ-ийг эдгээр салбараас")
    assert text.count("\n\n") >= 6 and "7. " not in text  # at most six
    assert "Бас 2 салбар бий: http://testserver/#where" in text
    # chains take turns: the biggest chain first, then the others
    assert "1. Ази-0 ЭХНТ\n\n2. Тавин Ус эмийн сан — Жуков салбар\n8807-0162\n\n" in text
    assert "3. Хүрмэн Сансар\nБЗД 1-р хороо, 5а байр\nӨдөр бүр 09:00–22:00\n\n4. Ази-1 ЭХНТ" in text
    assert buttons(last(fb))[0] == ("Өөр байршил", "WHERE_ASK")
    reason = client.get("/api/admin/messenger", headers=AUTH).json()["last_decision"]["reason"]
    assert reason == "Салбарын мэдээлэл илгээсэн: Баянзүрх дүүрэг (8)."


def test_buttons_rural_and_named_aimag(client, fb, stocked):
    connect(client)
    post(client, "Орон нутаг", mid="r1", payload="WHERE_RURAL")
    assert last(fb)["text"] == places.ASK_RURAL and buttons(last(fb)) == [("Дархан-Уул", "WHERE:Дархан-Уул|")]
    post(client, "Дархан-Уул", mid="r2", payload="WHERE:Дархан-Уул|")
    text = last(fb)["text"]
    assert text.startswith("📍 Дархан-Уул аймаг")
    assert "1. Ази Фарма — Дархан ЭХНТ\nБолор худалдааны төв 1 давхар\n08:30–17:30 · 7037-4343" in text

    post(client, "darhan hotod haana zaragddag we", mid="r3")  # place and question at once, in Latin letters
    assert last(fb)["text"].startswith("📍 Дархан-Уул аймаг")
    post(client, "Увс аймагт хаана байдаг вэ?", mid="r4")
    assert last(fb)["text"].startswith("📍 Увс аймаг: одоогоор манай худалдаалах цэг бүртгэгдээгүй")


def test_faq_button_for_where_asks_the_district(client, fb, stocked):
    connect(client)
    save_welcome(client)  # FAQ: «Үнэ хэд вэ?», «Хаанаас авах вэ?»
    post(client, "Хаанаас авах вэ?", mid="f1", payload="FAQ_1")
    assert last(fb)["text"] == places.ASK
    post(client, "Хан-Уул", mid="f2", payload=f"WHERE:{UB}|Хан-Уул")
    msg = last(fb)
    assert "1. Хүрмэн Зайсан" in msg["text"] and "Газрын зураг: http://testserver/#where" in msg["text"]
    assert buttons(msg) == [("Өөр байршил", "WHERE_ASK"), ("Үнэ хэд вэ?", "FAQ_0")]  # the where FAQ is not repeated
    post(client, "Үнэ хэд вэ?", mid="f3", payload="FAQ_0")
    assert last(fb)["text"] == "Үнийг ойрын салбараас лавлана уу."


def test_ulaanbaatar_without_district_asks_which(client, fb, stocked):
    connect(client)
    post(client, "Улаанбаатарт хаана зарагддаг вэ?", mid="u1")
    assert last(fb)["text"] == places.ASK


def test_place_alone_is_not_a_where_question(client, fb, stocked):
    connect(client)
    post(client, "Баянзүрхэд амьдардаг, хүүхэд хэрэглэж болох уу?", mid="n1")
    assert all(not m.get("text", "").startswith("📍") for m in sent_texts(fb))


def test_without_real_branches_the_faq_answer_stays(client, fb):
    connect(client)
    save_welcome(client)
    post(client, "Хаанаас авах вэ?", mid="e1", payload="FAQ_1")
    assert last(fb)["text"] == "Салбаруудыг сайтаас харна уу."  # sample branches only: nothing to list


def test_human_takeover_is_respected_but_buttons_answer(client, fb, stocked):
    connect(client)
    post(client, "Сайн уу", mid="h0")
    client.post("/api/admin/messenger/threads/psid-1/reply", json={"text": "Сайн байна уу, туслъя."}, headers=AUTH)
    before = len(sent_texts(fb))
    post(client, "Дарханд хаанаас авах вэ?", mid="h1")
    assert len(sent_texts(fb)) == before  # a person is answering this conversation
    post(client, "Хан-Уул", mid="h2", payload=f"WHERE:{UB}|Хан-Уул")
    assert last(fb)["text"].startswith("📍 Хан-Уул дүүрэг")


# ------------------------------------------------------------------ AI knowledge

def test_ai_knows_the_branches_by_place(client, stocked):
    items = ai.knowledge_items(dbmod.get_db())
    titles = [i["title"] for i in items if i["source"] == "Худалдаалах цэг"]
    assert titles == ["Салбарууд: Баянзүрх дүүрэг", "Салбарууд: Хан-Уул дүүрэг", "Салбарууд: Дархан-Уул аймаг"]
    darkhan = next(i for i in items if i["title"] == "Салбарууд: Дархан-Уул аймаг")
    assert "Болор худалдааны төв" in darkhan["text"] and "7037-4343" in darkhan["text"]
    prompt = ai.system_prompt(items, "https://domch.gem.mn", "")
    assert "аль дүүрэг, аймагт байгаа нь тодорхойгүй бол" in prompt and "Салбарууд: Хан-Уул дүүрэг" in prompt
