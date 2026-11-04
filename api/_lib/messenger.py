"""Facebook Messenger: settings saved from the admin, webhook, conversations and replies.

The admin enters the App ID, App Secret and Page access token. Saving them connects everything through the
Graph API: the token is checked, the app's webhook is registered with this site's callback URL and the Page
is subscribed to the app. Incoming messages land in D1 and can be answered from /admin.
"""
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from . import ai
from .common import ago, fail, now_utc, require_admin
from .db import DBError, get_db

GRAPH_VERSION = "v26.0"
GRAPH_URL = f"https://graph.facebook.com/{GRAPH_VERSION}"
FIELDS = "messages,messaging_postbacks"
PREFIX = "messenger."
KEYS = ("app_id", "app_secret", "page_token", "verify_token", "page_id", "page_name", "page_link",
        "button", "auto_reply", "connected_at", "webhook_url", "page_subscribed", "last_event_at",
        "greeting", "faq", "last_error", "profile_synced_at")
SECRETS = ("app_secret", "page_token")
NEW_CONVERSATION_HOURS = 24  # a person who has been silent this long gets the welcome again
MAX_FAQ = 4
HUMAN_PAUSE_HOURS = 12  # the AI stays quiet in a conversation an admin answered recently
GREETING = re.compile(r"^(сайн|сн|сайн уу|сайн байна уу|сайхан|мэнд|hi|hello|hey|юу байна|байна уу)[\s!.,?]*$", re.I)

http = httpx.Client(timeout=8.0)  # replaced in tests


class GraphError(Exception):
    def __init__(self, message: str, code=None, subcode=None):
        super().__init__(message)
        self.code = code
        self.subcode = subcode


def graph(method: str, path: str, token: str = "", params: dict | None = None, body: dict | None = None,
          app_secret: str = "", timeout: float | None = None) -> dict:
    query = dict(params or {})
    if token:
        query["access_token"] = token
        if app_secret and "|" not in token:
            query["appsecret_proof"] = hmac.new(app_secret.encode(), token.encode(), hashlib.sha256).hexdigest()
    try:
        res = http.request(method, f"{GRAPH_URL}/{path.lstrip('/')}", params=query, json=body,
                           timeout=timeout or http.timeout)
    except httpx.HTTPError as exc:
        raise GraphError(f"Facebook-тэй холбогдож чадсангүй: {exc}") from exc
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400 or (isinstance(data, dict) and data.get("error")):
        err = (data or {}).get("error") or {}
        raise GraphError(err.get("message") or f"Facebook алдаа ({res.status_code})", err.get("code"),
                         err.get("error_subcode"))
    return data if isinstance(data, dict) else {}


# ------------------------------------------------------------------ config

_schema_ready = False


def ensure_schema(db) -> None:
    """Add the Messenger tables/columns to databases created before they existed (once per process)."""
    global _schema_ready
    if _schema_ready:
        return
    try:
        db.one("SELECT welcomed_at FROM messenger_contacts LIMIT 1")
    except DBError:
        db.script(
            "CREATE TABLE IF NOT EXISTS integrations (key TEXT PRIMARY KEY, value TEXT,"
            " updated_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE TABLE IF NOT EXISTS messenger_contacts (psid TEXT PRIMARY KEY, name TEXT, welcomed_at TEXT,"
            " created_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE TABLE IF NOT EXISTS messenger_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, psid TEXT NOT NULL,"
            " direction TEXT NOT NULL CHECK (direction IN ('in', 'out')), kind TEXT NOT NULL DEFAULT 'message', text TEXT,"
            " mid TEXT UNIQUE, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE INDEX IF NOT EXISTS idx_messenger_psid ON messenger_messages (psid, created_at);"
        )
        try:
            db.run("ALTER TABLE messenger_contacts ADD COLUMN welcomed_at TEXT")
        except DBError:
            pass
    _schema_ready = True


def load(db) -> dict:
    ensure_schema(db)
    rows = db.all("SELECT key, value FROM integrations WHERE key LIKE 'messenger.%'")
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


def mask(value: str) -> dict:
    return {"set": bool(value), "hint": f"…{value[-4:]}" if len(value) >= 8 else ""}


def public_link(cfg: dict) -> str:
    if cfg.get("page_link"):
        return cfg["page_link"]
    return f"https://m.me/{cfg['page_id']}" if cfg.get("page_id") else ""


def public_info(cfg: dict) -> dict:
    """What the public site may know: whether to show the button, and where it points."""
    link = public_link(cfg)
    return {"enabled": cfg.get("button") == "1" and bool(link), "link": link}


def callback_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto.split(',')[0].strip()}://{host.split(',')[0].strip()}/api/messenger/webhook"


def parse_faq(cfg: dict) -> list:
    try:
        items = json.loads(cfg.get("faq") or "[]")
    except ValueError:
        return []
    return [{"q": str(i.get("q", "")), "a": str(i.get("a", ""))} for i in items if isinstance(i, dict)][:MAX_FAQ]


def parse_error(cfg: dict) -> dict:
    try:
        return json.loads(cfg.get("last_error") or "{}") or {}
    except ValueError:
        return {}


def note_error(db, context: str, exc: Exception) -> None:
    """Remember the last failure so the admin can see why an automatic reply did not go out."""
    message = friendly(exc) if isinstance(exc, GraphError) else str(exc)
    print(f"[messenger] {context}: {message}", flush=True)
    try:
        store(db, {"last_error": json.dumps({"at": now_utc(), "context": context, "message": message[:500]},
                                            ensure_ascii=False)})
    except DBError:
        pass


def site_url(request: Request) -> str:
    return callback_url(request).rsplit("/api/", 1)[0]


def admin_view(cfg: dict, request: Request) -> dict:
    return {
        "greeting": cfg["greeting"],
        "faq": parse_faq(cfg),
        "last_error": parse_error(cfg),
        "profile_synced_at": cfg["profile_synced_at"],
        "site_url": site_url(request),
        "app_id": cfg["app_id"],
        "app_secret": mask(cfg["app_secret"]),
        "page_token": mask(cfg["page_token"]),
        "page_id": cfg["page_id"],
        "page_name": cfg["page_name"],
        "page_link": cfg["page_link"],
        "button": cfg["button"] == "1",
        "auto_reply": cfg["auto_reply"],
        "connected_at": cfg["connected_at"],
        "page_subscribed": cfg["page_subscribed"],
        "last_event_at": cfg["last_event_at"],
        "verify_token": cfg["verify_token"],
        "webhook_url": callback_url(request),
        "link": public_link(cfg),
    }


def friendly(exc: GraphError) -> str:
    text = str(exc)
    if exc.code == 190:
        return "Page access token хүчингүй эсвэл хугацаа нь дууссан байна. Шинээр үүсгээд оруулна уу."
    if "appsecret_proof" in text:
        return "App Secret нь энэ token-ийг үүсгэсэн апптай таарахгүй байна."
    if exc.code == 10 and exc.subcode == 2018278:
        return "Хэрэглэгчийн сүүлийн мессежээс хойш 24 цаг өнгөрсөн тул Facebook-ийн дүрмээр хариулах боломжгүй. Page Inbox-оос хариулна уу."
    if exc.code == 551:
        return "Энэ хэрэглэгч одоогоор мессеж хүлээн авах боломжгүй байна."
    if exc.code == 100 and "pages_read_engagement" in text:
        return "Token-д pages_read_engagement эрх хэрэгтэй үйлдэл байна. " + text
    if exc.code in (200, 10, 230):
        return f"Эрх хүрэлцэхгүй байна (pages_messaging, pages_manage_metadata). {text}"
    return text


# ------------------------------------------------------------------ connecting

REQUIRED_SCOPES = ("pages_messaging",)  # without it nothing can be sent
METADATA_SCOPE = "pages_manage_metadata"  # only needed to subscribe the Page from here; the dashboard can do it too
MANUAL_SUBSCRIBE = (
    "Token-д pages_manage_metadata эрх байхгүй тул Page-ийг эндээс холбож чадсангүй. Дараах хоёрын аль нэгийг хийнэ үү:"
    " (1) Meta апп → Messenger → API Setup → Webhooks хэсэгт Page-ийнхаа мөрөнд «Add subscriptions» дарж messages,"
    " messaging_postbacks-ийг сонгоно; эсвэл (2) аппын Permissions хэсэгт pages_manage_metadata эрхийг нэмж, token-ийг"
    " дахин үүсгээд энд оруулна. Эхний мессеж ирэхэд холболт баталгаажна."
)


def _detail(exc: GraphError) -> str:
    return f" ({exc})" if str(exc) else ""


def token_problem(cfg: dict, info: dict) -> str:
    if not info.get("is_valid"):
        err = (info.get("error") or {}).get("message") or ""
        return "Page access token хүчингүй эсвэл хугацаа нь дууссан байна. Шинээр үүсгээд оруулна уу." + (f" ({err})" if err else "")
    if str(info.get("app_id") or "") != cfg["app_id"]:
        return f"Энэ token өөр аппынх байна (App ID {info.get('app_id')}). Оруулсан App ID-тай аппаас token үүсгэнэ үү."
    kind = str(info.get("type") or "").upper()
    if kind and kind != "PAGE":
        return f"Энэ нь {kind} token байна. Messenger → API Setup → Generate access tokens хэсгээс Page-ийн token үүсгэнэ үү."
    missing = [s for s in REQUIRED_SCOPES if s not in (info.get("scopes") or [])]
    if missing:
        return "Token-д " + ", ".join(missing) + " эрх алга. Token-ийг дахин үүсгэхдээ эдгээр эрхийг зөвшөөрнө үү."
    return ""


def page_id_from(info: dict) -> str:
    if info.get("profile_id"):
        return str(info["profile_id"])
    for item in info.get("granular_scopes") or []:
        if item.get("scope") in (*REQUIRED_SCOPES, METADATA_SCOPE) and item.get("target_ids"):
            return str(item["target_ids"][0])
    return ""


def connect(db, cfg: dict, request: Request) -> list:
    """Check the credentials and wire up the webhook. Returns a checklist for the admin."""
    steps = []

    def step(key, label, ok, message="", warn=False):
        steps.append({"key": key, "label": label, "ok": ok, "warn": warn and not ok, "message": message})
        return ok

    if not (cfg["app_id"] and cfg["app_secret"] and cfg["page_token"]):
        step("fields", "App ID, App Secret, Page access token", False, "Гурван утгыг бүгдийг нь оруулна уу.")
        return steps

    # Inspect the token with the app access token: this needs no Page permissions and also proves
    # that the App ID and App Secret belong together.
    try:
        info = graph("GET", "debug_token", f"{cfg['app_id']}|{cfg['app_secret']}",
                     {"input_token": cfg["page_token"]}).get("data") or {}
    except GraphError as exc:
        step("token", "App ID, App Secret", False,
             "App ID эсвэл App Secret буруу байна. App settings → Basic хэсгээс дахин хуулна уу." + _detail(exc))
        return steps
    problem = token_problem(cfg, info)
    if problem:
        step("token", "Page access token", False, problem)
        return steps
    page_id = page_id_from(info)
    if not page_id:
        try:
            page_id = graph("GET", "me", cfg["page_token"], {"fields": "id"}, app_secret=cfg["app_secret"]).get("id", "")
        except GraphError:
            page_id = ""
    if not page_id:
        step("token", "Page access token", False, "Token-оос Page ID олдсонгүй. Messenger → API Setup хэсгээс Page-ийн token үүсгэнэ үү.")
        return steps
    name = ""
    try:  # needs pages_read_engagement, which Messenger-only tokens often lack, so it is optional
        name = graph("GET", page_id, cfg["page_token"], {"fields": "name"}, app_secret=cfg["app_secret"],
                     timeout=4.0).get("name", "")
    except GraphError:
        pass
    cfg.update(page_id=page_id, page_name=name)
    store(db, {"page_id": page_id, "page_name": name})
    expires = int(info.get("expires_at") or 0)
    note = "хугацаагүй" if not expires else "дуусах: " + datetime.fromtimestamp(expires, timezone.utc).strftime("%Y-%m-%d")
    step("token", "Page access token, App Secret", True, f"Page: {name or page_id} · token {note}")

    url = callback_url(request)
    if not url.startswith("https://"):
        step("webhook", "Webhook бүртгэх", False,
             "Webhook-ийг https хаягтай, нийтлэгдсэн сайтаас холбоно (жишээ нь domch-amzailagch.vercel.app/admin).")
    else:
        try:
            graph("POST", f"{cfg['app_id']}/subscriptions", f"{cfg['app_id']}|{cfg['app_secret']}", {
                "object": "page", "callback_url": url, "fields": FIELDS,
                "verify_token": cfg["verify_token"], "include_values": "true",
            }, timeout=12.0)
            store(db, {"webhook_url": url})
            step("webhook", "Webhook бүртгэх", True, url)
        except GraphError as exc:
            step("webhook", "Webhook бүртгэх", False, friendly(exc))

    has_metadata = METADATA_SCOPE in (info.get("scopes") or [])
    try:
        graph("POST", f"{cfg['page_id']}/subscribed_apps", cfg["page_token"], {"subscribed_fields": FIELDS},
              app_secret=cfg["app_secret"])
        cfg["page_subscribed"] = "1"
        step("page", "Page-ийг апптай холбох", True, "messages, messaging_postbacks")
    except GraphError as exc:
        if not has_metadata or exc.code in (100, 200, 10, 230):
            cfg["page_subscribed"] = "manual"
            step("page", "Page-ийг апптай холбох", False, MANUAL_SUBSCRIBE, warn=True)
        else:
            cfg["page_subscribed"] = ""
            step("page", "Page-ийг апптай холбох", False, friendly(exc))
    store(db, {"page_subscribed": cfg["page_subscribed"]})

    # connected = nothing failed outright; a Page subscription done by hand in the Meta dashboard still counts
    if all(s["ok"] or s["warn"] for s in steps):
        cfg["connected_at"] = now_utc()
        store(db, {"connected_at": cfg["connected_at"]})
    return steps


# ------------------------------------------------------------------ messages

def save_contact(db, cfg: dict, psid: str) -> None:
    if db.one("SELECT psid FROM messenger_contacts WHERE psid = ?", (psid,)):
        return
    name = ""
    try:
        who = graph("GET", psid, cfg["page_token"], {"fields": "first_name,last_name"}, app_secret=cfg["app_secret"],
                    timeout=2.5)
        name = " ".join(p for p in (who.get("first_name"), who.get("last_name")) if p)
    except GraphError:
        pass
    db.run("INSERT OR IGNORE INTO messenger_contacts (psid, name) VALUES (?, ?)", (psid, name or None))


def send_text(db, cfg: dict, psid: str, text: str, kind: str = "reply", quick_replies: list | None = None) -> dict:
    message = {"text": text}
    if quick_replies:
        message["quick_replies"] = quick_replies
    res = graph("POST", "me/messages", cfg["page_token"], body={
        "recipient": {"id": psid}, "messaging_type": "RESPONSE", "message": message,
    }, app_secret=cfg["app_secret"])
    db.run(
        "INSERT OR IGNORE INTO messenger_messages (psid, direction, kind, text, mid, is_read) VALUES (?, 'out', ?, ?, ?, 1)",
        (psid, kind, text, res.get("message_id")),
    )
    return res


def faq_buttons(faq: list, skip: int | None = None) -> list:
    return [{"content_type": "text", "title": item["q"][:20], "payload": f"FAQ_{i}"}
            for i, item in enumerate(faq) if i != skip]


def _norm(text: str) -> str:
    return re.sub(r"[\s?!.,]+", " ", str(text or "")).strip().casefold()


def _stamp_ms(ms) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OverflowError):
        return now_utc()


def typing(cfg: dict, psid: str) -> None:
    try:
        graph("POST", "me/messages", cfg["page_token"], body={"recipient": {"id": psid}, "sender_action": "typing_on"},
              app_secret=cfg["app_secret"], timeout=2.0)
    except GraphError:
        pass


def human_active(db, psid: str) -> bool:
    row = db.one(
        "SELECT MAX(created_at) AS at FROM messenger_messages WHERE psid = ? AND direction = 'out' AND kind = 'reply'",
        (psid,),
    ) or {}
    return bool(row.get("at") and row["at"] >= ago(hours=HUMAN_PAUSE_HOURS))


def ai_reply(db, cfg: dict, psid: str, text: str, site: str) -> None:
    acfg = ai.load(db)
    if not ai.ready(acfg):
        return
    history = list(reversed(db.all(
        "SELECT direction, text FROM messenger_messages WHERE psid = ? ORDER BY created_at DESC, id DESC LIMIT 9",
        (psid,),
    )))
    if history and history[-1]["direction"] == "in" and history[-1]["text"] == text:
        history = history[:-1]  # the current message is passed separately
    typing(cfg, psid)
    try:
        result = ai.answer(db, acfg, text, history[-8:], site=site, messenger_faq=parse_faq(cfg), timeout=7.0)
    except ai.AIError as exc:
        ai.note_error(db, "Messenger хариулт", exc)
        send_text(db, cfg, psid, "Таны асуултыг хүлээн авлаа. Манай ажилтан удахгүй хариулна.", kind="auto")
        return
    send_text(db, cfg, psid, result["answer"], kind="ai")


def auto_respond(db, cfg: dict, psid: str, text: str, payload: str, welcomed_at, previous_in,
                 site: str = "", attachment: bool = False) -> None:
    """Quick-question buttons first, then the welcome for a new conversation, then the AI assistant."""
    faq = parse_faq(cfg)
    index = None
    if payload.startswith("FAQ_") and payload[4:].isdigit():
        index = int(payload[4:])
    elif text and not attachment:
        index = next((i for i, item in enumerate(faq) if _norm(item["q"]) == _norm(text)), None)
    if index is not None and index < len(faq):
        send_text(db, cfg, psid, faq[index]["a"], kind="auto", quick_replies=faq_buttons(faq, skip=index))
        db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
        return
    welcome = cfg["auto_reply"].strip()
    window = ago(hours=NEW_CONVERSATION_HOURS)
    new_conversation = not welcomed_at or (welcomed_at < window and (not previous_in or previous_in < window))
    welcomed = False
    if welcome and (payload == "GET_STARTED" or new_conversation):
        send_text(db, cfg, psid, welcome, kind="auto", quick_replies=faq_buttons(faq))
        db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
        welcomed = True
    if payload == "GET_STARTED" or attachment or not text.strip():
        return
    if welcomed and (GREETING.match(text.strip()) or len(text.strip()) < 6):
        return  # "сайн байна уу" is answered by the welcome itself
    if human_active(db, psid):
        return
    ai_reply(db, cfg, psid, text, site)


def handle_event(db, cfg: dict, event: dict, site: str = "") -> None:
    psid = str((event.get("sender") or {}).get("id") or "")
    if not psid or psid == cfg["page_id"]:
        return
    message = event.get("message") or {}
    if message.get("is_echo"):
        return
    payload = ""
    attachment = False
    if message:
        text = message.get("text") or ""
        payload = str((message.get("quick_reply") or {}).get("payload") or "")
        if not text and message.get("attachments"):
            kinds = {a.get("type", "file") for a in message["attachments"]}
            text = "[" + ", ".join(sorted(kinds)) + " хавсралт]"
            attachment = True
        mid = message.get("mid")
    elif event.get("postback"):
        payload = str(event["postback"].get("payload") or "")
        text = event["postback"].get("title") or payload or "[товч]"
        mid = event["postback"].get("mid") or f"pb.{psid}.{event.get('timestamp')}"
    else:
        return
    when = _stamp_ms(event.get("timestamp"))
    previous = db.one(
        "SELECT MAX(created_at) AS at FROM messenger_messages WHERE psid = ? AND direction = 'in'", (psid,)
    ) or {}
    res = db.run(
        "INSERT OR IGNORE INTO messenger_messages (psid, direction, kind, text, mid, created_at) VALUES (?, 'in', 'message', ?, ?, ?)",
        (psid, text[:2000], mid, when),
    )
    if not res.get("changes"):
        return  # a retried delivery
    save_contact(db, cfg, psid)
    contact = db.one("SELECT welcomed_at FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    try:
        auto_respond(db, cfg, psid, text, payload, contact.get("welcomed_at"), previous.get("at"), site=site,
                     attachment=attachment)
    except GraphError as exc:
        note_error(db, "Автомат хариу илгээх", exc)


def sync_profile(db, cfg: dict) -> dict:
    """Push the greeting, quick questions (ice breakers) and Get Started button to the Page's Messenger profile."""
    faq = parse_faq(cfg)
    body = {"get_started": {"payload": "GET_STARTED"}}
    remove = []
    if cfg["greeting"].strip():
        body["greeting"] = [{"locale": "default", "text": cfg["greeting"].strip()}]
    else:
        remove.append("greeting")
    if faq:
        body["ice_breakers"] = [{"locale": "default", "call_to_actions": [
            {"question": item["q"], "payload": f"FAQ_{i}"} for i, item in enumerate(faq)]}]
    else:
        remove.append("ice_breakers")
    try:
        graph("POST", "me/messenger_profile", cfg["page_token"], body=body, app_secret=cfg["app_secret"])
        if remove:
            try:
                graph("DELETE", "me/messenger_profile", cfg["page_token"], body={"fields": remove},
                      app_secret=cfg["app_secret"])
            except GraphError:
                pass
    except GraphError as exc:
        note_error(db, "Мэндчилгээний дэлгэц шинэчлэх", exc)
        return {"ok": False, "message": friendly(exc)}
    cfg["profile_synced_at"] = now_utc()
    store(db, {"profile_synced_at": cfg["profile_synced_at"]})
    return {"ok": True, "message": "Messenger-ийн мэндчилгээний дэлгэц шинэчлэгдлээ."}


# ------------------------------------------------------------------ routes

public = APIRouter()


@public.get("/api/messenger/webhook")
def verify(request: Request):
    params = request.query_params
    cfg = load(get_db())
    token = params.get("hub.verify_token", "")
    if params.get("hub.mode") == "subscribe" and cfg["verify_token"] and hmac.compare_digest(token, cfg["verify_token"]):
        return PlainTextResponse(params.get("hub.challenge", ""))
    raise HTTPException(403, "Verify token таарахгүй байна.")


@public.post("/api/messenger/webhook")
async def receive(request: Request):
    raw = await request.body()
    db = get_db()
    cfg = load(db)
    if not cfg["app_secret"]:
        raise HTTPException(403, "Messenger тохируулагдаагүй байна.")
    given = request.headers.get("x-hub-signature-256", "")
    expected = "sha256=" + hmac.new(cfg["app_secret"].encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(given, expected):
        raise HTTPException(403, "Гарын үсэг таарахгүй байна.")
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "JSON буруу байна.")
    if data.get("object") == "page":
        try:
            store(db, {"last_event_at": now_utc()})
        except DBError:
            pass
        for entry in data.get("entry") or []:
            for event in entry.get("messaging") or []:
                try:
                    handle_event(db, cfg, event, site=site_url(request))
                except DBError:
                    pass
    return PlainTextResponse("EVENT_RECEIVED")


admin = APIRouter(prefix="/api/admin/messenger", dependencies=[Depends(require_admin)])


@admin.get("")
def admin_get(request: Request):
    return admin_view(load(get_db()), request)


@admin.put("")
def admin_put(request: Request, payload: dict = Body(...)):
    db = get_db()
    cfg = load(db)
    changes, errors = {}, {}
    app_id = str(payload.get("app_id", cfg["app_id"]) or "").strip()
    if app_id and not re.fullmatch(r"\d{5,25}", app_id):
        errors["app_id"] = "App ID зөвхөн тооноос бүрдэнэ."
    changes["app_id"] = app_id
    for key in SECRETS:
        value = str(payload.get(key) or "").strip()
        if value:
            if re.search(r"\s", value) or len(value) < 16:
                errors[key] = "Утгыг бүтнээр нь, хоосон зайгүй хуулж оруулна уу."
            changes[key] = value
    link = str(payload.get("page_link", cfg["page_link"]) or "").strip()
    if link and not re.fullmatch(r"https://(m\.me|www\.messenger\.com|messenger\.com|facebook\.com|www\.facebook\.com)/\S+", link):
        errors["page_link"] = "https://m.me/… хэлбэрийн холбоос оруулна уу."
    changes["page_link"] = link
    if "button" in payload:
        changes["button"] = "1" if payload.get("button") in (True, 1, "1", "true", "on") else "0"
    if "auto_reply" in payload:
        reply = str(payload.get("auto_reply") or "").strip()
        if len(reply) > 640:
            errors["auto_reply"] = "Хамгийн ихдээ 640 тэмдэгт байна."
        changes["auto_reply"] = reply
    if errors:
        fail(errors)
    credentials_changed = any(changes.get(k, cfg[k]) != cfg[k] for k in ("app_id", "app_secret", "page_token"))
    if not cfg["verify_token"]:
        changes["verify_token"] = secrets.token_urlsafe(24)
    if credentials_changed:
        changes.update(connected_at="", page_id="", page_name="", page_subscribed="")
    store(db, changes)
    cfg.update(changes)
    steps = connect(db, cfg, request) if (credentials_changed or payload.get("connect")) else []
    return {"ok": True, "steps": steps, "config": admin_view(load(db), request)}


@admin.post("/test")
def admin_test(request: Request):
    db = get_db()
    cfg = load(db)
    steps = connect(db, cfg, request)
    return {"ok": all(s["ok"] or s["warn"] for s in steps), "steps": steps, "config": admin_view(load(db), request)}


@admin.put("/welcome")
def admin_welcome(request: Request, payload: dict = Body(...)):
    db = get_db()
    cfg = load(db)
    errors = {}
    greeting = str(payload.get("greeting") or "").strip()
    if len(greeting) > 160:
        errors["greeting"] = "Хамгийн ихдээ 160 тэмдэгт байна."
    welcome = str(payload.get("auto_reply") or "").strip()
    if len(welcome) > 640:
        errors["auto_reply"] = "Хамгийн ихдээ 640 тэмдэгт байна."
    faq = []
    for i, item in enumerate((payload.get("faq") or [])[:MAX_FAQ + 2]):
        q = str((item or {}).get("q") or "").strip()
        a = str((item or {}).get("a") or "").strip()
        if not q and not a:
            continue
        if not q or len(q) > 20:
            errors[f"faq.{i}.q"] = "Асуултыг 20 хүртэл тэмдэгтээр бичнэ үү."
        if not a or len(a) > 640:
            errors[f"faq.{i}.a"] = "Хариултыг 1–640 тэмдэгтээр бичнэ үү."
        faq.append({"q": q, "a": a})
    if len(faq) > MAX_FAQ:
        errors["faq"] = f"Хамгийн ихдээ {MAX_FAQ} асуулт байна."
    if errors:
        fail(errors)
    store(db, {"greeting": greeting, "auto_reply": welcome, "faq": json.dumps(faq, ensure_ascii=False), "last_error": ""})
    cfg.update(greeting=greeting, auto_reply=welcome, faq=json.dumps(faq, ensure_ascii=False))
    # everyone gets the new welcome on their next message (also makes it easy to test right away)
    db.run("UPDATE messenger_contacts SET welcomed_at = NULL")
    sync = sync_profile(db, cfg) if cfg["page_token"] else {"ok": False, "message": "Эхлээд token-уудаа оруулж холбоно уу."}
    return {"ok": True, "sync": sync, "config": admin_view(load(db), request)}


@admin.post("/threads/{psid}/welcome")
def send_welcome(psid: str):
    db = get_db()
    cfg = load(db)
    if not cfg["page_token"] or not cfg["auto_reply"].strip():
        raise HTTPException(409, "Мэндчилгээ мессеж тохируулагдаагүй байна.")
    try:
        send_text(db, cfg, psid, cfg["auto_reply"].strip(), kind="auto", quick_replies=faq_buttons(parse_faq(cfg)))
    except GraphError as exc:
        raise HTTPException(502, friendly(exc))
    db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
    return {"ok": True}


@admin.delete("")
def admin_disconnect(request: Request):
    db = get_db()
    cfg = load(db)
    if cfg["page_id"] and cfg["page_token"]:
        try:
            graph("DELETE", f"{cfg['page_id']}/subscribed_apps", cfg["page_token"], app_secret=cfg["app_secret"])
        except GraphError:
            pass
    store(db, {key: "" for key in KEYS if key != "verify_token"})
    return {"ok": True, "config": admin_view(load(db), request)}


@admin.get("/threads")
def threads():
    db = get_db()
    rows = db.all(
        "SELECT m.psid, c.name, MAX(m.created_at) AS last_at,"
        " SUM(CASE WHEN m.direction = 'in' AND m.is_read = 0 THEN 1 ELSE 0 END) AS unread,"
        " MAX(CASE WHEN m.direction = 'in' THEN m.created_at END) AS last_in_at"
        " FROM messenger_messages m LEFT JOIN messenger_contacts c ON c.psid = m.psid"
        " GROUP BY m.psid, c.name ORDER BY last_at DESC LIMIT 200"
    )
    if rows:
        lasts = db.all(
            "SELECT psid, text, direction FROM messenger_messages WHERE id IN"
            " (SELECT MAX(id) FROM messenger_messages GROUP BY psid)"
        )
        last = {r["psid"]: r for r in lasts}
        window = ago(hours=24)
        for row in rows:
            row["last_text"] = (last.get(row["psid"]) or {}).get("text") or ""
            row["last_direction"] = (last.get(row["psid"]) or {}).get("direction") or ""
            row["can_reply"] = bool(row.get("last_in_at") and row["last_in_at"] >= window)
            row["unread"] = int(row.get("unread") or 0)
    return {"items": rows}


@admin.get("/threads/{psid}")
def thread(psid: str, limit: int = Query(200, ge=1, le=500)):
    db = get_db()
    items = db.all(
        "SELECT id, direction, kind, text, created_at FROM messenger_messages WHERE psid = ?"
        " ORDER BY created_at DESC, id DESC LIMIT ?",
        (psid, limit),
    )
    if not items:
        raise HTTPException(404, "Харилцан яриа олдсонгүй.")
    db.run("UPDATE messenger_messages SET is_read = 1 WHERE psid = ? AND direction = 'in' AND is_read = 0", (psid,))
    contact = db.one("SELECT name FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    last_in = next((m["created_at"] for m in items if m["direction"] == "in"), None)
    return {
        "psid": psid,
        "name": contact.get("name") or "",
        "items": list(reversed(items)),
        "can_reply": bool(last_in and last_in >= ago(hours=24)),
    }


@admin.post("/threads/{psid}/reply")
def reply(psid: str, payload: dict = Body(...)):
    text = str(payload.get("text") or "").strip()
    if not text:
        fail({"text": "Хариултаа бичнэ үү."})
    if len(text) > 2000:
        fail({"text": "Хамгийн ихдээ 2000 тэмдэгт байна."})
    db = get_db()
    cfg = load(db)
    if not cfg["page_token"]:
        raise HTTPException(409, "Messenger тохируулагдаагүй байна. Тохиргоо → Facebook Messenger хэсгийг бөглөнө үү.")
    try:
        send_text(db, cfg, psid, text)
    except GraphError as exc:
        raise HTTPException(502, friendly(exc))
    return {"ok": True}


@admin.delete("/threads/{psid}")
def delete_thread(psid: str):
    db = get_db()
    res = db.run("DELETE FROM messenger_messages WHERE psid = ?", (psid,))
    db.run("DELETE FROM messenger_contacts WHERE psid = ?", (psid,))
    if not res["changes"]:
        raise HTTPException(404, "Харилцан яриа олдсонгүй.")
    return {"ok": True}
