from datetime import date

import pytest

from app.domain.runway import runway, safe_to_spend
from app.domain.starter_budget import monthly_income_cents, starter_plan

# ------------------------------------------------------------------ safe to spend


def test_budget_minus_spent_minus_unpaid_bills() -> None:
    result = safe_to_spend(100_000, 30_000, 10_000)
    assert (result.safe_cents, result.over_cents) == (60_000, 0)


def test_paid_bill_counts_once() -> None:
    # $500 budget with $100 rent: unpaid it's held back; once paid it's part of what's spent.
    assert safe_to_spend(50_000, 0, 10_000).safe_cents == 40_000
    assert safe_to_spend(50_000, 10_000, 0).safe_cents == 40_000


def test_goes_negative_when_over_budget() -> None:
    result = safe_to_spend(50_000, 62_000, 0)
    assert (result.safe_cents, result.over_cents) == (-12_000, 12_000)


def test_exactly_used_up_is_zero() -> None:
    assert safe_to_spend(50_000, 40_000, 10_000).safe_cents == 0


@pytest.mark.parametrize("values", [(-1, 0, 0), (0, -1, 0), (0, 0, -1)])
def test_safe_to_spend_rejects_negative_inputs(values: tuple[int, int, int]) -> None:
    with pytest.raises(ValueError):
        safe_to_spend(*values)


def test_runway_over_budget_has_no_daily_amount() -> None:
    result = runway(-500, date(2026, 11, 10), None, date(2026, 11, 30), 1_000)
    assert (result.status, result.per_day_cents, result.days_left) == ("over", 0, 21)


# ------------------------------------------------------------------ income


@pytest.mark.parametrize(
    ("frequency", "expected"),
    [("weekly", 216_666), ("biweekly", 108_333), ("semimonthly", 100_000), ("monthly", 50_000)],
)
def test_monthly_income(frequency: str, expected: int) -> None:
    assert monthly_income_cents(50_000, frequency) == expected


def test_custom_income_uses_interval() -> None:
    assert monthly_income_cents(30_000, "custom", 10) == 30_000 * 365 // 10 // 12


@pytest.mark.parametrize(("frequency", "interval"), [("custom", None), ("hourly", None)])
def test_income_rejects_bad_schedules(frequency: str, interval: int | None) -> None:
    with pytest.raises(ValueError):
        monthly_income_cents(50_000, frequency, interval)


# ------------------------------------------------------------------ plan


def test_plan_fits_and_keeps_requests() -> None:
    plan = starter_plan(200_000, {"cat-housing": 82_500}, {"cat-groceries": 30_000}, 1_000)
    assert (plan.fixed_cents, plan.savings_cents, plan.flexible_cents) == (82_500, 20_000, 30_000)
    assert plan.buffer_cents == 67_500
    assert plan.status == "fits"
    lines = {line.category_id: line for line in plan.lines}
    assert lines["cat-housing"].limit_cents == 82_500
    assert lines["cat-groceries"].limit_cents == 30_000


def test_plan_over_income_keeps_amounts_and_says_by_how_much() -> None:
    plan = starter_plan(100_000, {"cat-housing": 60_000}, {"a": 30_000, "b": 30_000}, 0)
    lines = {line.category_id: line for line in plan.lines}
    assert (lines["a"].flexible_cents, lines["b"].flexible_cents) == (30_000, 30_000)
    assert (plan.status, plan.over_income_cents, plan.buffer_cents) == ("over", 20_000, 0)


def test_fifty_thirty_twenty_guide() -> None:
    plan = starter_plan(200_001, {}, {}, 0)
    assert (plan.guide_needs_cents, plan.guide_wants_cents, plan.guide_savings_cents) == (
        100_000,
        60_000,
        40_000,
    )


def test_fixed_and_everyday_share_a_category() -> None:
    plan = starter_plan(200_000, {"cat-transport": 7_800}, {"cat-transport": 4_000}, 0)
    (line,) = plan.lines
    assert (line.fixed_cents, line.flexible_cents, line.limit_cents) == (7_800, 4_000, 11_800)


def test_savings_never_exceed_what_is_left_after_fixed() -> None:
    plan = starter_plan(100_000, {"cat-housing": 95_000}, {}, 2_000)
    assert plan.savings_cents == 5_000


def test_fixed_above_income_is_short_with_nothing_everyday() -> None:
    plan = starter_plan(50_000, {"cat-housing": 82_500}, {"cat-groceries": 20_000}, 1_000)
    assert plan.status == "short"
    assert (plan.savings_cents, plan.flexible_cents, plan.buffer_cents) == (0, 20_000, 0)
    assert plan.over_income_cents == 52_500
    lines = {line.category_id: line for line in plan.lines}
    assert lines["cat-housing"].limit_cents == 82_500


def test_zero_income_and_no_answers_is_empty() -> None:
    plan = starter_plan(0, {}, {}, 0)
    assert plan.lines == ()
    assert plan.status == "fits"


@pytest.mark.parametrize(
    ("income", "fixed", "everyday", "savings"),
    [(-1, {}, {}, 0), (0, {"a": -1}, {}, 0), (0, {}, {"a": -1}, 0), (0, {}, {}, 5_001)],
)
def test_plan_rejects_invalid_input(
    income: int, fixed: dict[str, int], everyday: dict[str, int], savings: int
) -> None:
    with pytest.raises(ValueError):
        starter_plan(income, fixed, everyday, savings)
