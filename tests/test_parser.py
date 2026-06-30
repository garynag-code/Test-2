"""Tests for the parser + renderer using a synthetic export, exercised against
the documented conversations.json shape (mapping tree, branches, content
types, and Project grouping)."""

import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chatgpt_export.parser import parse_archive  # noqa: E402
from chatgpt_export.render import (  # noqa: E402
    conversation_to_markdown,
    conversations_to_combined_markdown,
    safe_filename,
)


def _make_conversation():
    # Mapping tree: root -> system(hidden) -> user -> assistant
    #                                       \-> user(edited, abandoned branch)
    return {
        "title": "Trip planning",
        "create_time": 1700000000.0,
        "update_time": 1700000500.0,
        "conversation_id": "abc-123",
        "project_name": "Travel",
        "current_node": "n3",
        "mapping": {
            "root": {"id": "root", "message": None, "parent": None, "children": ["n0"]},
            "n0": {
                "id": "n0",
                "message": {
                    "id": "n0",
                    "author": {"role": "system"},
                    "create_time": 1700000000.0,
                    "content": {"content_type": "text", "parts": ["hidden prompt"]},
                    "metadata": {"is_visually_hidden_from_conversation": True},
                },
                "parent": "root",
                "children": ["n1", "n_abandoned"],
            },
            "n1": {
                "id": "n1",
                "message": {
                    "id": "n1",
                    "author": {"role": "user"},
                    "create_time": 1700000100.0,
                    "content": {"content_type": "text", "parts": ["Plan a trip to Rome"]},
                    "metadata": {},
                },
                "parent": "n0",
                "children": ["n2"],
            },
            "n_abandoned": {
                "id": "n_abandoned",
                "message": {
                    "id": "n_abandoned",
                    "author": {"role": "user"},
                    "create_time": 1700000110.0,
                    "content": {"content_type": "text", "parts": ["IGNORED BRANCH"]},
                    "metadata": {},
                },
                "parent": "n0",
                "children": [],
            },
            "n2": {
                "id": "n2",
                "message": {
                    "id": "n2",
                    "author": {"role": "assistant"},
                    "create_time": 1700000200.0,
                    "content": {
                        "content_type": "code",
                        "language": "python",
                        "text": "print('ciao')",
                    },
                    "metadata": {},
                },
                "parent": "n1",
                "children": ["n3"],
            },
            "n3": {
                "id": "n3",
                "message": {
                    "id": "n3",
                    "author": {"role": "assistant"},
                    "create_time": 1700000300.0,
                    "content": {"content_type": "text", "parts": ["Here is your plan."]},
                    "metadata": {},
                },
                "parent": "n2",
                "children": [],
            },
        },
    }


def _write_zip(tmp_path, data):
    zpath = os.path.join(tmp_path, "export.zip")
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("conversations.json", json.dumps(data))
    return zpath


def test_parse_from_zip(tmp_path):
    zpath = _write_zip(tmp_path, [_make_conversation()])
    convs = parse_archive(zpath)
    assert len(convs) == 1
    conv = convs[0]

    # Project grouping picked up.
    assert conv.project_name == "Travel"
    assert conv.group == "Travel"

    texts = [m.text for m in conv.messages]
    roles = [m.role for m in conv.messages]

    # Hidden system message dropped; abandoned branch excluded; order preserved.
    assert roles == ["user", "assistant", "assistant"]
    assert "IGNORED BRANCH" not in "".join(texts)
    assert "hidden prompt" not in "".join(texts)
    assert texts[0] == "Plan a trip to Rome"
    assert "```python" in texts[1]
    assert texts[2] == "Here is your plan."


def test_markdown_render(tmp_path):
    zpath = _write_zip(tmp_path, [_make_conversation()])
    conv = parse_archive(zpath)[0]
    md = conversation_to_markdown(conv)
    assert md.startswith("# Trip planning")
    assert "**Project:** Travel" in md
    assert "## You" in md
    assert "## ChatGPT" in md
    assert "```python" in md


def test_safe_filename():
    assert safe_filename('a/b:c*?"<>|') != ""
    assert "/" not in safe_filename("a/b")
    assert safe_filename("   ") == "untitled"


def test_combined_markdown(tmp_path):
    zpath = _write_zip(tmp_path, [_make_conversation()])
    convs = parse_archive(zpath)
    md = conversations_to_combined_markdown(convs)
    # Header, table of contents, grouped section, and a linkable anchor.
    assert md.startswith("# ChatGPT export")
    assert "## Contents" in md
    assert "# Project: Travel" in md
    assert "(#trip-planning)" in md
    assert '<a id="trip-planning"></a>' in md
    assert "Here is your plan." in md
    assert "IGNORED BRANCH" not in md


def test_ungrouped_when_no_project(tmp_path):
    raw = _make_conversation()
    del raw["project_name"]
    zpath = _write_zip(tmp_path, [raw])
    conv = parse_archive(zpath)[0]
    assert conv.group == "Ungrouped"
