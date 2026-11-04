"""DOMCH website API (FastAPI). Public content, branch finder, forms, analytics and an admin area."""
import hashlib
import json
import os
import re
from typing import Literal

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from .common import FieldErrors, ago, fail, now_utc, require_admin
from .db import SCHEMA_PATH, DBError, NotConfigured, get_db
from . import ai, media, messenger

app = FastAPI(
    title="DOMCH API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

PHONE_RE = re.compile(r"\+?[0-9][0-9\s\-]{6,18}")
EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
PUBLIC_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
RATE_LIMIT = 5  # submissions per form per visitor per 10 minutes


# ---------------------------------------------------------------- errors

def _validation_response(fields: dict) -> JSONResponse:
    return JSONResponse(
        {"ok": False, "error": "validation", "message": "Маягтын алдааг засна уу.", "fields": fields},
        status_code=422,
    )


@app.exception_handler(FieldErrors)
async def _field_errors(request: Request, exc: FieldErrors):
    return _validation_response(exc.fields)


def _mn_message(err: dict) -> str:
    kind = err.get("type", "")
    ctx = err.get("ctx") or {}
    if kind == "missing":
        return "Заавал бөглөнө үү."
    if kind == "string_too_short":
        return f"Хамгийн багадаа {ctx.get('min_length')} тэмдэгт бичнэ үү."
    if kind == "string_too_long":
        return f"Хамгийн ихдээ {ctx.get('max_length')} тэмдэгт байна."
    if kind == "value_error":
        return str(ctx.get("error") or err.get("msg", "")).replace("Value error, ", "")
    if kind in ("literal_error", "enum"):
        return "Сонголтоо шалгана уу."
    return "Утга буруу байна."


@app.exception_handler(RequestValidationError)
async def _request_validation(request: Request, exc: RequestValidationError):
    fields = {}
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", [])]
        if loc and loc[0] in ("body", "query", "path", "header"):
            loc = loc[1:]
        fields.setdefault(loc[-1] if loc else "form", _mn_message(err))
    return _validation_response(fields)


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, exc: StarletteHTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Алдаа гарлаа."
    if exc.status_code == 404 and message == "Not Found":
        message = "Хүссэн зам олдсонгүй."
    return JSONResponse({"ok": False, "message": message}, status_code=exc.status_code)


@app.exception_handler(NotConfigured)
async def _not_configured(request: Request, exc: NotConfigured):
    return JSONResponse({"ok": False, "error": "not_configured", "message": str(exc)}, status_code=503)


@app.exception_handler(DBError)
async def _db_error(request: Request, exc: DBError):
    return JSONResponse(
        {"ok": False, "error": "db_error", "message": "Өгөгдлийн сантай холбогдоход алдаа гарлаа. Дахин оролдоно уу."},
        status_code=502,
    )


# ---------------------------------------------------------------- helpers

def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real = request.headers.get("x-real-ip", "")
    if real:
        return real.strip()
    return request.client.host if request.client else ""


def ip_hash(request: Request) -> str:
    salt = os.getenv("IP_HASH_SALT") or os.getenv("ADMIN_TOKEN") or "domch"
    return hashlib.sha256(f"{salt}|{client_ip(request)}".encode()).hexdigest()[:24]


def check_rate(db, table: str, visitor: str) -> None:
    row = db.one(
        f"SELECT COUNT(*) AS n FROM {table} WHERE ip_hash = ? AND created_at >= ?",
        (visitor, ago(minutes=10)),
    )
    if row and int(row["n"] or 0) >= RATE_LIMIT:
        raise HTTPException(429, "Хэт олон удаа илгээлээ. 10 минутын дараа дахин оролдоно уу.")


def valid_contact(value: str) -> bool:
    return bool(PHONE_RE.fullmatch(value) or EMAIL_RE.fullmatch(value))


def fold(*parts) -> str:
    return " ".join(str(p or "") for p in parts).casefold()


# ---------------------------------------------------------------- public content

@app.get("/api/health")
def health():
    info = {"ok": True, "db": "not_configured", "admin": bool(os.getenv("ADMIN_TOKEN"))}
    try:
        db = get_db()
        db.one("SELECT 1 AS ok")
        info["db"] = db.driver
    except NotConfigured:
        pass
    except DBError as exc:
        info.update(ok=False, db="error", message=str(exc))
    return info


@app.get("/api/content")
def content(response: Response):
    db = get_db()
    products, faqs, tips, videos, reviews, stats, places, settings, msgr = db.batch([
        "SELECT id, slug, name, volume_ml, price, online_url FROM products WHERE active = 1 ORDER BY sort, id",
        "SELECT id, question, answer FROM faqs WHERE active = 1 ORDER BY sort, id",
        "SELECT id, kind, title, summary, body, doctor_name, doctor_title, video_url, image_url, source, published_at, featured, is_sample"
        " FROM tips WHERE active = 1 ORDER BY featured DESC, sort, id",
        "SELECT id, kind, title, author, topic, video_url, image_url, sponsored, is_sample FROM videos WHERE active = 1 ORDER BY sort, id",
        "SELECT id, name, rating, size, body, created_at FROM reviews WHERE status = 'approved'"
        " ORDER BY created_at DESC, id DESC LIMIT 12",
        "SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS average FROM reviews WHERE status = 'approved'",
        "SELECT DISTINCT city, district, chain FROM branches WHERE active = 1",
        "SELECT key, value FROM settings",
        "SELECT key, value FROM integrations WHERE key IN"
        " ('messenger.button', 'messenger.page_id', 'messenger.page_link')",
    ])
    stat = stats[0] if stats else {}
    districts: dict = {}
    for place in places:
        if place.get("district"):
            districts.setdefault(place["city"], set()).add(place["district"])
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return {
        "products": products,
        "faqs": faqs,
        "tips": tips,
        "videos": videos,
        "reviews": reviews,
        "reviewStats": {"count": int(stat.get("count") or 0), "average": stat.get("average")},
        "filters": {
            "cities": sorted({p["city"] for p in places if p.get("city")}),
            "districts": {city: sorted(values) for city, values in districts.items()},
            "chains": sorted({p["chain"] for p in places if p.get("chain")}),
        },
        "settings": {row["key"]: row["value"] or "" for row in settings if row["key"] in SETTING_KEYS},
        "messenger": messenger.public_info({row["key"][len(messenger.PREFIX):]: row["value"] or "" for row in msgr}),
    }


@app.get("/api/branches")
def branches(
    response: Response,
    city: str = Query("", max_length=60),
    district: str = Query("", max_length=60),
    chain: str = Query("", max_length=80),
    q: str = Query("", max_length=80),
    size: str = Query("", max_length=8),
    limit: int = Query(200, ge=1, le=500),
):
    where, params = ["active = 1"], []
    for column, value in (("city", city), ("district", district), ("chain", chain)):
        if value.strip():
            where.append(f"{column} = ?")
            params.append(value.strip())
    rows = get_db().all(
        "SELECT id, chain, name, city, district, address, lat, lng, phone, hours, sizes, online_url, verified_at, is_sample"
        f" FROM branches WHERE {' AND '.join(where)} ORDER BY city, district, chain, name LIMIT ?",
        params + [limit],
    )
    if size in ("250", "500"):
        rows = [r for r in rows if size in [s.strip() for s in (r.get("sizes") or "").split(",")]]
    needle = q.strip().casefold()
    if needle:
        rows = [r for r in rows if needle in fold(r["chain"], r["name"], r["city"], r["district"], r["address"])]
    response.headers["Cache-Control"] = PUBLIC_CACHE
    return {"items": rows, "count": len(rows)}


SECTIONS = [
    ("Савлагаа ба үнэ", "250 мл, 500 мл савлагаа", "sizes", "савлагаа хэмжээ үнэ 250 500 мл бүтээгдэхүүн худалдан авах домч"),
    ("Орц, найрлага", "Монгол жамц давс, башир цэцгийн ханд, гаа", "ingredients",
     "орц найрлага жамц давс башир цэцэг хадаасан ханд гаа глицерин спирт"),
    ("Хэрэглэх заавар", "Хэмжих, зайлах, нулимах", "usage", "хэрэглэх заавар хэмжих зайлах нулимах хүүхэд насанд хүрэгчид гэр бүл"),
    ("Чанарын баталгаа", "Лабораторийн хяналт, стандарт, ISO 9001", "quality", "чанар стандарт iso лаборатори аюулгүй тэмдэг"),
    ("Эмчийн булан", "Эмчийн зөвлөгөө, эмчээс асуух", "doctor", "эмч зөвлөгөө асуулт видео шүд буйл"),
    ("Хаанаас авах вэ?", "Худалдаалах цэг, эмийн сан", "where", "хаанаас авах салбар эмийн сан дэлгүүр байршил худалдаа онлайн"),
    ("Хэрэглэгчдийн сэтгэгдэл", "Бодит сэтгэгдэл, үнэлгээ", "reviews", "сэтгэгдэл үнэлгээ хэрэглэгч"),
    ("Хамтран ажиллах", "Эмийн сан, эмнэлэг, байгууллага, контент бүтээгч", "partner",
     "хамтран ажиллах хамтын ажиллагаа борлуулагч эмнэлэг байгууллага захиалга контент бүтээгч инфлюенсер"),
]


@app.get("/api/search")
def search(q: str = Query("", max_length=80)):
    needle = q.strip().casefold()
    if len(needle) < 2:
        return {"results": []}
    results = [
        {"type": "section", "title": title, "snippet": snippet, "go": go}
        for title, snippet, go, keys in SECTIONS
        if needle in fold(title, keys)
    ]
    try:
        faqs, tips, places = get_db().batch([
            "SELECT question, answer FROM faqs WHERE active = 1 ORDER BY sort, id",
            "SELECT title, summary, doctor_name FROM tips WHERE active = 1 ORDER BY sort, id",
            "SELECT id, chain, name, city, district, address FROM branches WHERE active = 1",
        ])
    except DBError:
        faqs, tips, places = [], [], []
    for row in faqs:
        if needle in fold(row["question"], row["answer"]):
            results.append({"type": "faq", "title": row["question"], "snippet": row["answer"][:160], "go": "faq"})
    for row in tips:
        if needle in fold(row["title"], row["summary"], row["doctor_name"]):
            results.append({"type": "tip", "title": row["title"], "snippet": (row["summary"] or "")[:160], "go": "doctor"})
    for row in places:
        if needle in fold(row["chain"], row["name"], row["city"], row["district"], row["address"]):
            place = ", ".join(p for p in (row["city"], row["district"]) if p)
            results.append({"type": "branch", "title": f"{row['chain']} · {row['name']}", "snippet": place, "go": "where",
                            "branch": row["id"]})
    return {"results": results[:20]}


# ---------------------------------------------------------------- forms

class ReviewIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=60)
    rating: int = Field(ge=1, le=5)
    size: Literal["250", "500", "unknown"] = "unknown"
    body: str = Field(min_length=10, max_length=1000)
    consent: bool = False
    website: str = Field("", max_length=200)


class QuestionIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field("", max_length=60)
    contact: str = Field("", max_length=120)
    question: str = Field(min_length=10, max_length=1000)
    consent: bool = False
    website: str = Field("", max_length=200)


PARTNER_DETAILS = {
    "pharmacy": (),
    "clinic": ("direction",),
    "corporate": ("size", "quantity", "timeline"),
    "creator": ("social", "focus"),
}


class PartnerIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    kind: Literal["pharmacy", "clinic", "corporate", "creator"]
    org: str = Field("", max_length=120)
    contact_name: str = Field(min_length=2, max_length=80)
    phone: str = Field("", max_length=40)
    email: str = Field("", max_length=120)
    location: str = Field("", max_length=200)
    details: dict[str, str] = Field(default_factory=dict)
    message: str = Field("", max_length=2000)
    consent: bool = False
    website: str = Field("", max_length=200)


class LocationIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    city: str = Field(min_length=2, max_length=60)
    district: str = Field("", max_length=60)
    note: str = Field("", max_length=500)
    contact: str = Field("", max_length=120)
    consent: bool = False
    website: str = Field("", max_length=200)


class EventIn(BaseModel):
    name: str = Field(max_length=40)
    meta: dict = Field(default_factory=dict)


@app.post("/api/reviews", status_code=201)
def create_review(data: ReviewIn, request: Request):
    if not data.consent:
        fail({"consent": "Нийтлэх зөвшөөрлөө тэмдэглэнэ үү."})
    message = "Таны сэтгэгдлийг хүлээн авлаа. Шалгасны дараа нийтлэгдэнэ."
    if data.website:
        return {"ok": True, "message": message}
    db = get_db()
    visitor = ip_hash(request)
    check_rate(db, "reviews", visitor)
    db.run(
        "INSERT INTO reviews (name, rating, size, body, status, ip_hash) VALUES (?, ?, ?, ?, 'pending', ?)",
        (data.name, data.rating, data.size, data.body, visitor),
    )
    return {"ok": True, "message": message}


@app.post("/api/questions", status_code=201)
def create_question(data: QuestionIn, request: Request):
    errors = {}
    if data.contact and not valid_contact(data.contact):
        errors["contact"] = "Утас эсвэл и-мэйл хаягаа зөв оруулна уу."
    if not data.consent:
        errors["consent"] = "Мэдээллээ ашиглахыг зөвшөөрнө үү."
    if errors:
        fail(errors)
    message = "Таны асуултыг хүлээн авлаа. Эмчийн дараагийн зөвлөгөөнд ашиглана."
    if data.website:
        return {"ok": True, "message": message}
    db = get_db()
    visitor = ip_hash(request)
    check_rate(db, "questions", visitor)
    db.run(
        "INSERT INTO questions (name, contact, question, ip_hash) VALUES (?, ?, ?, ?)",
        (data.name or None, data.contact or None, data.question, visitor),
    )
    return {"ok": True, "message": message}


@app.post("/api/partners", status_code=201)
def create_partner(data: PartnerIn, request: Request):
    details = {key: (data.details.get(key) or "").strip()[:300] for key in PARTNER_DETAILS[data.kind]}
    errors = {}
    if data.kind != "creator" and len(data.org) < 2:
        errors["org"] = "Байгууллагын нэрээ оруулна уу."
    if not data.phone and not data.email:
        errors["phone"] = "Утас эсвэл и-мэйлийн аль нэгийг оруулна уу."
    if data.phone and not PHONE_RE.fullmatch(data.phone):
        errors["phone"] = "Утасны дугаараа шалгана уу."
    if data.email and not EMAIL_RE.fullmatch(data.email):
        errors["email"] = "И-мэйл хаягаа шалгана уу."
    if data.kind == "clinic" and not details["direction"]:
        errors["direction"] = "Хамтрах чиглэлээ бичнэ үү."
    if data.kind == "corporate" and not details["quantity"]:
        errors["quantity"] = "Ойролцоо тоо хэмжээг оруулна уу."
    if data.kind == "creator":
        if not details["social"]:
            errors["social"] = "Сошиал хаягаа оруулна уу."
        if not details["focus"]:
            errors["focus"] = "Контентын чиглэлээ бичнэ үү."
        if len(data.message) < 10:
            errors["message"] = "Хамтрах санаагаа 10-аас дээш тэмдэгтээр бичнэ үү."
    if not data.consent:
        errors["consent"] = "Мэдээллээ ашиглахыг зөвшөөрнө үү."
    if errors:
        fail(errors)
    message = "Таны хүсэлтийг хүлээн авлаа."
    if data.website:
        return {"ok": True, "message": message}
    db = get_db()
    visitor = ip_hash(request)
    check_rate(db, "partner_requests", visitor)
    db.run(
        "INSERT INTO partner_requests (kind, org, contact_name, phone, email, location, details, message, ip_hash)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (data.kind, data.org or None, data.contact_name, data.phone or None, data.email or None,
         data.location or None, json.dumps(details, ensure_ascii=False), data.message or None, visitor),
    )
    return {"ok": True, "message": message}


@app.post("/api/location-requests", status_code=201)
def create_location_request(data: LocationIn, request: Request):
    errors = {}
    if data.contact and not valid_contact(data.contact):
        errors["contact"] = "Утас эсвэл и-мэйл хаягаа зөв оруулна уу."
    if data.contact and not data.consent:
        errors["consent"] = "Холбоо барих мэдээллээ ашиглахыг зөвшөөрнө үү."
    if errors:
        fail(errors)
    message = "Саналыг тань хүлээн авлаа. Борлуулалтын баг судалж үзнэ."
    if data.website:
        return {"ok": True, "message": message}
    db = get_db()
    visitor = ip_hash(request)
    check_rate(db, "location_requests", visitor)
    db.run(
        "INSERT INTO location_requests (city, district, note, contact, ip_hash) VALUES (?, ?, ?, ?, ?)",
        (data.city, data.district or None, data.note or None, data.contact or None, visitor),
    )
    return {"ok": True, "message": message}


EVENT_NAMES = {
    "where_click", "branch_search", "online_click", "direction_click", "call_click", "usage_view", "video_play",
    "partner_submit", "review_submit", "question_submit", "location_request", "search", "size_select",
    "messenger_click",
}


@app.post("/api/events", status_code=204)
def create_event(data: EventIn):
    if data.name in EVENT_NAMES:
        try:
            get_db().run(
                "INSERT INTO events (name, meta) VALUES (?, ?)",
                (data.name, json.dumps(data.meta, ensure_ascii=False)[:500]),
            )
        except DBError:
            pass
    return Response(status_code=204)


# ---------------------------------------------------------------- admin

admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

TABLES = {
    "products": {
        "fields": {"slug": "text", "name": "text", "volume_ml": "int", "price": "int", "online_url": "text",
                   "active": "bool", "sort": "int"},
        "required": ("slug", "name", "volume_ml"), "order": "sort, id",
    },
    "branches": {
        "fields": {"chain": "text", "name": "text", "city": "text", "district": "text", "address": "text",
                   "lat": "float", "lng": "float", "phone": "text", "hours": "text", "sizes": "text",
                   "online_url": "text", "verified_at": "text", "active": "bool"},
        "required": ("chain", "name", "city"), "order": "city, district, chain, name", "sample": True,
    },
    "faqs": {
        "fields": {"question": "text", "answer": "text", "sort": "int", "active": "bool"},
        "required": ("question", "answer"), "order": "sort, id",
    },
    "tips": {
        "fields": {"kind": "text", "title": "text", "summary": "text", "body": "text", "doctor_name": "text",
                   "doctor_title": "text", "video_url": "text", "image_url": "text", "source": "text", "published_at": "text",
                   "featured": "bool", "active": "bool", "sort": "int"},
        "required": ("title",), "order": "featured DESC, sort, id", "sample": True,
    },
    "videos": {
        "fields": {"kind": "text", "title": "text", "author": "text", "topic": "text", "video_url": "text",
                   "image_url": "text", "sponsored": "bool", "active": "bool", "sort": "int"},
        "required": ("title",), "order": "sort, id", "sample": True,
    },
    "knowledge": {
        "fields": {"topic": "text", "title": "text", "body": "text", "keywords": "text", "active": "bool", "sort": "int"},
        "required": ("title", "body"), "order": "sort, id",
    },
}
KNOWLEDGE_TOPICS = ("product", "ingredients", "usage", "buy", "health", "company", "general")
CHOICES = {("tips", "kind"): ("advice", "minute", "myth"), ("videos", "kind"): ("creator", "family"),
           ("knowledge", "topic"): KNOWLEDGE_TOPICS}
# NOT NULL columns that fall back to their default when the admin leaves them empty
DEFAULTS = {"sort": 0, ("tips", "kind"): "advice", ("videos", "kind"): "creator", ("knowledge", "topic"): "general"}
INBOX = {
    "reviews": {"table": "reviews", "statuses": ("pending", "approved", "rejected")},
    "questions": {"table": "questions", "statuses": ("new", "answered", "archived")},
    "partners": {"table": "partner_requests", "statuses": ("new", "contacted", "closed")},
    "locations": {"table": "location_requests", "statuses": ("new", "done")},
}
SETTING_KEYS = ("phone", "email", "address", "facebook", "instagram", "youtube", "online_store")
SEED_BASE = """
INSERT OR IGNORE INTO products (slug, name, volume_ml, price, online_url, active, sort) VALUES
  ('small', 'Жамц давсны уусмал', 250, NULL, NULL, 1, 1),
  ('big', 'Жамц давсны уусмал', 500, NULL, NULL, 1, 2);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('phone', ''), ('email', ''), ('address', ''), ('facebook', ''), ('instagram', ''), ('youtube', ''), ('online_store', '');
"""


def table_spec(table: str) -> dict:
    spec = TABLES.get(table)
    if not spec:
        raise HTTPException(404, "Ийм хүснэгт алга.")
    return spec


def inbox_spec(kind: str) -> dict:
    spec = INBOX.get(kind)
    if not spec:
        raise HTTPException(404, "Ийм төрөл алга.")
    return spec


def _coerce(kind: str, value):
    if kind == "bool":
        return 1 if value in (True, 1, "1", "true", "on", "yes") else 0
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
    if kind == "int":
        return int(float(value))
    if kind == "float":
        return float(value)
    return str(value)[:4000]


def clean_row(table: str, payload: dict, partial: bool) -> dict:
    spec = table_spec(table)
    row, errors = {}, {}
    for key, kind in spec["fields"].items():
        if key not in payload:
            continue
        try:
            row[key] = _coerce(kind, payload[key])
        except (TypeError, ValueError):
            errors[key] = "Тоо оруулна уу."
            continue
        if row[key] is None:
            fallback = DEFAULTS.get((table, key), DEFAULTS.get(key))
            if fallback is not None:
                row[key] = fallback
        choices = CHOICES.get((table, key))
        if choices and row[key] not in choices:
            errors[key] = "Сонголтоо шалгана уу."
    for key, limit in (("lat", 90), ("lng", 180)):
        value = row.get(key)
        if value is not None and key not in errors and not -limit <= value <= limit:
            errors[key] = "Координат буруу байна. Өргөрөг, уртрагийг сольж оруулсан эсэхээ шалгана уу."
    for key in spec["required"]:
        if (not partial or key in payload) and row.get(key) in (None, ""):
            errors[key] = "Заавал бөглөнө үү."
    if errors:
        fail(errors)
    return row


def _unique_guard(exc: DBError, table: str):
    if "UNIQUE" in str(exc).upper() and table == "products":
        fail({"slug": "Энэ код аль хэдийн бүртгэлтэй байна."})
    raise exc


@admin.get("/summary")
def admin_summary():
    db = get_db()
    counts = db.one(
        "SELECT"
        " (SELECT COUNT(*) FROM reviews WHERE status = 'pending') AS reviews_pending,"
        " (SELECT COUNT(*) FROM questions WHERE status = 'new') AS questions_new,"
        " (SELECT COUNT(*) FROM partner_requests WHERE status = 'new') AS partners_new,"
        " (SELECT COUNT(*) FROM location_requests WHERE status = 'new') AS locations_new,"
        " (SELECT COUNT(*) FROM branches WHERE is_sample = 1) + (SELECT COUNT(*) FROM tips WHERE is_sample = 1)"
        " + (SELECT COUNT(*) FROM videos WHERE is_sample = 1) AS samples,"
        " (SELECT COUNT(*) FROM messenger_messages WHERE direction = 'in' AND is_read = 0) AS messenger_unread"
    )
    since = ago(days=30)
    events = db.all(
        "SELECT name, COUNT(*) AS count FROM events WHERE created_at >= ? GROUP BY name ORDER BY count DESC",
        (since,),
    )
    daily = db.all(
        "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM events WHERE created_at >= ?"
        " GROUP BY day ORDER BY day",
        (since,),
    )
    return {"counts": counts or {}, "events": events, "daily": daily, "driver": db.driver}


@admin.get("/t/{table}")
def admin_list(table: str):
    spec = table_spec(table)
    return {"items": get_db().all(f"SELECT * FROM {table} ORDER BY {spec['order']}")}


@admin.post("/t/{table}", status_code=201)
def admin_create(table: str, payload: dict = Body(...)):
    row = clean_row(table, payload, partial=False)
    columns = list(row)
    try:
        res = get_db().run(
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            [row[c] for c in columns],
        )
    except DBError as exc:
        _unique_guard(exc, table)
    return {"ok": True, "id": res["last_row_id"]}


@admin.put("/t/{table}/{row_id}")
def admin_update(table: str, row_id: int, payload: dict = Body(...)):
    spec = table_spec(table)
    row = clean_row(table, payload, partial=True)
    if not row:
        fail({"form": "Өөрчлөх утга алга."})
    if spec.get("sample"):
        row["is_sample"] = 0
    if table in ("products", "knowledge"):
        row["updated_at"] = now_utc()
    try:
        res = get_db().run(
            f"UPDATE {table} SET {', '.join(f'{c} = ?' for c in row)} WHERE id = ?",
            [*row.values(), row_id],
        )
    except DBError as exc:
        _unique_guard(exc, table)
    if not res["changes"]:
        raise HTTPException(404, "Мөр олдсонгүй.")
    return {"ok": True}


@admin.delete("/t/{table}/{row_id}")
def admin_delete(table: str, row_id: int):
    table_spec(table)
    res = get_db().run(f"DELETE FROM {table} WHERE id = ?", (row_id,))
    if not res["changes"]:
        raise HTTPException(404, "Мөр олдсонгүй.")
    return {"ok": True}


@admin.get("/inbox/{kind}")
def admin_inbox(kind: str, status: str = Query("", max_length=20)):
    spec = inbox_spec(kind)
    sql, params = f"SELECT * FROM {spec['table']}", []
    if status:
        if status not in spec["statuses"]:
            fail({"status": "Төлөв буруу байна."})
        sql += " WHERE status = ?"
        params.append(status)
    rows = get_db().all(sql + " ORDER BY created_at DESC, id DESC LIMIT 500", params)
    for row in rows:
        row.pop("ip_hash", None)
        if kind == "partners":
            try:
                row["details"] = json.loads(row.get("details") or "{}")
            except ValueError:
                row["details"] = {}
    return {"items": rows, "statuses": list(spec["statuses"])}


class StatusIn(BaseModel):
    status: str


@admin.patch("/inbox/{kind}/{row_id}")
def admin_inbox_status(kind: str, row_id: int, data: StatusIn):
    spec = inbox_spec(kind)
    if data.status not in spec["statuses"]:
        fail({"status": "Төлөв буруу байна."})
    res = get_db().run(f"UPDATE {spec['table']} SET status = ? WHERE id = ?", (data.status, row_id))
    if not res["changes"]:
        raise HTTPException(404, "Мөр олдсонгүй.")
    return {"ok": True}


@admin.delete("/inbox/{kind}/{row_id}")
def admin_inbox_delete(kind: str, row_id: int):
    spec = inbox_spec(kind)
    res = get_db().run(f"DELETE FROM {spec['table']} WHERE id = ?", (row_id,))
    if not res["changes"]:
        raise HTTPException(404, "Мөр олдсонгүй.")
    return {"ok": True}


@admin.get("/settings")
def admin_settings():
    rows = get_db().all("SELECT key, value FROM settings")
    values = {row["key"]: row["value"] or "" for row in rows}
    return {key: values.get(key, "") for key in SETTING_KEYS}


@admin.put("/settings")
def admin_settings_update(payload: dict = Body(...)):
    db = get_db()
    for key in SETTING_KEYS:
        if key in payload:
            db.run(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(payload[key] or "").strip()[:300]),
            )
    return {"ok": True}


@admin.post("/clear-samples")
def admin_clear_samples():
    db = get_db()
    deleted = sum(int(db.run(f"DELETE FROM {t} WHERE is_sample = 1")["changes"] or 0) for t in ("branches", "tips", "videos"))
    return {"ok": True, "deleted": deleted}


@admin.post("/migrate")
def admin_migrate():
    db = get_db()
    db.script(SCHEMA_PATH.read_text("utf-8"))
    db.script(SEED_BASE)
    return {"ok": True}


app.include_router(admin)
app.include_router(messenger.admin)
app.include_router(ai.admin)
app.include_router(media.admin)
app.include_router(media.public)
app.include_router(messenger.public)
