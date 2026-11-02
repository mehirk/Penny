"""Words and dates shared by the plain-language readers (quick add and search)."""

import calendar
from datetime import date

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {name.lower(): index for index, name in enumerate(calendar.month_name) if name}
MONTHS.update({name.lower(): index for index, name in enumerate(calendar.month_abbr) if name})
# Words that never belong in a description or a search term.
FILLER = {
    "i",
    "spent",
    "paid",
    "pay",
    "bought",
    "buy",
    "on",
    "for",
    "a",
    "an",
    "the",
    "at",
    "from",
    "to",
    "my",
    "got",
    "today",
    "yesterday",
    "last",
    "this",
    "of",
    "and",
    "with",
    # Currency and schedule words never belong in a description.
    "cad",
    "usd",
    "dollars",
    "dollar",
    "bucks",
    "every",
    "each",
    "per",
    "other",
    "monthly",
    "weekly",
    "biweekly",
    "fortnightly",
    "yearly",
    "annually",
    "annual",
    "month",
    "months",
    "week",
    "weeks",
    "year",
    "years",
    "recurring",
    "repeats",
    "mo",
    "yr",
    "wk",
}


def shift_month(day: date, months: int, anchor: int) -> date:
    """`months` months from `day`, on day `anchor` (or the month's last day if shorter)."""
    index = day.year * 12 + day.month - 1 + months
    year, month = index // 12, index % 12 + 1
    return date(year, month, min(anchor, calendar.monthrange(year, month)[1]))
