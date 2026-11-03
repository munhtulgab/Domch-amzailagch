"""Helpers shared by the API modules."""
import hmac
import os
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException


class FieldErrors(Exception):
    def __init__(self, fields: dict):
        super().__init__("validation")
        self.fields = fields


def fail(fields: dict):
    raise FieldErrors(fields)


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def now_utc() -> str:
    return _stamp(datetime.now(timezone.utc))


def ago(minutes: int = 0, days: int = 0, hours: int = 0) -> str:
    return _stamp(datetime.now(timezone.utc) - timedelta(minutes=minutes, days=days, hours=hours))


def require_admin(authorization: str = Header("")):
    expected = os.getenv("ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(503, "ADMIN_TOKEN тохируулагдаагүй байна.")
    given = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    if not given or not hmac.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(401, "Нэвтрэх түлхүүр буруу байна.")
