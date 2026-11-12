"""Where to buy: recognise a district or aimag in a message and list the branches there.

Used by Messenger (ask "which district?", then answer from the branches table, also when the AI is unavailable)
and by the AI assistant's knowledge.
"""
import re

from .db import DBError

UB = "Улаанбаатар"
LIMIT = 6  # branches per answer

# (city, district, aliases). Aliases are matched at the start of a word, so «Баянзүрхэд», «Дарханд» match too;
# aliases of 3 letters or fewer («БЗД», «hud») must be a whole word. Common Latin spellings are included.
PLACES = [
    (UB, "Баянзүрх", "баянзүрх бзд bayanzurkh bayanzurh bayanzvrh bzd сансар sansar жуков zhukov jukov"),
    (UB, "Баянгол", "баянгол бгд bayangol bgd"),
    (UB, "Хан-Уул", "хан-уул хан_уул хануул худ khan-uul han-uul khan_uul han_uul khanuul hanuul hud khud зайсан zaisan "
                    "яармаг yarmag yaarmag"),
    (UB, "Сүхбаатар", "сүхбаатар_дүүрэг сбд sbd sukhbaatar_duureg suhbaatar_duureg"),
    (UB, "Чингэлтэй", "чингэлтэй чд chingeltei chingeltey chd"),
    (UB, "Сонгинохайрхан", "сонгинохайрхан схд songinokhairkhan songinohairhan songino shd skhd"),
    (UB, "Налайх", "налайх nalaikh nalaih"),
    (UB, "Багануур", "багануур baganuur"),
    (UB, "Багахангай", "багахангай bagakhangai bagahangai"),
    ("Архангай", None, "архангай цэцэрлэг arkhangai arhangai tsetserleg"),
    ("Баян-Өлгий", None, "баян-өлгий баян_өлгий баянөлгий өлгий bayan-ulgii bayan-olgii bayan_ulgii bayan_olgii ulgii olgii"),
    ("Баянхонгор", None, "баянхонгор bayankhongor bayanhongor"),
    ("Булган", None, "булган bulgan"),
    ("Говь-Алтай", None, "говь-алтай говь_алтай говьалтай алтай_хот govi-altai gobi-altai govi_altai gobi_altai govialtai"),
    ("Говьсүмбэр", None, "говьсүмбэр чойр govisumber gobisumber choir"),
    ("Дархан-Уул", None, "дархан darkhan darhan"),
    ("Дорноговь", None, "дорноговь сайншанд dornogovi dornogobi sainshand"),
    ("Дорнод", None, "дорнод чойбалсан dornod choibalsan"),
    ("Дундговь", None, "дундговь мандалговь dundgovi dundgobi mandalgovi"),
    ("Завхан", None, "завхан улиастай zavkhan zavhan uliastai"),
    ("Орхон", None, "орхон эрдэнэт orkhon orhon erdenet"),
    ("Өвөрхангай", None, "өвөрхангай арвайхээр uvurkhangai uvurhangai ovorkhangai arvaikheer arvaiheer"),
    ("Өмнөговь", None, "өмнөговь даланзадгад umnugovi omnogovi umnugobi dalanzadgad"),
    ("Сүхбаатар", None, "сүхбаатар_аймаг баруун-урт баруун_урт baruun-urt baruun_urt sukhbaatar_aimag suhbaatar_aimag"),
    ("Сэлэнгэ", None, "сэлэнгэ selenge"),
    ("Төв", None, "төв_аймаг зуунмод tuv_aimag zuunmod"),
    ("Увс", None, "увс улаангом uvs ulaangom"),
    ("Ховд", None, "ховд khovd hovd"),
    ("Хөвсгөл", None, "хөвсгөл мөрөн khuvsgul huvsgul khovsgol hovsgol murun moron"),
    ("Хэнтий", None, "хэнтий өндөрхаан khentii hentii undurkhaan"),
    (UB, None, "улаанбаатар ub ulaanbaatar ulanbator уб нийслэл"),
]

FOLD = str.maketrans({"ү": "у", "ө": "о", "э": "е", "ё": "е", "й": "и", "ы": "и", "ь": "", "ъ": ""})


def _norm(text: str) -> str:
    """Lowercase words separated by single spaces; ү/у, ө/о, э/е fold together (keyboards without Mongolian letters)."""
    text = str(text or "").casefold().translate(FOLD)
    return " " + " ".join(re.findall(r"[0-9a-zа-я]+", text)) + " "


def _aliases():
    for city, district, names in PLACES:
        for name in names.split():
            alias = _norm(name.replace("_", " ").replace("-", " ")).strip()
            yield city, district, alias


ALIASES = sorted(_aliases(), key=lambda a: -len(a[2]))  # «сүхбаатар аймаг» before «сүхбаатар»


def find_place(text: str) -> dict | None:
    """{"city", "district", "label"} for the first district or aimag named in the text, or None."""
    t = _norm(text)
    best = None
    for city, district, alias in ALIASES:
        whole = len(alias.replace(" ", "")) <= 3
        pattern = r" " + re.escape(alias) + (r" " if whole else r"")
        m = re.search(pattern, t)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), city, district)
    if best is None:
        # «Сүхбаатар» alone: the Ulaanbaatar district (the aimag is asked for with «аймаг»)
        if re.search(r" сухбатар| сухбаатар| sukhbaatar| suhbaatar", t):
            return {"city": UB, "district": "Сүхбаатар", "label": "Сүхбаатар дүүрэг"}
        return None
    _, city, district = best
    if district:
        return {"city": city, "district": district, "label": f"{district} дүүрэг"}
    return {"city": city, "district": None, "label": "Улаанбаатар" if city == UB else f"{city} аймаг"}


WHERE_WORDS = ("хаана", "хаанаас", "хаанах", "haana", "hana", "hnaas", "hnas", "haanaas", "haanah", "where")
BUY_WORDS = ("ав", "худалдаж", "худалдаа", "зарагд", "зардаг", "олдо", "байдаг", "байна", "aw", "av", "hudaldaj",
             "zarag", "zardag", "oldo", "baidag", "bga", "baina", "buy")
DIRECT = ("салбар", "худалдаалах цэг", "борлуулах цэг", "байршил", "эмийн сан", "salbar", "bairshil", "emiin san",
          "зарагддаг", "худалдаж ав", "hudaldaj aw", "hudaldaj av", "zaragddag",
          "аль дэлгүүр", "ямар дэлгүүр", "хайпермаркет", "супермаркет", "al delguur", "yamar delguur",
          "hypermarket", "supermarket", "minii hyper", "minii delguur", "minii discounter",
          "эфэс", "efes", "effes", "бсб", "bsb", "монос", "monos", "emonos", "е-монос")
NOT_WHERE = ("үйлдвэрл", "uildwerl", "uildverl")  # «хаана үйлдвэрлэдэг вэ» asks where it is made


WHERE_WORDS, BUY_WORDS = tuple(_norm(w).strip() for w in WHERE_WORDS), tuple(_norm(w).strip() for w in BUY_WORDS)
DIRECT, NOT_WHERE = tuple(_norm(w).rstrip() for w in DIRECT), tuple(_norm(w).rstrip() for w in NOT_WHERE)


def where_intent(text: str) -> bool:
    t = _norm(text)
    if any(n in t for n in NOT_WHERE):
        return False
    if any(d in t for d in DIRECT):
        return True
    words = t.split()
    asks_where = any(w.startswith(x) for w in words for x in WHERE_WORDS)
    buys = any(w.startswith(x) for w in words for x in BUY_WORDS)
    return asks_where and buys


def branches_in(db, place: dict, limit: int = 200) -> list:
    sql = ("SELECT chain, name, city, district, address, phone, hours FROM branches"
           " WHERE active = 1 AND is_sample = 0 AND city = ?")
    params = [place["city"]]
    if place.get("district"):
        sql += " AND district = ?"
        params.append(place["district"])
    sql += " ORDER BY (lat IS NULL), name LIMIT ?"
    try:
        rows = db.all(sql, tuple(params + [limit]))
    except DBError:
        return []
    # take turns between chains, so the first six are not all from one of them
    chains: dict = {}
    for row in rows:
        chains.setdefault(row["chain"], []).append(row)
    queues = sorted(chains.values(), key=lambda q: (-len(q), q[0]["chain"]))
    mixed = []
    while any(queues):
        for queue in queues:
            if queue:
                mixed.append(queue.pop(0))
    return mixed


def has_branches(db) -> bool:
    try:
        return bool(db.one("SELECT id FROM branches WHERE active = 1 AND is_sample = 0 LIMIT 1"))
    except DBError:
        return False


def districts_with_branches(db) -> list:
    """Ulaanbaatar districts that have branches, busiest first: the buttons for «which district?»."""
    try:
        rows = db.all("SELECT district, COUNT(*) AS n FROM branches WHERE active = 1 AND is_sample = 0 AND city = ?"
                      " AND district IS NOT NULL AND district <> '' GROUP BY district ORDER BY n DESC, district", (UB,))
    except DBError:
        return []
    return [r["district"] for r in rows]


def aimags_with_branches(db) -> list:
    try:
        rows = db.all("SELECT city, COUNT(*) AS n FROM branches WHERE active = 1 AND is_sample = 0 AND city <> ?"
                      " GROUP BY city ORDER BY city", (UB,))
    except DBError:
        return []
    return [r["city"] for r in rows]


def line(b: dict, n: int) -> str:
    head = f"{n}. {b['name']}" if b["name"].casefold().startswith(b["chain"].split()[0].casefold()) \
        else f"{n}. {b['chain']} — {b['name']}"
    details = [x for x in (b.get("address"), " · ".join(y for y in (b.get("hours"), b.get("phone")) if y)) if x]
    return "\n".join([head] + details)


def answer_text(db, place: dict, site: str = "") -> str:
    rows = branches_in(db, place)
    where = f"{site}/#where" if site else ""
    if not rows:
        return (f"📍 {place['label']}: одоогоор манай худалдаалах цэг бүртгэгдээгүй байна."
                + (f" Бусад салбаруудыг {where} хаягаар харж, тэндээс байршлын санал илгээх боломжтой." if where else "")
                + " Өөр дүүрэг, аймгийн нэрээ бичвэл тэндэх салбаруудыг хэлье.")
    shown = rows[:LIMIT]
    text = f"📍 {place['label']}\nДОМЧ-ийг эдгээр салбараас авах боломжтой:\n\n" + "\n\n".join(
        line(b, i + 1) for i, b in enumerate(shown))
    if len(rows) > len(shown):
        text += f"\n\nБас {len(rows) - len(shown)} салбар бий" + (f": {where}" if where else ".")
    elif where:
        text += f"\n\nГазрын зураг: {where}"
    return text + "\nОчихоосоо өмнө үлдэгдлийг салбараас лавлаарай."


ASK = "Та аль дүүрэг эсвэл аймагт байна вэ? Доорх товчноос сонгох эсвэл нэрийг нь бичээрэй."
ASK_RURAL = "Аль аймагт байна вэ? Доорх товчноос сонгох эсвэл аймаг, сумынхаа нэрийг бичээрэй."
ASKS = (ASK, ASK_RURAL)


def ask_buttons(db) -> list:
    buttons = [{"content_type": "text", "title": d[:20], "payload": f"WHERE:{UB}|{d}"} for d in districts_with_branches(db)[:11]]
    if aimags_with_branches(db):
        buttons.append({"content_type": "text", "title": "Орон нутаг", "payload": "WHERE_RURAL"})
    return buttons


def rural_buttons(db) -> list:
    return [{"content_type": "text", "title": a[:20], "payload": f"WHERE:{a}|"} for a in aimags_with_branches(db)[:13]]


def from_payload(payload: str) -> dict | None:
    if not payload.startswith("WHERE:"):
        return None
    city, _, district = payload[6:].partition("|")
    if not city:
        return None
    district = district or None
    return {"city": city, "district": district,
            "label": f"{district} дүүрэг" if district else ("Улаанбаатар" if city == UB else f"{city} аймаг")}


def knowledge(db) -> list:
    """Branches for the AI assistant, one entry per aimag / Ulaanbaatar district."""
    try:
        rows = db.all("SELECT chain, name, city, district, address, phone, hours FROM branches"
                      " WHERE active = 1 AND is_sample = 0 ORDER BY city <> ?, city, district, chain, name", (UB,))
    except DBError:
        return []
    groups: dict = {}
    for b in rows:
        key = f"{b['district']} дүүрэг" if b["city"] == UB and b.get("district") else (
            "Улаанбаатар (дүүрэг тодорхойгүй)" if b["city"] == UB else f"{b['city']} аймаг")
        groups.setdefault(key, []).append(b)
    return [{"source": "Худалдаалах цэг", "title": f"Салбарууд: {key}",
             "text": "\n".join(line(b, i + 1) for i, b in enumerate(items)),
             "keys": f"хаана авах салбар эмийн сан дэлгүүр {' '.join(sorted({b['chain'] for b in items}))} {key}"} for key, items in groups.items()]
