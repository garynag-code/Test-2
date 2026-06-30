"""A small web **portal** for the ChatGPT -> Google Drive exporter.

Run it locally and open it in your browser:

    pip install -r requirements.txt        # includes Flask
    python -m chatgpt_export.web            # then visit http://localhost:5000

Flow:
  1. Upload your ChatGPT export .zip (or click "Try the demo").
  2. The portal parses it and shows a summary of every chat, grouped by Project.
  3. Download everything as a tidy Markdown .zip, and/or connect Google Drive
     and import it straight into your Drive.

Everything runs on your own machine -- your chats are never sent anywhere
except to Google Drive, and only when you click Import.
"""

from __future__ import annotations

import io
import os
import secrets
import uuid
import zipfile
from collections import Counter
from dataclasses import dataclass

from .parser import Conversation, format_timestamp, load_conversations_json, parse_conversation
from .render import conversation_to_markdown, safe_filename
from .sample import sample_conversations

try:
    from flask import (
        Flask,
        flash,
        redirect,
        render_template_string,
        request,
        send_file,
        session,
        url_for,
    )
except ImportError as exc:  # pragma: no cover - environment dependent
    raise SystemExit(
        "The portal needs Flask. Install it with:\n"
        "  pip install flask\n"
        "(or: pip install -r requirements.txt)"
    ) from exc


# Google Drive scope: the app can only see/manage files it creates.
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]


# ---------------------------------------------------------------------------
# In-memory job store (single local user; cleared when the process stops)
# ---------------------------------------------------------------------------

@dataclass
class Job:
    conversations: list[Conversation]


_JOBS: dict[str, Job] = {}


def _store_job(conversations: list[Conversation]) -> str:
    job_id = uuid.uuid4().hex
    _JOBS[job_id] = Job(conversations=conversations)
    return job_id


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

BASE_CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
       max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; line-height: 1.5; }
h1 { font-size: 1.7rem; margin-bottom: 4px; }
.sub { color: #6b7280; margin-top: 0; }
.card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 24px; margin: 22px 0;
        background: rgba(127,127,127,0.04); }
.btn { display: inline-block; background: #10a37f; color: #fff; border: none;
       padding: 11px 18px; border-radius: 10px; font-size: 1rem; cursor: pointer;
       text-decoration: none; }
.btn:hover { background: #0e8e6d; }
.btn.secondary { background: #374151; }
.btn.secondary:hover { background: #1f2937; }
.btn.google { background: #4285f4; }
.btn.google:hover { background: #3367d6; }
.muted { color: #6b7280; font-size: 0.92rem; }
table { border-collapse: collapse; width: 100%; margin-top: 10px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
.flash { background: #fef3c7; border: 1px solid #fde68a; color: #92400e;
         padding: 10px 14px; border-radius: 10px; margin: 12px 0; }
.ok { background: #dcfce7; border-color: #bbf7d0; color: #166534; }
input[type=file] { margin: 12px 0; }
code { background: rgba(127,127,127,0.15); padding: 2px 6px; border-radius: 6px; }
ul.chips { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
ul.chips li { background: rgba(16,163,127,0.12); padding: 4px 12px; border-radius: 999px;
              font-size: 0.9rem; }
"""

PAGE = """
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ title }}</title><style>{{ css }}</style></head><body>
{% with messages = get_flashed_messages(with_categories=true) %}
  {% for cat, msg in messages %}
    <div class="flash {{ 'ok' if cat == 'ok' else '' }}">{{ msg }}</div>
  {% endfor %}
{% endwith %}
{{ body|safe }}
</body></html>
"""

INDEX_BODY = """
<h1>ChatGPT → Google Drive</h1>
<p class="sub">Import all your ChatGPT chats — including Project chats — into Google Drive.</p>

<div class="card">
  <h3>1. Upload your ChatGPT export</h3>
  <p class="muted">In ChatGPT: <b>Settings → Data Controls → Export Data</b>.
     You'll get an email with a <code>.zip</code> — upload it here.</p>
  <form method="post" action="{{ url_for('upload') }}" enctype="multipart/form-data">
    <input type="file" name="export" accept=".zip,.json" required>
    <br><button class="btn" type="submit">Upload &amp; preview</button>
  </form>
</div>

<div class="card">
  <h3>Just want to see how it works?</h3>
  <p class="muted">Load built-in sample chats — no export or Google account needed.</p>
  <a class="btn secondary" href="{{ url_for('demo') }}">Try the demo</a>
</div>
"""

SUMMARY_BODY = """
<h1>{{ total }} chats ready</h1>
<p class="sub">{{ messages }} messages across {{ ngroups }} group(s).</p>

<div class="card">
  <h3>Projects &amp; groups</h3>
  <ul class="chips">
    {% for name, count in groups %}<li>{{ name }} · {{ count }}</li>{% endfor %}
  </ul>
  <table>
    <tr><th>Chat</th><th>Group</th><th>Updated</th><th>Messages</th></tr>
    {% for c in preview %}
    <tr><td>{{ c.title }}</td><td>{{ c.group }}</td>
        <td>{{ c.updated }}</td><td>{{ c.nmsg }}</td></tr>
    {% endfor %}
  </table>
  {% if total > preview|length %}
  <p class="muted">…and {{ total - preview|length }} more.</p>{% endif %}
</div>

<div class="card">
  <h3>2. Get your chats</h3>
  <p style="margin-bottom:16px">
    <a class="btn secondary" href="{{ url_for('download', job_id=job_id) }}">⬇ Download as Markdown .zip</a>
  </p>
  {% if drive_ready %}
    {% if connected %}
      <form method="post" action="{{ url_for('do_import', job_id=job_id) }}">
        <button class="btn google" type="submit">⬆ Import {{ total }} chats to Google Drive</button>
      </form>
      <p class="muted">Connected to Google Drive ✓</p>
    {% else %}
      <a class="btn google" href="{{ url_for('connect', job_id=job_id) }}">Connect Google Drive</a>
      <p class="muted">You'll be asked to sign in to Google and allow access to files this app creates.</p>
    {% endif %}
  {% else %}
    <p class="muted">Google Drive import isn't configured yet. To enable it, add a
      <code>client_secrets.json</code> (a "Web application" OAuth client from the
      Google Cloud Console, with redirect URI
      <code>{{ redirect_uri }}</code>) next to the app, then restart.
      Downloading the .zip works without any setup.</p>
  {% endif %}
</div>

<p><a href="{{ url_for('index') }}">← start over</a></p>
"""

RESULT_BODY = """
<h1>Done ✅</h1>
<p class="sub">Imported {{ count }} chats into Google Drive.</p>
<div class="card">
  <p>Open the folder in your Drive:</p>
  <p><a class="btn google" target="_blank" href="{{ folder_url }}">Open “{{ folder }}” in Google Drive</a></p>
</div>
<p><a href="{{ url_for('index') }}">← import another export</a></p>
"""


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def _client_secrets_path() -> str | None:
    candidate = os.environ.get("GOOGLE_CLIENT_SECRETS", "client_secrets.json")
    return candidate if os.path.exists(candidate) else None


def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(16)
    app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024  # 256 MB uploads

    def render(body_tmpl: str, title: str, **ctx) -> str:
        body = render_template_string(body_tmpl, **ctx)
        return render_template_string(PAGE, body=body, title=title, css=BASE_CSS)

    # -- pages -------------------------------------------------------------

    @app.route("/")
    def index():
        return render(INDEX_BODY, "ChatGPT → Google Drive")

    @app.route("/demo")
    def demo():
        convs = [parse_conversation(c) for c in sample_conversations()]
        job_id = _store_job(convs)
        return redirect(url_for("summary", job_id=job_id))

    @app.route("/upload", methods=["POST"])
    def upload():
        file = request.files.get("export")
        if not file or not file.filename:
            flash("Please choose your ChatGPT export file first.")
            return redirect(url_for("index"))

        suffix = ".zip" if file.filename.lower().endswith(".zip") else ".json"
        tmp_path = os.path.join(
            app.config.get("UPLOAD_TMP", "."), f"upload-{uuid.uuid4().hex}{suffix}"
        )
        file.save(tmp_path)
        try:
            raw = load_conversations_json(tmp_path)
            convs = [parse_conversation(c) for c in raw]
        except Exception as exc:  # noqa: BLE001 - surface a friendly message
            flash(f"Couldn't read that file as a ChatGPT export: {exc}")
            return redirect(url_for("index"))
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

        if not convs:
            flash("No conversations were found in that export.")
            return redirect(url_for("index"))

        job_id = _store_job(convs)
        return redirect(url_for("summary", job_id=job_id))

    @app.route("/summary/<job_id>")
    def summary(job_id: str):
        job = _JOBS.get(job_id)
        if not job:
            flash("That session expired. Please upload your export again.")
            return redirect(url_for("index"))

        convs = job.conversations
        groups = Counter(c.group for c in convs).most_common()
        preview = [
            {
                "title": c.title,
                "group": c.group,
                "updated": format_timestamp(c.update_time),
                "nmsg": len(c.messages),
            }
            for c in convs[:25]
        ]
        return render(
            SUMMARY_BODY,
            "Your chats",
            job_id=job_id,
            total=len(convs),
            messages=sum(len(c.messages) for c in convs),
            ngroups=len(groups),
            groups=groups,
            preview=preview,
            drive_ready=_client_secrets_path() is not None,
            connected="credentials" in session,
            redirect_uri=url_for("oauth2callback", _external=True),
        )

    @app.route("/download/<job_id>")
    def download(job_id: str):
        job = _JOBS.get(job_id)
        if not job:
            flash("That session expired. Please upload your export again.")
            return redirect(url_for("index"))
        buf = _build_zip(job.conversations)
        return send_file(
            buf,
            mimetype="application/zip",
            as_attachment=True,
            download_name="chatgpt-export.zip",
        )

    # -- Google Drive ------------------------------------------------------

    @app.route("/connect/<job_id>")
    def connect(job_id: str):
        secrets_path = _client_secrets_path()
        if not secrets_path:
            flash("Google Drive isn't configured (no client_secrets.json).")
            return redirect(url_for("summary", job_id=job_id))

        from google_auth_oauthlib.flow import Flow

        flow = Flow.from_client_secrets_file(
            secrets_path,
            scopes=DRIVE_SCOPES,
            redirect_uri=url_for("oauth2callback", _external=True),
        )
        auth_url, state = flow.authorization_url(
            access_type="offline", include_granted_scopes="true", prompt="consent"
        )
        session["oauth_state"] = state
        session["pending_job"] = job_id
        return redirect(auth_url)

    @app.route("/oauth2callback")
    def oauth2callback():
        secrets_path = _client_secrets_path()
        job_id = session.get("pending_job")
        if not secrets_path or not job_id:
            flash("Google sign-in could not be completed. Please try again.")
            return redirect(url_for("index"))

        from google_auth_oauthlib.flow import Flow

        flow = Flow.from_client_secrets_file(
            secrets_path,
            scopes=DRIVE_SCOPES,
            state=session.get("oauth_state"),
            redirect_uri=url_for("oauth2callback", _external=True),
        )
        flow.fetch_token(authorization_response=request.url)
        session["credentials"] = _creds_to_dict(flow.credentials)
        flash("Connected to Google Drive ✓", "ok")
        return redirect(url_for("summary", job_id=job_id))

    @app.route("/import/<job_id>", methods=["POST"])
    def do_import(job_id: str):
        job = _JOBS.get(job_id)
        if not job:
            flash("That session expired. Please upload your export again.")
            return redirect(url_for("index"))
        if "credentials" not in session:
            return redirect(url_for("connect", job_id=job_id))

        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        from .drive import upload_conversations

        creds = Credentials(**session["credentials"])
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        folder_name = "ChatGPT Export"
        upload_conversations(
            job.conversations, service, root_folder_name=folder_name, progress=False
        )
        # Refresh any rotated token.
        session["credentials"] = _creds_to_dict(creds)

        folder_id = _find_folder_id(service, folder_name)
        folder_url = (
            f"https://drive.google.com/drive/folders/{folder_id}"
            if folder_id
            else "https://drive.google.com/drive/my-drive"
        )
        return render(
            RESULT_BODY,
            "Imported",
            count=len(job.conversations),
            folder=folder_name,
            folder_url=folder_url,
        )

    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_zip(conversations: list[Conversation]) -> io.BytesIO:
    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for conv in conversations:
            group = safe_filename(conv.group)
            base = safe_filename(conv.title)
            arcname = f"{group}/{base}.md"
            n = 2
            while arcname in used:
                arcname = f"{group}/{base} ({n}).md"
                n += 1
            used.add(arcname)
            zf.writestr(arcname, conversation_to_markdown(conv))
    buf.seek(0)
    return buf


def _creds_to_dict(creds) -> dict:
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }


def _find_folder_id(service, name: str) -> str | None:
    safe = name.replace("'", "\\'")
    resp = (
        service.files()
        .list(
            q=f"name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false",
            spaces="drive",
            fields="files(id)",
            pageSize=1,
        )
        .execute()
    )
    files = resp.get("files", [])
    return files[0]["id"] if files else None


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="chatgpt-export-portal",
        description="Launch the ChatGPT → Google Drive web portal.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args(argv)

    # Google's OAuth redirect to http://localhost is fine, but oauthlib refuses
    # non-HTTPS by default; allow it for local development only.
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

    app = create_app()
    print(f"\n  ChatGPT → Google Drive portal running at http://{args.host}:{args.port}\n")
    app.run(host=args.host, port=args.port, debug=args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
