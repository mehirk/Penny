"""How long "Safe to spend" has to last, and what that means per day.

Safe to spend is the user's spending money minus what's already spoken for (see
`safe_to_spend_cents`). This turns it into the days it has to cover (through the day before the
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


@dataclass(frozen=True, slots=True)
class SafeToSpend:
    """Every step of the Safe to spend sum, so the app can show its working."""

    spending_money_cents: int
    set_aside_cents: int
    owed_on_cards_cents: int
    unpaid_bills_cents: int
    spent_outside_cents: int
    safe_cents: int
    # How far what's spoken for goes past the spending money (0 when it all fits).
    short_cents: int


def safe_to_spend(
    spending_money_cents: int,
    unpaid_bills_cents: int,
    set_aside_cents: int = 0,
    owed_on_cards_cents: int = 0,
    spent_outside_cents: int = 0,
) -> SafeToSpend:
    """Money that's safe to spend now, never negative, with each step of the sum.

    Start from the accounts the user spends from (chequing and cash, plus savings if they said
    so), then take out what's already spoken for: goal money set aside in those accounts, what's
    owed on credit cards (card purchases are money already spent), recurring bills not yet
    paid (a paid bill is already out of the balance, so it's never taken out twice), and
    this period's spending paid from accounts outside their spending money (it's still spending,
    so it comes back out of spending money).

    Budgets don't cap it. A bill that's already been paid is already out of the balance, so
    capping by "budget left" would count it twice (a $100 rent paid from $500 left $0 instead of
    $400). Budgets stay a separate guide.
    """
    for value in (
        unpaid_bills_cents,
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
        - unpaid_bills_cents
        - spent_outside_cents
    )
    return SafeToSpend(
        spending_money_cents=spending_money_cents,
        set_aside_cents=set_aside_cents,
        owed_on_cards_cents=owed_on_cards_cents,
        unpaid_bills_cents=unpaid_bills_cents,
        spent_outside_cents=spent_outside_cents,
        safe_cents=max(0, after),
        short_cents=max(0, -after),
    )


def safe_to_spend_cents(
    spending_money_cents: int,
    unpaid_bills_cents: int,
    set_aside_cents: int = 0,
    owed_on_cards_cents: int = 0,
    spent_outside_cents: int = 0,
) -> int:
    return safe_to_spend(
        spending_money_cents,
        unpaid_bills_cents,
        set_aside_cents,
        owed_on_cards_cents,
        spent_outside_cents,
    ).safe_cents


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
