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
    spending_money_cents: int,
    due_before_payday_cents: int,
    budget_total_cents: int,
    budget_remaining_cents: int,
    set_aside_cents: int = 0,
    owed_on_cards_cents: int = 0,
    spent_outside_cents: int = 0,
) -> int:
    """Money that's safe to spend now, never negative.

    Start from the accounts the user spends from (chequing and cash, plus savings if they said
    so), then take out what's already spoken for: goal money set aside in those accounts, what's
    owed on credit cards (card purchases are money already spent), bills due before payday, and
    this period's spending paid from accounts outside their spending money (it's still spending,
    so it comes back out of spending money). Once any budget is set, it's also capped by what's
    left in it. A missing budget never means nothing is safe.
    """
    for value in (
        due_before_payday_cents,
        budget_total_cents,
        set_aside_cents,
        owed_on_cards_cents,
        spent_outside_cents,
    ):
        if value < 0:
            raise ValueError("amounts taken out of spending money must not be negative")
    after = (
        spending_money_cents
        - set_aside_cents
        - owed_on_cards_cents
        - due_before_payday_cents
        - spent_outside_cents
    )
    if budget_total_cents == 0:
        return max(0, after)
    return max(0, min(budget_remaining_cents, after))


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
