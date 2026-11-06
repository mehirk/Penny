"""An iCalendar (.ics) file of money dates (bills, card payments, paydays) that a phone or
laptop calendar can add. One-way: Penny never reads the user's calendar. Nothing here reads a
database or calls a model.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

Reminder = Literal["none", "same_day", "day_before"]

# All-day events start at midnight, so these alert at 9 a.m. on the day, or the day before.
_TRIGGERS: dict[Reminder, str | None] = {
    "none": None,
    "same_day": "PT9H",
    "day_before": "-PT15H",
}
_LINE_OCTETS = 75


@dataclass(frozen=True, slots=True)
class CalendarEvent:
    # Stable for the same bill and date, so adding the file again updates rather than repeats.
    uid: str
    day: date
    title: str
    description: str


def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> list[str]:
    """Splits a content line into lines of at most 75 octets (RFC 5545 §3.1), never inside a
    character; continuation lines start with a space."""
    parts: list[str] = []
    current = ""
    limit = _LINE_OCTETS
    for char in line:
        if len((current + char).encode()) > limit:
            parts.append(current)
            current = " "
            limit = _LINE_OCTETS
        current += char
    parts.append(current)
    return parts


def calendar_file(
    events: Iterable[CalendarEvent],
    stamp: datetime,
    reminder: Reminder = "day_before",
    name: str = "Penny money dates",
) -> str:
    """The .ics text, with CRLF line endings. `stamp` is when the file was made (any timezone)."""
    if stamp.tzinfo is None:
        raise ValueError("stamp must have a timezone")
    stamped = stamp.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    trigger = _TRIGGERS[reminder]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Penny//Money dates//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(name)}",
    ]
    for event in sorted(events, key=lambda item: (item.day, item.title, item.uid)):
        lines += [
            "BEGIN:VEVENT",
            f"UID:{_escape(event.uid)}",
            f"DTSTAMP:{stamped}",
            f"DTSTART;VALUE=DATE:{event.day:%Y%m%d}",
            f"DTEND;VALUE=DATE:{event.day + timedelta(days=1):%Y%m%d}",
            f"SUMMARY:{_escape(event.title)}",
            f"DESCRIPTION:{_escape(event.description)}",
            "TRANSP:TRANSPARENT",
        ]
        if trigger:
            lines += [
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                f"DESCRIPTION:{_escape(event.title)}",
                f"TRIGGER:{trigger}",
                "END:VALARM",
            ]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "".join(f"{part}\r\n" for line in lines for part in _fold(line))
