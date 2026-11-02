import pytest

from app.domain.financial_health import health_factors, health_score


def _factors(**overrides: object) -> dict[str, int]:
    values: dict[str, object] = {
        "spending_cents": 80_000,
        "budget_cents": 100_000,
        "cash_flow_cents": 20_000,
        "has_activity": True,
        "previous_spending_cents": 80_000,
        "previous_cash_flow_cents": 10_000,
        "goal_progress_basis_points": [5_000],
    } | overrides
    return {item.id: item.score for item in health_factors(**values)}  # type: ignore[arg-type]


def test_a_steady_month_on_budget() -> None:
    assert _factors() == {"budget": 35, "savings": 30, "goals": 10, "stability": 15}


def test_overspending_loses_only_the_share_over_budget() -> None:
    # 10% over the budget costs 10% of the 35 budget points (floored to 3).
    assert _factors(spending_cents=110_000)["budget"] == 32
    # Twice the budget or more scores zero, never negative.
    assert _factors(spending_cents=300_000)["budget"] == 0


def test_savings_needs_positive_cash_flow_now_and_before_for_full_points() -> None:
    assert _factors(previous_cash_flow_cents=0)["savings"] == 20
    assert _factors(cash_flow_cents=0)["savings"] == 0


def test_stability_bands() -> None:
    assert _factors(spending_cents=88_000)["stability"] == 15  # 10% change
    assert _factors(spending_cents=100_000)["stability"] == 10  # 25% change
    assert _factors(spending_cents=40_000)["stability"] == 5  # 50% change


def test_factors_without_data_are_left_out() -> None:
    factors = _factors(
        budget_cents=0,
        has_activity=False,
        previous_spending_cents=0,
        goal_progress_basis_points=[],
    )
    assert factors == {}
    assert health_score([]) == 0


def test_goal_progress_is_capped_per_goal() -> None:
    assert _factors(goal_progress_basis_points=[20_000, 0])["goals"] == 10


def test_score_is_the_share_of_available_points() -> None:
    factors = health_factors(
        spending_cents=110_000,
        budget_cents=100_000,
        cash_flow_cents=0,
        has_activity=True,
        previous_spending_cents=0,
        previous_cash_flow_cents=0,
        goal_progress_basis_points=[],
    )
    # 32 of 35 budget points + 0 of 30 savings points = 32 of 65.
    assert health_score(factors) == 49


def test_negative_amounts_are_rejected() -> None:
    with pytest.raises(ValueError):
        _factors(spending_cents=-1)
