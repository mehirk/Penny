"""Month-by-month figures for the Charts tab, filtered by account and category.

Each month gets money in, money out, what was kept (in minus out), needs and wants, and
spending per top-level category. Range totals add those months up; per-account totals show
where money moved. Filters keep only the transactions that match every one given: an empty
filter keeps everything.

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

Kind = Literal["income", "spending"]


@dataclass(frozen=True, slots=True)
class ChartTransaction:
    occurred_on: date
    amount_cents: int
    kind: Kind
    account_id: str
    category_id: str | None  # top-level (subcategories already rolled up)
    necessity: Literal["need", "want"] | None = None


@dataclass(frozen=True, slots=True)
class Filters:
    account_ids: frozenset[str] = frozenset()
    # Top-level category ids; "uncategorized" matches transactions without a category.
    category_ids: frozenset[str] = frozenset()

    def keeps(self, item: ChartTransaction) -> bool:
        if self.account_ids and item.account_id not in self.account_ids:
            return False
        if self.category_ids:
            key = item.category_id or "uncategorized"
            if key not in self.category_ids:
                return False
        return True


@dataclass(slots=True)
class MonthTotals:
    month: date
    income_cents: int = 0
    spending_cents: int = 0
    needs_cents: int = 0
    wants_cents: int = 0
    by_category: dict[str | None, int] = field(default_factory=dict)

    @property
    def net_cents(self) -> int:
        return self.income_cents - self.spending_cents


@dataclass(frozen=True, slots=True)
class AccountTotals:
    account_id: str
    income_cents: int
    spending_cents: int


@dataclass(frozen=True, slots=True)
class Series:
    months: tuple[MonthTotals, ...]
    accounts: tuple[AccountTotals, ...]
    # Spending per top-level category over the whole range, largest first (ties by id).
    categories: tuple[tuple[str | None, int], ...]

    @property
    def income_cents(self) -> int:
        return sum(item.income_cents for item in self.months)

    @property
    def spending_cents(self) -> int:
        return sum(item.spending_cents for item in self.months)

    @property
    def average_spending_cents(self) -> int:
        """Average monthly spending over the months that had any activity (floored)."""
        active = [m for m in self.months if m.income_cents or m.spending_cents]
        return self.spending_cents // len(active) if active else 0


def _month(day: date) -> date:
    return day.replace(day=1)


def build_series(
    transactions: Iterable[ChartTransaction], months: Sequence[date], filters: Filters
) -> Series:
    if any(month.day != 1 for month in months):
        raise ValueError("months must be first days of months")
    if list(months) != sorted(set(months)):
        raise ValueError("months must be unique and in order")
    rows = {month: MonthTotals(month) for month in months}
    accounts: dict[str, list[int]] = {}
    categories: dict[str | None, int] = {}
    for item in transactions:
        if item.amount_cents < 0:
            raise ValueError("amounts must not be negative")
        row = rows.get(_month(item.occurred_on))
        if row is None or not filters.keeps(item):
            continue
        account = accounts.setdefault(item.account_id, [0, 0])
        if item.kind == "income":
            row.income_cents += item.amount_cents
            account[0] += item.amount_cents
            continue
        row.spending_cents += item.amount_cents
        account[1] += item.amount_cents
        if item.necessity == "need":
            row.needs_cents += item.amount_cents
        elif item.necessity == "want":
            row.wants_cents += item.amount_cents
        row.by_category[item.category_id] = (
            row.by_category.get(item.category_id, 0) + item.amount_cents
        )
        categories[item.category_id] = categories.get(item.category_id, 0) + item.amount_cents
    return Series(
        months=tuple(rows[month] for month in months),
        accounts=tuple(
            AccountTotals(account_id, income, spending)
            for account_id, (income, spending) in sorted(accounts.items())
        ),
        categories=tuple(sorted(categories.items(), key=lambda pair: (-pair[1], pair[0] or "~"))),
    )
