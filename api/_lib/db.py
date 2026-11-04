"""Database access: Cloudflare D1 over its REST API in production, SQLite locally and in tests."""
import os
import sqlite3
import threading
from pathlib import Path

import httpx

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SEED_PATH = Path(__file__).with_name("seed.sql")


class DBError(Exception):
    """The database could not answer."""


class NotConfigured(DBError):
    """No database settings were provided."""


class D1:
    driver = "d1"

    def __init__(self, account_id: str, database_id: str, token: str, timeout: float = 10.0):
        self.url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
            f"/d1/database/{database_id}/query"
        )
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.client = httpx.Client(timeout=timeout)

    def _post(self, sql: str, params) -> list:
        try:
            res = self.client.post(self.url, headers=self.headers, json={"sql": sql, "params": list(params)})
        except httpx.HTTPError as exc:
            raise DBError(f"D1 холболт амжилтгүй: {exc}") from exc
        try:
            data = res.json()
        except ValueError as exc:
            raise DBError(f"D1 хариу уншигдсангүй ({res.status_code})") from exc
        if res.status_code >= 400 or not data.get("success"):
            msg = "; ".join(e.get("message", "") for e in data.get("errors") or []) or res.text[:200]
            raise DBError(f"D1 алдаа: {msg}")
        return data.get("result") or []

    def _first(self, sql: str, params):
        result = self._post(sql, params)
        first = result[0] if result else {}
        return first.get("results") or [], first.get("meta") or {}

    def all(self, sql: str, params=()) -> list:
        return self._first(sql, params)[0]

    def one(self, sql: str, params=()):
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def run(self, sql: str, params=()) -> dict:
        meta = self._first(sql, params)[1]
        return {"last_row_id": meta.get("last_row_id"), "changes": meta.get("changes", 0)}

    def batch(self, statements: list) -> list:
        """Run several parameterless SELECTs in one round trip."""
        result = self._post(";\n".join(statements), [])
        if len(result) != len(statements):
            return [self.all(s) for s in statements]
        return [r.get("results") or [] for r in result]

    def script(self, sql: str) -> None:
        self._post(sql, [])


class Local:
    driver = "sqlite"

    def __init__(self, path: str):
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def all(self, sql: str, params=()) -> list:
        with self.lock:
            try:
                rows = [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]
                self.conn.commit()
            except sqlite3.Error as exc:
                self.conn.rollback()
                raise DBError(f"SQLite алдаа: {exc}") from exc
            return rows

    def one(self, sql: str, params=()):
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def run(self, sql: str, params=()) -> dict:
        with self.lock:
            try:
                cur = self.conn.execute(sql, tuple(params))
                self.conn.commit()
            except sqlite3.Error as exc:
                self.conn.rollback()
                raise DBError(f"SQLite алдаа: {exc}") from exc
            return {"last_row_id": cur.lastrowid, "changes": cur.rowcount}

    def batch(self, statements: list) -> list:
        return [self.all(s) for s in statements]

    def script(self, sql: str) -> None:
        with self.lock:
            try:
                self.conn.executescript(sql)
                self.conn.commit()
            except sqlite3.Error as exc:
                raise DBError(f"SQLite алдаа: {exc}") from exc


_db = None


def _env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return ""


def get_db():
    global _db
    if _db is not None:
        return _db
    account = _env("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
    database = _env("CF_D1_DATABASE_ID", "D1_DATABASE_ID")
    token = _env("CF_API_TOKEN", "CLOUDFLARE_API_TOKEN")
    local = _env("LOCAL_DB_PATH")
    if account and database and token:
        _db = D1(account, database, token)
    elif local:
        fresh = local == ":memory:" or not Path(local).exists()
        db = Local(local)
        db.script(SCHEMA_PATH.read_text("utf-8"))
        if fresh and _env("LOCAL_DB_SEED") != "0":
            db.script(SEED_PATH.read_text("utf-8"))
        _db = db
    else:
        raise NotConfigured("Өгөгдлийн сан тохируулагдаагүй байна.")
    upgrade(_db)
    return _db


# Columns/tables added after the first release; added once per process if missing.
UPGRADES = (
    ("tips", "image_url", "ALTER TABLE tips ADD COLUMN image_url TEXT"),
    ("videos", "image_url", "ALTER TABLE videos ADD COLUMN image_url TEXT"),
)
MEDIA_TABLE = (
    "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL,"
    " size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
)


def upgrade(db) -> None:
    try:
        db.one("SELECT " + ", ".join(f"(SELECT {c} FROM {t} LIMIT 1)" for t, c, _ in UPGRADES) + ", (SELECT id FROM media LIMIT 1)")
        return
    except DBError:
        pass
    for table, column, sql in UPGRADES:
        try:
            db.one(f"SELECT {column} FROM {table} LIMIT 1")
        except DBError:
            try:
                db.run(sql)
            except DBError:
                pass
    try:
        db.run(MEDIA_TABLE)
    except DBError:
        pass


def reset_db() -> None:
    global _db
    _db = None
