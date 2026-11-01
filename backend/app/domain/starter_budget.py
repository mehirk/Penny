"""A starting monthly budget from a new user's onboarding answers.

- Fixed costs (scheduled bills) get exactly what they need each month; they're locked.
- Savings take the chosen share of monthly income, but never more than is left after fixed costs.
- Everyday categories get exactly what the user asks for, even when it doesn't fit: the plan is
  theirs. If everything adds up to more than their income, the status says so ("over") and the
  app warns them, with the 50/30/20 guide (needs, wants, savings shares of income) for reference.
- Whatever isn't assigned stays as a buffer.

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Status = Literal["fits", "over", "short"]
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
    # Fixed + savings + everyday beyond income (0 when it fits).
    over_income_cents: int
    status: Status
    lines: tuple[PlanLine, ...]
    # The 50/30/20 guide: needs, wants, and savings shares of income, for comparison.
    guide_needs_cents: int
    guide_wants_cents: int
    guide_savings_cents: int


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
    assigned = dict(everyday_by_category)
    over = max(0, fixed + savings + sum(assigned.values()) - income_cents)
    status: Status = "short" if fixed > income_cents else "over" if over else "fits"

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
        over_income_cents=over,
        status=status,
        lines=lines,
        guide_needs_cents=income_cents * 50 // 100,
        guide_wants_cents=income_cents * 30 // 100,
        guide_savings_cents=income_cents * 20 // 100,
    )
