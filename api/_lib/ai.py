"""AI answers (Google Gemini) grounded in the knowledge base, doctor tips and FAQs.

The admin saves a Gemini API key under Settings → AI. Messenger then answers questions that the quick
buttons do not cover, using only what the site knows about DOMCH.
"""
import json
import os
import re
import time

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from .common import ago, fail, now_utc, public_links, require_admin, site_url
from .db import DBError, get_db

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
PREFIX = "ai."
KEYS = ("gemini_key", "model", "enabled", "instructions", "models", "checked_at", "last_error", "pause_minutes",
        "cooldown")
PAUSE_CHOICES = (0, 15, 30, 60, 180, 720)
DEFAULT_PAUSE = 30
CONTEXT_BUDGET = 24000  # characters of knowledge sent with each question
SKIP_MODEL = re.compile(r"image|tts|audio|live|embedding|vision|aqa|imagen|veo|robotics|computer|learnlm|gemma|nano", re.I)

http = httpx.Client(timeout=10.0)  # replaced in tests


class AIError(Exception):
    def __init__(self, message: str, status: int = 0, transient: bool = False):
        super().__init__(message)
        self.status = status
        self.transient = transient  # overloaded / quota / timeout: another model may still answer


TRANSIENT_STATUS = (429, 500, 502, 503, 504)
TRANSIENT_TEXT = re.compile(r"high demand|overloaded|unavailable|try again later|exhausted|deadline|internal error", re.I)


# ------------------------------------------------------------------ config

def load(db) -> dict:
    rows = db.all("SELECT key, value FROM integrations WHERE key LIKE 'ai.%'")
    cfg = {key: "" for key in KEYS}
    for row in rows:
        cfg[row["key"][len(PREFIX):]] = row["value"] or ""
    return cfg


def store(db, values: dict) -> None:
    for key, value in values.items():
        db.run(
            "INSERT INTO integrations (key, value, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (PREFIX + key, "" if value is None else str(value), now_utc()),
        )


def pause_minutes(cfg: dict) -> int:
    try:
        value = int(cfg.get("pause_minutes") or DEFAULT_PAUSE)
    except ValueError:
        value = DEFAULT_PAUSE
    return value if value in PAUSE_CHOICES else DEFAULT_PAUSE


def ready(cfg: dict) -> bool:
    return cfg.get("enabled") == "1" and bool(cfg.get("gemini_key")) and bool(cfg.get("model"))


def note_error(db, context: str, exc: Exception) -> None:
    print(f"[ai] {context}: {exc}", flush=True)
    try:
        store(db, {"last_error": json.dumps({"at": now_utc(), "context": context, "message": str(exc)[:500]},
                                            ensure_ascii=False)})
    except DBError:
        pass


# ------------------------------------------------------------------ Gemini

def _request(method: str, path: str, key: str, body: dict | None = None, timeout: float = 10.0) -> dict:
    try:
        res = http.request(method, f"{GEMINI_URL}/{path}", headers={"x-goog-api-key": key}, json=body, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise AIError("Gemini хугацаандаа хариулсангүй.", transient=True) from exc
    except httpx.HTTPError as exc:
        raise AIError(f"Gemini-тэй холбогдож чадсангүй: {exc}", transient=True) from exc
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400:
        err = (data or {}).get("error") or {}
        message = err.get("message") or f"Gemini алдаа ({res.status_code})"
        if re.search(r"location is not supported", message, re.I):
            region = os.getenv("VERCEL_REGION", "")
            message = ("Gemini API энэ серверийн байршлаас" + (f" ({region})" if region else "") + " ажиллахгүй байна."
                       " Сервер Gemini дэмждэг бүсэд (жишээ нь Япон, Сингапур) байх ёстой. " + message)
        elif res.status_code in (400, 401, 403) and re.search(r"api key|API_KEY|permission", message, re.I):
            message = "Gemini API key буруу эсвэл идэвхгүй байна. " + message
        elif res.status_code == 429:
            message = "Gemini-ийн хязгаарт хүрсэн (quota). Түр хүлээгээд дахин оролдоно уу. " + message
        elif res.status_code == 503 or TRANSIENT_TEXT.search(message):
            message = "Gemini-ийн загвар түр ачаалалтай байна. " + message
        transient = res.status_code in TRANSIENT_STATUS or bool(TRANSIENT_TEXT.search(message))
        raise AIError(message, status=res.status_code, transient=transient)
    return data if isinstance(data, dict) else {}


def list_models(key: str) -> list:
    data = _request("GET", "models?pageSize=1000", key)
    names = []
    for model in data.get("models") or []:
        name = str(model.get("name") or "").removeprefix("models/")
        if "generateContent" in (model.get("supportedGenerationMethods") or []) and name.startswith("gemini") \
                and not SKIP_MODEL.search(name):
            names.append(name)
    return sorted(set(names), key=_model_rank)


def _model_rank(name: str):
    """Stable before preview; Flash (fast enough for Messenger), then Flash-Lite, then others; newest first."""
    parts = name.split("-")
    nums = [int(n) for n in re.findall(r"\d+", parts[1] if len(parts) > 1 else "")[:2]]
    version = tuple(nums + [0] * (2 - len(nums)))
    tier = 1 if "flash-lite" in name else 0 if "flash" in name else 2
    unstable = 1 if re.search(r"preview|exp|latest", name) else 0
    return (unstable, tier, tuple(-v for v in version), name)


def pick_model(models: list) -> str:
    return models[0] if models else ""


def _thinking(model: str) -> dict:
    if model.startswith("gemini-2.5"):
        return {"thinkingBudget": 0} if "flash" in model else {}
    if model.startswith("gemini-2"):
        return {}
    return {"thinkingLevel": "minimal" if "flash" in model else "low"}


def generate(key: str, model: str, system: str, contents: list, timeout: float = 8.0) -> str:
    config = {"temperature": 0.3, "maxOutputTokens": 800}
    thinking = _thinking(model)
    body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents, "generationConfig": config}
    if thinking:
        config["thinkingConfig"] = thinking
    try:
        data = _request("POST", f"models/{model}:generateContent", key, body, timeout=timeout)
    except AIError as exc:
        if thinking and "thinking" in str(exc).lower():
            config.pop("thinkingConfig", None)
            data = _request("POST", f"models/{model}:generateContent", key, body, timeout=timeout)
        else:
            raise
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason")
        raise AIError(f"Gemini хариу өгсөнгүй ({reason or 'хоосон'}).")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if not text.strip():
        raise AIError(f"Gemini хоосон хариу өгсөн ({candidates[0].get('finishReason', '')}).")
    return clean(text)


def clean(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"(?m)^\s*[*•]\s+", "• ", text)
    text = re.sub(r"(?<!\w)[*_]{1,2}(\S.*?\S|\S)[*_]{1,2}(?!\w)", r"\1", text)
    text = re.sub(r"(?m)^#+\s*", "", text)
    return public_links(text).strip()[:1990]


# ------------------------------------------------------------------ knowledge

def knowledge_items(db, messenger_faq: list | None = None) -> list:
    """Everything the assistant may use, as {source, title, text, keys}."""
    try:
        kb, tips, faqs, products, settings = db.batch([
            "SELECT title, body, keywords FROM knowledge WHERE active = 1 ORDER BY sort, id",
            "SELECT kind, title, summary, body, doctor_name, doctor_title, source FROM tips"
            " WHERE active = 1 AND is_sample = 0 ORDER BY featured DESC, sort, id",
            "SELECT question, answer FROM faqs WHERE active = 1 ORDER BY sort, id",
            "SELECT volume_ml, price, online_url FROM products WHERE active = 1 ORDER BY sort, id",
            "SELECT key, value FROM settings",
        ])
    except DBError:
        kb, tips, faqs, products, settings = [], [], [], [], []
    items = [{"source": "Мэдлэгийн сан", "title": r["title"], "text": r["body"] or "", "keys": r.get("keywords") or ""}
             for r in kb]
    for t in tips:
        who = ", ".join(x for x in (t.get("doctor_name"), t.get("doctor_title")) if x)
        body = "\n".join(x for x in (t.get("summary"), t.get("body")) if x)
        if t.get("source"):
            body += f"\nЭх сурвалж: {t['source']}"
        items.append({"source": "Эмчийн зөвлөгөө" + (f" ({who})" if who else ""), "title": t["title"], "text": body, "keys": ""})
    items += [{"source": "Түгээмэл асуулт", "title": f["question"], "text": f["answer"], "keys": ""} for f in faqs]
    items += [{"source": "Messenger асуулт", "title": f["q"], "text": f["a"], "keys": ""} for f in (messenger_faq or [])]
    if products:
        lines = []
        for p in products:
            price = f"{int(p['price']):,}₮".replace(",", " ") if p.get("price") else "үнийг салбараас лавлана"
            lines.append(f"{p['volume_ml']} мл: {price}" + (f", онлайн: {p['online_url']}" if p.get("online_url") else ""))
        items.append({"source": "Бүтээгдэхүүн", "title": "Савлагаа ба үнэ", "text": "\n".join(lines), "keys": "үнэ мл"})
    contact = {r["key"]: r["value"] for r in settings if r.get("value")}
    parts = [f"{label}: {contact[k]}" for k, label in (("phone", "Утас"), ("email", "И-мэйл"), ("address", "Хаяг"),
                                                       ("online_store", "Онлайн дэлгүүр"), ("facebook", "Facebook"))
             if contact.get(k)]
    if parts:
        items.append({"source": "Холбоо барих", "title": "Холбоо барих", "text": "\n".join(parts), "keys": "утас хаяг"})
    for item in items:  # the assistant should only ever see and repeat the primary address
        item["text"] = public_links(item["text"])
    return items


WORD = re.compile(r"[0-9a-zöüа-яёөү]+", re.I)
LATIN = (("sh", "ш"), ("ch", "ч"), ("ts", "ц"), ("kh", "х"), ("ya", "я"), ("yu", "ю"), ("yo", "ё"), ("ye", "е"),
         ("a", "а"), ("b", "б"), ("c", "ц"), ("d", "д"), ("e", "э"), ("f", "ф"), ("g", "г"), ("h", "х"), ("i", "и"),
         ("j", "ж"), ("k", "к"), ("l", "л"), ("m", "м"), ("n", "н"), ("o", "о"), ("p", "п"), ("q", "ө"), ("r", "р"),
         ("s", "с"), ("t", "т"), ("u", "у"), ("v", "ү"), ("w", "в"), ("x", "х"), ("y", "ы"), ("z", "з"), ("ö", "ө"),
         ("ü", "ү"))
LATIN_RE = re.compile("|".join(k for k, _ in LATIN))
LATIN_MAP = dict(LATIN)
# letters people mix up when typing Mongolian in Latin (у/ү/в, о/ө, э/е, и/й/ы) fold together for matching
FOLD = str.maketrans({"ү": "у", "в": "у", "ө": "о", "э": "е", "ё": "е", "й": "и", "ы": "и", "ь": "", "ъ": ""})


def _fold(word: str) -> str:
    word = LATIN_RE.sub(lambda m: LATIN_MAP[m.group(0)], word).translate(FOLD)
    return re.sub(r"(.)\1+", r"\1", word)


def _words(text: str) -> set:
    """Words for matching a question to knowledge, in a form where «hnaas awah» and «хаанаас авах» meet."""
    return {_fold(w) for w in WORD.findall(str(text or "").casefold()) if len(w) > 2}


def select(items: list, question: str, budget: int = CONTEXT_BUDGET) -> list:
    """All items when they fit; otherwise the ones that share the most words with the question."""
    def size(i):
        return len(i["title"]) + len(i["text"]) + 40
    if sum(size(i) for i in items) <= budget:
        return items
    q = _words(question)

    def score(i):
        prefix = {w[:5] for w in q}
        title, keys, text = _words(i["title"]), _words(i["keys"]), _words(i["text"])
        hit = lambda ws: sum(1 for w in ws if w in q or w[:5] in prefix)  # noqa: E731 (crude Mongolian stemming)
        return 3 * hit(title) + 3 * hit(keys) + hit(text)
    chosen, used = [], 0
    for item in sorted(items, key=score, reverse=True):
        if used + size(item) > budget:
            continue
        chosen.append(item)
        used += size(item)
    return chosen


def system_prompt(items: list, site: str, extra: str) -> str:
    knowledge = "\n\n".join(f"### [{i['source']}] {i['title']}\n{i['text']}" for i in items) or "(хоосон)"
    rules = f"""Чи ДОМЧ брэндийн (жамц давсны уусмал, спирт агуулаагүй ам зайлагч, үйлдвэрлэгч Жем Интернэшнл ХХК) Facebook Messenger дээрх туслах.
Хэрэглэгчтэй эелдэг, товч (ихдээ 4–5 өгүүлбэр) монгол хэлээр (кирилл) хариул. Хэрэглэгч монголоор латин үсгээр бичиж болно
(жишээ нь "medeelel og" = "мэдээлэл өг", "une hed ve" = "үнэ хэд вэ") — ойлгоод кирилл үсгээр хариул.
Хэрэглэгч өөр хэлээр (англи, орос) бичвэл тэр хэлээр хариулж болно. Ерөнхий "мэдээлэл өг" гэвэл бүтээгдэхүүний товч
танилцуулга, найрлага, хаанаас авах тухай хэлээд юу сонирхож байгааг асуу.

Дүрэм:
1. Зөвхөн доорх МЭДЛЭГ хэсэгт байгаа мэдээлэлд тулгуурла. Тэнд байхгүй үнэ, хаяг, хугацаа, хямдрал, эмчилгээний үр дүнг бүү зохио.
2. Асуултын хариулт мэдлэгт байхгүй бол үүнийг шударгаар хэлээд, манай ажилтан удахгүй хариулна гэж хэл.
3. Онош тавихгүй, эм зааж өгөхгүй. Өвдөх, цус гарах, хавдах зэрэг шинж тэмдэг дурдвал шүдний эмчид үзүүлэхийг зөвлө.
4. Холбоос хэрэгтэй үед сайтын хаягийг ашигла: {site} (жишээ нь худалдаалах цэг: {site}/#where).
5. Markdown, од (*), гарчиг бүү хэрэглэ. Messenger энгийн текст харуулна.
6. Өөрийгөө хиймэл оюун гэдгийг асуувал үнэнээр хэл."""
    if extra.strip():
        rules += f"\n\nАдминаас өгсөн нэмэлт заавар:\n{extra.strip()}"
    return f"{rules}\n\nМЭДЛЭГ:\n{knowledge}"


def to_contents(history: list, question: str) -> list:
    """Gemini turns from stored messages (oldest first), merged so roles alternate and start with the user."""
    turns = []
    for msg in history + [{"direction": "in", "text": question}]:
        role = "user" if msg["direction"] == "in" else "model"
        text = str(msg.get("text") or "").strip()
        if not text:
            continue
        if turns and turns[-1]["role"] == role:
            turns[-1]["parts"][0]["text"] += "\n" + text
        else:
            turns.append({"role": role, "parts": [{"text": text}]})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


def fallback_chain(cfg: dict, limit: int = 4) -> list:
    """The chosen model first, then stable Flash-Lite and Flash models in turn: different models have separate
    capacity, so when one is "experiencing high demand" another usually answers."""
    try:
        models = json.loads(cfg.get("models") or "[]")
    except ValueError:
        models = []
    stable = [m for m in sorted(models, key=_model_rank)
              if "flash" in m and not re.search(r"preview|exp|latest|transcribe|omni|image|tts|live", m)]
    lites = [m for m in stable if "flash-lite" in m]
    flashes = [m for m in stable if "flash-lite" not in m]
    chain = [cfg["model"]] if cfg.get("model") else []
    for pair in zip(lites + [None] * len(flashes), flashes + [None] * len(lites)):
        for name in pair:
            if name and name not in chain:
                chain.append(name)
    return chain[:limit]


RETRY_IN = re.compile(r"retry in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?", re.I)


def quota_wait(message: str) -> int:
    """Seconds until a model that ran out of quota can be asked again («Please retry in 4h4m26s»)."""
    m = RETRY_IN.search(message or "")
    if m and any(m.groups()):
        hours, minutes, seconds = m.groups()
        wait = int(hours or 0) * 3600 + int(minutes or 0) * 60 + float(seconds or 0)
    elif re.search(r"per ?day", message or "", re.I):
        wait = 6 * 3600
    else:
        wait = 60
    return int(min(max(wait, 30), 24 * 3600))


def cooldowns(cfg: dict) -> dict:
    try:
        data = json.loads(cfg.get("cooldown") or "{}")
    except ValueError:
        return {}
    now = now_utc()
    return {m: until for m, until in data.items() if isinstance(until, str) and until > now} if isinstance(data, dict) else {}


def rest_model(db, cfg: dict, model: str, seconds: int) -> None:
    resting = cooldowns(cfg)
    resting[model] = ago(minutes=-(seconds // 60 or 1))  # a time in the future
    cfg["cooldown"] = json.dumps(resting)
    if db is not None:
        try:
            store(db, {"cooldown": cfg["cooldown"]})
        except DBError:
            pass


def _short(exc: AIError) -> str:
    if exc.status == 429:
        return "хязгаар дууссан"
    if exc.status == 503 or TRANSIENT_TEXT.search(str(exc)):
        return "ачаалалтай"
    if "хугацаандаа" in str(exc):
        return "хугацаа хэтэрсэн"
    return str(exc)[:120]


def generate_any(cfg: dict, system: str, contents: list, budget: float = 18.0, db=None):
    """Try the chosen model; when it is overloaded or out of quota, the next one. Returns (text, model).

    A model that ran out of quota is skipped until Google says it can be used again, so the time goes to
    models that can still answer.
    """
    started = time.monotonic()
    chain = fallback_chain(cfg)
    resting = cooldowns(cfg)
    order = [m for m in chain if m not in resting] + [m for m in chain if m in resting]
    if not order:
        raise AIError("Gemini загвар сонгогдоогүй байна.")
    failures, last = [], None
    for model in order:
        left = budget - (time.monotonic() - started)
        if left < 1.5:
            failures.append("хугацаа дууссан")
            break
        try:
            return generate(cfg["gemini_key"], model, system, contents, timeout=min(6.0, left)), model
        except AIError as exc:
            last = exc
            print(f"[ai] {model}: {exc}", flush=True)
            if exc.status == 429:
                rest_model(db, cfg, model, quota_wait(str(exc)))
            if not exc.transient:
                raise
            failures.append(f"{model}: {_short(exc)}")
    if len(failures) <= 1:
        raise last
    raise AIError("Бүх загвар амжилтгүй (" + "; ".join(failures) + "). " + str(last), status=last.status, transient=True)


def local_answer(db, question: str, messenger_faq: list | None = None, site: str = "") -> str:
    """No AI available: the knowledge entry that best matches the question, as is."""
    q = _words(question)
    if not q:
        return ""
    prefix = {w[:5] for w in q}

    def hits(text):
        return sum(1 for w in _words(text) if w in q or w[:5] in prefix)
    best, score = None, 0
    for item in knowledge_items(db, messenger_faq):
        value = 3 * hits(item["title"]) + 3 * hits(item["keys"]) + hits(item["text"])
        if value > score:
            best, score = item, value
    if not best or score < 3:
        return ""
    text = best["text"].strip()
    if len(text) > 900:
        text = text[:900].rsplit(" ", 1)[0] + "…"
    return text + (f"\n\nДэлгэрэнгүй: {site}" if site and site not in text else "")


def answer(db, cfg: dict, question: str, history: list | None = None, site: str = "",
           messenger_faq: list | None = None, timeout: float = 18.0) -> dict:
    items = select(knowledge_items(db, messenger_faq), question)
    started = time.monotonic()
    text, model = generate_any(cfg, system_prompt(items, site, cfg.get("instructions") or ""),
                               to_contents(history or [], question), budget=timeout, db=db)
    return {"answer": text, "sources": [f"{i['source']}: {i['title']}" for i in items],
            "ms": int((time.monotonic() - started) * 1000), "model": model}


# ------------------------------------------------------------------ admin routes

admin = APIRouter(prefix="/api/admin/ai", dependencies=[Depends(require_admin)])


def view(db, cfg: dict) -> dict:
    key = cfg["gemini_key"]
    try:
        counts = db.one(
            "SELECT (SELECT COUNT(*) FROM knowledge WHERE active = 1) AS knowledge,"
            " (SELECT COUNT(*) FROM tips WHERE active = 1 AND is_sample = 0) AS tips,"
            " (SELECT COUNT(*) FROM faqs WHERE active = 1) AS faqs"
        ) or {}
    except DBError:
        counts = {}
    try:
        models = json.loads(cfg["models"] or "[]")
    except ValueError:
        models = []
    try:
        last_error = json.loads(cfg["last_error"] or "{}") or {}
    except ValueError:
        last_error = {}
    return {
        "gemini_key": {"set": bool(key), "hint": f"…{key[-4:]}" if len(key) >= 8 else ""},
        "model": cfg["model"],
        "models": models,
        "enabled": cfg["enabled"] == "1",
        "instructions": cfg["instructions"],
        "checked_at": cfg["checked_at"],
        "last_error": last_error,
        "counts": {k: int(v or 0) for k, v in counts.items()},
        "pause_minutes": pause_minutes(cfg),
    }


@admin.get("")
def ai_get():
    db = get_db()
    return view(db, load(db))


@admin.put("")
def ai_put(payload: dict = Body(...)):
    db = get_db()
    cfg = load(db)
    changes, errors = {}, {}
    key = str(payload.get("gemini_key") or "").strip()
    if key:
        if re.search(r"\s", key) or len(key) < 20:
            errors["gemini_key"] = "API key-г бүтнээр нь, хоосон зайгүй хуулж оруулна уу."
        changes["gemini_key"] = key
    if "instructions" in payload:
        extra = str(payload.get("instructions") or "").strip()
        if len(extra) > 2000:
            errors["instructions"] = "Хамгийн ихдээ 2000 тэмдэгт байна."
        changes["instructions"] = extra
    if "enabled" in payload:
        changes["enabled"] = "1" if payload.get("enabled") in (True, 1, "1", "true", "on") else "0"
    if "model" in payload:
        changes["model"] = str(payload.get("model") or "").strip()
    if "pause_minutes" in payload:
        try:
            minutes = int(payload.get("pause_minutes"))
        except (TypeError, ValueError):
            minutes = -1
        if minutes not in PAUSE_CHOICES:
            errors["pause_minutes"] = "Сонголтоос сонгоно уу."
        changes["pause_minutes"] = minutes
    if errors:
        fail(errors)
    cfg.update(changes)
    check = None
    if cfg["gemini_key"] and (key or payload.get("check") or not cfg["models"]):
        try:
            models = list_models(cfg["gemini_key"])
            if not models:
                raise AIError("Энэ key-ээр текст үүсгэх Gemini загвар олдсонгүй.")
            changes["models"] = json.dumps(models)
            if cfg["model"] not in models:
                changes["model"] = pick_model(models)
            changes.update(checked_at=now_utc(), last_error="")
            check = {"ok": True, "message": f"API key зөв. {len(models)} загвар боломжтой."}
        except AIError as exc:
            changes["checked_at"] = ""
            check = {"ok": False, "message": str(exc)}
    store(db, changes)
    return {"ok": True, "check": check, "config": view(db, load(db))}


@admin.post("/test")
def ai_test(request: Request, payload: dict = Body(...)):
    question = str(payload.get("question") or "").strip()
    if not question:
        fail({"question": "Асуултаа бичнэ үү."})
    db = get_db()
    cfg = load(db)
    if not (cfg["gemini_key"] and cfg["model"]):
        raise HTTPException(409, "Эхлээд Gemini API key-ээ хадгална уу.")
    from . import messenger  # local import: messenger imports this module
    mcfg = messenger.load(db)
    try:
        return answer(db, cfg, question, site=site_url(request), messenger_faq=messenger.parse_faq(mcfg), timeout=20.0)
    except AIError as exc:
        note_error(db, "Туршилт", exc)
        raise HTTPException(502, str(exc))
