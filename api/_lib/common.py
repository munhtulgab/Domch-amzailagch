"""Helpers shared by the API modules."""
import os
import re
from datetime import datetime, timedelta, timezone

from fastapi import Header, Request

SITE_URL = "https://domch.gem.mn"  # primary address; the SITE_URL environment variable overrides it
LOCAL_HOST = re.compile(r"^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[^.:]+|[^:]*\.local|[^:]*\.test)(:\d+)?$", re.I)
OLD_SITE = re.compile(r"https?://domch-?amzailagch[a-z0-9-]*\.vercel\.app", re.I)


def request_origin(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto.split(',')[0].strip()}://{host.split(',')[0].strip()}"


def primary_url() -> str:
    return (os.getenv("SITE_URL") or SITE_URL).strip().rstrip("/")


def site_url(request: Request | None = None) -> str:
    """The address customers and Facebook should use: the primary domain, except on a developer's computer."""
    if request is not None:
        origin = request_origin(request)
        if LOCAL_HOST.match(origin.split("://", 1)[-1]):
            return origin
    return primary_url()


def public_links(text: str) -> str:
    """Links to the old *.vercel.app address point at the primary domain instead."""
    return OLD_SITE.sub(primary_url(), text or "")


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
    """Admin guard: a signed session from /api/auth/login, or the ADMIN_TOKEN environment value."""
    from .auth import require_admin as check  # imported here: auth itself imports this module

    return check(authorization)
