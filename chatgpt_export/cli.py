"""Command-line interface: parse a ChatGPT export and render it to files you can
import into Claude (a single combined Markdown file, plus per-chat files)."""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

from . import __version__
from .parser import parse_archive, parse_conversation
from .render import conversations_to_combined_markdown, write_local
from .sample import sample_conversations


COMBINED_NAME = "chatgpt-chats-for-claude.md"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="chatgpt-export",
        description=(
            "Extract ChatGPT conversations (including Project chats) from an "
            "official data-export .zip and render them for import into Claude."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "archive",
        nargs="?",
        help="Path to the ChatGPT export .zip, its extracted folder, or "
        "conversations.json directly.",
    )
    p.add_argument(
        "--demo",
        action="store_true",
        help="Run on built-in sample data (no real export needed) to see how "
        "the output looks.",
    )
    p.add_argument(
        "-o",
        "--out-dir",
        default="chatgpt_export_output",
        help="Directory for the rendered files.",
    )
    p.add_argument(
        "--no-json",
        action="store_true",
        help="Skip the per-chat .json sidecar files.",
    )
    p.add_argument(
        "--no-split",
        action="store_true",
        help="Write only the single combined file, not per-chat files.",
    )
    p.add_argument(
        "--no-combined",
        action="store_true",
        help="Skip the single combined-Markdown file.",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.demo:
        print("Running in demo mode with built-in sample data.")
        conversations = [parse_conversation(c) for c in sample_conversations()]
    elif not args.archive:
        print(
            "error: provide an export path, or use --demo to try sample data.",
            file=sys.stderr,
        )
        return 2
    else:
        print(f"Parsing export: {args.archive}")
        try:
            conversations = parse_archive(args.archive)
        except FileNotFoundError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

    if not conversations:
        print("No conversations found in the export.", file=sys.stderr)
        return 1

    total_msgs = sum(len(c.messages) for c in conversations)
    groups = Counter(c.group for c in conversations)
    print(
        f"Found {len(conversations)} conversations "
        f"({total_msgs} messages) across {len(groups)} group(s):"
    )
    for name, count in groups.most_common():
        print(f"  - {name}: {count} chat(s)")

    os.makedirs(args.out_dir, exist_ok=True)
    print(f"\nWriting to: {args.out_dir}")

    if not args.no_combined:
        combined_path = os.path.join(args.out_dir, COMBINED_NAME)
        with open(combined_path, "w", encoding="utf-8") as fh:
            fh.write(conversations_to_combined_markdown(conversations))
        print(f"  combined file (import this into Claude): {combined_path}")

    if not args.no_split:
        written = write_local(
            conversations, args.out_dir, write_json=not args.no_json
        )
        print(f"  per-chat Markdown files: {len(written)}")

    print("\nDone. Import the combined .md into a Claude Project's knowledge.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
