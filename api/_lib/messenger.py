"""Facebook Messenger: settings saved from the admin, webhook, conversations and replies.

The admin enters the App ID, App Secret and Page access token. Saving them connects everything through the
Graph API: the token is checked, the app's webhook is registered with this site's callback URL and the Page
is subscribed to the app. Incoming messages land in D1 and can be answered from /admin.
"""
import hashlib
import hmac
import json
import re
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from . import ai, places
from .common import ago, fail, now_utc, public_links, require_admin, site_url
from .db import DBError, get_db

GRAPH_VERSION = "v26.0"
GRAPH_URL = f"https://graph.facebook.com/{GRAPH_VERSION}"
FIELDS = "messages,messaging_postbacks,message_echoes"  # echoes reveal replies typed in the Page Inbox
PREFIX = "messenger."
KEYS = ("app_id", "app_secret", "page_token", "verify_token", "page_id", "page_name", "page_link",
        "button", "auto_reply", "connected_at", "webhook_url", "page_subscribed", "last_event_at",
        "greeting", "faq", "last_error", "profile_synced_at", "last_decision", "ig_id", "ig_username", "ig_status",
        "webhook_tried_at")
IG_FIELDS = "messages,messaging_postbacks"  # Instagram DMs through the same Page token (Instagram API with Facebook Login)
IG_SCOPES = ("instagram_basic", "instagram_manage_messages")
SECRETS = ("app_secret", "page_token")
NEW_CONVERSATION_HOURS = 24  # a person who has been silent this long gets the welcome again
MAX_FAQ = 4
FOREVER_DAYS = 3650  # «AI-г зогсоох» for one conversation
# Facebook's own like stickers (small, medium, large thumbs up)
LIKE_STICKERS = {"369239263222822", "369239343222814", "369239383222810"}
LIKE_REPLY = "👍 Баярлалаа! Өөр асуух зүйл байвал бичээрэй эсвэл доорх товчноос сонгоорой."
STICKER_REPLY = "😊 Танд юугаар туслах вэ? Асуултаа бичих эсвэл доорх товчноос сонгоорой."
FILE_REPLY = "Хавсралтыг хүлээн авлаа. Манай ажилтан үзээд удахгүй хариулна."
HELP_REPLY = "Танд юугаар туслах вэ? Асуултаа бичих эсвэл доорх товчноос сонгоорой."
# Meta Business Suite's own instant reply arrives within seconds; a person in the Page inbox is slower
INBOX_AUTO_SECONDS = 20
INBOX_GRACE = float(os.getenv("MESSENGER_INBOX_GRACE", "5"))  # wait this long before a greeting, to see if it came
LETTERS = re.compile(r"[0-9A-Za-zА-Яа-яЁёӨөҮү]")
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
        db.one("SELECT welcomed_at, ai_until, channel FROM messenger_contacts LIMIT 1")
    except DBError:
        db.script(
            "CREATE TABLE IF NOT EXISTS integrations (key TEXT PRIMARY KEY, value TEXT,"
            " updated_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE TABLE IF NOT EXISTS messenger_contacts (psid TEXT PRIMARY KEY, name TEXT, welcomed_at TEXT, ai_until TEXT,"
            " channel TEXT NOT NULL DEFAULT 'messenger',"
            " created_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE TABLE IF NOT EXISTS messenger_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, psid TEXT NOT NULL,"
            " direction TEXT NOT NULL CHECK (direction IN ('in', 'out')), kind TEXT NOT NULL DEFAULT 'message', text TEXT,"
            " mid TEXT UNIQUE, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE INDEX IF NOT EXISTS idx_messenger_psid ON messenger_messages (psid, created_at);"
        )
        for column in ("welcomed_at TEXT", "ai_until TEXT", "channel TEXT NOT NULL DEFAULT 'messenger'"):
            try:
                db.run(f"ALTER TABLE messenger_contacts ADD COLUMN {column}")
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


def webhook_for(site: str) -> str:
    return f"{site}/api/messenger/webhook"


def callback_url(request: Request) -> str:
    return webhook_for(site_url(request))


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


def admin_view(cfg: dict, request: Request) -> dict:
    return {
        "greeting": cfg["greeting"],
        "faq": parse_faq(cfg),
        "last_error": parse_error(cfg),
        "last_decision": json.loads(cfg["last_decision"] or "{}") if cfg["last_decision"].startswith("{") else {},
        "ig_id": cfg["ig_id"],
        "ig_username": cfg["ig_username"],
        "ig_status": cfg["ig_status"],
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
        "webhook_saved": cfg["webhook_url"],
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
    if cfg["page_token"].startswith("IG"):
        return ("Энэ нь Instagram-аар нэвтэрч авсан (IG…) token байна. Facebook-ийн (EAA…) token хэрэгтэй: Graph API Explorer-оос"
                " User Token үүсгэж оруулна уу (Instagram-ийг холбох заавар).")
    if not info.get("is_valid"):
        err = (info.get("error") or {}).get("message") or ""
        return "Page access token хүчингүй эсвэл хугацаа нь дууссан байна. Шинээр үүсгээд оруулна уу." + (f" ({err})" if err else "")
    if str(info.get("app_id") or "") != cfg["app_id"]:
        return f"Энэ token өөр аппынх байна (App ID {info.get('app_id')}). Оруулсан App ID-тай аппаас token үүсгэнэ үү."
    kind = str(info.get("type") or "").upper()
    if kind and kind != "PAGE":
        return (f"Энэ нь {kind} token байна. Page token, Graph API Explorer-ийн User token эсвэл Business Settings-ийн"
                " System user token оруулна уу.")
    missing = [s for s in REQUIRED_SCOPES if s not in (info.get("scopes") or [])]
    if missing:
        return "Token-д " + ", ".join(missing) + " эрх алга. Token-ийг дахин үүсгэхдээ эдгээр эрхийг зөвшөөрнө үү."
    return ""


def page_token_from_user(cfg: dict, user_token: str, exchange: bool = True, info: dict | None = None) -> tuple:
    """A user token (Graph API Explorer) or a system user token (Business Settings) → the Page's token.

    A user token is first exchanged for a long-lived one, so the Page token made from it does not expire;
    a system user token already lasts. Returns (page_token, page_name, instagram_id or "").
    """
    long_lived = user_token
    if exchange:
        long_lived = graph("GET", "oauth/access_token", "", {
            "grant_type": "fb_exchange_token", "client_id": cfg["app_id"], "client_secret": cfg["app_secret"],
            "fb_exchange_token": user_token,
        }).get("access_token") or user_token
    pages = graph("GET", "me/accounts", long_lived, {"fields": "id,name,access_token,instagram_business_account",
                                                     "limit": "100"}, app_secret=cfg["app_secret"]).get("data") or []
    pages = [p for p in pages if p.get("access_token")]
    if not pages:
        # me/accounts can come back empty (e.g. no pages_show_list): ask the Page itself, by the IDs the token was granted
        # and the Page this site was connected to
        targets = [str(t) for item in (info or {}).get("granular_scopes") or []
                   if str(item.get("scope", "")).startswith("pages_") for t in item.get("target_ids") or []]
        for pid in dict.fromkeys(targets + ([cfg["page_id"]] if cfg["page_id"] else [])):
            try:
                page = graph("GET", pid, long_lived, {"fields": "id,name,access_token,instagram_business_account"},
                             app_secret=cfg["app_secret"], timeout=6.0)
            except GraphError:
                continue
            if page.get("access_token"):
                pages = [page]
                break
    if not pages:
        have = (info or {}).get("scopes") or []
        page_scopes = [x for x in ("pages_show_list", "pages_messaging", "pages_manage_metadata") if x not in have]
        if len(page_scopes) == 3:  # an Instagram-only token: the Page permissions were not ticked when it was made
            raise ValueError("token-д Facebook Page-ийн эрх огт алга (одоо байгаа эрх: " + (", ".join(have) or "—") + ")."
                             " Token-ийг дахин үүсгэхдээ Instagram-ийн эрхүүдтэй хамт pages_show_list, pages_messaging,"
                             " pages_manage_metadata-г сонгоно. Нэг token Messenger, Instagram хоёуланд хүрнэ.")
        scopes = ", ".join(have) or "—"
        granted = any(item.get("target_ids") for item in (info or {}).get("granular_scopes") or []
                      if str(item.get("scope", "")).startswith("pages_"))
        raise ValueError("энэ token-оор удирдах Facebook Page олдсонгүй"
                         f" (token-ийн эрх: {scopes}; Page олгогдсон: {'тийм' if granted else 'үгүй'}).")
    chosen = next((p for p in pages if str(p.get("id")) == cfg["page_id"]), None) if cfg["page_id"] else None
    if not chosen and len(pages) == 1:
        chosen = pages[0]
    if not chosen:
        with_ig = [p for p in pages if p.get("instagram_business_account")]
        chosen = with_ig[0] if len(with_ig) == 1 else None
    if not chosen:
        names = ", ".join(p.get("name") or p["id"] for p in pages)
        raise ValueError(f"token хэд хэдэн Page удирддаг ({names}). Нэвтрэх цонхонд зөвхөн ДОМЧ-ийн Page-ийг сонгоно уу.")
    ig_id = str((chosen.get("instagram_business_account") or {}).get("id") or "") or instagram_from(info or {})
    return chosen["access_token"], chosen.get("name") or chosen["id"], ig_id


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
    kind = str(info.get("type") or "").upper()
    owner_token, ig_hint = "", ""
    if kind in ("USER", "SYSTEM_USER") and info.get("is_valid") and str(info.get("app_id") or "") == cfg["app_id"]:
        try:
            owner_token = cfg["page_token"]
            page_token, label, ig_hint = page_token_from_user(cfg, owner_token, exchange=kind == "USER", info=info)
            info = graph("GET", "debug_token", f"{cfg['app_id']}|{cfg['app_secret']}",
                         {"input_token": page_token}).get("data") or {}
        except (GraphError, ValueError) as exc:
            name = "System user" if kind == "SYSTEM_USER" else "User"
            hint = (" Business Settings → Users → System users → энэ хэрэглэгч → Assign assets хэсгээс ДОМЧ-ийн Page болон"
                    " Instagram аккаунтыг (Full control) олгоод «Холболт шалгах» дарна уу. Token-д pages_show_list эрх байх ёстой."
                    ) if kind == "SYSTEM_USER" else " Нэвтрэх цонхонд ДОМЧ-ийн Page-ийг сонгосон эсэхээ шалгана уу."
            step("token", f"{name} token → Page token", False, f"{name} token-оос Page token гаргаж чадсангүй: {exc}{hint}")
            return steps
        cfg["page_token"] = page_token
        store(db, {"page_token": page_token})
        name = "System user" if kind == "SYSTEM_USER" else "User"
        step("exchange", f"{name} token → Page token", True, f"«{label}» Page-ийн хугацаагүй token үүсгэж хадгаллаа")
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
             "Webhook-ийг https хаягтай, нийтлэгдсэн сайтаас холбоно (жишээ нь domch.gem.mn/admin).")
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
    connect_instagram(db, cfg, info, url, step, ig_hint=ig_hint, owner_token=owner_token)

    # connected = nothing failed outright; a Page subscription done by hand in the Meta dashboard still counts
    if all(s["ok"] or s["warn"] for s in steps):
        cfg["connected_at"] = now_utc()
        store(db, {"connected_at": cfg["connected_at"]})
    return steps


IG_SETUP = (
    "Засах: (1) Instagram professional (Business/Creator) аккаунтаа энэ Facebook Page-тэй холбоно (Meta Business Suite →"
    " Тохиргоо → Instagram аккаунт); (2) Instagram апп → Тохиргоо → Мессеж ба story-ийн хариу → Холбогдсон хэрэгслүүд →"
    " «Allow access to messages»-ийг асаана; (3) developers.facebook.com/tools/explorer → Meta App: өөрийн апп, User or"
    " Page: User Token, Permissions: pages_show_list, pages_messaging, pages_manage_metadata, instagram_basic,"
    " instagram_manage_messages → Generate Access Token → нэвтрэх цонхонд ДОМЧ-ийн Page болон Instagram аккаунтыг сонгоно;"
    " (4) гарсан token-ийг энд «Page access token» талбарт оруулж «Хадгалаад холбох» дарна — систем өөрөө хугацаагүй"
    " Page token болгоно. Messenger-ийн тохиргооны «Generate access tokens»-оор үүсгэсэн token-д Instagram-ийн эрх ордоггүй."
)


def instagram_from(info: dict) -> str:
    for item in info.get("granular_scopes") or []:
        if item.get("scope") in IG_SCOPES and item.get("target_ids"):
            return str(item["target_ids"][0])
    return ""


def linked_instagram(cfg: dict, tokens: list) -> tuple:
    """The Instagram account linked to the Page, asked with each token in turn. Returns (id, error text)."""
    error = ""
    for token in tokens:
        if not token:
            continue
        try:
            page = graph("GET", cfg["page_id"], token, {"fields": "instagram_business_account,connected_instagram_account"},
                         app_secret=cfg["app_secret"], timeout=5.0)
        except GraphError as exc:
            error = str(exc)
            continue
        ig = page.get("instagram_business_account") or page.get("connected_instagram_account") or {}
        if ig.get("id"):
            return str(ig["id"]), ""
    return "", error


def connect_instagram(db, cfg: dict, info: dict, url: str, step, ig_hint: str = "", owner_token: str = "") -> None:
    """Instagram DMs arrive through the same app and Page token when the token has the Instagram permissions."""
    scopes = info.get("scopes") or []
    if "instagram_manage_messages" not in scopes:
        cfg.update(ig_id="", ig_username="", ig_status="missing")
        store(db, {"ig_id": "", "ig_username": "", "ig_status": "missing"})
        missing = [s for s in IG_SCOPES if s not in scopes]
        have = ", ".join(scopes) or "—"
        step("instagram", "Instagram DM", False,
             f"Token-д {', '.join(missing)} эрх алга (одоо байгаа эрх: {have}). " + IG_SETUP, warn=True)
        return
    # the account granted with the token (system user assets, login dialog), else the one linked to the Page
    ig_id, error = instagram_from(info) or ig_hint or cfg.get("ig_id") or "", ""  # cfg: found on an earlier connect
    if not ig_id:
        ig_id, error = linked_instagram(cfg, [cfg["page_token"], owner_token])
    if not ig_id and "pages_read_engagement" in error and url.startswith("https://"):
        # the link cannot be read without pages_read_engagement, but DMs do not need it: subscribe the Instagram webhook
        # and learn the account from the first DM (its entry id)
        try:
            graph("POST", f"{cfg['app_id']}/subscriptions", f"{cfg['app_id']}|{cfg['app_secret']}", {
                "object": "instagram", "callback_url": url, "fields": IG_FIELDS,
                "verify_token": cfg["verify_token"], "include_values": "true",
            }, timeout=12.0)
        except GraphError as exc:
            cfg.update(ig_id="", ig_username="", ig_status="error")
            store(db, {"ig_id": "", "ig_username": "", "ig_status": "error"})
            step("instagram", "Instagram DM", False, friendly(exc), warn=True)
            return
        cfg.update(ig_id="", ig_username="", ig_status="pending")
        store(db, {"ig_id": "", "ig_username": "", "ig_status": "pending"})
        step("instagram", "Instagram DM", False,
             "Instagram-ийн webhook бүртгэгдлээ. Token-д pages_read_engagement эрх байхгүй тул Page-тэй холбосон Instagram"
             " аккаунтыг урьдчилан уншиж чадсангүй — Instagram-аас ДОМЧ руу нэг DM бичихэд систем аккаунтыг автоматаар"
             " танина. Эсвэл token-ийг pages_read_engagement эрхтэй дахин үүсгээд «Хадгалаад холбох» дарна.", warn=True)
        return
    if not ig_id:
        cfg.update(ig_id="", ig_username="", ig_status="nolink")
        store(db, {"ig_id": "", "ig_username": "", "ig_status": "nolink"})
        step("instagram", "Instagram DM", False,
             "Энэ Page-тэй холбосон Instagram аккаунт олдсонгүй" + (f" (Facebook: {error[:300]})" if error else "") + ". "
             "Business портфолид хоёулаа байгаа ч Page болон Instagram хоорондоо холбогдсон байх ёстой: Facebook Page →"
             " Тохиргоо → Холбогдсон аккаунтууд (Linked accounts) → Instagram → Холбох; эсвэл Meta Business Suite →"
             " Тохиргоо → Instagram аккаунтууд → тухайн аккаунт → Холбогдсон хөрөнгө → Page нэмэх. Дараа нь «Холболт шалгах» дарна.",
             warn=True)
        return
    username = ""
    try:
        username = graph("GET", ig_id, cfg["page_token"], {"fields": "username"}, app_secret=cfg["app_secret"],
                         timeout=4.0).get("username", "")
    except GraphError:
        pass
    if not url.startswith("https://"):
        status, ok, message = "error", False, "Webhook-ийг https хаягтай, нийтлэгдсэн сайтаас холбоно."
    else:
        try:
            graph("POST", f"{cfg['app_id']}/subscriptions", f"{cfg['app_id']}|{cfg['app_secret']}", {
                "object": "instagram", "callback_url": url, "fields": IG_FIELDS,
                "verify_token": cfg["verify_token"], "include_values": "true",
            }, timeout=12.0)
            status, ok = "1", True
            message = (f"@{username}" if username else f"Instagram ID {ig_id}") + " · DM энд ирнэ"
        except GraphError as exc:
            status, ok, message = "error", False, friendly(exc)
    cfg.update(ig_id=ig_id, ig_username=username, ig_status=status)
    store(db, {"ig_id": ig_id, "ig_username": username, "ig_status": status})
    step("instagram", "Instagram DM", ok, message, warn=not ok)


# ------------------------------------------------------------------ messages

def save_contact(db, cfg: dict, psid: str, channel: str = "messenger") -> None:
    if db.one("SELECT psid FROM messenger_contacts WHERE psid = ?", (psid,)):
        return
    name = ""
    try:
        if channel == "instagram":
            who = graph("GET", psid, cfg["page_token"], {"fields": "name,username"}, app_secret=cfg["app_secret"],
                        timeout=2.5)
            name = who.get("name") or (f"@{who['username']}" if who.get("username") else "")
        else:
            who = graph("GET", psid, cfg["page_token"], {"fields": "first_name,last_name"}, app_secret=cfg["app_secret"],
                        timeout=2.5)
            name = " ".join(p for p in (who.get("first_name"), who.get("last_name")) if p)
    except GraphError:
        pass
    db.run("INSERT OR IGNORE INTO messenger_contacts (psid, name, channel) VALUES (?, ?, ?)", (psid, name or None, channel))


def channel_of(db, psid: str) -> str:
    row = db.one("SELECT channel FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    return row.get("channel") or "messenger"


def send_path(db, cfg: dict, psid: str) -> str:
    # Instagram DMs are sent through the Page the Instagram account is linked to
    return f"{cfg['page_id']}/messages" if channel_of(db, psid) == "instagram" and cfg["page_id"] else "me/messages"


def send_text(db, cfg: dict, psid: str, text: str, kind: str = "reply", quick_replies: list | None = None) -> dict:
    text = public_links(text)
    if kind != "reply":  # automatic answers (buttons, knowledge base): a price comes with the factory-price reminder
        text = ai.price_note(text)
    message = {"text": text}
    if quick_replies:
        message["quick_replies"] = quick_replies
    body = {"recipient": {"id": psid}, "messaging_type": "RESPONSE", "message": message}
    path = send_path(db, cfg, psid)
    try:
        res = graph("POST", path, cfg["page_token"], body=body, app_secret=cfg["app_secret"])
    except GraphError as exc:
        if path == "me/messages" or not cfg.get("ig_id") or exc.code not in (100, 3):
            raise
        res = graph("POST", f"{cfg['ig_id']}/messages", cfg["page_token"], body=body, app_secret=cfg["app_secret"])
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


def typing(db, cfg: dict, psid: str) -> None:
    try:
        graph("POST", send_path(db, cfg, psid), cfg["page_token"],
              body={"recipient": {"id": psid}, "sender_action": "typing_on"}, app_secret=cfg["app_secret"], timeout=2.0)
    except GraphError:
        pass


def ai_paused_until(db, psid: str) -> str:
    row = db.one("SELECT ai_until FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    until = row.get("ai_until") or ""
    return until if until > now_utc() else ""


def pause_ai(db, psid: str, minutes: int) -> None:
    """A person from the team took over: the AI stays quiet in this conversation for a while."""
    if minutes <= 0:
        return
    until = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M:%S")
    db.run("INSERT OR IGNORE INTO messenger_contacts (psid) VALUES (?)", (psid,))
    db.run("UPDATE messenger_contacts SET ai_until = ? WHERE psid = ? AND (ai_until IS NULL OR ai_until < ?)",
           (until, psid, until))


def decide(db, psid: str, reason: str) -> None:
    """Remember why the last message was (not) answered automatically, for the admin's diagnostics."""
    try:
        store(db, {"last_decision": json.dumps({"at": now_utc(), "psid": psid, "reason": reason}, ensure_ascii=False)})
    except DBError:
        pass


GREETING_START = re.compile(r"^\s*(сайн байна уу|сайн байцгаана уу|сайн уу|мэнд хүргэе)[\s,!?.🙂😊🌿]*", re.I)


def drop_greeting(db, psid: str, question: str, answer: str) -> str:
    """Only the first reply of a conversation may start with «Сайн байна уу», and only if the person greeted."""
    greeted = db.one("SELECT id FROM messenger_messages WHERE psid = ? AND direction = 'out' AND created_at >= ?"
                     " AND id < (SELECT MAX(id) FROM messenger_messages WHERE psid = ?)", (psid, ago(hours=12), psid))
    person_greets = re.match(r"^\s*(сайн|сн|sain|sn|hi|hello|мэнд)", question, re.I)
    rest = GREETING_START.sub("", answer, count=1)
    if (greeted or not person_greets) and rest != answer and len(rest) > 10:
        return rest[0].upper() + rest[1:]
    return answer


def ai_reply(db, cfg: dict, psid: str, text: str, site: str, buttons: list | None = None) -> None:
    acfg = ai.load(db)
    if not ai.ready(acfg):
        decide(db, psid, "AI унтраалттай эсвэл тохируулаагүй тул хариулсангүй." if not acfg.get("gemini_key")
               or acfg.get("enabled") != "1" else "AI загвар сонгогдоогүй.")
        return
    history = list(reversed(db.all(
        "SELECT direction, text FROM messenger_messages WHERE psid = ? ORDER BY id DESC LIMIT 10",
        (psid,),
    )))
    for i in range(len(history) - 1, -1, -1):  # the current message is passed separately
        if history[i]["direction"] == "in" and history[i]["text"] == text:
            del history[i]
            break
    typing(db, cfg, psid)
    try:
        result = ai.answer(db, acfg, text, history[-8:], site=site, messenger_faq=parse_faq(cfg), timeout=18.0)
    except ai.AIError as exc:
        ai.note_error(db, "Messenger хариулт", exc)
        # still answer: the matching knowledge entry, or at least where to look
        local = ai.local_answer(db, text, parse_faq(cfg), site)
        if local:
            send_text(db, cfg, psid, local, kind="auto", quick_replies=faq_buttons(parse_faq(cfg)))
            decide(db, psid, f"AI түр ажиллахгүй байсан ({exc}) тул мэдлэгийн сангаас хариулсан.")
        else:
            send_text(db, cfg, psid, "Таны асуултыг хүлээн авлаа, манай ажилтан удахгүй хариулна."
                      + (f" Бүтээгдэхүүн, худалдаалах цэгийн мэдээллийг эндээс харна уу: {site}" if site else ""),
                      kind="auto", quick_replies=faq_buttons(parse_faq(cfg)))
            decide(db, psid, f"AI алдаа: {exc}")
        return
    send_text(db, cfg, psid, drop_greeting(db, psid, text, result["answer"]), kind="ai", quick_replies=buttons)
    decide(db, psid, f"AI хариулсан ({result['model']}, {result['ms']} мс).")


def auto_respond(db, cfg: dict, psid: str, text: str, payload: str, welcomed_at, previous_in,
                 site: str = "", attachment: bool = False, sticker: str = "", received_at: str = "") -> None:
    """Quick-question buttons first, then the welcome for a new conversation, then the AI assistant."""
    faq = parse_faq(cfg)
    stocked = places.has_branches(db)  # without real branches the FAQ answers and the AI handle «where to buy»
    # where to buy: a district / aimag button
    if payload == "WHERE_ASK":
        return ask_where(db, cfg, psid, faq)
    if payload == "WHERE_RURAL":
        send_text(db, cfg, psid, places.ASK_RURAL, kind="auto", quick_replies=places.rural_buttons(db))
        decide(db, psid, "Аль аймагт байгааг асуусан.")
        return
    place = places.from_payload(payload)
    if place:
        return send_where(db, cfg, psid, place, site, faq)
    index = None
    if payload.startswith("FAQ_") and payload[4:].isdigit():
        index = int(payload[4:])
    elif text and not attachment:
        index = next((i for i, item in enumerate(faq) if _norm(item["q"]) == _norm(text)), None)
    if stocked and index is not None and index < len(faq) and places.where_intent(faq[index]["q"]):
        db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
        return ask_where(db, cfg, psid, faq)  # «📍 Хаанаас худалдаж авах вэ?» → which district, then the branches
    if index is not None and index < len(faq):
        send_text(db, cfg, psid, faq[index]["a"], kind="auto", quick_replies=faq_buttons(faq, skip=index))
        db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
        decide(db, psid, f"Асуултын товчны хариулт илгээсэн: {faq[index]['q']}")
        return
    welcome = cfg["auto_reply"].strip()
    window = ago(hours=NEW_CONVERSATION_HOURS)
    new_conversation = not welcomed_at or (welcomed_at < window and (not previous_in or previous_in < window))
    clean = text.strip()
    # a greeting, «?», a like or a sticker: there is nothing to answer beyond a greeting and the buttons
    light = bool(sticker) or attachment or not LETTERS.search(clean) or bool(GREETING.match(clean)) or len(clean) < 6
    if welcome and (payload == "GET_STARTED" or (new_conversation and light)):
        db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
        if payload != "GET_STARTED":
            wait_for_inbox(received_at)
            if inbox_answered(db, psid, received_at):
                decide(db, psid, "Page Inbox-ийн автомат хариу очсон тул мэндчилгээг давхардуулсангүй.")
                return
        send_text(db, cfg, psid, welcome, kind="auto", quick_replies=faq_buttons(faq))
        decide(db, psid, "Мэндчилгээ илгээсэн.")
        return
    first = new_conversation  # a real question as the first message: answer it, with the buttons, without a separate welcome
    if first:
        db.run("UPDATE messenger_contacts SET welcomed_at = ? WHERE psid = ?", (now_utc(), psid))
        if welcome and not ai.ready(ai.load(db)):  # no AI to answer it: the welcome and its buttons at least
            send_text(db, cfg, psid, welcome, kind="auto", quick_replies=faq_buttons(faq))
            decide(db, psid, "Мэндчилгээ илгээсэн (AI унтраалттай).")
            first = False
    until = ai_paused_until(db, psid)
    if until:
        decide(db, psid, f"Энэ ярианд ажилтан хариулж байгаа тул AI {until} (UTC) хүртэл түр зогссон.")
        return
    if sticker or attachment or not LETTERS.search(clean):
        reply = LIKE_REPLY if sticker == "like" else FILE_REPLY if attachment else STICKER_REPLY if sticker else HELP_REPLY
        wait_for_inbox(received_at)
        if inbox_answered(db, psid, received_at):
            decide(db, psid, "Page Inbox хариулсан тул давхардуулсангүй.")
        elif replied_lately(db, psid, reply):
            decide(db, psid, "Саяхан ижил хариу илгээсэн тул давтсангүй.")
        else:
            send_text(db, cfg, psid, reply, kind="auto", quick_replies=None if attachment else faq_buttons(faq))
            decide(db, psid, {LIKE_REPLY: "Like-д хариулсан.", FILE_REPLY: "Хавсралтыг хүлээн авснаа мэдэгдсэн.",
                              STICKER_REPLY: "Стикерт хариулсан.", HELP_REPLY: "Юугаар туслахыг асуусан."}[reply])
        return
    # «Дарханд хаанаас авах вэ?», or «Баянзүрх» right after we asked which district: the branches there,
    # straight from the branch list (exact, and works even when the AI is unavailable)
    wants = stocked and places.where_intent(text)
    place = places.find_place(text) if stocked else None
    if place and (wants or last_out_text(db, psid) in places.ASKS):
        if place["city"] == places.UB and not place["district"] and places.districts_with_branches(db):
            return ask_where(db, cfg, psid, faq)
        return send_where(db, cfg, psid, place, site, faq)
    if wants:
        return ask_where(db, cfg, psid, faq)
    ai_reply(db, cfg, psid, text, site, buttons=faq_buttons(faq) if first else None)


def last_out_text(db, psid: str) -> str:
    row = db.one("SELECT text FROM messenger_messages WHERE psid = ? AND direction = 'out' ORDER BY id DESC LIMIT 1",
                 (psid,))
    return (row or {}).get("text") or ""


def ask_where(db, cfg: dict, psid: str, faq: list) -> None:
    buttons = places.ask_buttons(db)
    send_text(db, cfg, psid, places.ASK, kind="auto", quick_replies=buttons or None)
    decide(db, psid, "Аль дүүрэг, аймагт байгааг асуусан.")


def send_where(db, cfg: dict, psid: str, place: dict, site: str, faq: list) -> None:
    others = [b for i, b in enumerate(faq_buttons(faq)) if not places.where_intent(faq[i]["q"])]
    buttons = [{"content_type": "text", "title": "Өөр байршил", "payload": "WHERE_ASK"}] + others
    send_text(db, cfg, psid, places.answer_text(db, place, site), kind="auto", quick_replies=buttons[:13])
    decide(db, psid, f"Салбарын мэдээлэл илгээсэн: {place['label']} ({len(places.branches_in(db, place))}).")


def own_echo(db, cfg: dict, psid: str, message: dict) -> bool:
    """Did this site send it? Messenger echoes carry our app_id; Instagram ones are matched by id or text."""
    if str(message.get("app_id") or "") == cfg["app_id"]:
        return True
    mid = message.get("mid")
    if mid and db.one("SELECT id FROM messenger_messages WHERE mid = ? AND direction = 'out'", (mid,)):
        return True
    text = message.get("text") or ""
    return bool(text and db.one(
        "SELECT id FROM messenger_messages WHERE psid = ? AND direction = 'out' AND kind <> 'inbox' AND text = ?"
        " AND created_at >= ?", (psid, text, ago(minutes=3))))


def handle_echo(db, cfg: dict, event: dict, message: dict) -> None:
    """A copy of a message the Page sent. Anything this site did not send was typed by a person."""
    psid = str((event.get("recipient") or {}).get("id") or "")
    if not psid or psid in (cfg["page_id"], cfg["ig_id"]):
        return
    if own_echo(db, cfg, psid, message):
        return
    text = message.get("text") or ("[хавсралт]" if message.get("attachments") else "")
    at = _stamp_ms(event.get("timestamp"))
    db.run(
        "INSERT OR IGNORE INTO messenger_messages (psid, direction, kind, text, mid, is_read, created_at)"
        " VALUES (?, 'out', 'inbox', ?, ?, 1, ?)",
        (psid, text[:2000], message.get("mid"), at),
    )
    last_in = (db.one("SELECT MAX(created_at) AS at FROM messenger_messages WHERE psid = ? AND direction = 'in'",
                      (psid,)) or {}).get("at")
    if last_in and 0 <= _seconds(last_in, at) <= INBOX_AUTO_SECONDS:
        return  # Meta Business Suite's instant reply, seconds after the person wrote: not a person taking over
    pause_ai(db, psid, ai.pause_minutes(ai.load(db)))


def _seconds(start: str, end: str) -> float:
    try:
        fmt = "%Y-%m-%d %H:%M:%S"
        return (datetime.strptime(end[:19], fmt) - datetime.strptime(start[:19], fmt)).total_seconds()
    except ValueError:
        return -1


def inbox_answered(db, psid: str, since: str) -> bool:
    """Did the Page inbox (Meta's instant reply or a person) already answer the message received at `since`?"""
    return bool(since and db.one("SELECT id FROM messenger_messages WHERE psid = ? AND direction = 'out' AND kind = 'inbox'"
                                 " AND created_at >= ?", (psid, since)))


def wait_for_inbox(received_at: str) -> None:
    """Give Meta's instant reply a few seconds to arrive before greeting, so the person is not greeted twice."""
    if INBOX_GRACE <= 0 or not received_at:
        return
    try:
        received = datetime.strptime(received_at[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return
    left = INBOX_GRACE - (datetime.now(timezone.utc) - received).total_seconds()
    if left > 0:
        time.sleep(min(left, INBOX_GRACE))


def replied_lately(db, psid: str, text: str, minutes: int = 10) -> bool:
    return bool(db.one("SELECT id FROM messenger_messages WHERE psid = ? AND direction = 'out' AND text = ?"
                       " AND created_at >= ?", (psid, text, ago(minutes=minutes))))


def handle_event(db, cfg: dict, event: dict, site: str = "", channel: str = "messenger") -> None:
    message = event.get("message") or {}
    if message.get("is_echo"):
        handle_echo(db, cfg, event, message)
        return
    if message.get("is_deleted") or message.get("is_unsupported"):
        return
    psid = str((event.get("sender") or {}).get("id") or "")
    if not psid or psid in (cfg["page_id"], cfg["ig_id"]):
        return
    payload = ""
    attachment = False
    sticker = ""
    if message:
        text = message.get("text") or ""
        payload = str((message.get("quick_reply") or {}).get("payload") or "")
        sticker_id = str(message.get("sticker_id") or next(
            ((a.get("payload") or {}).get("sticker_id") for a in message.get("attachments") or []
             if (a.get("payload") or {}).get("sticker_id")), "") or "")
        if not text and sticker_id:  # the 👍 button and other stickers come as an image with a sticker_id
            sticker = "like" if sticker_id in LIKE_STICKERS else "sticker"
            text = "👍" if sticker == "like" else "[стикер]"
        elif not text and message.get("attachments"):
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
    save_contact(db, cfg, psid, channel)
    contact = db.one("SELECT welcomed_at FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    try:
        auto_respond(db, cfg, psid, text, payload, contact.get("welcomed_at"), previous.get("at"), site=site,
                     attachment=attachment, sticker=sticker, received_at=when)
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
    note = ""
    if cfg.get("ig_id") and cfg.get("ig_status") == "1":
        # Instagram supports the quick questions (ice breakers) only, not the greeting or Get Started
        try:
            if faq:
                graph("POST", "me/messenger_profile", cfg["page_token"], {"platform": "instagram"},
                      body={"platform": "instagram", "ice_breakers": body["ice_breakers"]}, app_secret=cfg["app_secret"])
            else:
                graph("DELETE", "me/messenger_profile", cfg["page_token"], {"platform": "instagram"},
                      body={"fields": ["ice_breakers"], "platform": "instagram"}, app_secret=cfg["app_secret"])
            note = " Instagram-ийн асуултын товчнууд ч шинэчлэгдлээ."
        except GraphError as exc:
            note_error(db, "Instagram асуултын товч", exc)
            note = f" Instagram-ийн асуултын товчийг шинэчилж чадсангүй: {friendly(exc)}"
    cfg["profile_synced_at"] = now_utc()
    store(db, {"profile_synced_at": cfg["profile_synced_at"]})
    return {"ok": True, "message": "Messenger-ийн мэндчилгээний дэлгэц шинэчлэгдлээ." + note}


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


def process(cfg: dict, data: dict, site: str) -> None:
    db = get_db()
    channel = "instagram" if data.get("object") == "instagram" else "messenger"
    for entry in data.get("entry") or []:
        if channel == "instagram" and entry.get("id") and cfg.get("ig_status") == "pending":
            adopt_instagram(db, cfg, str(entry["id"]))
        for event in entry.get("messaging") or []:
            try:
                handle_event(db, cfg, event, site=site, channel=channel)
            except Exception as exc:  # noqa: BLE001 — one bad event must not stop the rest
                note_error(db, "Мессеж боловсруулах", exc)
    try:
        move_webhook(db, cfg, site)
    except DBError:
        pass


def adopt_instagram(db, cfg: dict, ig_id: str) -> None:
    """The first Instagram DM tells which account the Page's Instagram is (entry id), when it could not be read before."""
    username = ""
    try:
        username = graph("GET", ig_id, cfg["page_token"], {"fields": "username"}, app_secret=cfg["app_secret"],
                         timeout=4.0).get("username", "")
    except GraphError:
        pass
    cfg.update(ig_id=ig_id, ig_username=username, ig_status="1")
    store(db, {"ig_id": ig_id, "ig_username": username, "ig_status": "1"})


def move_webhook(db, cfg: dict, site: str) -> bool:
    """After the site moves to a new address (domch.gem.mn), point Facebook's webhook there too.

    Facebook checks the new URL before switching, so a failed attempt leaves the old webhook working;
    it is retried at most once an hour.
    """
    url = webhook_for(site)
    if not (url.startswith("https://") and cfg["webhook_url"] and cfg["webhook_url"] != url
            and cfg["app_id"] and cfg["app_secret"] and cfg["verify_token"]):
        return False
    if cfg["webhook_tried_at"] and cfg["webhook_tried_at"] > ago(hours=1):
        return False
    cfg["webhook_tried_at"] = now_utc()
    store(db, {"webhook_tried_at": cfg["webhook_tried_at"]})
    app_token = f"{cfg['app_id']}|{cfg['app_secret']}"
    objects = [("page", FIELDS)] + ([("instagram", IG_FIELDS)] if cfg["ig_status"] in ("1", "pending") else [])
    try:
        for name, fields in objects:
            graph("POST", f"{cfg['app_id']}/subscriptions", app_token, {
                "object": name, "callback_url": url, "fields": fields,
                "verify_token": cfg["verify_token"], "include_values": "true",
            }, timeout=8.0)
    except GraphError as exc:
        note_error(db, "Webhook-ийг шинэ хаяг руу шилжүүлэх", exc)
        return False
    cfg["webhook_url"] = url
    store(db, {"webhook_url": url})
    return True


@public.post("/api/messenger/webhook")
async def receive(request: Request, background: BackgroundTasks):
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
    if data.get("object") in ("page", "instagram"):
        try:
            store(db, {"last_event_at": now_utc()})
        except DBError:
            pass
        # answer after Facebook has its 200 OK, so slow AI replies do not make Facebook resend the event
        background.add_task(process, cfg, data, site_url(request))
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
    previous = {k: cfg[k] for k in KEYS}
    if credentials_changed:
        changes.update(connected_at="", page_name="", page_subscribed="", ig_id="", ig_username="", ig_status="")
    store(db, changes)
    cfg.update(changes)
    steps = connect(db, cfg, request) if (credentials_changed or payload.get("connect")) else []
    token_failed = any(s["key"] == "token" and not s["ok"] for s in steps)
    if credentials_changed and token_failed and previous["connected_at"]:
        # Messenger kept working with the old credentials: put them back instead of leaving it broken
        restore = {k: previous[k] for k in ("app_id", "app_secret", "page_token", "connected_at", "page_id", "page_name",
                                            "page_subscribed", "ig_id", "ig_username", "ig_status")}
        store(db, restore)
        steps.append({"key": "kept", "label": "Өмнөх token", "ok": False, "warn": True,
                      "message": "Шинэ утга ажилласангүй тул Messenger-ийг өмнөх ажиллаж байсан token-оор үргэлжлүүлж байна."})
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
        "SELECT m.psid, c.name, COALESCE(c.channel, 'messenger') AS channel, MAX(m.created_at) AS last_at,"
        " SUM(CASE WHEN m.direction = 'in' AND m.is_read = 0 THEN 1 ELSE 0 END) AS unread,"
        " MAX(CASE WHEN m.direction = 'in' THEN m.created_at END) AS last_in_at"
        " FROM messenger_messages m LEFT JOIN messenger_contacts c ON c.psid = m.psid"
        " GROUP BY m.psid, c.name, c.channel ORDER BY last_at DESC LIMIT 200"
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
    contact = db.one("SELECT name, channel FROM messenger_contacts WHERE psid = ?", (psid,)) or {}
    last_in = next((m["created_at"] for m in items if m["direction"] == "in"), None)
    return {
        "psid": psid,
        "name": contact.get("name") or "",
        "channel": contact.get("channel") or "messenger",
        "items": list(reversed(items)),
        "can_reply": bool(last_in and last_in >= ago(hours=24)),
        "ai_on": ai.ready(ai.load(db)),
        "ai_paused_until": ai_paused_until(db, psid),
    }


@admin.post("/threads/{psid}/ai")
def thread_ai(psid: str, payload: dict = Body(...)):
    db = get_db()
    db.run("INSERT OR IGNORE INTO messenger_contacts (psid) VALUES (?)", (psid,))
    if payload.get("paused"):
        until = (datetime.now(timezone.utc) + timedelta(days=FOREVER_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        db.run("UPDATE messenger_contacts SET ai_until = ? WHERE psid = ?", (until, psid))
    else:
        db.run("UPDATE messenger_contacts SET ai_until = NULL WHERE psid = ?", (psid,))
    return {"ok": True, "ai_paused_until": ai_paused_until(db, psid)}


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
    pause_ai(db, psid, ai.pause_minutes(ai.load(db)))
    return {"ok": True, "ai_paused_until": ai_paused_until(db, psid)}


@admin.delete("/threads/{psid}")
def delete_thread(psid: str):
    db = get_db()
    res = db.run("DELETE FROM messenger_messages WHERE psid = ?", (psid,))
    db.run("DELETE FROM messenger_contacts WHERE psid = ?", (psid,))
    if not res["changes"]:
        raise HTTPException(404, "Харилцан яриа олдсонгүй.")
    return {"ok": True}
