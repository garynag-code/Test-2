"""A small RFC 5545 reader and writer — the free tier's entire connectivity.

iCal is what makes a zero-cost launch possible: Airbnb, Vrbo, Booking.com and
almost every regional OTA will publish a calendar feed and subscribe to one
without any partnership, certification or fee.  The trade is latency — the far
side may only re-read us every few hours — which is why ``bnb.sync`` treats
iCal channels as untrusted and closes inventory it cannot confirm.

Only the subset accommodation feeds actually use is implemented: VEVENT with
all-day DTSTART/DTEND, UID, SUMMARY and DESCRIPTION.  No recurrence, no
timezone components, no alarms.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime

from .dates import fmt, parse_date

PRODID = "-//Perch//Booking Manager 1.0//EN"

# Phrases the OTAs use for "this is a block, not a guest".  Airbnb exports
# owner blocks as "Airbnb (Not available)"; Booking.com uses "CLOSED".
_BLOCK_WORDS = (
    "not available", "unavailable", "blocked", "block", "closed",
    "no disponible", "nicht verfügbar", "indisponible", "non disponibile",
)


@dataclass
class Event:
    uid: str
    start: date            # first occupied night
    end: date              # exclusive — the departure day
    summary: str = ""
    description: str = ""

    @property
    def is_block(self) -> bool:
        text = f"{self.summary} {self.description}".lower()
        return any(word in text for word in _BLOCK_WORDS)

    @property
    def guest_name(self) -> str | None:
        if self.is_block:
            return None
        # Airbnb puts the guest's first name in the summary as
        # "Jane (HMAB3CDEF4)"; Booking.com uses "Jane Doe".
        cleaned = re.sub(r"\s*\([^)]*\)\s*$", "", self.summary).strip()
        return cleaned or None


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

def unfold(text: str) -> list[str]:
    """Undo RFC 5545 line folding (a leading space or tab continues a line)."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _unescape(value: str) -> str:
    out, index = [], 0
    while index < len(value):
        char = value[index]
        if char == "\\" and index + 1 < len(value):
            nxt = value[index + 1]
            out.append({"n": "\n", "N": "\n", ",": ",", ";": ";", "\\": "\\"}.get(nxt, nxt))
            index += 2
        else:
            out.append(char)
            index += 1
    return "".join(out)


def _split_line(line: str) -> tuple[str, dict[str, str], str]:
    head, _, value = line.partition(":")
    parts = head.split(";")
    name = parts[0].strip().upper()
    params = {}
    for param in parts[1:]:
        key, _, val = param.partition("=")
        params[key.strip().upper()] = val.strip().strip('"')
    return name, params, value


def _parse_stamp(value: str) -> date | None:
    value = value.strip()
    for pattern in ("%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S", "%Y%m%d"):
        try:
            return datetime.strptime(value, pattern).date()
        except ValueError:
            continue
    try:                                   # a few feeds emit ISO dates
        return parse_date(value[:10])
    except (ValueError, TypeError):
        return None


def parse(text: str) -> list[Event]:
    """Read every VEVENT in a feed.  Unparseable events are skipped, not fatal.

    One malformed event in a channel's feed must never take the whole import
    down — that would strand every other reservation in the same file.
    """
    events: list[Event] = []
    current: dict | None = None

    for line in unfold(text):
        stripped = line.strip()
        if stripped == "BEGIN:VEVENT":
            current = {}
            continue
        if stripped == "END:VEVENT":
            if current and current.get("start") and current.get("end"):
                start, end = current["start"], current["end"]
                if end > start:
                    events.append(Event(
                        uid=current.get("uid") or _fallback_uid(current),
                        start=start,
                        end=end,
                        summary=current.get("summary", ""),
                        description=current.get("description", ""),
                    ))
            current = None
            continue
        if current is None or not stripped:
            continue

        name, _params, value = _split_line(stripped)
        if name == "UID":
            current["uid"] = _unescape(value).strip()
        elif name == "DTSTART":
            current["start"] = _parse_stamp(value)
        elif name == "DTEND":
            current["end"] = _parse_stamp(value)
        elif name == "SUMMARY":
            current["summary"] = _unescape(value).strip()
        elif name == "DESCRIPTION":
            current["description"] = _unescape(value).strip()

    return events


def _fallback_uid(fields: dict) -> str:
    """Some feeds omit UID.  Derive a stable one so re-imports still match."""
    seed = f"{fields.get('start')}|{fields.get('end')}|{fields.get('summary', '')}"
    return "perch-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:20]


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------

def _escape(value: str) -> str:
    return (value.replace("\\", "\\\\").replace(";", r"\;")
                 .replace(",", r"\,").replace("\n", r"\n"))


def fold(line: str) -> str:
    """Wrap at 75 octets, continuing with a leading space, per RFC 5545."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    chunks, start = [], 0
    while start < len(raw):
        end = min(start + (75 if not chunks else 74), len(raw))
        # Back up out of the middle of a multi-byte character: if the byte we
        # would start the *next* chunk with is a continuation byte, the split
        # falls inside a sequence.  Arabic, Greek and CJK names hit this
        # constantly; a 7-bit test suite never sees it.
        while start < end < len(raw) and (raw[end] & 0xC0) == 0x80:
            end -= 1
        chunks.append(raw[start:end].decode("utf-8"))
        start = end
    return ("\r\n ").join(chunks)


def _stamp(moment: datetime | None = None) -> str:
    from .dates import utc_now
    return (moment or utc_now()).strftime("%Y%m%dT%H%M%SZ")


def write(events: list[Event], *, name: str = "Perch", now: datetime | None = None) -> str:
    """Render a feed.  Every event is all-day: a stay is dates, not instants."""
    stamp = _stamp(now)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(name)}",
    ]
    for event in events:
        lines += [
            "BEGIN:VEVENT",
            f"UID:{event.uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{fmt(event.start).replace('-', '')}",
            f"DTEND;VALUE=DATE:{fmt(event.end).replace('-', '')}",
            f"SUMMARY:{_escape(event.summary)}",
        ]
        if event.description:
            lines.append(f"DESCRIPTION:{_escape(event.description)}")
        lines += ["TRANSP:OPAQUE", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
