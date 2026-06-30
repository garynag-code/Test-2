"""A small web **portal** that turns a ChatGPT data export into a file you can
import into Claude.

Run it locally and open it in your browser:

    pip install -r requirements.txt        # just Flask
    python -m chatgpt_export.web            # then visit http://localhost:5000

Flow:
  1. Upload your ChatGPT export .zip (or click "Try the demo").
  2. The portal parses it and shows a summary of every chat, grouped by Project.
  3. Download either a single combined Markdown file (the easy "one file to
     import into a Claude Project" option) or a .zip of one file per chat.

Everything runs on your own machine -- your chats are never uploaded anywhere.
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
from .render import conversation_to_markdown, conversations_to_combined_markdown, safe_filename
from .sample import sample_conversations

try:
    from flask import (
        Flask,
        flash,
        redirect,
        render_template_string,
        request,
        send_file,
        url_for,
    )
except ImportError as exc:  # pragma: no cover - environment dependent
    raise SystemExit(
        "The portal needs Flask. Install it with:\n"
        "  pip install flask\n"
        "(or: pip install -r requirements.txt)"
    ) from exc


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
.btn { display: inline-block; background: #c15f3c; color: #fff; border: none;
       padding: 11px 18px; border-radius: 10px; font-size: 1rem; cursor: pointer;
       text-decoration: none; }
.btn:hover { filter: brightness(0.93); }
.btn.secondary { background: #374151; }
.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.muted { color: #6b7280; font-size: 0.92rem; }
table { border-collapse: collapse; width: 100%; margin-top: 10px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
.flash { background: #fef3c7; border: 1px solid #fde68a; color: #92400e;
         padding: 10px 14px; border-radius: 10px; margin: 12px 0; }
input[type=file] { margin: 12px 0; }
code { background: rgba(127,127,127,0.15); padding: 2px 6px; border-radius: 6px; }
ul.chips { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
ul.chips li { background: rgba(193,95,60,0.14); padding: 4px 12px; border-radius: 999px;
              font-size: 0.9rem; }
ol { padding-left: 20px; }
"""

PAGE = """
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ title }}</title><style>{{ css }}</style></head><body>
{% with messages = get_flashed_messages() %}
  {% for msg in messages %}<div class="flash">{{ msg }}</div>{% endfor %}
{% endwith %}
{{ body|safe }}
</body></html>
"""

INDEX_BODY = """
<h1>ChatGPT → Claude</h1>
<p class="sub">Turn all your ChatGPT chats — including Project chats — into a file
you can import into Claude.</p>

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
  <p class="muted">Load built-in sample chats — no export needed.</p>
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
  <h3>2. Download for Claude</h3>
  <div class="row">
    <a class="btn" href="{{ url_for('download_combined', job_id=job_id) }}">⬇ One combined file (.md)</a>
    <a class="btn secondary" href="{{ url_for('download_zip', job_id=job_id) }}">⬇ One file per chat (.zip)</a>
  </div>
  <p class="muted" style="margin-top:14px">
    <b>How to import into Claude:</b> open (or create) a
    <b>Project</b> in Claude, then add the combined <code>.md</code> file to the
    project's <b>knowledge</b> — or simply attach it in a chat. Prefer the
    <code>.zip</code> if you'd rather add chats as separate documents (unzip it
    first; Claude reads the individual <code>.md</code> files, not the zip).
  </p>
</div>

<p><a href="{{ url_for('index') }}">← start over</a></p>
"""


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(16)
    app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024  # 256 MB uploads

    def render(body_tmpl: str, title: str, **ctx) -> str:
        body = render_template_string(body_tmpl, **ctx)
        return render_template_string(PAGE, body=body, title=title, css=BASE_CSS)

    @app.route("/")
    def index():
        return render(INDEX_BODY, "ChatGPT → Claude")

    @app.route("/demo")
    def demo():
        convs = [parse_conversation(c) for c in sample_conversations()]
        return redirect(url_for("summary", job_id=_store_job(convs)))

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

        return redirect(url_for("summary", job_id=_store_job(convs)))

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
        )

    @app.route("/download/<job_id>/combined.md")
    def download_combined(job_id: str):
        job = _JOBS.get(job_id)
        if not job:
            flash("That session expired. Please upload your export again.")
            return redirect(url_for("index"))
        data = conversations_to_combined_markdown(job.conversations).encode("utf-8")
        return send_file(
            io.BytesIO(data),
            mimetype="text/markdown",
            as_attachment=True,
            download_name="chatgpt-chats-for-claude.md",
        )

    @app.route("/download/<job_id>/chats.zip")
    def download_zip(job_id: str):
        job = _JOBS.get(job_id)
        if not job:
            flash("That session expired. Please upload your export again.")
            return redirect(url_for("index"))
        return send_file(
            _build_zip(job.conversations),
            mimetype="application/zip",
            as_attachment=True,
            download_name="chatgpt-chats-for-claude.zip",
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


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="chatgpt-export-portal",
        description="Launch the ChatGPT → Claude web portal.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args(argv)

    app = create_app()
    print(f"\n  ChatGPT → Claude portal running at http://{args.host}:{args.port}\n")
    app.run(host=args.host, port=args.port, debug=args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
