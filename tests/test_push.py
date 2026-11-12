"""Admin Web Push: payload encryption, VAPID header, subscriptions and the hooks that send notifications."""
import base64
import json
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from _lib import db as dbmod  # noqa: E402
from _lib import push  # noqa: E402
from _lib.app import app  # noqa: E402

TOKEN = "test-admin-token"
H = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    for name in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID", "D1_DATABASE_ID",
                 "CF_API_TOKEN", "CLOUDFLARE_API_TOKEN", "VAPID_PRIVATE_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LOCAL_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    dbmod.reset_db()
    push._keys.clear()
    yield
    dbmod.reset_db()


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Browser:
    """A pretend browser subscription that can decrypt what it receives."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.auth = b"0123456789abcdef"
        self.public = self.key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)

    def sub(self, endpoint="https://push.example.com/abc"):
        return {"endpoint": endpoint, "keys": {"p256dh": b64u(self.public), "auth": b64u(self.auth)}}

    def decrypt(self, body: bytes) -> bytes:
        salt, rs, idlen = body[:16], body[16:20], body[20]
        as_public = body[21:21 + idlen]
        shared = self.key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
        hk = lambda salt, ikm, info, n: HKDF(hashes.SHA256(), n, salt, info).derive(ikm)  # noqa: E731
        ikm = hk(self.auth, shared, b"WebPush: info\x00" + self.public + as_public, 32)
        cek = hk(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
        nonce = hk(salt, ikm, b"Content-Encoding: nonce\x00", 12)
        plain = AESGCM(cek).decrypt(nonce, body[21 + idlen:], None)
        assert plain.endswith(b"\x02")
        return plain[:-1]


def test_encrypt_round_trip():
    browser = Browser()
    s = browser.sub()
    body = push.encrypt("Сайн уу 👋".encode(), s["keys"]["p256dh"], s["keys"]["auth"])
    assert browser.decrypt(body).decode() == "Сайн уу 👋"


def test_vapid_header_is_a_valid_es256_jwt():
    key, public = push.vapid_keys()
    header = push.vapid_header("https://fcm.googleapis.com/fcm/send/xyz", key, public)
    token = header.split("t=")[1].split(",")[0]
    h, c, sig = token.split(".")
    claims = json.loads(unb64u(c))
    assert claims["aud"] == "https://fcm.googleapis.com" and claims["sub"].startswith("mailto:")
    raw = unb64u(sig)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(public))
    pub.verify(der, f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))  # raises if wrong
    assert push.vapid_keys()[1] == public  # stored once, reused


@pytest.fixture
def outbox(monkeypatch):
    sent = []

    class Res:
        def __init__(self, code):
            self.status_code, self.text = code, ""

    class Fake:
        def post(self, url, content=None, headers=None):
            sent.append({"url": url, "body": content, "headers": headers})
            return Res(410 if "gone" in url else 201)

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(push, "_client", Fake)
    return sent


def test_subscribe_and_receive_form_notifications(outbox):
    client = TestClient(app)
    browser = Browser()
    assert client.get("/api/admin/push", headers=H).json()["public_key"]
    res = client.post("/api/admin/push/subscribe", headers=H, json={"subscription": browser.sub(), "label": "iPhone"})
    assert res.status_code == 200
    ok = client.post("/api/questions", json={"name": "Болд", "question": "Хүүхдэд хэрэглэж болох уу?", "consent": True})
    assert ok.status_code == 201
    assert len(outbox) == 1
    msg = json.loads(browser.decrypt(outbox[0]["body"]))
    assert msg["title"] == "Эмчид шинэ асуулт" and "Болд" in msg["body"] and msg["url"] == "/admin#/questions"
    assert outbox[0]["headers"]["Authorization"].startswith("vapid t=")
    devices = client.get("/api/admin/push", headers=H).json()["devices"]
    assert devices[0]["label"] == "iPhone" and devices[0]["last_ok_at"] and devices[0]["endpoint"] is None


def test_kinds_filter_and_gone_devices_are_removed(outbox):
    client = TestClient(app)
    a, b = Browser(), Browser()
    client.post("/api/admin/push/subscribe", headers=H, json={"subscription": a.sub("https://push.example.com/only-msgs"), "kinds": ["messages"]})
    client.post("/api/admin/push/subscribe", headers=H, json={"subscription": b.sub("https://push.example.com/gone")})
    assert push.notify("requests", "t", "b") == 0  # only the gone device wanted requests
    assert [o["url"] for o in outbox] == ["https://push.example.com/gone"]
    assert len(client.get("/api/admin/push", headers=H).json()["devices"]) == 1


def test_test_push_and_unsubscribe(outbox):
    client = TestClient(app)
    browser = Browser()
    sub = browser.sub()
    assert client.post("/api/admin/push/test", headers=H, json={"endpoint": sub["endpoint"]}).status_code == 422
    client.post("/api/admin/push/subscribe", headers=H, json={"subscription": sub})
    res = client.post("/api/admin/push/test", headers=H, json={"endpoint": sub["endpoint"]})
    assert res.json()["sent"] == 1 and "ажиллаж" in json.loads(browser.decrypt(outbox[-1]["body"]))["body"]
    client.post("/api/admin/push/unsubscribe", headers=H, json={"subscription": sub})
    assert client.get("/api/admin/push", headers=H).json()["devices"] == []
    assert client.post("/api/admin/push/subscribe", json={"subscription": sub}).status_code == 401


def test_matches_rfc8291_example():
    """RFC 8291 appendix A: same keys and salt must give the published message byte for byte."""
    server = ec.derive_private_key(int.from_bytes(unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
    body = push.encrypt(b"When I grow up, I want to be a watermelon",
                        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                        "BTBZMqHH6r4Tts7J_aSIgg", salt=unb64u("DGv6ra1nlYgDCS1FRnbzlw"), server_key=server)
    assert b64u(body) == ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tl"
                          "zAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
