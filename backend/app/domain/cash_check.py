"""Can each account cover the bills due from it in the next few days?

Safe to spend follows the budget, not balances, so this is a separate heads-up: rent of $611 due
from a chequing account holding $0 is a problem even when the budget is fine. For each account
whose balance is less than its unpaid bills, it reports the shortfall and, when one has enough,
another account to move money from (savings first, then the one with the most). Credit cards
are left out: a bill charged to a card adds to what's owed rather than needing cash.

Only bills due within 3 days (or overdue) count, so the warning shows up when it's time to act.

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

# Warn only this close to a due date (overdue ones too); earlier, there's still time.
HEADS_UP_DAYS = 3


def due_soon(due_on: date, today: date) -> bool:
    """True from 3 days before a due date onward (overdue included)."""
    return due_on <= today + timedelta(days=HEADS_UP_DAYS)


@dataclass(frozen=True, slots=True)
class Cash:
    account_id: str
    account_type: str
    balance_cents: int


@dataclass(frozen=True, slots=True)
class Due:
    account_id: str
    cents: int


@dataclass(frozen=True, slots=True)
class Shortfall:
    account_id: str
    due_cents: int
    balance_cents: int
    short_cents: int
    cover_from: str | None  # an account with enough to move from, if any


def shortfalls(accounts: Sequence[Cash], dues: Sequence[Due]) -> list[Shortfall]:
    if any(due.cents < 0 for due in dues):
        raise ValueError("amounts due must not be negative")
    owed: dict[str, int] = {}
    for due in dues:
        owed[due.account_id] = owed.get(due.account_id, 0) + due.cents
    cash = [a for a in accounts if a.account_type != "credit"]
    result = []
    for account in cash:
        due = owed.get(account.account_id, 0)
        short = due - max(0, account.balance_cents)
        if due <= 0 or short <= 0:
            continue
        sources = sorted(
            (
                other
                for other in cash
                if other.account_id != account.account_id
                and other.balance_cents - owed.get(other.account_id, 0) >= short
            ),
            key=lambda other: (other.account_type != "savings", -other.balance_cents),
        )
        result.append(
            Shortfall(
                account_id=account.account_id,
                due_cents=due,
                balance_cents=account.balance_cents,
                short_cents=short,
                cover_from=sources[0].account_id if sources else None,
            )
        )
    return sorted(result, key=lambda item: -item.short_cents)
