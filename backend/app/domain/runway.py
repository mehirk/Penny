"""Safe to spend, and how long it has to last.

Safe to spend is the month's budget minus what's been spent this month, minus bills still to be
paid this month (their budget room is already spoken for). Account balances don't change it: the
budget is the plan. It goes negative once spending passes the budget, so people can see by how
much they're over.

The runway spreads it over the days left in the month as a daily amount, with a status:

- over: spending has passed the budget (Safe to spend is below zero);
- empty: exactly nothing left;
- tight: the daily amount is under half the usual daily flexible allowance;
- on_track: otherwise.

Integer cents only. Nothing here reads a database or calls a model.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Status = Literal["on_track", "tight", "empty", "over"]
TIGHT_BASIS_POINTS = 5_000


@dataclass(frozen=True, slots=True)
class SafeToSpend:
    """Every step of the Safe to spend sum, so the app can show its working."""

    budget_cents: int
    spent_cents: int
    unpaid_bills_cents: int
    safe_cents: int  # negative when over budget
    over_cents: int  # how far over budget (0 when not)


def safe_to_spend(budget_cents: int, spent_cents: int, unpaid_bills_cents: int) -> SafeToSpend:
    """Budget − spent this month − bills still due this month. May be negative.

    A paid bill is part of what's spent, and an unpaid one is held back, so each bill counts once.
    """
    for value in (budget_cents, spent_cents, unpaid_bills_cents):
        if value < 0:
            raise ValueError("amounts must not be negative")
    safe = budget_cents - spent_cents - unpaid_bills_cents
    return SafeToSpend(
        budget_cents=budget_cents,
        spent_cents=spent_cents,
        unpaid_bills_cents=unpaid_bills_cents,
        safe_cents=safe,
        over_cents=max(0, -safe),
    )


@dataclass(frozen=True, slots=True)
class Runway:
    until: date
    until_payday: bool
    days_left: int
    per_day_cents: int
    status: Status


def runway(
    safe_cents: int,
    today: date,
    next_payday: date | None,
    month_end: date,
    daily_allowance_cents: int,
) -> Runway:
    if daily_allowance_cents < 0:
        raise ValueError("daily_allowance_cents must not be negative")
    if month_end < today:
        raise ValueError("month_end must not be before today")
    until_payday = next_payday is not None and next_payday > today
    until = next_payday - timedelta(days=1) if next_payday and until_payday else month_end
    days_left = (until - today).days + 1
    per_day = max(0, safe_cents) // days_left
    if safe_cents < 0:
        status: Status = "over"
    elif safe_cents == 0:
        status = "empty"
    elif per_day * 10_000 < daily_allowance_cents * TIGHT_BASIS_POINTS:
        status = "tight"
    else:
        status = "on_track"
    return Runway(until, until_payday, days_left, per_day, status)
