"""How long "Safe to spend" has to last, and what that means per day.

Safe to spend itself is computed by the dashboard: the smaller of the budget left and cash after
bills due before payday. This turns it into the days it has to cover (through the day before the
next payday, or the end of the month when there's no pay schedule), a daily amount, and a status:

- empty: nothing is safe to spend;
- tight: the daily amount is under half the usual daily flexible allowance;
- on_track: otherwise.

Integer cents only. Nothing here reads a database or calls a model.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Status = Literal["on_track", "tight", "empty"]
TIGHT_BASIS_POINTS = 5_000


def safe_to_spend_cents(
    spendable_cents: int,
    due_before_payday_cents: int,
    budget_total_cents: int,
    budget_remaining_cents: int,
) -> int:
    """Money that's safe to spend now: spendable cash after the bills due before payday, and,
    once any budget is set, no more than what's left in it. Never negative. Without a budget,
    the cash after bills alone decides (a missing budget doesn't mean nothing is safe)."""
    if due_before_payday_cents < 0 or budget_total_cents < 0:
        raise ValueError("due_before_payday_cents and budget_total_cents must not be negative")
    after_bills = spendable_cents - due_before_payday_cents
    if budget_total_cents == 0:
        return max(0, after_bills)
    return max(0, min(budget_remaining_cents, after_bills))


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
    if safe_cents < 0:
        raise ValueError("safe_cents must not be negative")
    if daily_allowance_cents < 0:
        raise ValueError("daily_allowance_cents must not be negative")
    if month_end < today:
        raise ValueError("month_end must not be before today")
    until_payday = next_payday is not None and next_payday > today
    until = next_payday - timedelta(days=1) if next_payday and until_payday else month_end
    days_left = (until - today).days + 1
    per_day = safe_cents // days_left
    if safe_cents == 0:
        status: Status = "empty"
    elif per_day * 10_000 < daily_allowance_cents * TIGHT_BASIS_POINTS:
        status = "tight"
    else:
        status = "on_track"
    return Runway(until, until_payday, days_left, per_day, status)
