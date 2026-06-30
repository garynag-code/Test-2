"""Render parsed conversations to Markdown and write them to disk, grouped by
ChatGPT Project / folder."""

from __future__ import annotations

import json
import os
import re
from collections import OrderedDict
from dataclasses import asdict
from datetime import datetime, timezone

from .parser import Conversation, format_timestamp


_ROLE_LABELS = {
    "user": "You",
    "assistant": "ChatGPT",
    "system": "System",
    "tool": "Tool",
}


def conversation_to_markdown(conv: Conversation) -> str:
    lines: list[str] = [f"# {conv.title}", ""]
    lines.append(f"- **Created:** {format_timestamp(conv.create_time)}")
    lines.append(f"- **Updated:** {format_timestamp(conv.update_time)}")
    if conv.project_name:
        lines.append(f"- **Project:** {conv.project_name}")
    if conv.gizmo_id:
        lines.append(f"- **Custom GPT:** {conv.gizmo_id}")
    lines.append(f"- **Conversation ID:** {conv.conversation_id}")
    lines.append("")
    lines.append("---")
    lines.append("")

    for msg in conv.messages:
        label = _ROLE_LABELS.get(msg.role, msg.role.capitalize())
        if msg.author_name and msg.role == "tool":
            label = f"{label} ({msg.author_name})"
        lines.append(f"## {label}")
        lines.append("")
        lines.append(msg.text.rstrip())
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _slug(text: str) -> str:
    """A GitHub-style anchor slug for in-document links."""
    s = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[\s_]+", "-", s)


def conversations_to_combined_markdown(
    conversations: list[Conversation],
    title: str = "ChatGPT export",
) -> str:
    """Render every conversation into a single Markdown document, grouped by
    Project, with a table of contents. This is the file you import into a
    Claude Project's knowledge (or attach in a chat)."""
    exported = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total_msgs = sum(len(c.messages) for c in conversations)

    # Group preserving first-seen order.
    grouped: "OrderedDict[str, list[Conversation]]" = OrderedDict()
    for conv in conversations:
        grouped.setdefault(conv.group, []).append(conv)

    out: list[str] = [
        f"# {title}",
        "",
        f"_{len(conversations)} conversations · {total_msgs} messages · "
        f"exported {exported}._",
        "",
        "## Contents",
        "",
    ]

    # Anchors must be unique even when chat titles repeat.
    seen_anchors: dict[str, int] = {}
    anchors: list[str] = []
    for conv in conversations:
        base = _slug(conv.title) or "chat"
        n = seen_anchors.get(base, 0)
        seen_anchors[base] = n + 1
        anchors_id = base if n == 0 else f"{base}-{n}"
        anchors.append(anchors_id)

    idx = 0
    for group, convs in grouped.items():
        out.append(f"- **{group}**")
        for conv in convs:
            out.append(f"  - [{conv.title}](#{anchors[idx]})")
            idx += 1
    out.append("")

    idx = 0
    for group, convs in grouped.items():
        out.append("\n---\n")
        out.append(f"# Project: {group}\n")
        for conv in convs:
            out.append(f'<a id="{anchors[idx]}"></a>')
            out.append(f"## {conv.title}")
            out.append("")
            meta = [
                f"Updated {format_timestamp(conv.update_time)}",
                f"created {format_timestamp(conv.create_time)}",
            ]
            if conv.gizmo_id:
                meta.append(f"custom GPT `{conv.gizmo_id}`")
            out.append(f"_{' · '.join(meta)}._")
            out.append("")
            for msg in conv.messages:
                label = _ROLE_LABELS.get(msg.role, msg.role.capitalize())
                if msg.author_name and msg.role == "tool":
                    label = f"{label} ({msg.author_name})"
                out.append(f"**{label}:**")
                out.append("")
                out.append(msg.text.rstrip())
                out.append("")
            idx += 1

    return "\n".join(out).rstrip() + "\n"


def safe_filename(name: str, max_len: int = 120) -> str:
    """Make a string safe to use as a file/folder name across platforms."""
    name = name.strip() or "untitled"
    # Replace path separators and characters illegal on Windows.
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = "untitled"
    if len(name) > max_len:
        name = name[:max_len].rstrip(" .")
    return name


def _unique_path(directory: str, base: str, ext: str) -> str:
    candidate = os.path.join(directory, f"{base}{ext}")
    if not os.path.exists(candidate):
        return candidate
    i = 2
    while True:
        candidate = os.path.join(directory, f"{base} ({i}){ext}")
        if not os.path.exists(candidate):
            return candidate
        i += 1


def write_local(
    conversations: list[Conversation],
    out_dir: str,
    write_json: bool = True,
) -> list[str]:
    """Write each conversation as ``<out_dir>/<group>/<title>.md`` (and ``.json``).

    Returns the list of Markdown file paths written.
    """
    written: list[str] = []
    for conv in conversations:
        group_dir = os.path.join(out_dir, safe_filename(conv.group))
        os.makedirs(group_dir, exist_ok=True)

        base = safe_filename(conv.title)
        md_path = _unique_path(group_dir, base, ".md")
        with open(md_path, "w", encoding="utf-8") as fh:
            fh.write(conversation_to_markdown(conv))
        written.append(md_path)

        if write_json:
            json_path = md_path[:-3] + ".json"
            with open(json_path, "w", encoding="utf-8") as fh:
                json.dump(_conversation_to_dict(conv), fh, ensure_ascii=False, indent=2)

    return written


def _conversation_to_dict(conv: Conversation) -> dict:
    data = asdict(conv)
    data["group"] = conv.group
    return data
