import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))

from _lib import db as dbmod  # noqa: E402
from _lib.app import app  # noqa: E402

TOKEN = "test-admin-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID", "D1_DATABASE_ID",
                 "CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LOCAL_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    dbmod.reset_db()
    yield
    dbmod.reset_db()


@pytest.fixture
def client():
    return TestClient(app)


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True, "db": "sqlite", "admin": True}


def test_not_configured(client, monkeypatch):
    monkeypatch.delenv("LOCAL_DB_PATH")
    dbmod.reset_db()
    res = client.get("/api/content")
    assert res.status_code == 503
    assert res.json()["error"] == "not_configured"


def test_content(client):
    data = client.get("/api/content").json()
    assert [p["volume_ml"] for p in data["products"]] == [250, 500]
    assert len(data["faqs"]) == 3
    assert data["reviews"] == [] and data["reviewStats"] == {"count": 0, "average": None}
    assert "Улаанбаатар" in data["filters"]["cities"]
    assert "Сүхбаатар" in data["filters"]["districts"]["Улаанбаатар"]
    assert data["tips"][0]["featured"] == 1
    assert set(data["settings"]) >= {"phone", "email"}


def test_branches_filters(client):
    all_rows = client.get("/api/branches").json()
    assert all_rows["count"] == 5
    ub = client.get("/api/branches", params={"city": "Улаанбаатар"}).json()
    assert ub["count"] == 4
    district = client.get("/api/branches", params={"city": "Улаанбаатар", "district": "Хан-Уул"}).json()
    assert [r["name"] for r in district["items"]] == ["Хан-Уул салбар"]
    small = client.get("/api/branches", params={"size": "250"}).json()
    assert all("250" in r["sizes"] for r in small["items"]) and small["count"] == 4
    text = client.get("/api/branches", params={"q": "дархан"}).json()
    assert text["count"] == 1


def test_search(client):
    res = client.get("/api/search", params={"q": "давс"}).json()
    assert any(r["go"] == "ingredients" for r in res["results"])
    assert client.get("/api/search", params={"q": "а"}).json() == {"results": []}
    branch = client.get("/api/search", params={"q": "хан-уул"}).json()
    assert any(r["type"] == "branch" for r in branch["results"])


def test_review_flow(client):
    bad = client.post("/api/reviews", json={"name": "Б", "rating": 7, "body": "богино", "consent": False})
    assert bad.status_code == 422
    fields = bad.json()["fields"]
    assert {"name", "rating", "body"} <= set(fields)
    no_consent = client.post("/api/reviews", json={"name": "Бат", "rating": 5, "body": "Маш сайн бүтээгдэхүүн байна.", "consent": False})
    assert no_consent.status_code == 422 and "consent" in no_consent.json()["fields"]
    ok = client.post("/api/reviews", json={"name": "Бат", "rating": 5, "size": "500", "body": "Маш сайн бүтээгдэхүүн байна.", "consent": True})
    assert ok.status_code == 201
    assert client.get("/api/content").json()["reviews"] == []
    pending = client.get("/api/admin/inbox/reviews", params={"status": "pending"}, headers=AUTH).json()["items"]
    assert len(pending) == 1 and "ip_hash" not in pending[0]
    rid = pending[0]["id"]
    assert client.patch(f"/api/admin/inbox/reviews/{rid}", json={"status": "approved"}, headers=AUTH).status_code == 200
    content = client.get("/api/content").json()
    assert content["reviewStats"] == {"count": 1, "average": 5.0}
    assert content["reviews"][0]["name"] == "Бат"


def test_honeypot_is_silent(client):
    res = client.post("/api/reviews", json={"name": "Spam", "rating": 5, "body": "spam spam spam spam", "consent": True, "website": "x"})
    assert res.status_code == 201
    assert client.get("/api/admin/inbox/reviews", headers=AUTH).json()["items"] == []


def test_rate_limit(client):
    body = {"question": "Өдөрт хэдэн удаа зайлах вэ?", "consent": True}
    codes = [client.post("/api/questions", json=body).status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


def test_question_contact_validation(client):
    res = client.post("/api/questions", json={"question": "Өдөрт хэдэн удаа зайлах вэ?", "contact": "abc", "consent": True})
    assert res.status_code == 422 and "contact" in res.json()["fields"]
    ok = client.post("/api/questions", json={"question": "Өдөрт хэдэн удаа зайлах вэ?", "contact": "99112233", "consent": True})
    assert ok.status_code == 201


def test_partner_rules(client):
    res = client.post("/api/partners", json={"kind": "corporate", "contact_name": "Сараа", "consent": True})
    fields = res.json()["fields"]
    assert {"org", "phone", "quantity"} <= set(fields)
    creator = client.post("/api/partners", json={"kind": "creator", "contact_name": "Сараа", "email": "a@b.mn",
                                                  "details": {"social": "@saraa"}, "message": "богино", "consent": True})
    assert {"focus", "message", "phone"} <= set(creator.json()["fields"])  # an e-mail alone is not enough
    ok = client.post("/api/partners", json={
        "kind": "corporate", "org": "ABC ХХК", "contact_name": "Сараа", "phone": "+976 9911 2233",
        "details": {"size": "500", "quantity": "200 ширхэг", "timeline": "12-р сар", "junk": "x"}, "consent": True,
    })
    assert ok.status_code == 201
    item = client.get("/api/admin/inbox/partners", headers=AUTH).json()["items"][0]
    assert item["details"] == {"size": "500", "quantity": "200 ширхэг", "timeline": "12-р сар"}


def test_location_request(client):
    assert client.post("/api/location-requests", json={"city": "Ховд"}).status_code == 201
    no_consent = client.post("/api/location-requests", json={"city": "Ховд", "contact": "99112233"})
    assert no_consent.status_code == 422 and "consent" in no_consent.json()["fields"]
    with_consent = client.post("/api/location-requests", json={"city": "Ховд", "contact": "99112233", "consent": True})
    assert with_consent.status_code == 201
    assert client.get("/api/admin/summary", headers=AUTH).json()["counts"]["locations_new"] == 2


def test_events(client):
    assert client.post("/api/events", json={"name": "where_click", "meta": {"from": "hero"}}).status_code == 204
    assert client.post("/api/events", json={"name": "not_allowed"}).status_code == 204
    client.post("/api/events", json={"name": "where_click", "meta": {"from": "nav"}})
    events = client.get("/api/admin/summary", headers=AUTH).json()["events"]
    assert events == [{"name": "where_click", "count": 2, "people": 1}]  # two clicks by one visitor


def test_events_on_an_older_database_without_visitor_column(client):
    db = dbmod.get_db()
    db.script("DROP TABLE events; CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, meta TEXT,"
              " created_at TEXT NOT NULL DEFAULT (datetime('now')));")
    from _lib import app as appmod
    appmod._event_visitor.clear()
    assert client.get("/api/admin/summary", headers=AUTH).status_code == 200
    assert client.post("/api/events", json={"name": "call_click"}).status_code == 204
    assert client.get("/api/admin/summary", headers=AUTH).json()["events"] == [{"name": "call_click", "count": 1, "people": 1}]


def test_admin_auth(client):
    assert client.get("/api/admin/summary").status_code == 401
    assert client.get("/api/admin/summary", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_admin_crud(client):
    created = client.post("/api/admin/t/branches", headers=AUTH, json={
        "chain": "Монос", "name": "Зайсан салбар", "city": "Улаанбаатар", "district": "Хан-Уул",
        "lat": "47.88", "lng": "106.91", "sizes": "250,500", "active": True,
    })
    assert created.status_code == 201
    bid = created.json()["id"]
    missing = client.post("/api/admin/t/branches", headers=AUTH, json={"chain": "", "name": "x"})
    assert missing.status_code == 422 and {"chain", "city"} <= set(missing.json()["fields"])
    bad_number = client.put(f"/api/admin/t/branches/{bid}", headers=AUTH, json={"lat": "abc"})
    assert bad_number.status_code == 422
    assert client.put(f"/api/admin/t/branches/{bid}", headers=AUTH, json={"phone": "77001122"}).status_code == 200
    rows = client.get("/api/admin/t/branches", headers=AUTH).json()["items"]
    row = next(r for r in rows if r["id"] == bid)
    assert row["phone"] == "77001122" and row["lat"] == 47.88
    price = client.put("/api/admin/t/products/1", headers=AUTH, json={"price": "8900"})
    assert price.status_code == 200
    assert client.get("/api/content").json()["products"][0]["price"] == 8900
    dup = client.post("/api/admin/t/products", headers=AUTH, json={"slug": "big", "name": "x", "volume_ml": 500})
    assert dup.status_code == 422 and "slug" in dup.json()["fields"]
    assert client.delete(f"/api/admin/t/branches/{bid}", headers=AUTH).status_code == 200
    assert client.delete(f"/api/admin/t/branches/{bid}", headers=AUTH).status_code == 404
    assert client.get("/api/admin/t/unknown", headers=AUTH).status_code == 404


def test_admin_form_defaults_and_coordinates(client):
    # The admin form sends every field; empty NOT NULL columns fall back to their defaults.
    faq = client.post("/api/admin/t/faqs", headers=AUTH, json={"question": "Q?", "answer": "A.", "sort": "", "active": True})
    assert faq.status_code == 201, faq.text
    row = next(r for r in client.get("/api/admin/t/faqs", headers=AUTH).json()["items"] if r["id"] == faq.json()["id"])
    assert row["sort"] == 0 and row["active"] == 1
    tip = client.post("/api/admin/t/tips", headers=AUTH, json={"title": "T", "kind": "", "sort": "", "featured": False})
    assert tip.status_code == 201, tip.text
    swapped = client.post("/api/admin/t/branches", headers=AUTH, json={
        "chain": "A", "name": "B", "city": "Улаанбаатар", "lat": "106.9", "lng": "47.9",
    })
    assert swapped.status_code == 422 and "lat" in swapped.json()["fields"]


def test_editing_sample_marks_it_real(client):
    tips = client.get("/api/admin/t/tips", headers=AUTH).json()["items"]
    tid = tips[0]["id"]
    client.put(f"/api/admin/t/tips/{tid}", headers=AUTH, json={"doctor_name": "Д. Болд"})
    tip = next(t for t in client.get("/api/admin/t/tips", headers=AUTH).json()["items"] if t["id"] == tid)
    assert tip["is_sample"] == 0


def test_settings_and_samples(client):
    assert client.put("/api/admin/settings", headers=AUTH, json={"phone": "7000 0000", "evil": "x"}).status_code == 200
    assert client.get("/api/admin/settings", headers=AUTH).json()["phone"] == "7000 0000"
    assert client.get("/api/content").json()["settings"]["phone"] == "7000 0000"
    cleared = client.post("/api/admin/clear-samples", headers=AUTH).json()
    assert cleared["deleted"] == 11
    assert client.get("/api/branches").json()["count"] == 0
    assert client.post("/api/admin/migrate", headers=AUTH).status_code == 200


def test_unknown_route(client):
    res = client.get("/api/nope")
    assert res.status_code == 404 and res.json()["ok"] is False


def test_media_upload_and_serve(client):
    import base64
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    res = client.post("/api/admin/media", headers=AUTH, json={"data": "data:image/png;base64," + base64.b64encode(png).decode()})
    assert res.status_code == 201, res.text
    url = res.json()["url"]
    assert url.startswith("/api/media/") and url.endswith(".png")
    got = client.get(url)
    assert got.status_code == 200 and got.content == png and got.headers["content-type"] == "image/png"
    assert "immutable" in got.headers["cache-control"]
    svg = base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'/>").decode()
    assert client.post("/api/admin/media", headers=AUTH, json={"data": svg}).status_code == 422
    assert client.post("/api/admin/media", json={"data": svg}).status_code == 401
    assert client.get("/api/media/nope.png").status_code == 404
    # covers are saved on tips/videos and reach the public content
    tip = client.post("/api/admin/t/videos", headers=AUTH, json={"title": "Reel", "video_url": "https://www.facebook.com/reel/1616920993305370",
                                                                   "image_url": url, "active": True})
    assert tip.status_code == 201
    videos = client.get("/api/content").json()["videos"]
    assert any(v["image_url"] == url for v in videos)


def test_old_database_is_upgraded():
    db = dbmod.get_db()
    db.run("ALTER TABLE tips DROP COLUMN image_url")
    db.run("DROP TABLE media")
    dbmod.reset_db()
    db = dbmod.get_db()
    assert db.one("SELECT image_url FROM tips LIMIT 1") is not None
    assert db.all("SELECT id FROM media") == []


def test_image_field_rejects_video_links(client):
    bad = client.put("/api/admin/t/tips/1", headers=AUTH, json={"image_url": "https://www.facebook.com/reel/2464133197747241"})
    assert bad.status_code == 422 and "видео холбоос" in bad.json()["fields"]["image_url"]
    junk = client.put("/api/admin/t/tips/1", headers=AUTH, json={"image_url": "javascript:alert(1)"})
    assert junk.status_code == 422
    ok = client.put("/api/admin/t/tips/1", headers=AUTH, json={"image_url": "https://example.com/a.jpg"})
    assert ok.status_code == 200
    assert client.put("/api/admin/t/tips/1", headers=AUTH, json={"image_url": ""}).status_code == 200
