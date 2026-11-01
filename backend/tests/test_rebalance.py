import pytest

from app.domain.rebalance import BudgetLine, Change, rebalance


def test_covers_overspend_from_the_budget_with_most_room() -> None:
    plan = rebalance(
        [
            BudgetLine("groceries", 30_000, 34_200),
            BudgetLine("fun", 10_000, 2_000),
            BudgetLine("transport", 8_000, 7_000),
        ]
    )
    # $42 over, rounded up to $45, taken from Entertainment ($80 of room).
    assert plan.over_cents == 4_500
    assert (plan.covered_cents, plan.uncovered_cents) == (4_500, 0)
    assert plan.changes == (Change("groceries", 30_000, 34_500), Change("fun", 10_000, 5_500))


def test_total_budget_never_grows() -> None:
    lines = [BudgetLine("a", 10_000, 15_000), BudgetLine("b", 10_000, 9_000)]
    plan = rebalance(lines)
    before = sum(line.limit_cents for line in lines)
    after = before + sum(c.to_cents - c.from_cents for c in plan.changes)
    assert after == before
    assert plan.uncovered_cents == 5_000 - 1_000


def test_never_below_spent_or_scheduled_bills() -> None:
    plan = rebalance(
        [
            BudgetLine("fun", 5_000, 12_000),
            BudgetLine("housing", 90_000, 0, floor_cents=85_000),
            BudgetLine("coffee", 3_000, 2_800),
        ]
    )
    # Entertainment needs $70. Housing can give only $50 (its bills need $850);
    # Coffee's $2 isn't a $5 step.
    lowered = {c.category_id: c.to_cents for c in plan.changes if c.to_cents < c.from_cents}
    assert lowered == {"housing": 85_000}
    assert (plan.covered_cents, plan.uncovered_cents) == (5_000, 2_000)


def test_nothing_over_means_no_changes() -> None:
    plan = rebalance([BudgetLine("a", 10_000, 10_000), BudgetLine("b", 5_000, 0)])
    assert plan.changes == ()
    assert plan.over_cents == 0


def test_spreads_across_donors_in_five_dollar_steps() -> None:
    plan = rebalance(
        [
            BudgetLine("over", 10_000, 17_000),
            BudgetLine("x", 10_000, 6_000),
            BudgetLine("y", 10_000, 6_500),
        ]
    )
    moved = {
        c.category_id: c.from_cents - c.to_cents for c in plan.changes if c.category_id != "over"
    }
    assert moved == {"x": 4_000, "y": 3_000}
    assert all(cents % 500 == 0 for cents in moved.values())


@pytest.mark.parametrize(
    "lines",
    [
        [BudgetLine("a", -1, 0)],
        [BudgetLine("a", 0, -1)],
        [BudgetLine("a", 0, 0), BudgetLine("a", 0, 0)],
    ],
)
def test_rejects_invalid_lines(lines: list[BudgetLine]) -> None:
    with pytest.raises(ValueError):
        rebalance(lines)
