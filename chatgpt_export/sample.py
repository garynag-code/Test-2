"""A synthetic ChatGPT export used by ``--demo`` so the tool can be tried
without a real export or any Google credentials."""

from __future__ import annotations


def sample_conversations() -> list[dict]:
    """Return raw conversation dicts shaped like a real ``conversations.json``,
    including a Project chat, a custom-GPT chat, and an ungrouped chat."""
    return [
        {
            "title": "Rome itinerary",
            "create_time": 1700000000.0,
            "update_time": 1700000500.0,
            "conversation_id": "demo-1",
            "project_name": "Italy Trip",
            "current_node": "a2",
            "mapping": {
                "a0": {"id": "a0", "message": None, "parent": None, "children": ["a1"]},
                "a1": {
                    "id": "a1",
                    "message": {
                        "author": {"role": "user"},
                        "create_time": 1700000100.0,
                        "content": {"content_type": "text",
                                    "parts": ["Plan a 3-day trip to Rome."]},
                        "metadata": {},
                    },
                    "parent": "a0",
                    "children": ["a2"],
                },
                "a2": {
                    "id": "a2",
                    "message": {
                        "author": {"role": "assistant"},
                        "create_time": 1700000200.0,
                        "content": {"content_type": "text",
                                    "parts": ["Day 1: Colosseum and Forum. "
                                              "Day 2: Vatican. Day 3: Trastevere."]},
                        "metadata": {},
                    },
                    "parent": "a1",
                    "children": [],
                },
            },
        },
        {
            "title": "Budget spreadsheet formula",
            "create_time": 1700100000.0,
            "update_time": 1700100300.0,
            "conversation_id": "demo-2",
            "project_name": "Italy Trip",
            "current_node": "b2",
            "mapping": {
                "b0": {"id": "b0", "message": None, "parent": None, "children": ["b1"]},
                "b1": {
                    "id": "b1",
                    "message": {
                        "author": {"role": "user"},
                        "create_time": 1700100100.0,
                        "content": {"content_type": "text",
                                    "parts": ["Give me a Python snippet to sum a column."]},
                        "metadata": {},
                    },
                    "parent": "b0",
                    "children": ["b2"],
                },
                "b2": {
                    "id": "b2",
                    "message": {
                        "author": {"role": "assistant"},
                        "create_time": 1700100200.0,
                        "content": {"content_type": "code", "language": "python",
                                    "text": "total = sum(row['amount'] for row in rows)"},
                        "metadata": {},
                    },
                    "parent": "b1",
                    "children": [],
                },
            },
        },
        {
            "title": "Quick question about CSS",
            "create_time": 1700200000.0,
            "update_time": 1700200200.0,
            "conversation_id": "demo-3",
            "current_node": "c2",
            "mapping": {
                "c0": {"id": "c0", "message": None, "parent": None, "children": ["c1"]},
                "c1": {
                    "id": "c1",
                    "message": {
                        "author": {"role": "user"},
                        "create_time": 1700200100.0,
                        "content": {"content_type": "text",
                                    "parts": ["How do I centre a div?"]},
                        "metadata": {},
                    },
                    "parent": "c0",
                    "children": ["c2"],
                },
                "c2": {
                    "id": "c2",
                    "message": {
                        "author": {"role": "assistant"},
                        "create_time": 1700200150.0,
                        "content": {"content_type": "text",
                                    "parts": ["Use display:flex on the parent, then "
                                              "justify-content and align-items: center."]},
                        "metadata": {},
                    },
                    "parent": "c1",
                    "children": [],
                },
            },
        },
    ]
