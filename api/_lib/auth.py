"""Admin sign-in: a username and password kept (hashed) in the settings table, and signed session tokens.

Until a password is set the account is Admin / admin123, and the admin is asked to change it.
The ADMIN_TOKEN environment value still works as a bearer token and as a recovery password.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request

from .common import ago, fail
from .db import DBError, get_db

DEFAULT_USER = "Admin"
DEFAULT_PASSWORD = "admin123"
SESSION_HOURS = 12
ITERATIONS = 200_000
MAX_FAILS = 8  # failed sign-ins per visitor per 15 minutes
CACHE_SECONDS = 30

_cache = {"at": 0.0, "value": None, "db": None}
_table_ready = set()


# ---------------------------------------------------------------- passwords

def hash_password(password: str, salt: str | None = None, iterations: int = ITERATIONS) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        expected = hash_password(password, salt, int(iterations)).split("$")[3]
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(expected, digest)


def _account(db=None, fresh=False) -> dict:
    """{user, hash, secret}: read from settings, cached briefly so each admin request is not a database read."""
    now = time.time()
    db = db or get_db()
    if not fresh and _cache["value"] and _cache["db"] is db and now - _cache["at"] < CACHE_SECONDS:
        return _cache["value"]
    rows = db.all("SELECT key, value FROM settings WHERE key IN ('admin_user', 'admin_pass', 'admin_secret')")
    values = {r["key"]: r["value"] or "" for r in rows}
    secret = os.getenv("SESSION_SECRET") or os.getenv("ADMIN_TOKEN") or values.get("admin_secret")
    if not secret:
        secret = secrets.token_urlsafe(32)
        db.run("INSERT INTO settings (key, value) VALUES ('admin_secret', ?) ON CONFLICT(key) DO NOTHING", (secret,))
        row = db.one("SELECT value FROM settings WHERE key = 'admin_secret'")
        secret = (row and row["value"]) or secret
    account = {"user": values.get("admin_user") or DEFAULT_USER, "hash": values.get("admin_pass") or "", "secret": secret}
    _cache.update(at=now, value=account, db=db)
    return account


def _is_default(account: dict) -> bool:
    return not account["hash"]


def _password_ok(account: dict, password: str) -> bool:
    if account["hash"]:
        return check_password(password, account["hash"])
    return hmac.compare_digest(password.encode(), DEFAULT_PASSWORD.encode())


# ---------------------------------------------------------------- session tokens

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _version(account: dict) -> str:
    """Changes whenever the password changes, so older sessions stop working."""
    return hashlib.sha256((account["hash"] or "default").encode()).hexdigest()[:12]


def _sign(account: dict, body: str) -> str:
    return _b64(hmac.new(account["secret"].encode(), body.encode(), hashlib.sha256).digest())


def issue_token(account: dict) -> str:
    body = _b64(json.dumps({"u": account["user"], "v": _version(account), "exp": int(time.time()) + SESSION_HOURS * 3600},
                           separators=(",", ":")).encode())
    return f"s1.{body}.{_sign(account, body)}"


def verify_token(token: str) -> bool:
    try:
        prefix, body, sig = token.split(".")
    except ValueError:
        return False
    if prefix != "s1":
        return False
    account = _account()
    if not hmac.compare_digest(sig, _sign(account, body)):
        return False
    try:
        data = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return False
    if int(data.get("exp", 0)) < time.time():
        return False
    if data.get("v") != _version(account):
        # the password may have just changed in another instance: look again before refusing
        account = _account(fresh=True)
        return data.get("v") == _version(account) and hmac.compare_digest(sig, _sign(account, body))
    return True


def require_admin(authorization: str = Header("")):
    given = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not given:
        raise HTTPException(401, "Нэвтэрнэ үү.")
    legacy = os.getenv("ADMIN_TOKEN", "")
    if legacy and hmac.compare_digest(given.encode(), legacy.encode()):
        return
    if not verify_token(given):
        raise HTTPException(401, "Нэвтрэх хугацаа дууссан эсвэл буруу байна. Дахин нэвтэрнэ үү.")


# ---------------------------------------------------------------- sign-in throttle

def _ensure_table(db) -> None:
    if id(db) in _table_ready:
        return
    try:
        db.one("SELECT ip_hash FROM admin_logins LIMIT 1")
    except DBError:
        db.script(
            "CREATE TABLE IF NOT EXISTS admin_logins (id INTEGER PRIMARY KEY AUTOINCREMENT, ip_hash TEXT NOT NULL,"
            " created_at TEXT NOT NULL DEFAULT (datetime('now')));"
            "CREATE INDEX IF NOT EXISTS idx_admin_logins ON admin_logins (ip_hash, created_at);"
        )
    _table_ready.add(id(db))


def _visitor(request: Request) -> str:
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or request.headers.get("x-real-ip", "").strip()
          or (request.client.host if request.client else ""))
    salt = os.getenv("IP_HASH_SALT") or os.getenv("ADMIN_TOKEN") or "domch"
    return hashlib.sha256(f"{salt}|login|{ip}".encode()).hexdigest()[:24]


# ---------------------------------------------------------------- routes

public = APIRouter(prefix="/api/auth")
admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


def _session(account: dict) -> dict:
    return {"ok": True, "token": issue_token(account), "user": account["user"], "default_password": _is_default(account),
            "expires_in": SESSION_HOURS * 3600}


@public.post("/login")
def login(request: Request, payload: dict = Body(...)):
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        fail({k: "Заавал бөглөнө үү." for k, v in (("username", username), ("password", password)) if not v})
    db = get_db()
    _ensure_table(db)
    visitor = _visitor(request)
    row = db.one("SELECT COUNT(*) AS n FROM admin_logins WHERE ip_hash = ? AND created_at >= ?", (visitor, ago(minutes=15)))
    if row and int(row["n"] or 0) >= MAX_FAILS:
        raise HTTPException(429, "Олон удаа буруу оруулсан тул 15 минутын дараа дахин оролдоно уу.")
    account = _account(db, fresh=True)
    legacy = os.getenv("ADMIN_TOKEN", "")
    recovery = bool(legacy) and hmac.compare_digest(password.encode(), legacy.encode())
    if recovery or (username.casefold() == account["user"].casefold() and _password_ok(account, password)):
        db.run("DELETE FROM admin_logins WHERE ip_hash = ?", (visitor,))
        return _session(account)
    db.run("INSERT INTO admin_logins (ip_hash) VALUES (?)", (visitor,))
    db.run("DELETE FROM admin_logins WHERE created_at < ?", (ago(days=1),))
    raise HTTPException(401, "Нэвтрэх нэр эсвэл нууц үг буруу байна.")


@admin.get("/account")
def account_info():
    account = _account(fresh=True)
    return {"user": account["user"], "default_password": _is_default(account)}


@admin.put("/account")
def account_update(payload: dict = Body(...)):
    current = str(payload.get("current_password") or "")
    new = str(payload.get("new_password") or "")
    username = str(payload.get("username") or "").strip()
    db = get_db()
    account = _account(db, fresh=True)
    legacy = os.getenv("ADMIN_TOKEN", "")
    errors = {}
    if not (_password_ok(account, current) or (legacy and hmac.compare_digest(current.encode(), legacy.encode()))):
        errors["current_password"] = "Одоогийн нууц үг буруу байна."
    if username and not (2 <= len(username) <= 40):
        errors["username"] = "Нэвтрэх нэр 2–40 тэмдэгт байна."
    if new:
        if len(new) < 8:
            errors["new_password"] = "Хамгийн багадаа 8 тэмдэгт байна."
        elif new == DEFAULT_PASSWORD or new.casefold() == (username or account["user"]).casefold():
            errors["new_password"] = "Анхны нууц үг эсвэл нэвтрэх нэрээс өөр нууц үг сонгоно уу."
    elif not username or username == account["user"]:
        errors["new_password"] = "Шинэ нууц үгээ оруулна уу."
    elif _is_default(account):
        errors["new_password"] = "Нэрээ солихын өмнө анхны нууц үгээ солино уу."
    if errors:
        fail(errors)
    upsert = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    if new:
        db.run(upsert, ("admin_pass", hash_password(new)))
    if username:
        db.run(upsert, ("admin_user", username))
    return _session(_account(db, fresh=True))
