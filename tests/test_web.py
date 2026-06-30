"""Smoke tests for the web portal that don't require Flask-specific fixtures or
any Google credentials. Skipped automatically if Flask isn't installed."""

import io
import json
import os
import re
import sys
import zipfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pytest.importorskip("flask")

from chatgpt_export.web import create_app  # noqa: E402


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def test_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"ChatGPT" in r.data


def test_demo_then_summary_and_download(client):
    r = client.get("/demo", follow_redirects=True)
    assert r.status_code == 200
    assert b"chats ready" in r.data
    assert b"Italy Trip" in r.data  # project grouping shown

    job_id = re.search(rb"/download/([0-9a-f]+)", r.data).group(1).decode()
    r = client.get(f"/download/{job_id}")
    assert r.status_code == 200
    assert r.headers["Content-Type"].startswith("application/zip")
    names = zipfile.ZipFile(io.BytesIO(r.data)).namelist()
    assert any(n.startswith("Italy Trip/") for n in names)
    assert all(n.endswith(".md") for n in names)


def test_upload_zip(client):
    conv = [{
        "title": "Hello chat", "create_time": 1.0, "update_time": 2.0,
        "conversation_id": "u1", "project_name": "Inbox", "current_node": "b",
        "mapping": {
            "a": {"id": "a", "message": {"author": {"role": "user"},
                  "content": {"content_type": "text", "parts": ["hi"]},
                  "metadata": {}}, "parent": None, "children": ["b"]},
            "b": {"id": "b", "message": {"author": {"role": "assistant"},
                  "content": {"content_type": "text", "parts": ["hello!"]},
                  "metadata": {}}, "parent": "a", "children": []},
        },
    }]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("conversations.json", json.dumps(conv))
    buf.seek(0)

    r = client.post(
        "/upload",
        data={"export": (buf, "export.zip")},
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert r.status_code == 200
    assert b"chats ready" in r.data
    assert b"Inbox" in r.data


def test_upload_rejects_garbage(client):
    buf = io.BytesIO(b"not a real export")
    r = client.post(
        "/upload",
        data={"export": (buf, "junk.json")},
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert r.status_code == 200
    # Bounced back to the landing page with a friendly message.
    assert b"Couldn't read that file" in r.data or b"Upload" in r.data
