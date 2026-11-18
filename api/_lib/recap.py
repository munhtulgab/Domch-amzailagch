"""A short summary of one Messenger / Instagram conversation, written before every AI reply.

The AI sees only the last few messages word for word (ai.HISTORY_TURNS); this summary carries what came before:
where the customer is, which size they asked about, what they have asked so far, whether they want to sell it, and
what the bot has already sent (price card, the factory-price note, the map link, the online pharmacies, the
partner form). It is put together from the stored messages by rules — no extra Gemini request, so it costs no
quota and adds no waiting — and it is shown to staff beside the conversation in the admin."""
import re

from . import insights, places
from .common import ago

LOOK_BACK_DAYS = 30
MAX_MESSAGES = 60
EARLIER_QUESTIONS = 4
QUESTION_CHARS = 90
SIZE = re.compile(r"(?<![\d.,])(250|500)(?![\d.,])\s*(мл|ml|mm|млл)?", re.I)
SKIP_TOPICS = {"greeting", "media", "other"}
# what the bot already sent, by a mark it leaves in the stored text
SENT = (
    ("🗂 Үнэ", "үнийн карт"),
    ("🗂 Найрлага", "найрлагын карт"),
    ("🗂 Хэрэглэх заавар", "хэрэглэх зааврын карт"),
    ("🗂 Танилцуулга", "танилцуулга карт"),
    ("үйлдвэрийн үнэ", "үйлдвэрийн үнийн сануулга"),
    ("📍", "салбаруудын жагсаалт"),
    ("#where", "худалдаалах цэгийн газрын зураг (#where)"),
    ("emonos.mn", "Emonos-ийн онлайн захиалгын холбоос"),
    ("hpoint.mn", "Health point-ийн онлайн захиалгын холбоос"),
    ("?partner=", "«Хамтран ажиллах хүсэлт»-ийн холбоос"),
)


def _rows(db, psid: str) -> list:
    rows = db.all(
        "SELECT direction, kind, text, created_at FROM messenger_messages WHERE psid = ? AND created_at >= ?"
        " ORDER BY id DESC LIMIT ?", (psid, ago(hours=24 * LOOK_BACK_DAYS), MAX_MESSAGES))
    return [r for r in reversed(rows) if str(r.get("text") or "").strip()]


def _short(text: str) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= QUESTION_CHARS else text[:QUESTION_CHARS - 1].rstrip() + "…"


def facts(db, psid: str, current: str = "", shown: int = 0) -> dict:
    """What is known about this conversation. `current` is the message being answered (not counted as earlier);
    `shown` is how many of the latest messages the AI reads word for word anyway."""
    rows = _rows(db, psid)
    for i in range(len(rows) - 1, -1, -1):  # the message being answered
        if current and rows[i]["direction"] == "in" and rows[i]["text"] == current:
            del rows[i]
            break
    incoming = [r["text"] for r in rows if r["direction"] == "in"]
    outgoing = [r["text"] for r in rows if r["direction"] == "out"]
    texts = incoming + ([current] if current else [])

    topics = []
    for text in texts:
        for key in insights.classify(text):
            if key not in SKIP_TOPICS and key not in topics:
                topics.append(key)
    if any(places.where_intent(t) for t in texts) and "where" not in topics:
        topics.append("where")

    place = None
    for text in texts:  # the last place named wins («Баянзүрх… үгүй ээ, Сонгинохайрхан»)
        place = places.find_place(text) or place
    sizes = []
    for text in texts:
        for m in SIZE.finditer(str(text)):
            if m.group(1) not in sizes:
                sizes.append(m.group(1))

    sent = []
    joined_out = "\n".join(outgoing)
    for mark, label in SENT:
        if mark.casefold() in joined_out.casefold() and label not in sent:
            sent.append(label)

    earlier = [r for r in rows[:max(0, len(rows) - shown)] if r["direction"] == "in"]
    candidates, seen = [], set()
    for r in earlier:
        text = str(r["text"])
        key = re.sub(r"[\W\d_]+", "", text.casefold())
        if len(text.strip()) < 8 or key in seen or insights.classify(text) in (["greeting"], ["media"]):
            continue
        seen.add(key)
        candidates.append(_short(text))
    # the first questions usually say what the person came for, the last ones lead into what they read word for word
    half = EARLIER_QUESTIONS // 2
    questions = candidates if len(candidates) <= EARLIER_QUESTIONS else candidates[:half] + candidates[-half:]

    last_question = ""
    if rows and rows[-1]["direction"] == "out":
        last = str(rows[-1]["text"])
        if last in places.ASKS:
            last_question = "аль дүүрэг, аймагт байгааг"
        else:
            asked = [s for s in re.split(r"(?<=[.!?])\s+|\n+", last) if s.strip().endswith("?")]
            last_question = _short(asked[-1]) if asked else ""

    return {
        "messages": len(rows),
        "since": rows[0]["created_at"] if rows else "",
        "topics": [insights.LABEL.get(k, k) for k in topics],
        "place": place["label"] if place else "",
        "sizes": [f"{s} мл" for s in sizes],
        "partner": "partner" in topics,
        "phone": bool(insights.find_phone(texts)),
        "stock": "stock" in topics,
        "sent": sent,
        "earlier": questions,
        "last_question": last_question,
    }


def lines(f: dict) -> list:
    out = []
    if f["place"]:
        out.append(f"Байршил: {f['place']} (харилцагч өөрөө хэлсэн — дахин бүү асуу)")
    if f["sizes"]:
        out.append(f"Сонирхсон хэмжээ: {', '.join(f['sizes'])}")
    if f["topics"]:
        out.append(f"Энэ ярианд асуусан сэдэв: {', '.join(f['topics'])}")
    if f["partner"]:
        out.append("Хамтран ажиллах / борлуулах сонирхолтой" +
                   ("; утасны дугаараа үлдээсэн" if f["phone"] else "; утасны дугаар үлдээгээгүй"))
    if f["stock"]:
        out.append("Салбарт байхгүй, дууссан гэж хэлсэн")
    if f["earlier"]:
        out.append("Өмнө бичсэн: " + "; ".join(f"«{q}»" for q in f["earlier"]))
    if f["sent"]:
        out.append(f"Аль хэдийн илгээсэн (дахин бүү давт): {', '.join(f['sent'])}")
    if f["last_question"]:
        out.append(f"Бот сүүлд {f['last_question']} асуусан — одоогийн мессеж нь үүний хариулт байж магадгүй")
    return out


def notes(db, psid: str, current: str = "", shown: int = 0) -> dict:
    """{"text": the summary for the prompt ("" when there is nothing to say), "context": words for choosing the
    knowledge (the place named earlier, so its branches are included)}."""
    try:
        f = facts(db, psid, current, shown)
    except Exception:  # the summary helps; a reply must never fail because of it
        return {"text": "", "context": "", "lines": []}
    found = lines(f)
    return {"text": "\n".join(f"- {line}" for line in found), "context": " ".join([f["place"], *f["sizes"]]).strip(),
            "lines": found}
