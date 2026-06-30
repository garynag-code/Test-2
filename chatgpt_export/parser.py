"""Parse a ChatGPT data-export archive into structured conversations.

ChatGPT (Settings -> Data Controls -> Export Data) emails a ``.zip`` whose
core file is ``conversations.json`` -- a list of conversation objects. Each
conversation stores its messages as a ``mapping`` tree (every node may have
several children, because you can edit/regenerate messages). The
``current_node`` points at the leaf of the *visible* thread; walking parent
pointers from there back to the root reconstructs the conversation the user
actually sees.

This module is deliberately defensive: the export format is undocumented and
changes over time, so unknown content types degrade to a best-effort text
representation rather than raising.
"""

from __future__ import annotations

import io
import json
import os
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Message:
    role: str            # user / assistant / system / tool
    text: str            # rendered text content (may be multi-line)
    create_time: float | None = None
    author_name: str | None = None  # e.g. tool name or custom-GPT name


@dataclass
class Conversation:
    conversation_id: str
    title: str
    create_time: float | None
    update_time: float | None
    messages: list[Message] = field(default_factory=list)
    # Grouping hints pulled from the export, used to organise output folders.
    project_name: str | None = None   # ChatGPT "Project" / folder, if present
    gizmo_id: str | None = None       # custom-GPT id, if the chat used one

    @property
    def group(self) -> str:
        """Folder this conversation belongs in."""
        if self.project_name:
            return self.project_name
        if self.gizmo_id:
            return f"GPT {self.gizmo_id}"
        return "Ungrouped"


# ---------------------------------------------------------------------------
# Archive loading
# ---------------------------------------------------------------------------

def load_conversations_json(path: str) -> list[dict[str, Any]]:
    """Return the raw conversation dicts from a ``.zip``, a directory, or a
    direct ``conversations.json`` path."""
    if os.path.isdir(path):
        candidate = os.path.join(path, "conversations.json")
        if not os.path.isfile(candidate):
            raise FileNotFoundError(
                f"No conversations.json found in directory: {path}"
            )
        with open(candidate, "r", encoding="utf-8") as fh:
            return json.load(fh)

    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            name = _find_conversations_member(zf)
            with zf.open(name) as raw:
                return json.load(io.TextIOWrapper(raw, encoding="utf-8"))

    # Assume a direct JSON file.
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _find_conversations_member(zf: zipfile.ZipFile) -> str:
    for member in zf.namelist():
        if os.path.basename(member) == "conversations.json":
            return member
    raise FileNotFoundError("conversations.json not found inside the archive")


# ---------------------------------------------------------------------------
# Conversation parsing
# ---------------------------------------------------------------------------

# Keys that, when present on a conversation, have been observed to carry the
# Project / folder grouping. The export format is undocumented so we probe a
# few candidates and take the first that yields a usable name.
_PROJECT_NAME_KEYS = (
    "project_name",
    "folder_name",
)
_PROJECT_OBJECT_KEYS = (
    "project",
    "folder",
)


def parse_archive(path: str) -> list[Conversation]:
    raw = load_conversations_json(path)
    return [parse_conversation(c) for c in raw]


def parse_conversation(raw: dict[str, Any]) -> Conversation:
    conv_id = raw.get("conversation_id") or raw.get("id") or ""
    title = (raw.get("title") or "Untitled chat").strip() or "Untitled chat"

    messages = [
        m for m in _ordered_messages(raw) if m is not None
    ]

    return Conversation(
        conversation_id=conv_id,
        title=title,
        create_time=raw.get("create_time"),
        update_time=raw.get("update_time"),
        messages=messages,
        project_name=_extract_project_name(raw),
        gizmo_id=raw.get("gizmo_id"),
    )


def _extract_project_name(raw: dict[str, Any]) -> str | None:
    for key in _PROJECT_NAME_KEYS:
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    for key in _PROJECT_OBJECT_KEYS:
        obj = raw.get(key)
        if isinstance(obj, dict):
            for nk in ("name", "title"):
                val = obj.get(nk)
                if isinstance(val, str) and val.strip():
                    return val.strip()
    return None


def _ordered_messages(raw: dict[str, Any]) -> Iterable[Message | None]:
    """Yield the visible thread in chronological order.

    Preferred path: follow ``current_node`` parent pointers to the root, then
    reverse. Falls back to sorting all mapped messages by ``create_time`` if
    the tree structure is missing or broken.
    """
    mapping = raw.get("mapping")
    if not isinstance(mapping, dict) or not mapping:
        return []

    ordered_nodes = _walk_current_thread(mapping, raw.get("current_node"))
    if not ordered_nodes:
        ordered_nodes = _all_nodes_by_time(mapping)

    for node in ordered_nodes:
        msg = _node_to_message(node)
        if msg is not None:
            yield msg


def _walk_current_thread(mapping: dict[str, Any], current_node: Any) -> list[dict]:
    if not isinstance(current_node, str) or current_node not in mapping:
        return []
    chain: list[dict] = []
    seen: set[str] = set()
    node_id: Any = current_node
    while isinstance(node_id, str) and node_id in mapping and node_id not in seen:
        seen.add(node_id)
        node = mapping[node_id]
        chain.append(node)
        node_id = node.get("parent")
    chain.reverse()
    return chain


def _all_nodes_by_time(mapping: dict[str, Any]) -> list[dict]:
    nodes = [n for n in mapping.values() if isinstance(n, dict) and n.get("message")]
    nodes.sort(key=lambda n: (n.get("message") or {}).get("create_time") or 0.0)
    return nodes


def _node_to_message(node: dict[str, Any]) -> Message | None:
    message = node.get("message")
    if not isinstance(message, dict):
        return None

    metadata = message.get("metadata") or {}
    if metadata.get("is_visually_hidden_from_conversation"):
        return None

    author = message.get("author") or {}
    role = author.get("role") or "unknown"

    text = _render_content(message.get("content") or {})
    if not text.strip():
        # Skip empty turns (e.g. a tool call carrying only metadata).
        return None

    return Message(
        role=role,
        text=text,
        create_time=message.get("create_time"),
        author_name=author.get("name"),
    )


def _render_content(content: dict[str, Any]) -> str:
    """Convert a ChatGPT ``content`` object to plain text/markdown."""
    ctype = content.get("content_type")

    if ctype == "text":
        return "\n".join(_as_text_parts(content.get("parts")))

    if ctype == "code":
        lang = content.get("language") or ""
        code = content.get("text") or ""
        return f"```{lang}\n{code}\n```"

    if ctype == "execution_output":
        out = content.get("text") or ""
        return f"```\n{out}\n```"

    if ctype == "multimodal_text":
        return "\n".join(_render_multimodal_parts(content.get("parts")))

    if ctype in ("tether_quote", "tether_browsing_display"):
        return content.get("text") or content.get("result") or ""

    if ctype == "system_error":
        return f"[system error] {content.get('text', '')}"

    # Unknown type: salvage any obvious text-bearing fields.
    if isinstance(content.get("parts"), list):
        return "\n".join(_as_text_parts(content.get("parts")))
    if isinstance(content.get("text"), str):
        return content["text"]
    return ""


def _as_text_parts(parts: Any) -> list[str]:
    if not isinstance(parts, list):
        return []
    out: list[str] = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
        elif isinstance(p, dict):
            # Occasionally a structured part sneaks into a text array.
            txt = p.get("text")
            if isinstance(txt, str):
                out.append(txt)
    return out


def _render_multimodal_parts(parts: Any) -> list[str]:
    if not isinstance(parts, list):
        return []
    out: list[str] = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
        elif isinstance(p, dict):
            if p.get("content_type") == "image_asset_pointer" or "asset_pointer" in p:
                out.append("[image attachment]")
            elif isinstance(p.get("text"), str):
                out.append(p["text"])
    return out


# ---------------------------------------------------------------------------
# Helpers shared with rendering
# ---------------------------------------------------------------------------

def format_timestamp(ts: float | None) -> str:
    if not ts:
        return "unknown date"
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except (ValueError, OSError, OverflowError):
        return "unknown date"
