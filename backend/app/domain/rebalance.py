"""Ways to cover overspent budgets by moving room from budgets that still have some.

For each budget that's over, the shortfall (rounded up to $5) is taken from budgets with room
left, most room first. A budget never drops below what's already been spent in it or below its
category's scheduled bills, and moves are in whole $5 steps. Anything that can't be covered is
reported, not invented: the total budget never grows.

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Sequence
from dataclasses import dataclass

STEP_CENTS = 500


@dataclass(frozen=True, slots=True)
class BudgetLine:
    category_id: str
    limit_cents: int
    spent_cents: int
    floor_cents: int = 0  # scheduled bills in this category: the limit can't go below it


@dataclass(frozen=True, slots=True)
class Change:
    category_id: str
    from_cents: int
    to_cents: int


@dataclass(frozen=True, slots=True)
class Rebalance:
    over_cents: int  # how much the overspent budgets need, in $5 steps
    covered_cents: int
    uncovered_cents: int
    changes: tuple[Change, ...]  # raised budgets first, then the ones lowered to pay for them


def _up(cents: int) -> int:
    return -(-cents // STEP_CENTS) * STEP_CENTS


def _down(cents: int) -> int:
    return cents // STEP_CENTS * STEP_CENTS


def rebalance(lines: Sequence[BudgetLine]) -> Rebalance:
    if any(min(item.limit_cents, item.spent_cents, item.floor_cents) < 0 for item in lines):
        raise ValueError("amounts must not be negative")
    if len({item.category_id for item in lines}) != len(lines):
        raise ValueError("one line per category")

    needs = {
        item.category_id: _up(item.spent_cents - item.limit_cents)
        for item in lines
        if item.spent_cents > item.limit_cents
    }
    room = {
        item.category_id: _down(item.limit_cents - max(item.spent_cents, item.floor_cents))
        for item in lines
        if item.category_id not in needs
    }
    donors = sorted(
        (category for category, cents in room.items() if cents > 0),
        key=lambda category: (-room[category], category),
    )
    limits = {item.category_id: item.limit_cents for item in lines}
    raised: dict[str, int] = {}
    lowered: dict[str, int] = {}
    # Biggest overspend first, so the worst one is fixed when room is scarce.
    for category in sorted(needs, key=lambda c: (-needs[c], c)):
        need = needs[category]
        for donor in donors:
            if need == 0:
                break
            take = min(need, room[donor])
            if take:
                room[donor] -= take
                lowered[donor] = lowered.get(donor, 0) + take
                raised[category] = raised.get(category, 0) + take
                need -= take

    changes = tuple(
        [Change(c, limits[c], limits[c] + raised[c]) for c in sorted(raised)]
        + [Change(c, limits[c], limits[c] - lowered[c]) for c in sorted(lowered)]
    )
    over = sum(needs.values())
    covered = sum(raised.values())
    return Rebalance(over, covered, over - covered, changes)
