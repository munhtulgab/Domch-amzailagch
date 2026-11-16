"""Card carousels for the chat (Messenger / Instagram generic template): the two sizes with their prices, and the
ingredients — each a picture, a title, a line and buttons, instead of a block of text."""
import re

from .ai import PRICE_NOTE
from .db import DBError

PRICE_PAYLOAD = "PRICE"
ONLINE_PAYLOAD = "ONLINE"  # «Онлайн захиалах»: both online pharmacies, not just one
ONLINE_TEXT = "🛒 Emonos болон Health point эмийн сангийн онлайн захиалгыг ашиглана уу."
ONLINE_NOTE = ("Эмийн сан, дэлгүүрт үйлдвэрийн үнээс өндөр үнээр зарагдаж болно. Эмийн сан болон дэлгүүр бүр өөрийн "
               "нэмэгдэлтэй зардаг тул үнэ салбар бүрт өөр байж болно.")
INGREDIENTS_PAYLOAD = "INGREDIENTS"
USAGE_PAYLOAD = "USAGE"
# «мэдээлэл өгөөч», «дэлгэрэнгүй мэдээлэл»: nothing specific asked — an overview of the product as cards
INFO = re.compile(r"мэдээл|medeel|mdeel|medel|дэлгэрэнгүй|delgerengui|delgrengui|танилцуул|taniltsuul|info", re.I)
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


HOW_TO_USE = re.compile(r"хэрэгл|heregl|hereglee|заавар|zaavar|зайл|zail|хэдэн удаа|heden udaa|hed udaa|хэдэн мл|heden ml",
                        re.I)
# «хэр удаан хадгалах вэ» (shelf life) or «жирэмсэн хэрэглэж болох уу» (may I?) are not «how to use»: the AI answers
NOT_HOW = re.compile(r"хадгал|hadgal|хугацаа|hugatsaa|дуусах|duusah|задар|болох|болно|bolo|bolh|bolno|bolku|болхуу", re.I)
USAGE = (
    ("use-adult", "Насанд хүрэгчид · 25 мл", "Шүдээ угаасны дараа 25 мл-ээр 10 секунд зайлаад нулимна. 2 удаа давтана."),
    ("use-kid", "Хүүхэд · 15 мл", "Эцэг эхийн хяналтан дор 15 мл-ээр 10 секунд зайлаад нулимна. 2 удаа давтана."),
    ("use-warn", "Анхааруулга", "Залгихгүй. Найрлагын аль нэг бодист харшилтай бол хэрэглэж болохгүй."),
)
USAGE_SUMMARY = ("🗂 Хэрэглэх заавар: насанд хүрэгчид 25 мл, хүүхэд 15 мл, 10 секунд зайлаад нулимна, 2 удаа давтана. "
                 "Залгихгүй.")


def usage_elements(site: str) -> list:
    base = _base(site)
    return [{
        "title": title, "subtitle": line, "image_url": f"{base}/media/bot/{key}.jpg",
        "default_action": {"type": "web_url", "url": f"{base}/#usage"},
        "buttons": [
            {"type": "web_url", "title": "Дэлгэрэнгүй", "url": f"{base}/#usage"},
            {"type": "postback", "title": "Найрлага", "payload": INGREDIENTS_PAYLOAD},
            {"type": "postback", "title": "Хаанаас авах", "payload": "WHERE_ASK"},
        ],
    } for key, title, line in USAGE]


def overview_elements(db, site: str) -> list:
    """The product in four cards: what it is and costs, ingredients, how to use, where to buy."""
    base = _base(site)
    prices = " · ".join(f"{int(p['volume_ml'])} мл {_money(p['price'])}" for p in products(db) if p.get("price"))
    return [
        {"title": "ДОМЧ ам зайлагч", "subtitle": f"Жамц давсны уусмал, спирт агуулаагүй. {prices}".strip()[:80],
         "image_url": f"{base}/media/bot/domch-500.jpg", "default_action": {"type": "web_url", "url": base},
         "buttons": [{"type": "postback", "title": "Үнэ", "payload": PRICE_PAYLOAD},
                     {"type": "web_url", "title": "Вэбээс үзэх", "url": base}]},
        {"title": "Найрлага", "subtitle": INGREDIENTS[0][2], "image_url": f"{base}/media/bot/ing-all.jpg",
         "default_action": {"type": "web_url", "url": f"{base}/#ingredients"},
         "buttons": [{"type": "postback", "title": "Найрлага", "payload": INGREDIENTS_PAYLOAD}]},
        {"title": "Хэрэглэх заавар", "subtitle": USAGE[0][2], "image_url": f"{base}/media/bot/use-adult.jpg",
         "default_action": {"type": "web_url", "url": f"{base}/#usage"},
         "buttons": [{"type": "postback", "title": "Хэрэглэх заавар", "payload": USAGE_PAYLOAD}]},
        {"title": "Хаанаас авах", "subtitle": "Эмийн сан, дэлгүүрүүдээс эсвэл Emonos, Health point-оос онлайнаар.",
         "image_url": f"{base}/media/bot/where.jpg", "default_action": {"type": "web_url", "url": f"{base}/#where"},
         "buttons": [{"type": "postback", "title": "Хаанаас авах", "payload": "WHERE_ASK"},
                     {"type": "postback", "title": "Онлайн захиалах", "payload": ONLINE_PAYLOAD}]},
    ]


OVERVIEW_SUMMARY = "🗂 Танилцуулга: ДОМЧ ам зайлагч · найрлага · хэрэглэх заавар · хаанаас авах"


def which(topics: set, text: str) -> str:
    """'price', 'ingredients', 'usage' or 'info' when the message asks only that (cards answer it whole), else ''."""
    if WHY.search(text or ""):
        return ""
    rest = topics - {"greeting", "other"}
    if rest - {"info", "order"}:
        rest = rest - {"info", "order"}  # «Үнийн мэдээлэл» asks the price
    if rest == {"price"}:
        return "price"
    if rest == {"ingredients"}:
        return "ingredients"
    if rest == {"usage"} and HOW_TO_USE.search(text or "") and not NOT_HOW.search(text or ""):
        return "usage"  # «хэрхэн хэрэглэх вэ», not «хэр удаан хадгалах вэ»
    if (rest and rest <= {"info", "order"} and "info" in rest) or (not rest and INFO.search(text or "")):
        return "info"  # «мэдээлэл авъя», «дэлгэрэнгүй мэдээлэл»
    return ""


def for_payload(payload: str) -> str:
    return {PRICE_PAYLOAD: "price", INGREDIENTS_PAYLOAD: "ingredients", USAGE_PAYLOAD: "usage"}.get(payload, "")
