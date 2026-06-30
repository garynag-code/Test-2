"""Command-line interface tying together parsing, local rendering, and the
optional Google Drive upload."""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from . import __version__
from .parser import parse_archive, parse_conversation
from .render import write_local
from .sample import sample_conversations


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="chatgpt-export",
        description=(
            "Extract ChatGPT conversations (including Project chats) from an "
            "official data-export .zip and import them into Google Drive."
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
        help="Run on built-in sample data (no real export or credentials "
        "needed) to see how the output looks.",
    )
    p.add_argument(
        "-o",
        "--out-dir",
        default="chatgpt_export_output",
        help="Local directory for rendered Markdown/JSON.",
    )
    p.add_argument(
        "--no-json",
        action="store_true",
        help="Write only Markdown locally, skip the per-chat JSON.",
    )
    p.add_argument(
        "--no-local",
        action="store_true",
        help="Skip writing local files (only meaningful with --upload-drive).",
    )

    g = p.add_argument_group("Google Drive")
    g.add_argument(
        "--upload-drive",
        action="store_true",
        help="Upload the rendered chats to Google Drive.",
    )
    g.add_argument(
        "--client-secrets",
        help="OAuth Desktop-app client_secrets.json (first run only; a token "
        "is cached afterwards). Not needed in service-account mode.",
    )
    g.add_argument(
        "--token",
        default="token.json",
        help="Where to cache/read the OAuth token.",
    )
    g.add_argument(
        "--drive-folder",
        default="ChatGPT Export",
        help="Name of the root Drive folder to create/use.",
    )
    g.add_argument(
        "--drive-parent",
        help="Id of an existing Drive folder (or Shared Drive) to nest the "
        "root folder under. Defaults to My Drive root.",
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

    if not args.no_local:
        print(f"\nWriting local files to: {args.out_dir}")
        written = write_local(
            conversations, args.out_dir, write_json=not args.no_json
        )
        print(f"Wrote {len(written)} Markdown file(s).")

    if args.upload_drive:
        # Imported here so the local path has no hard dependency on the
        # Google client libraries.
        from .drive import build_service, upload_conversations

        print("\nAuthenticating with Google Drive...")
        service = build_service(
            client_secrets=args.client_secrets, token_path=args.token
        )
        print(f"Uploading to Drive folder: {args.drive_folder}")
        results = upload_conversations(
            conversations,
            service,
            root_folder_name=args.drive_folder,
            parent_id=args.drive_parent,
        )
        print(f"Uploaded {len(results)} conversation(s) to Google Drive.")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
