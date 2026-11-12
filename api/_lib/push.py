"""Web Push to the admin's phones and computers: new Messenger / Instagram messages and new form requests.

Implements VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291) with `cryptography`, so no extra
push library is needed. Keys come from VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY, or are generated once and kept
in the settings table.
"""
import base64
import json
import os
import struct
import time
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Body, Depends

from .common import fail, require_admin
from .db import DBError, get_db

KINDS = ("messages", "requests")
SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:info@gem.mn")
TIMEOUT = 6.0

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL UNIQUE,"
    " p256dh TEXT NOT NULL, auth TEXT NOT NULL, label TEXT, kinds TEXT NOT NULL DEFAULT 'messages,requests',"
    " created_at TEXT NOT NULL DEFAULT (datetime('now')), last_ok_at TEXT, last_error TEXT);"
)
_ready = set()
_keys = {}


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64u(text: str) -> bytes:
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def ensure_schema(db) -> None:
    if id(db) in _ready:
        return
    try:
        db.one("SELECT kinds FROM push_subscriptions LIMIT 1")
    except DBError:
        db.script(SCHEMA)
    _ready.add(id(db))


# ---------------------------------------------------------------- keys

def _private_from_text(text: str) -> ec.EllipticCurvePrivateKey:
    text = text.strip()
    if "BEGIN" in text:
        return serialization.load_pem_private_key(text.encode(), password=None)
    return ec.derive_private_key(int.from_bytes(unb64u(text), "big"), ec.SECP256R1())


def _public_raw(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def vapid_keys(db=None) -> tuple[ec.EllipticCurvePrivateKey, str]:
    """(private key, public key as base64url) — from the environment, or generated once and stored."""
    env = os.getenv("VAPID_PRIVATE_KEY", "")
    cache_key = ("env", env) if env else ("db", id(db or get_db()))
    if cache_key in _keys:
        return _keys[cache_key]
    if env:
        key = _private_from_text(env)
    else:
        db = db or get_db()
        row = db.one("SELECT value FROM settings WHERE key = 'vapid_private'")
        if not (row and row["value"]):
            fresh = ec.generate_private_key(ec.SECP256R1())
            d = fresh.private_numbers().private_value.to_bytes(32, "big")
            db.run("INSERT INTO settings (key, value) VALUES ('vapid_private', ?) ON CONFLICT(key) DO NOTHING", (b64u(d),))
            row = db.one("SELECT value FROM settings WHERE key = 'vapid_private'")
        key = _private_from_text(row["value"])
    _keys[cache_key] = (key, b64u(_public_raw(key)))
    return _keys[cache_key]


def vapid_header(endpoint: str, key: ec.EllipticCurvePrivateKey, public: str) -> str:
    url = urlparse(endpoint)
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": f"{url.scheme}://{url.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": SUBJECT},
                             separators=(",", ":")).encode())
    r, s = decode_dss_signature(key.sign(f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    signature = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={header}.{claims}.{signature}, k={public}"


# ---------------------------------------------------------------- encryption (RFC 8291, aes128gcm)

def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(payload: bytes, p256dh: str, auth: str, *, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    ua_public = unb64u(p256dh)
    auth_secret = unb64u(auth)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = _public_raw(server_key)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = server_key.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack("!IB", 4096, len(as_public)) + as_public + body


# ---------------------------------------------------------------- sending

def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT)


def send_one(sub: dict, message: dict, db=None, client: httpx.Client | None = None) -> tuple[bool, str]:
    key, public = vapid_keys(db)
    data = json.dumps(message, ensure_ascii=False).encode()[:3000]
    headers = {
        "Authorization": vapid_header(sub["endpoint"], key, public),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        "Urgency": "high",
    }
    topic = "".join(ch for ch in str(message.get("tag") or "") if ch.isalnum() or ch in "-_")[:32]
    if topic:
        headers["Topic"] = topic  # a newer notification with the same topic replaces an undelivered one
    body = encrypt(data, sub["p256dh"], sub["auth"])
    own = client is None
    client = client or _client()
    try:
        res = client.post(sub["endpoint"], content=body, headers=headers)
    except httpx.HTTPError as exc:
        return False, f"network: {exc.__class__.__name__}"
    finally:
        if own:
            client.close()
    if res.status_code in (200, 201, 202):
        return True, ""
    return False, f"{res.status_code} {res.text[:160]}"


def notify(kind: str, title: str, body: str, url: str = "/admin", tag: str = "", db=None) -> int:
    """Send to every device that asked for this kind. Never raises: a failed push must not break the caller."""
    try:
        db = db or get_db()
        ensure_schema(db)
        subs = db.all("SELECT id, endpoint, p256dh, auth, kinds FROM push_subscriptions")
        subs = [s for s in subs if kind in (s["kinds"] or "").split(",")]
        if not subs:
            return 0
        message = {"title": title[:120], "body": body[:240], "url": url, "tag": tag or kind}
        sent = 0
        with _client() as client:
            for sub in subs:
                ok, error = send_one(sub, message, db, client)
                if ok:
                    sent += 1
                    db.run("UPDATE push_subscriptions SET last_ok_at = datetime('now'), last_error = NULL WHERE id = ?", (sub["id"],))
                elif error[:3] in ("404", "410"):
                    db.run("DELETE FROM push_subscriptions WHERE id = ?", (sub["id"],))  # the device unsubscribed
                else:
                    db.run("UPDATE push_subscriptions SET last_error = ? WHERE id = ?", (error[:300], sub["id"]))
        return sent
    except Exception:  # noqa: BLE001 — notifications are best effort
        return 0


# ---------------------------------------------------------------- admin routes

admin = APIRouter(prefix="/api/admin/push", dependencies=[Depends(require_admin)])


@admin.get("")
def push_info():
    db = get_db()
    ensure_schema(db)
    _, public = vapid_keys(db)
    rows = db.all("SELECT id, endpoint, label, kinds, created_at, last_ok_at, last_error FROM push_subscriptions ORDER BY id DESC")
    return {"public_key": public, "devices": [
        {**r, "endpoint": None, "endpoint_id": r["endpoint"][-16:], "kinds": (r["kinds"] or "").split(",")} for r in rows]}


def _subscription(payload: dict) -> dict:
    sub = payload.get("subscription") or {}
    keys = sub.get("keys") or {}
    endpoint = str(sub.get("endpoint") or "")
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        fail({"subscription": "Мэдэгдлийн бүртгэл буруу байна."})
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(keys["p256dh"]))
    except (ValueError, TypeError):
        fail({"subscription": "Мэдэгдлийн түлхүүр буруу байна."})
    return {"endpoint": endpoint[:1000], "p256dh": keys["p256dh"], "auth": keys["auth"]}


@admin.post("/subscribe")
def push_subscribe(payload: dict = Body(...)):
    sub = _subscription(payload)
    kinds = ",".join(k for k in KINDS if k in (payload.get("kinds") or KINDS))
    label = str(payload.get("label") or "")[:80] or None
    db = get_db()
    ensure_schema(db)
    db.run(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, kinds) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label,"
        " kinds = excluded.kinds, last_error = NULL",
        (sub["endpoint"], sub["p256dh"], sub["auth"], label, kinds),
    )
    return {"ok": True, "kinds": kinds.split(",") if kinds else []}


@admin.post("/unsubscribe")
def push_unsubscribe(payload: dict = Body(...)):
    db = get_db()
    ensure_schema(db)
    endpoint = str((payload.get("subscription") or {}).get("endpoint") or payload.get("endpoint") or "")
    db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    return {"ok": True}


@admin.delete("/devices/{device_id}")
def push_forget(device_id: int):
    db = get_db()
    ensure_schema(db)
    db.run("DELETE FROM push_subscriptions WHERE id = ?", (device_id,))
    return {"ok": True}


@admin.post("/test")
def push_test(payload: dict = Body(default={})):
    db = get_db()
    ensure_schema(db)
    endpoint = str(payload.get("endpoint") or "")
    rows = db.all("SELECT id, endpoint, p256dh, auth FROM push_subscriptions" + (" WHERE endpoint = ?" if endpoint else ""),
                  (endpoint,) if endpoint else ())
    if not rows:
        fail({"subscription": "Энэ төхөөрөмж мэдэгдэлд бүртгэгдээгүй байна."})
    message = {"title": "ДОМЧ удирдлага", "body": "Мэдэгдэл ажиллаж байна ✓", "url": "/admin#/overview", "tag": "test"}
    results = []
    with _client() as client:
        for sub in rows:
            ok, error = send_one(sub, message, db, client)
            if error[:3] in ("404", "410"):
                db.run("DELETE FROM push_subscriptions WHERE id = ?", (sub["id"],))
            results.append({"ok": ok, "error": error})
    if not any(r["ok"] for r in results):
        fail({"subscription": "Илгээж чадсангүй: " + (results[0]["error"] or "тодорхойгүй алдаа")})
    return {"ok": True, "sent": sum(r["ok"] for r in results)}
