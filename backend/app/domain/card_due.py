"""When a credit card's payment is next due, from the day of the month it's due.

A due day past the end of a short month falls on that month's last day (31 → Feb 28). The
payment due today counts as next. Nothing here reads a database or calls a model.
"""

import calendar
from datetime import date


def _on_day(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_card_due(today: date, due_day: int) -> date:
    if not 1 <= due_day <= 31:
        raise ValueError("due_day must be between 1 and 31")
    this_month = _on_day(today.year, today.month, due_day)
    if this_month >= today:
        return this_month
    year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return _on_day(year, month, due_day)
