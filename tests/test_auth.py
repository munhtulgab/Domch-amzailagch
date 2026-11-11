"""Admin sign-in with a username and password, sessions, and changing the password."""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from _lib import db as dbmod  # noqa: E402
from _lib.app import app  # noqa: E402

TOKEN = "test-admin-token"


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID", "D1_DATABASE_ID",
                 "CF_API_TOKEN", "CLOUDFLARE_API_TOKEN", "SESSION_SECRET"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LOCAL_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    dbmod.reset_db()
    yield
    dbmod.reset_db()


@pytest.fixture
def client():
    return TestClient(app)


def login(client, username="Admin", password="admin123"):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_default_account_signs_in_and_is_flagged(client):
    res = login(client)
    assert res.status_code == 200
    body = res.json()
    assert body["default_password"] is True and body["user"] == "Admin"
    assert client.get("/api/admin/summary", headers=bearer(body["token"])).status_code == 200
    assert login(client, "admin").status_code == 200  # the name is not case sensitive
    assert client.get("/api/admin/account", headers=bearer(body["token"])).json() == {"user": "Admin", "default_password": True}


def test_wrong_password_and_bad_tokens_are_refused(client):
    assert login(client, password="nope").status_code == 401
    assert login(client, "someone").status_code == 401
    assert client.get("/api/admin/summary", headers=bearer("s1.e30.bad")).status_code == 401
    token = login(client).json()["token"]
    prefix, body, sig = token.split(".")
    assert client.get("/api/admin/summary", headers=bearer(f"{prefix}.{body}x.{sig}")).status_code == 401


def test_recovery_with_admin_token(client):
    assert client.get("/api/admin/summary", headers=bearer(TOKEN)).status_code == 200
    assert login(client, "whoever", TOKEN).status_code == 200


def test_change_password_and_name(client):
    old = login(client).json()["token"]
    h = bearer(old)
    bad = client.put("/api/admin/account", headers=h, json={"current_password": "x", "new_password": "short"})
    assert set(bad.json()["fields"]) == {"current_password", "new_password"}
    same = client.put("/api/admin/account", headers=h, json={"current_password": "admin123", "new_password": "admin123"})
    assert "new_password" in same.json()["fields"]
    res = client.put("/api/admin/account", headers=h,
                     json={"current_password": "admin123", "new_password": "Domch-2026!", "username": "domch"})
    assert res.status_code == 200 and res.json()["default_password"] is False and res.json()["user"] == "domch"
    assert client.get("/api/admin/summary", headers=h).status_code == 401  # older sessions end
    assert client.get("/api/admin/summary", headers=bearer(res.json()["token"])).status_code == 200
    assert login(client).status_code == 401
    assert login(client, "Domch", "Domch-2026!").status_code == 200
    stored = dbmod.get_db().one("SELECT value FROM settings WHERE key = 'admin_pass'")["value"]
    assert stored.startswith("pbkdf2_sha256$") and "Domch-2026!" not in stored
    # the password never reaches the public site settings
    assert "admin_pass" not in str(client.get("/api/admin/settings", headers=bearer(TOKEN)).json())


def test_sign_in_is_throttled(client):
    for _ in range(8):
        assert login(client, password="wrong").status_code == 401
    assert login(client).status_code == 429
