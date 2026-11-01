from datetime import date

import pytest
from fastapi import HTTPException

from app.dashboard_models import BudgetPatch, OnboardingAnswers, OnboardingApply
from app.dashboard_store import _fresh_store

USER = "user-1"


def _answers(**overrides: object) -> OnboardingAnswers:
    values: dict[str, object] = {
        "opening_balances": {"acct-chequing": 250_000},
        "income": {
            "amount_cents": 120_000,
            "frequency": "biweekly",
            "next_payday": date(2026, 11, 13),
        },
        "bills": [
            {
                "name": "Rent",
                "amount_cents": 82_500,
                "category_id": "cat-housing",
                "next_due": date(2026, 12, 1),
            }
        ],
        "everyday": {"cat-groceries": 30_000, "cat-fun": 10_000},
        "savings_basis_points": 1_000,
    }
    values.update(overrides)
    return OnboardingAnswers.model_validate(values)


def test_new_account_needs_onboarding() -> None:
    store = _fresh_store(USER, None)
    assert store.dashboard_for_user(USER).needs_onboarding


def test_apply_saves_setup_and_keeps_fixed_costs_locked() -> None:
    store = _fresh_store(USER, None)
    result = store.apply_onboarding(
        USER, OnboardingApply(answers=_answers(), everyday_limits={"cat-fun": 5_000})
    )
    budgets = {b.category_id: b.limit_cents for b in result.budgets}
    assert budgets == {"cat-housing": 82_500, "cat-groceries": 30_000, "cat-fun": 5_000}
    assert result.pay_schedule is not None and len(result.bills) == 1
    assert not result.needs_onboarding
    assert result.spending_power_cents > 0
    housing = next(b for b in result.budgets if b.category_id == "cat-housing")
    with pytest.raises(HTTPException) as error:
        store.update_budget(USER, housing.id, BudgetPatch(limit_cents=50_000))
    assert error.value.status_code == 422


def test_apply_only_once() -> None:
    store = _fresh_store(USER, None)
    store.apply_onboarding(USER, OnboardingApply(answers=_answers()))
    with pytest.raises(HTTPException) as error:
        store.apply_onboarding(USER, OnboardingApply(answers=_answers()))
    assert error.value.status_code == 409


def test_apply_rejects_income_categories_for_spending() -> None:
    store = _fresh_store(USER, None)
    with pytest.raises(HTTPException) as error:
        store.apply_onboarding(USER, OnboardingApply(answers=_answers(everyday={"cat-income": 1})))
    assert error.value.status_code == 422


def test_without_pay_the_monthly_money_is_the_base() -> None:
    store = _fresh_store(USER, None)
    plan = store.starter_plan_for(USER, _answers(income=None, monthly_money_cents=80_000, bills=[]))
    assert plan.income_cents == 80_000
