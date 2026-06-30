"""Upload rendered conversations to Google Drive, mirroring the local folder
layout (one Drive folder per ChatGPT Project / group, one file per chat).

Authentication supports two modes:

* **OAuth (default)** -- for uploading to *your own* Drive. Provide a
  ``client_secrets.json`` (Desktop app credentials from Google Cloud Console).
  The first run opens a browser to authorise; the resulting token is cached so
  later runs are non-interactive.
* **Service account** -- set ``GOOGLE_APPLICATION_CREDENTIALS`` to a service
  account key file. Useful for headless/automated runs; note a service account
  has its own Drive storage, so usually combine with ``--drive-parent`` or a
  Shared Drive the account can write to.

Imports of the Google client libraries are done lazily so the parsing/rendering
half of the tool works without them installed.
"""

from __future__ import annotations

import os
from typing import Any

from .parser import Conversation
from .render import conversation_to_markdown, safe_filename


SCOPES = ["https://www.googleapis.com/auth/drive.file"]
FOLDER_MIME = "application/vnd.google-apps.folder"


def _require_google_libs() -> None:
    try:
        import googleapiclient  # noqa: F401
        import google.auth  # noqa: F401
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit(
            "Google Drive upload requires extra libraries. Install them with:\n"
            "  pip install google-api-python-client google-auth "
            "google-auth-oauthlib google-auth-httplib2"
        ) from exc


def build_service(
    client_secrets: str | None = None,
    token_path: str = "token.json",
) -> Any:
    """Return an authenticated Drive v3 service object."""
    _require_google_libs()
    from googleapiclient.discovery import build

    creds = _load_credentials(client_secrets, token_path)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _load_credentials(client_secrets: str | None, token_path: str):
    # Service-account mode: GOOGLE_APPLICATION_CREDENTIALS takes precedence.
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if sa_path:
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_file(
            sa_path, scopes=SCOPES
        )

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not client_secrets or not os.path.exists(client_secrets):
                raise SystemExit(
                    "No cached token and no OAuth client secrets file found.\n"
                    "Create OAuth 'Desktop app' credentials in the Google Cloud "
                    "Console, download the JSON, and pass it with "
                    "--client-secrets path/to/client_secrets.json"
                )
            flow = InstalledAppFlow.from_client_secrets_file(client_secrets, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w", encoding="utf-8") as fh:
            fh.write(creds.to_json())

    return creds


class DriveUploader:
    def __init__(self, service: Any, parent_id: str | None = None):
        self.service = service
        self.root_parent = parent_id  # None == "My Drive" root
        self._folder_cache: dict[tuple[str | None, str], str] = {}

    # -- folders -----------------------------------------------------------

    def ensure_folder(self, name: str, parent_id: str | None) -> str:
        """Return the id of folder ``name`` under ``parent_id``, creating it if
        needed. Idempotent and cached within a run."""
        key = (parent_id, name)
        if key in self._folder_cache:
            return self._folder_cache[key]

        existing = self._find_folder(name, parent_id)
        if existing:
            self._folder_cache[key] = existing
            return existing

        metadata: dict[str, Any] = {"name": name, "mimeType": FOLDER_MIME}
        if parent_id:
            metadata["parents"] = [parent_id]
        folder = (
            self.service.files()
            .create(body=metadata, fields="id", supportsAllDrives=True)
            .execute()
        )
        folder_id = folder["id"]
        self._folder_cache[key] = folder_id
        return folder_id

    def _find_folder(self, name: str, parent_id: str | None) -> str | None:
        safe_name = name.replace("'", "\\'")
        query = (
            f"name = '{safe_name}' and mimeType = '{FOLDER_MIME}' "
            "and trashed = false"
        )
        if parent_id:
            query += f" and '{parent_id}' in parents"
        resp = (
            self.service.files()
            .list(
                q=query,
                spaces="drive",
                fields="files(id, name)",
                pageSize=1,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        files = resp.get("files", [])
        return files[0]["id"] if files else None

    # -- files -------------------------------------------------------------

    def upload_markdown(self, name: str, content: str, parent_id: str) -> str:
        from googleapiclient.http import MediaInMemoryUpload

        media = MediaInMemoryUpload(
            content.encode("utf-8"), mimetype="text/markdown", resumable=False
        )
        metadata = {"name": name, "parents": [parent_id]}
        file = (
            self.service.files()
            .create(
                body=metadata,
                media_body=media,
                fields="id",
                supportsAllDrives=True,
            )
            .execute()
        )
        return file["id"]


def upload_conversations(
    conversations: list[Conversation],
    service: Any,
    root_folder_name: str = "ChatGPT Export",
    parent_id: str | None = None,
    progress: bool = True,
) -> dict[str, str]:
    """Upload every conversation as a Markdown file into a per-group folder
    beneath ``root_folder_name``. Returns ``{conversation_id: drive_file_id}``."""
    uploader = DriveUploader(service, parent_id)
    root_id = uploader.ensure_folder(root_folder_name, parent_id)

    results: dict[str, str] = {}
    total = len(conversations)
    for i, conv in enumerate(conversations, start=1):
        group_id = uploader.ensure_folder(safe_filename(conv.group), root_id)
        filename = safe_filename(conv.title) + ".md"
        file_id = uploader.upload_markdown(
            filename, conversation_to_markdown(conv), group_id
        )
        results[conv.conversation_id] = file_id
        if progress:
            print(f"  [{i}/{total}] uploaded: {conv.group} / {filename}")

    return results
