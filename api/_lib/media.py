"""Images uploaded from the admin, kept in D1 and served (cached for a year) from /api/media/<id>.<ext>."""
import base64
import binascii
import re
import secrets

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from .common import fail, require_admin
from .db import get_db

MIMES = {"image/webp": "webp", "image/jpeg": "jpg", "image/png": "png"}
MAX_BYTES = 1_200_000  # the admin compresses to WebP first, so real uploads are far smaller


def _sniff(raw: bytes) -> str:
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return ""


public = APIRouter()


@public.get("/api/media/{name}")
def get_media(name: str):
    media_id = name.split(".", 1)[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", media_id):
        raise HTTPException(404, "Зураг олдсонгүй.")
    row = get_db().one("SELECT mime, data FROM media WHERE id = ?", (media_id,))
    if not row:
        raise HTTPException(404, "Зураг олдсонгүй.")
    return Response(base64.b64decode(row["data"]), media_type=row["mime"], headers={
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    })


admin = APIRouter(prefix="/api/admin/media", dependencies=[Depends(require_admin)])


@admin.post("", status_code=201)
def upload(payload: dict = Body(...)):
    data = str(payload.get("data") or "")
    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        fail({"file": "Зургийг уншиж чадсангүй."})
    if not raw:
        fail({"file": "Зураг сонгоно уу."})
    if len(raw) > MAX_BYTES:
        fail({"file": "Зураг хэт том байна (1.2 MB хүртэл)."})
    mime = _sniff(raw)
    if mime not in MIMES:
        fail({"file": "WebP, JPEG эсвэл PNG зураг оруулна уу."})
    media_id = secrets.token_urlsafe(12)
    get_db().run("INSERT INTO media (id, mime, data, size) VALUES (?, ?, ?, ?)",
                 (media_id, mime, base64.b64encode(raw).decode(), len(raw)))
    return {"ok": True, "url": f"/api/media/{media_id}.{MIMES[mime]}", "size": len(raw)}
