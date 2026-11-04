"""AI answers (Google Gemini) grounded in the knowledge base, doctor tips and FAQs.

The admin saves a Gemini API key under Settings → AI. Messenger then answers questions that the quick
buttons do not cover, using only what the site knows about DOMCH.
"""
import json
import re
import time

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from .common import fail, now_utc, require_admin
from .db import DBError, get_db

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
PREFIX = "ai."
KEYS = ("gemini_key", "model", "enabled", "instructions", "models", "checked_at", "last_error")
CONTEXT_BUDGET = 24000  # characters of knowledge sent with each question
SKIP_MODEL = re.compile(r"image|tts|audio|live|embedding|vision|aqa|imagen|veo|robotics|computer|learnlm|gemma|nano", re.I)

http = httpx.Client(timeout=10.0)  # replaced in tests


class AIError(Exception):
    pass


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
        raise AIError("Gemini хугацаандаа хариулсангүй.") from exc
    except httpx.HTTPError as exc:
        raise AIError(f"Gemini-тэй холбогдож чадсангүй: {exc}") from exc
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400:
        err = (data or {}).get("error") or {}
        message = err.get("message") or f"Gemini алдаа ({res.status_code})"
        if res.status_code in (400, 401, 403) and re.search(r"api key|API_KEY|permission", message, re.I):
            message = "Gemini API key буруу эсвэл идэвхгүй байна. " + message
        elif res.status_code == 429:
            message = "Gemini-ийн хязгаарт хүрсэн (quota). Түр хүлээгээд дахин оролдоно уу. " + message
        raise AIError(message)
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
    """Stable before preview; newest version first; within a version Flash, then Flash-Lite, then Pro."""
    parts = name.split("-")
    nums = [int(n) for n in re.findall(r"\d+", parts[1] if len(parts) > 1 else "")[:2]]
    version = tuple(nums + [0] * (2 - len(nums)))
    tier = 1 if "flash-lite" in name else 0 if "flash" in name else 2
    unstable = 1 if re.search(r"preview|exp|latest", name) else 0
    return (unstable, tuple(-v for v in version), tier, name)


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
    return text.strip()[:1990]


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
    return items


WORD = re.compile(r"[0-9a-zа-яёөү]+", re.I)


def _words(text: str) -> set:
    return {w for w in WORD.findall(str(text or "").casefold()) if len(w) > 2}


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
Хэрэглэгчтэй эелдэг, товч (ихдээ 4–5 өгүүлбэр) монгол хэлээр (кирилл) хариул. Хэрэглэгч өөр хэлээр бичвэл тэр хэлээр хариулж болно.

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


def answer(db, cfg: dict, question: str, history: list | None = None, site: str = "",
           messenger_faq: list | None = None, timeout: float = 8.0) -> dict:
    items = select(knowledge_items(db, messenger_faq), question)
    started = time.monotonic()
    text = generate(cfg["gemini_key"], cfg["model"], system_prompt(items, site, cfg.get("instructions") or ""),
                    to_contents(history or [], question), timeout=timeout)
    return {"answer": text, "sources": [f"{i['source']}: {i['title']}" for i in items],
            "ms": int((time.monotonic() - started) * 1000), "model": cfg["model"]}


# ------------------------------------------------------------------ admin routes

admin = APIRouter(prefix="/api/admin/ai", dependencies=[Depends(require_admin)])


def site_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto.split(',')[0].strip()}://{host.split(',')[0].strip()}"


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
