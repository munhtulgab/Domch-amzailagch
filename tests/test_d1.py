"""The D1 driver against a fake Cloudflare REST API (same response shape as the real one)."""
import json
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from _lib.db import D1, DBError  # noqa: E402


def make(handler):
    db = D1("acc", "dbid", "tok")
    db.client = httpx.Client(transport=httpx.MockTransport(handler))
    return db


def ok(results_per_statement, meta=None):
    return httpx.Response(200, json={
        "success": True, "errors": [], "messages": [],
        "result": [{"results": r, "success": True, "meta": meta or {"changes": 0, "last_row_id": 0}} for r in results_per_statement],
    })


def test_request_shape_and_rows():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return ok([[{"id": 1, "name": "A"}]])

    db = make(handler)
    assert db.all("SELECT * FROM t WHERE id = ?", (1,)) == [{"id": 1, "name": "A"}]
    assert seen["url"].endswith("/accounts/acc/d1/database/dbid/query")
    assert seen["auth"] == "Bearer tok"
    assert seen["body"] == {"sql": "SELECT * FROM t WHERE id = ?", "params": [1]}
    assert db.one("SELECT 1") == {"id": 1, "name": "A"}


def test_run_meta():
    db = make(lambda r: ok([[]], {"changes": 1, "last_row_id": 42}))
    assert db.run("INSERT INTO t (a) VALUES (?)", ("x",)) == {"last_row_id": 42, "changes": 1}


def test_batch_and_fallback():
    db = make(lambda r: ok([[{"a": 1}], [{"b": 2}]]))
    assert db.batch(["SELECT 1 AS a", "SELECT 2 AS b"]) == [[{"a": 1}], [{"b": 2}]]
    calls = []

    def single(request):
        calls.append(json.loads(request.content)["sql"])
        return ok([[{"n": len(calls)}]])

    db = make(single)
    # the API answered with one result for two statements -> statements are re-run one by one
    assert db.batch(["SELECT 1", "SELECT 2"]) == [[{"n": 2}], [{"n": 3}]]
    assert calls == ["SELECT 1;\nSELECT 2", "SELECT 1", "SELECT 2"]


def test_errors():
    db = make(lambda r: httpx.Response(400, json={"success": False, "errors": [{"code": 7500, "message": "no such table: x"}], "result": []}))
    with pytest.raises(DBError, match="no such table"):
        db.all("SELECT * FROM x")
    db = make(lambda r: httpx.Response(502, text="<html>bad gateway</html>"))
    with pytest.raises(DBError):
        db.all("SELECT 1")

    def boom(request):
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(DBError, match="холболт"):
        make(boom).all("SELECT 1")
