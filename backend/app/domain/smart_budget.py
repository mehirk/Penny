"""A monthly budget built from everything Penny knows about someone, for them to review.

1. Start from what comes in each month (every source of pay, even before any has arrived).
2. Take out the recurring bills (the fixed part of the budget).
3. Set aside savings: 10% of income, then more toward active goals (up to 20% in all) only
   from what would otherwise be left over, so goals never squeeze everyday spending. Never
   more than is left after bills.
4. What remains is for everyday spending. Each category starts at what the person usually
   spends (their average, rounded up to $5), or a typical student amount with no history.
5. If that doesn't fit, "wants" (eating out, entertainment) give up to half first; then every
   category is scaled down to fit, rounded down to $5. Whatever isn't assigned is a buffer.

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

Status = Literal["fits", "trimmed", "short", "no_income"]
Basis = Literal["history", "typical"]
STEP_CENTS = 500
DEFAULT_SAVINGS_BASIS_POINTS = 1_000  # 10% of income
GOAL_SAVINGS_BASIS_POINTS = 2_000  # goals can take savings up to 20% of income
MAX_SAVINGS_BASIS_POINTS = 5_000


@dataclass(frozen=True, slots=True)
class CategoryBase:
    """Where a category's suggestion starts: usual monthly spending, or a typical amount."""

    category_id: str
    cents: int
    is_want: bool
    basis: Basis


@dataclass(frozen=True, slots=True)
class PlanLine:
    category_id: str
    suggested_cents: int
    usual_cents: int  # the starting point (average, or a typical amount)
    basis: Basis
    trimmed: bool  # lowered to fit


@dataclass(frozen=True, slots=True)
class SmartPlan:
    income_cents: int
    fixed_cents: int
    savings_cents: int
    everyday_cents: int  # income − fixed − savings: room for everyday spending
    planned_cents: int  # sum of the suggestions
    buffer_cents: int  # room left unassigned (0 when trimmed or short)
    status: Status
    lines: tuple[PlanLine, ...]


def round_up(cents: int) -> int:
    return -(-cents // STEP_CENTS) * STEP_CENTS


def round_down(cents: int) -> int:
    return cents // STEP_CENTS * STEP_CENTS


def smart_budget(
    income_cents: int,
    fixed_cents: int,
    goals_monthly_cents: int,
    bases: Sequence[CategoryBase],
    savings_basis_points: int = DEFAULT_SAVINGS_BASIS_POINTS,
) -> SmartPlan:
    if min(income_cents, fixed_cents, goals_monthly_cents) < 0:
        raise ValueError("amounts must not be negative")
    if not 0 <= savings_basis_points <= MAX_SAVINGS_BASIS_POINTS:
        raise ValueError("savings_basis_points must be between 0 and 5000")
    if any(base.cents < 0 for base in bases):
        raise ValueError("category amounts must not be negative")
    if len({base.category_id for base in bases}) != len(bases):
        raise ValueError("one starting amount per category")

    start = {base.category_id: round_up(base.cents) for base in bases if base.cents > 0}
    kept = [base for base in bases if base.category_id in start]
    after_fixed = max(0, income_cents - fixed_cents)
    base_savings = min(income_cents * savings_basis_points // 10_000, after_fixed)
    wanted = sum(start.values())
    spare = max(0, after_fixed - base_savings - wanted)
    goal_room = max(0, income_cents * GOAL_SAVINGS_BASIS_POINTS // 10_000 - base_savings)
    savings = base_savings + min(max(0, goals_monthly_cents - base_savings), goal_room, spare)
    room = after_fixed - savings

    if income_cents == 0 or fixed_cents >= income_cents:
        # Nothing to fit into: show what they usually spend and say so.
        status: Status = "no_income" if income_cents == 0 else "short"
        amounts = dict(start)
    elif wanted <= room:
        status, amounts = "fits", dict(start)
    else:
        status, amounts = "trimmed", _fit(kept, start, room)

    lines = tuple(
        PlanLine(
            category_id=base.category_id,
            suggested_cents=amounts[base.category_id],
            usual_cents=start[base.category_id],
            basis=base.basis,
            trimmed=amounts[base.category_id] < start[base.category_id],
        )
        for base in kept
    )
    planned = sum(line.suggested_cents for line in lines)
    return SmartPlan(
        income_cents=income_cents,
        fixed_cents=fixed_cents,
        savings_cents=savings,
        everyday_cents=room,
        planned_cents=planned,
        buffer_cents=max(0, room - planned) if status in ("fits", "trimmed") else 0,
        status=status,
        lines=lines,
    )


def _fit(bases: Sequence[CategoryBase], start: dict[str, int], room: int) -> dict[str, int]:
    """Wants give up to half first (in proportion); then everything scales down to fit."""
    amounts = dict(start)
    over = sum(amounts.values()) - room
    cuttable = {b.category_id: start[b.category_id] // 2 for b in bases if b.is_want}
    available = sum(cuttable.values())
    if available:
        take = min(over, available)
        for category_id, most in cuttable.items():
            amounts[category_id] = start[category_id] - round_up(most * take // available)
    total = sum(amounts.values())
    if total > room:
        amounts = {key: round_down(value * room // total) for key, value in amounts.items()}
    return amounts
