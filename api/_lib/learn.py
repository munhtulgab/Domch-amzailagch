"""The assistant learns from staff.

When someone on the team answers a customer (from the admin chat or the Page Inbox), the question and that answer
become a lesson: Gemini keeps what is general knowledge about ДОМЧ — true for any customer, without names, phone
numbers or a single customer's deal — and writes it into the knowledge base (topic «learned»), where the assistant
uses it from then on. Small talk, one person's order and things the knowledge base already says are left out.
Every lesson is listed in the admin («AI туслах» → «Ажилтнаас суралцсан») with what was learned, to fix or delete.
"""
import json
import re

from fastapi import APIRouter, Depends

from . import ai
from .common import ago, now_utc, require_admin
from .db import DBError, get_db

STAFF_KINDS = ("inbox", "reply")
SETTLE_MINUTES = 3  # staff often answer in several messages: wait until they have finished
DAILY_LIMIT = 20  # lessons use the same Gemini quota as the answers to customers
SHORT = "Хариу хэт богино (мэндчилгээ, эмодзи, хавсралт)."
NO_QUESTION = "Харилцагчийн асуулт алга."
LETTERS = re.compile(r"[A-Za-zА-Яа-яЁёӨөҮү]")

TABLE = (
    "CREATE TABLE IF NOT EXISTS ai_lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, psid TEXT NOT NULL,"
    " msg_id INTEGER NOT NULL UNIQUE, last_id INTEGER NOT NULL, question TEXT, answer TEXT,"
    " outcome TEXT NOT NULL DEFAULT 'pending', knowledge_id INTEGER, note TEXT,"
    " created_at TEXT NOT NULL DEFAULT (datetime('now')))"
)

SYSTEM = """You maintain the knowledge base of the customer-service assistant of ДОМЧ, a Mongolian salt-water
mouthwash (жамц давсны уусмал, 250 мл and 500 мл). A staff member has just answered a customer in chat.
Decide whether the staff answer teaches something GENERAL that the assistant should tell ANY customer who asks the
same thing: facts about the product, its use, ingredients, where and how it is sold, delivery, wholesale or
partnership terms, company policy, contact details of the company.

Do NOT learn:
- small talk, greetings, thanks, emojis, «we will call you», «please wait»;
- anything about one person: names, phone numbers, addresses, one order, one delivery, a deal or price offered to
  one customer, influencer or partner (e.g. a fee for a reel, free products for one person);
- guesses, promises or medical diagnoses;
- what the existing knowledge already says (same facts in other words).

When the assistant had answered first and the staff answer corrects or completes it, learn the correct facts (use
update_id when the wrong facts came from a «learned» entry).

Reply with JSON only, no other text:
{"learn": true|false, "reason": "<short, in Mongolian>", "title": "<the question, in Mongolian Cyrillic, max 70 chars>",
 "body": "<the general answer, in Mongolian Cyrillic, max 450 chars, no personal data>", "keywords": "<5-8 words,
 Cyrillic and Latin spellings customers use>", "update_id": <id of an existing «learned» entry this corrects, or null>}
Write title and body in Cyrillic even when the chat was written in Latin letters."""


def ensure(db) -> None:
    if getattr(db, "_lessons_ready", False):  # once per database connection
        return
    try:
        db.run(TABLE)
        db._lessons_ready = True
    except (DBError, AttributeError):
        pass


def next_lesson(db):
    """The oldest staff answer not learned from yet, with the customer's question before it and every staff message
    that followed in a row (one answer is often several messages)."""
    first = db.one(
        "SELECT m.id, m.psid FROM messenger_messages m WHERE m.direction = 'out' AND m.kind IN ('inbox', 'reply')"
        " AND m.created_at <= ? AND NOT EXISTS (SELECT 1 FROM ai_lessons l WHERE l.psid = m.psid"
        " AND m.id BETWEEN l.msg_id AND l.last_id) ORDER BY m.id LIMIT 1",
        (ago(minutes=SETTLE_MINUTES),),
    )
    if not first:
        return None
    after = db.all("SELECT id, direction, kind, text FROM messenger_messages WHERE psid = ? AND id >= ? ORDER BY id"
                   " LIMIT 15", (first["psid"], first["id"]))
    answer, last_id = [], first["id"]
    for row in after:
        if row["direction"] == "in":
            break
        if row["kind"] in STAFF_KINDS:
            last_id = row["id"]
            if row.get("text"):
                answer.append(row["text"].strip())
    before = db.all("SELECT direction, kind, text FROM messenger_messages WHERE psid = ? AND id < ? ORDER BY id DESC"
                    " LIMIT 15", (first["psid"], first["id"]))
    question, bot = [], ""
    for row in before:
        if row["direction"] == "out" and row["kind"] in STAFF_KINDS:
            break  # an earlier staff answer: its question was learned with it
        if row["direction"] == "out" and row["kind"] == "ai" and not bot and not question:
            bot = (row.get("text") or "").strip()[:600]  # what the assistant said just before staff stepped in
        if row["direction"] == "in" and row.get("text") and len(question) < 3:
            question.append(row["text"].strip()[:400])
    return {"psid": first["psid"], "msg_id": first["id"], "last_id": last_id,
            "question": "\n".join(reversed(question)), "answer": "\n".join(answer)[:1500], "bot": bot}


def _worth_asking(lesson) -> str:
    """Why a lesson is skipped without asking Gemini, or ''."""
    if len(LETTERS.findall(lesson["answer"])) < 15:
        return SHORT
    if len(LETTERS.findall(lesson["question"])) < 3:
        return NO_QUESTION
    return ""


def _parse(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        raise ValueError("JSON алга")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("JSON биш")
    return data


def _light_cfg(cfg: dict) -> dict:
    """Lessons go to a «lite» model first, so the main model's quota stays for customers."""
    chain = ai.fallback_chain(cfg)
    lite = next((m for m in chain if "lite" in m), None)
    return {**cfg, "model": lite} if lite else cfg


def _known(db) -> str:
    rows = db.all("SELECT id, topic, title, body FROM knowledge WHERE active = 1 ORDER BY id")
    return "\n".join(f"[{r['id']}{' learned' if r['topic'] == 'learned' else ''}] {r['title']}: {(r['body'] or '')[:300]}"
                     for r in rows)


def _today_count(db) -> int:
    """Lessons that went to Gemini in the last 24 hours (learned or not)."""
    row = db.one("SELECT COUNT(*) AS n FROM ai_lessons WHERE outcome != 'pending' AND COALESCE(note, '') NOT IN (?, ?)"
                 " AND created_at >= ?", (SHORT, NO_QUESTION, ago(hours=24)))
    return int((row or {}).get("n") or 0)


def learn_one(db, cfg: dict) -> dict | None:
    """Take the next staff answer and learn from it. None when there is nothing to do (or no quota left today)."""
    ensure(db)
    if not ai.ready(cfg) or _today_count(db) >= DAILY_LIMIT:
        return None
    lesson = next_lesson(db)
    if not lesson:
        return None
    try:  # claim it, so two webhooks never learn the same answer twice
        db.run("INSERT INTO ai_lessons (psid, msg_id, last_id, question, answer) VALUES (?, ?, ?, ?, ?)",
               (lesson["psid"], lesson["msg_id"], lesson["last_id"], lesson["question"], lesson["answer"]))
    except DBError:
        return None
    lid = db.one("SELECT id FROM ai_lessons WHERE msg_id = ?", (lesson["msg_id"],))["id"]
    skip = _worth_asking(lesson)
    if skip:
        db.run("UPDATE ai_lessons SET outcome = 'skipped', note = ? WHERE id = ?", (skip, lid))
        return {"outcome": "skipped", "note": skip}
    said = f"\n\nTHE ASSISTANT HAD ANSWERED (staff stepped in after it):\n{lesson['bot']}" if lesson.get("bot") else ""
    prompt = (f"EXISTING KNOWLEDGE:\n{_known(db)}\n\nCUSTOMER:\n{lesson['question']}{said}"
              f"\n\nSTAFF ANSWER:\n{lesson['answer']}")
    try:
        text, _model = ai.generate_any(_light_cfg(cfg), SYSTEM, [{"role": "user", "parts": [{"text": prompt}]}],
                                       budget=12.0, db=db)
        data = _parse(text)
    except (ai.AIError, ValueError) as exc:
        if isinstance(exc, ai.AIError):  # no model free now: try this one again later
            db.run("DELETE FROM ai_lessons WHERE id = ?", (lid,))
            return None
        db.run("UPDATE ai_lessons SET outcome = 'skipped', note = ? WHERE id = ?", (f"Ойлгомжгүй хариу: {exc}", lid))
        return {"outcome": "skipped"}
    reason = str(data.get("reason") or "")[:300]
    title = str(data.get("title") or "").strip()[:120]
    body = str(data.get("body") or "").strip()[:900]
    if not data.get("learn") or not title or not body:
        db.run("UPDATE ai_lessons SET outcome = 'skipped', note = ? WHERE id = ?", (reason or "Ерөнхий мэдээлэл биш.", lid))
        return {"outcome": "skipped", "note": reason}
    keywords = str(data.get("keywords") or "")[:300]
    target = None
    if data.get("update_id"):
        target = db.one("SELECT id FROM knowledge WHERE id = ? AND topic = 'learned'", (data["update_id"],))
    if target:
        db.run("UPDATE knowledge SET title = ?, body = ?, keywords = ?, active = 1, updated_at = ? WHERE id = ?",
               (title, body, keywords, now_utc(), target["id"]))
        kid, outcome = target["id"], "updated"
    else:
        db.run("INSERT INTO knowledge (topic, title, body, keywords, active, sort) VALUES ('learned', ?, ?, ?, 1, 900)",
               (title, body, keywords))
        kid, outcome = db.one("SELECT MAX(id) AS id FROM knowledge WHERE topic = 'learned'")["id"], "added"
    db.run("UPDATE ai_lessons SET outcome = ?, knowledge_id = ?, note = ? WHERE id = ?", (outcome, kid, reason, lid))
    return {"outcome": outcome, "knowledge_id": kid, "title": title}


def run(db, limit: int = 1) -> list:
    """Learn from up to `limit` staff answers (called after each webhook, and from the admin)."""
    cfg = ai.load(db)
    done = []
    for _ in range(limit):
        result = learn_one(db, cfg)
        if result is None:
            break
        done.append(result)
    return done


def recent(db, limit: int = 30) -> list:
    ensure(db)
    return db.all(
        "SELECT l.id, l.created_at, l.outcome, l.note, l.question, l.answer, l.knowledge_id, k.title, k.body, k.active"
        " FROM ai_lessons l LEFT JOIN knowledge k ON k.id = l.knowledge_id WHERE l.outcome != 'pending'"
        " ORDER BY CASE WHEN l.outcome IN ('added', 'updated') THEN 0 ELSE 1 END, l.id DESC LIMIT ?", (limit,))


# ------------------------------------------------------------------ admin routes

admin = APIRouter(prefix="/api/admin/ai/lessons", dependencies=[Depends(require_admin)])


@admin.get("")
def lessons_get():
    db = get_db()
    ensure(db)
    row = db.one("SELECT COUNT(*) AS n FROM knowledge WHERE topic = 'learned' AND active = 1") or {}
    return {"items": recent(db), "learned": int(row.get("n") or 0), "daily_limit": DAILY_LIMIT}


@admin.post("/run")
def lessons_run():
    """«Одоо суралцах»: work through a few waiting staff answers now (the rest follow with new messages)."""
    db = get_db()
    done = run(db, limit=3)
    ensure(db)
    return {"done": done, "items": recent(db)}
