"""Card carousels for the chat (Messenger / Instagram generic template): the two sizes with their prices, and the
ingredients — each a picture, a title, a line and buttons, instead of a block of text."""
import re

from .ai import PRICE_NOTE
from .db import DBError

PRICE_PAYLOAD = "PRICE"
ONLINE_PAYLOAD = "ONLINE"  # «Онлайн захиалах»: both online pharmacies, not just one
ONLINE_TEXT = "🛒 e-Монос болон Health point эмийн сангийн онлайн захиалгыг ашиглана уу."
INGREDIENTS_PAYLOAD = "INGREDIENTS"
# «500 яагаад илүү үнэтэй вэ» asks why, not what: that one goes to the AI
WHY = re.compile(r"(?<!\w)(яагаад|яах|yagaad|yagad|ygd|ygaad|yaagaad|yaah)", re.I)

INGREDIENTS = (
    ("all", "Найрлага · Спирт агуулаагүй", "Шүүсэн ус, жамц давс, башир цэцгийн ханд, гаа, глицерин, FD&C Blue No.1"),
    ("salt", "Монгол жамц давс", "Нян бактери устгаж, амны хөндий, хоолойн үрэвслийг намдаана."),
    ("clove", "Башир цэцгийн ханд", "Амны эвгүй үнэрийг арилгаж, хоолойн өвчнийг намдаана."),
    ("mint", "Гаа", "Амны хөндийг ариутгаж, сэрүүн амт өгнө."),
)


def _money(value) -> str:
    return f"{int(value):,}".replace(",", " ") + "₮"


def _base(site: str) -> str:
    return (site or "https://domch.gem.mn").rstrip("/")


def products(db) -> list:
    try:
        return db.all("SELECT volume_ml, price, online_url FROM products WHERE active = 1 ORDER BY sort, volume_ml")
    except DBError:
        return []


def price_elements(db, site: str) -> list:
    base = _base(site)
    out = []
    for p in products(db):
        vol = int(p["volume_ml"] or 0)
        subtitle = (f"Үйлдвэрийн үнэ {_money(p['price'])} · Жамц давсны уусмал" if p.get("price")
                    else "Үнийг салбараас лавлана уу · Жамц давсны уусмал")
        image = f"{base}/media/bot/domch-{vol}.jpg" if vol in (250, 500) else f"{base}/media/domch_bottles.webp"
        out.append({
            "title": f"ДОМЧ ам зайлагч {vol} мл",
            "subtitle": subtitle,
            "image_url": image,
            "default_action": {"type": "web_url", "url": f"{base}/#sizes"},
            "buttons": [
                {"type": "postback", "title": "Хаанаас авах", "payload": "WHERE_ASK"},
                {"type": "web_url", "title": "Онлайн захиалах", "url": p["online_url"]} if p.get("online_url")
                else {"type": "postback", "title": "Онлайн захиалах", "payload": ONLINE_PAYLOAD},
                {"type": "web_url", "title": "Вэбээс үзэх", "url": f"{base}/#sizes"},
            ],
        })
    return out


def price_summary(db) -> str:
    """How the price cards read in the admin's chat history (and the text sent if cards cannot be)."""
    parts = [f"{int(p['volume_ml'])} мл — {_money(p['price'])}" for p in products(db) if p.get("price")]
    return f"🗂 Үнэ: {' · '.join(parts)}" if parts else ""


def ingredient_elements(site: str) -> list:
    base = _base(site)
    return [{
        "title": title,
        "subtitle": line,
        "image_url": f"{base}/media/bot/ing-{key}.jpg",
        "default_action": {"type": "web_url", "url": f"{base}/#ingredients"},
        "buttons": [
            {"type": "web_url", "title": "Дэлгэрэнгүй", "url": f"{base}/#ingredients"},
            {"type": "postback", "title": "Үнэ", "payload": PRICE_PAYLOAD},
            {"type": "postback", "title": "Хаанаас авах", "payload": "WHERE_ASK"},
        ],
    } for key, title, line in INGREDIENTS]


def online_message() -> tuple[dict, str]:
    """A message with a button for each online pharmacy, and how it reads as text (with the links)."""
    from .insights import DELIVERY_LINKS

    buttons = [{"type": "web_url", "title": name, "url": url} for name, url in DELIVERY_LINKS]
    text = ONLINE_TEXT + "\n" + "\n".join(f"• {name}: {url}" for name, url in DELIVERY_LINKS)
    return {"attachment": {"type": "template", "payload": {"template_type": "button", "text": ONLINE_TEXT,
                                                           "buttons": buttons}}}, text


INGREDIENT_SUMMARY = ("🗂 Найрлага: шүүсэн ус, жамц давс, башир цэцгийн ханд, гаа, глицерин, FD&C Blue No.1. "
                      "Спирт агуулаагүй.")


def which(topics: set, text: str) -> str:
    """'price' or 'ingredients' when the message asks only that (cards answer it whole), else ''."""
    if WHY.search(text or ""):
        return ""
    rest = topics - {"greeting", "other"}
    if rest == {"price"}:
        return "price"
    if rest == {"ingredients"}:
        return "ingredients"
    return ""
