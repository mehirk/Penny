"""When a credit card's payment is next due, from the day of the month it's due.

A due day past the end of a short month falls on that month's last day (31 → Feb 28). The
payment due today counts as next. Once a payment is made for a cycle, the next one shows.
Nothing here reads a database or calls a model.
"""

import calendar
from collections.abc import Iterable
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


def _shift(due: date, months: int, due_day: int) -> date:
    index = due.year * 12 + due.month - 1 + months
    return _on_day(index // 12, index % 12 + 1, due_day)


def card_cycle(today: date, due_day: int, payments: Iterable[date]) -> tuple[date, date | None]:
    """The due date to show, and the latest payment that paid the current cycle (or None).

    A payment made after the previous due date (and by today) pays the one coming up, so the
    card moves on to the following month's due date: paid on Oct 30 for Nov 2, it shows Dec 2.
    """
    due = next_card_due(today, due_day)
    previous = _shift(due, -1, due_day)
    paid = max((day for day in payments if previous < day <= today), default=None)
    return (_shift(due, 1, due_day), paid) if paid else (due, None)
