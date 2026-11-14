"""What people ask on Messenger and Instagram, and turning partnership messages into partner requests.

Messages are sorted into topics by keywords that work for Cyrillic and for Mongolian typed in Latin
(«үнэ хэд вэ», «une hed we», «vne»). A message may belong to several topics.
"""
import json
import re
import time

from fastapi import APIRouter, Depends, Query

from . import places
from .ai import WORD, _fold
from .common import ago, primary_url, require_admin
from .db import DBError, get_db

TOPICS = [
    # key, label, word stems (matched at the start of each word, after folding)
    ("partner", "Хамтран ажиллах, бөөний худалдаа", ("бөөн", "нийлүүл", "борлуулмаар", "борлуулъя", "борлуулагч", "дистрибь",
                                                     "хамтр", "хамтын", "реклам", "сурталч", "контент", "спонсор",
                                                     "төлөөлөгч", "франчайз", "дилер", "борлуулах", "borluulah", "borluulax", "booniin", "boonii", "бүүний",
                                                     "buunii", "гэрээтийн", "байршуул", "bairshuul", "tuluulugch", "reel")),
    ("price", "Үнэ", ("үнэ", "үний", "yne", "une", "vne", "uniin", "price")),
    ("where", "Хаанаас авах, байршил", ()),
    ("order", "Захиалах, авмаар байна", ("захиал", "zahial", "zaxial", "авъя", "авья", "авий", "awie", "awii", "abii", "aviy",
                                         "авмаар", "awmaar", "avmaar", "ширхэг")),
    ("delivery", "Хүргэлт", ("хүргэ", "хүргүүл", "hurge", "hvrge", "khurge", "delivery", "доставк", "dostavk")),
    ("usage", "Хэрэглэх заавар", ("заавар", "хэрэглэ", "хэрэглээ", "нулим", "зайлах", "зайлж", "удаа", "өдөрт", "zaavar",
                                 "hereglee", "hereglex", "hereglh")),
    ("ingredients", "Орц, найрлага", ("найрлага", "орц", "спирт", "давс", "гаа", "башир", "глицерин", "nairlaga")),
    ("health", "Хүүхэд, жирэмсэн, эрүүл мэнд", ("жирэмс", "хөхүүл", "хүүхэд", "нас", "шүд", "буйл", "үнэр", "хоолой",
                                                "харшил", "өвд", "ханиад", "үрэвс", "шарх", "эмчил", "huuhed", "hvvhed",
                                                "jirems", "shud", "builn")),
    ("stock", "Дэлгүүрт олдохгүй байна гэсэн", ("байхгүй", "bhgui", "bhgvi", "baihgui", "baihgvi", "олдохгүй", "oldohgui",
                                               "oldohgvi", "oldku", "oldgvi", "oldgui", "дууссан", "duussan", "ирэхгүй",
                                               "irehgui", "ирдэггүй", "irdeggui", "alga", "алга")),
    ("info", "Дэлгэрэнгүй мэдээлэл", ("дэлгэрэнгүй", "мэдээлэл", "delgerengui", "medeelel")),
    ("greeting", "Мэндчилгээ", ()),
    ("media", "Зураг, стикер", ()),
    ("other", "Бусад", ()),
]
LABEL = {k: label for k, label, _ in TOPICS}
# phrases: every stem must start one of the words («гэрээт борлуулагч», «авч зарах», «манайх эмийн сан»)
COMBOS = {
    "partner": (("гэрээт", "борлуулагч"), ("гэрээт", "салбар", "бол"), ("гэрээт", "цэг"), ("авч", "зара"), ("аваад", "зара"),
                ("манайх", "эмийн"), ("манайх", "борлуул"), ("манайх", "дэлгүүр"), ("emiin", "san", "zahialga"),
                ("эмийн", "сан", "захиалга"), ("emiin", "san", "bgaa", "yum"), ("эмийн", "сан", "байгаа", "юм"),
                # «Эмийн санд(аа) авах гэсэн юм» — buying for a pharmacy, not from one («эмийн сангаас»)
                ("эмийн", "санд", "ав"), ("emiin", "sand", "aw"), ("emiin", "sand", "av"),
                ("худалдан", "борлуул"), ("hudaldan", "borluul"), ("авч", "борлуул"), ("awch", "borluul"), ("avch", "borluul")),
}
COMBOS = {k: tuple(tuple(_fold(s.casefold()) for s in combo) for combo in v) for k, v in COMBOS.items()}
THANKS = tuple(_fold(w) for w in ("баярла", "bayrla", "bayarla", "баярлалаа"))
STEMS = {k: tuple({_fold(s.casefold()) for s in stems}) for k, _, stems in TOPICS}
PRICE_HOW_MUCH = {_fold("хэд"), _fold("hed")}
GREETING_WORDS = {_fold(w) for w in ("сайн", "байна", "бна", "бнуу", "бну", "уу", "sain", "bnu", "bnuu", "baina", "sn", "hi",
                                     "hello", "сн", "hey", "мэнд", "mend", "сайнуу", "sainuu", "өглөөний", "оройн")}
QUICK_WHERE = {_fold(w) for w in ("орон нутаг", "өөр байршил", "хаяг", "хаая")}
MEDIA = re.compile(r"^\[[^\]]*(хавсралт|стикер)\]$|^👍$")
# Mongolian numbers: 8 digits starting 5–9 (mobile and Ulaanbaatar lines), optionally after +976
PHONE = re.compile(r"(?<![\d.,])(?:\+?976[\s-]?)?([5-9]\d{3})[\s-]?(\d{4})(?![\d.,]|\s?(?:₮|төг|tug|мл|ml|гр|gr))")
ASK_PHONE = ("🤝 Хамтран ажиллах саналд тань баярлалаа! Доорх холбоосоор орж «Хамтран ажиллах хүсэлт»-ийг бөглөж "
             "илгээнэ үү — манай хариуцсан ажилтан тантай холбогдоно:\n{link}\n\n"
             "Эсвэл утасны дугаараа энд бичээд үлдээж болно.")
PARTNER_KINDS = ("pharmacy", "clinic", "corporate", "creator")


def partner_link(site: str, kind: str = "") -> str:
    """The site address that opens the «Хамтран ажиллах хүсэлт» form straight away (see src/Landing.jsx)."""
    kind = kind if kind in PARTNER_KINDS else "pharmacy"
    return f"{(site or primary_url()).rstrip('/')}/?partner={kind}#partner"


def ask_partner(site: str, kind: str = "") -> str:
    return ASK_PHONE.format(link=partner_link(site, kind))


def partner_kind(db, psid: str, channel: str) -> str:
    row = db.one("SELECT kind FROM partner_requests WHERE source_ref = ?", (_ref(psid, channel),))
    return (row or {}).get("kind") or ""
THANK_PHONE = "Баярлалаа! Утасны дугаарыг тань ({phone}) хүлээн авлаа. Манай ажилтан удахгүй холбогдоно. 🙏"


def find_phone(texts) -> str | None:
    """The last phone number written in the messages, as 8 digits."""
    phone = None
    for text in texts:
        for m in PHONE.finditer(str(text or "")):
            phone = f"{m.group(1)}{m.group(2)}"
    return phone


def pretty_phone(phone: str) -> str:
    return f"{phone[:4]}-{phone[4:]}" if phone and len(phone) == 8 else phone
CACHE_SECONDS = 600

_cache: dict = {}


def _stems(text: str) -> list:
    return [_fold(w) for w in WORD.findall(str(text or "").casefold())]


def classify(text: str) -> list:
    """Topic keys for one incoming message (most specific first)."""
    raw = str(text or "").strip()
    if not raw:
        return ["other"]
    if MEDIA.match(raw):
        return ["media"]
    words = _stems(raw)
    found = []
    for key, _, _ in TOPICS:
        stems = STEMS[key]
        if stems and any(w.startswith(s) for w in words for s in stems):
            found.append(key)
        elif any(all(any(w.startswith(s) for w in words) for s in combo) for combo in COMBOS.get(key, ())):
            found.append(key)
    if "stock" in found and any(w.startswith(t) for w in words for t in THANKS):
        found.remove("stock")  # «байхгүй ээ, баярлалаа» is a polite no, not a complaint
    if "price" not in found and any(w in PRICE_HOW_MUCH for w in words) and not ({"usage", "health"} & set(found)):
        found.append("price")  # «хэд вэ», «am zailagch hed we»
    if places.where_intent(raw) or places.find_place(raw) or " ".join(words) in QUICK_WHERE:
        found.append("where")
    if not found and words and all(w in GREETING_WORDS for w in words):
        return ["greeting"]
    order = [k for k, _, _ in TOPICS]
    found = sorted(set(found), key=order.index)
    return found or ["other"]


def _key(text: str) -> str:
    """Groups the same question typed differently: «Үнэ хэд вэ?», «💰 Үнэ хэд вэ», «une hed we»."""
    return " ".join(_stems(text))


# ---------------------------------------------------------------- partnership requests from chats

PARTNER_KIND = (
    ("clinic", ("эмнэлэг", "шүдний", "emneleg", "clinic")),
    ("creator", ("контент", "реклам", "сурталч", "спонсор", "инфлюэнс", "блог", "тикток", "tiktok", "content", "reklam")),
    ("corporate", ("байгууллага", "ажилчид", "ажилтн", "компани", "baiguullaga", "company")),
)


def _partner_kind(text: str) -> str:
    words = _stems(text)
    for kind, stems in PARTNER_KIND:
        if any(w.startswith(_fold(s)) for w in words for s in stems):
            return kind
    return "pharmacy"  # «Эмийн сан, борлуулагч»: reselling, wholesale, supplying a shop


def ensure_partner_columns(db) -> None:
    try:
        db.one("SELECT source, source_ref FROM partner_requests LIMIT 1")
    except DBError:
        for sql in ("ALTER TABLE partner_requests ADD COLUMN source TEXT NOT NULL DEFAULT 'site'",
                    "ALTER TABLE partner_requests ADD COLUMN source_ref TEXT"):
            try:
                db.run(sql)
            except DBError:
                pass  # added by another request in the meantime
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_source_ref ON partner_requests (source_ref) WHERE source_ref IS NOT NULL")


def dismissed(db) -> set:
    row = db.one("SELECT value FROM settings WHERE key = 'partner_dismissed'")
    try:
        return set(json.loads(row["value"])) if row and row["value"] else set()
    except ValueError:
        return set()


def dismiss(db, ref: str) -> None:
    refs = list(dismissed(db) | {ref})[-500:]
    db.run("INSERT INTO settings (key, value) VALUES ('partner_dismissed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
           (json.dumps(refs),))


def record_partner(db, psid: str, name: str | None, channel: str, texts: list, at: str | None = None,
                   phone: str | None = None) -> bool:
    """One partner request per conversation. A conversation already recorded only gets its message updated; a
    phone number that is already in a site request links to that request instead of making a second one.
    A request without a phone is kept out of sight in the admin; returns True when a request becomes visible."""
    ensure_partner_columns(db)
    texts = [t.strip() for t in texts if t and t.strip()]
    if not texts:
        return False
    body = "\n".join(dict.fromkeys(texts))[-1500:]
    source = "instagram" if channel == "instagram" else "messenger"
    ref = f"{source}:{psid}"
    if ref in dismissed(db):
        return False  # the admin deleted this one; do not bring it back
    phone = phone or find_phone(texts)
    existing = db.one("SELECT id, message, phone FROM partner_requests WHERE source_ref = ?", (ref,))
    if existing:
        if body != (existing["message"] or "") or (phone and not existing["phone"]):
            db.run("UPDATE partner_requests SET message = ?, phone = COALESCE(phone, ?) WHERE id = ?",
                   (body, pretty_phone(phone) if phone else None, existing["id"]))
        return bool(phone and not existing["phone"])
    if phone:
        same = db.one("SELECT id FROM partner_requests WHERE REPLACE(REPLACE(phone, ' ', ''), '-', '') = ? LIMIT 1", (phone,))
        if same:
            db.run("UPDATE partner_requests SET source_ref = COALESCE(source_ref, ?) WHERE id = ?", (ref, same["id"]))
            return False
    who = name or f"{'Instagram' if source == 'instagram' else 'Messenger'} хэрэглэгч …{psid[-4:]}"
    details = {"direction": f"{'Instagram' if source == 'instagram' else 'Messenger'}-ээр ирсэн мессеж"}
    db.run(
        "INSERT OR IGNORE INTO partner_requests (kind, org, contact_name, phone, details, message, source, source_ref, created_at)"
        " VALUES (?, NULL, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))",
        (_partner_kind(body), who, pretty_phone(phone) if phone else None, json.dumps(details, ensure_ascii=False), body, source,
         ref, at),
    )
    return bool(phone)


def _ref(psid: str, channel: str) -> str:
    return f"{'instagram' if channel == 'instagram' else 'messenger'}:{psid}"


def on_message(db, psid: str, text: str, channel: str) -> str:
    """Called for each new incoming message. Returns what to say next, if anything:
    'ask'    — a partnership message and no phone yet: ask for one (once per conversation);
    'thanks' — the phone the request was waiting for has arrived;
    ''       — nothing."""
    partner = "partner" in classify(text)
    phone = find_phone([text])
    if not partner and not phone:
        return ""
    ensure_partner_columns(db)
    ref = _ref(psid, channel)
    if not partner:
        # a number sent later in the same conversation completes the request
        row = db.one("SELECT id, phone FROM partner_requests WHERE source_ref = ?", (ref,))
        if not row or row["phone"]:
            return ""
        db.run("UPDATE partner_requests SET phone = ? WHERE id = ?", (pretty_phone(phone), row["id"]))
        return "thanks"
    rows = db.all("SELECT text FROM messenger_messages WHERE psid = ? AND direction = 'in' ORDER BY created_at DESC LIMIT 30", (psid,))
    texts = [r["text"] for r in reversed(rows)]
    contact = db.one("SELECT name FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    record_partner(db, psid, contact.get("name"), channel, [t for t in texts if "partner" in classify(t)] or [text],
                   phone=find_phone(texts))
    row = db.one("SELECT id, phone, details FROM partner_requests WHERE source_ref = ?", (ref,))
    if not row or row["phone"]:
        return ""
    try:
        details = json.loads(row["details"] or "{}")
    except ValueError:
        details = {}
    if details.get("asked_phone"):
        return ""
    details["asked_phone"] = "1"
    db.run("UPDATE partner_requests SET details = ? WHERE id = ?", (json.dumps(details, ensure_ascii=False), row["id"]))
    return "ask"


DELIVERY_LINKS = (("e-Монос", "https://www.emonos.mn/category?search=%D0%94%D0%BE%D0%BC%D1%87"),
                  ("Health point", "https://hpoint.mn/categories/0?q=%D0%94%D0%BE%D0%BC%D1%87"))
DELIVERY = ("🚚 ДОМЧ-ийг ойролцоох эмийн сан, дэлгүүрээс авах боломжтой: {where}\n\n"
            "Эсвэл e-Монос болон Health point эмийн сангийн онлайн захиалгыг ашиглана уу:\n"
            + "\n".join(f"• {name}: {url}" for name, url in DELIVERY_LINKS))


def delivery_reply(site: str) -> str:
    return DELIVERY.format(where=f"{(site or primary_url()).rstrip('/')}/#where")


# ---------------------------------------------------------------- overview

admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


@admin.get("/messenger/insights")
def messenger_insights(days: int = Query(30, ge=1, le=90), fresh: int = Query(0, ge=0, le=1)):
    db = get_db()
    key = (id(db), days)
    hit = _cache.get(key)
    if hit and not fresh and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    try:
        rows = db.all(
            "SELECT m.psid, m.text, m.created_at, c.name, COALESCE(c.channel, 'messenger') AS channel"
            " FROM messenger_messages m LEFT JOIN messenger_contacts c ON c.psid = m.psid"
            " WHERE m.direction = 'in' AND m.created_at >= ? ORDER BY m.created_at DESC",
            (ago(days=days),),
        )
    except DBError:
        rows = []
    topics = {k: {"key": k, "label": LABEL[k], "messages": 0, "people": set(), "examples": []} for k, _, _ in TOPICS}
    channels = {"messenger": set(), "instagram": set()}
    questions: dict = {}
    recent = []
    partners: dict = {}
    phones: dict = {}
    for r in reversed(rows):  # oldest first, so the latest number wins
        found = find_phone([r["text"]])
        if found:
            phones[r["psid"]] = found
    for r in rows:
        keys = classify(r["text"])
        channels.setdefault(r["channel"], set()).add(r["psid"])
        for k in keys:
            topics[k]["messages"] += 1
            topics[k]["people"].add(r["psid"])
            ex = topics[k]["examples"]
            if len(ex) < 3 and k not in ("greeting", "media") and r["text"] and r["text"].strip() not in ex:
                ex.append(r["text"].strip()[:140])
        if "partner" in keys:
            partners.setdefault(r["psid"], {"name": r["name"], "channel": r["channel"], "texts": [], "at": r["created_at"]})
            partners[r["psid"]]["texts"].insert(0, r["text"])
            partners[r["psid"]]["at"] = r["created_at"]
        if keys[0] in ("greeting", "media", "other") and len(keys) == 1:
            continue
        if keys == ["where"] and places.find_place(r["text"]) and not places.where_intent(r["text"]):
            continue  # a district picked from the buttons, not a question
        k = _key(r["text"])
        if not k:
            continue
        q = questions.setdefault(k, {"text": r["text"].strip(), "count": 0, "people": set(), "topic": keys[0]})
        q["count"] += 1
        q["people"].add(r["psid"])
        if len(recent) < 25:
            recent.append({"psid": r["psid"], "name": r["name"], "channel": r["channel"], "text": r["text"],
                           "at": r["created_at"], "topics": keys})
    added = 0
    for psid, p in partners.items():
        try:
            added += record_partner(db, psid, p["name"], p["channel"], p["texts"], p["at"], phone=phones.get(psid))
        except DBError:
            break
    out = {
        "days": days,
        "messages": len(rows),
        "people": len({r["psid"] for r in rows}),
        "channels": {k: len(v) for k, v in channels.items()},
        "topics": [{**t, "people": len(t["people"])} for t in topics.values() if t["messages"]],
        "top_questions": [{**q, "people": len(q["people"])} for q in
                          sorted(questions.values(), key=lambda q: (-len(q["people"]), -q["count"]))[:12]],
        "recent": recent,
        "partners_added": added,
    }
    out["topics"].sort(key=lambda t: -t["people"])
    _cache[key] = (time.time(), out)
    return out
