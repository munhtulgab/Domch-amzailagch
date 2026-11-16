"""A last look over each AI reply before it is sent, so it reads like a person in a chat and not like a template:
broken links are mended, stock closing lines go, and what the bot has already said in this conversation (the
factory-price reminder, «see the map at …», the online pharmacies) is not said again."""
import re

from .common import ago

EMONOS = "https://www.emonos.mn/category?search=%D0%94%D0%BE%D0%BC%D1%87"
HPOINT = "https://hpoint.mn/categories/0?q=%D0%94%D0%BE%D0%BC%D1%87"
URL = re.compile(r"https?://[A-Za-z0-9%/?=&._:#+~-]+")
# Gemini sometimes cuts these long search links or runs the next word into them («…%D1%8част»)
KNOWN = ((re.compile(r"https?://(?:www\.)?emonos\.mn/[A-Za-z0-9%/?=&._:#+~-]*"), EMONOS),
         (re.compile(r"https?://(?:www\.)?hpoint\.mn/[A-Za-z0-9%/?=&._:#+~-]*"), HPOINT))
STOCK_LINES = re.compile(
    r"(өөр|бусад)\s+(юу|ямар|асуулт|асуух|зүйл).{0,40}(сонирхо|байвал|асуу|хэрэгтэй)"
    r"|туслахад\s+бэлэн|чөлөөтэй\s+асуу|асуух\s+зүйл\s+байвал|асуулт\s+байвал",
    re.I,
)
SENTENCE = re.compile(r"(?<=[.!?…])\s+|\n+")
LIST_LINE = re.compile(r"^\s*(\d+[.)]|[•\-–])\s|\d{4}-\d{4}")


def mend_links(text: str) -> str:
    for pattern, url in KNOWN:
        text = pattern.sub(url, text)
    # a word glued onto the end of a link: the link ends its line, the rest goes on the next
    return re.sub(r"(https?://[A-Za-z0-9%/?=&._:#+~-]+)(?=[А-Яа-яЁёӨөҮү])", "\\1\n", text)


def _norm(sentence: str) -> str:
    return re.sub(r"[^\wа-яёөү%]+", "", sentence.casefold())


def said_before(db, psid: str) -> set:
    """Every sentence the bot sent in this conversation in the last day."""
    rows = db.all("SELECT text FROM messenger_messages WHERE psid = ? AND direction = 'out' AND kind IN ('ai', 'auto')"
                  " AND created_at >= ? ORDER BY id DESC LIMIT 30", (psid, ago(hours=24)))
    out = set()
    for row in rows:
        for part in SENTENCE.split(row.get("text") or ""):
            key = _norm(part)
            if len(key) >= 20:
                out.add(key)
    return out


def polish(db, psid: str, answer: str) -> str:
    text = mend_links(answer or "").strip()
    seen = said_before(db, psid)
    base = _trim(text, seen, repeats=False)  # stock lines and reminders/links already given are always dropped
    trimmed = _trim(text, seen, repeats=True)
    # any other sentence said before goes too — unless that leaves little: then the person asked the same again,
    # and the answer stays whole
    return trimmed if len(_norm(trimmed)) >= 0.4 * len(_norm(base)) else base


def boilerplate(key: str) -> bool:
    """The factory-price reminder, the online pharmacies, a link: said once per conversation is enough."""
    return ("http" in key or ("үйлдвэрийнүнэ" in key and "өндөр" in key) or ("emonos" in key and "health" in key)
            or "нэмэгдэлтэй" in key)


def _trim(text: str, seen: set, repeats: bool) -> str:
    lines, kept_any = [], False
    for raw_line in text.split("\n"):
        if LIST_LINE.search(raw_line) or not raw_line.strip():  # a branch list line stays as it is
            lines.append(raw_line)
            kept_any = kept_any or bool(raw_line.strip())
            continue
        parts = [p for p in re.split(r"(?<=[.!?…])\s+", raw_line) if p.strip()]
        keep = []
        for part in parts:
            if STOCK_LINES.search(part):
                continue
            key = _norm(part)
            if len(key) >= 20 and key in seen and (repeats or boilerplate(key)):
                continue
            keep.append(part)
        if keep:
            lines.append(" ".join(keep))
            kept_any = True
    result = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return result if kept_any and len(result) >= 2 else text
