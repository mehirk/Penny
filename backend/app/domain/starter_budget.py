"""A starting monthly budget from a new user's onboarding answers.

- Fixed costs (scheduled bills) get exactly what they need each month; they're locked.
- Savings take the chosen share of monthly income, but never more than is left after fixed costs.
- Everyday categories get what the user expects to spend. If that doesn't fit in what's left,
  each is scaled down by the same share and rounded down to the nearest $5.
- Whatever isn't assigned stays as a buffer.

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Status = Literal["fits", "trimmed", "short"]
ROUND_CENTS = 500
MAX_SAVINGS_BASIS_POINTS = 5_000

_PER_YEAR = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12}


def monthly_income_cents(
    amount_cents: int, frequency: str, interval_days: int | None = None
) -> int:
    """Average take-home pay per month, floored to the cent."""
    if amount_cents < 0:
        raise ValueError("amount_cents must not be negative")
    if frequency == "custom":
        if not interval_days or interval_days <= 0:
            raise ValueError("custom pay needs interval_days")
        return amount_cents * 365 // interval_days // 12
    if frequency not in _PER_YEAR:
        raise ValueError(f"unknown frequency {frequency!r}")
    return amount_cents * _PER_YEAR[frequency] // 12


@dataclass(frozen=True, slots=True)
class PlanLine:
    category_id: str
    fixed_cents: int  # locked: what this category's bills need each month
    flexible_cents: int  # everyday spending assigned here
    requested_cents: int  # what the user expected to spend day to day

    @property
    def limit_cents(self) -> int:
        return self.fixed_cents + self.flexible_cents


@dataclass(frozen=True, slots=True)
class StarterPlan:
    income_cents: int
    fixed_cents: int
    savings_cents: int
    flexible_cents: int
    buffer_cents: int
    status: Status
    lines: tuple[PlanLine, ...]


def starter_plan(
    income_cents: int,
    fixed_by_category: Mapping[str, int],
    everyday_by_category: Mapping[str, int],
    savings_basis_points: int,
) -> StarterPlan:
    if income_cents < 0:
        raise ValueError("income_cents must not be negative")
    if not 0 <= savings_basis_points <= MAX_SAVINGS_BASIS_POINTS:
        raise ValueError("savings_basis_points must be between 0 and 5000")
    if any(value < 0 for value in [*fixed_by_category.values(), *everyday_by_category.values()]):
        raise ValueError("amounts must not be negative")

    fixed = sum(fixed_by_category.values())
    after_fixed = max(0, income_cents - fixed)
    savings = min(income_cents * savings_basis_points // 10_000, after_fixed)
    room = after_fixed - savings
    requested = sum(everyday_by_category.values())

    if requested <= room:
        assigned = dict(everyday_by_category)
        status: Status = "fits"
    else:
        assigned = {
            category: (amount * room // requested) // ROUND_CENTS * ROUND_CENTS
            for category, amount in everyday_by_category.items()
        }
        status = "trimmed"
    if fixed > income_cents:
        status = "short"

    categories = sorted(set(fixed_by_category) | set(everyday_by_category))
    lines = tuple(
        PlanLine(
            category_id=category,
            fixed_cents=fixed_by_category.get(category, 0),
            flexible_cents=assigned.get(category, 0),
            requested_cents=everyday_by_category.get(category, 0),
        )
        for category in categories
        if fixed_by_category.get(category, 0) or everyday_by_category.get(category, 0)
    )
    flexible = sum(assigned.values())
    return StarterPlan(
        income_cents=income_cents,
        fixed_cents=fixed,
        savings_cents=savings,
        flexible_cents=flexible,
        buffer_cents=max(0, income_cents - fixed - savings - flexible),
        status=status,
        lines=lines,
    )
