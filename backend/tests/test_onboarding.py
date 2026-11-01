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


def _setup(spending_from: str = "chequing"):  # type: ignore[no-untyped-def]
    store = _fresh_store(USER, None)
    store.apply_onboarding(
        USER,
        OnboardingApply(
            answers=_answers(
                bills=[],
                everyday={},
                income=None,
                monthly_money_cents=0,
                spending_from=spending_from,
                new_accounts=[
                    {"name": "Savings", "account_type": "savings", "balance_cents": 100_000},
                    {
                        "name": "Card",
                        "account_type": "credit",
                        "balance_cents": 0,
                        "credit_limit_cents": 100_000,
                    },
                ],
            )
        ),
    )
    ids = {a.account_type: a.id for a in store.dashboard_for_user(USER).accounts}
    return store, ids


def _spend(store, account_id: str, cents: int) -> int:  # type: ignore[no-untyped-def]
    from app.dashboard_models import TransactionWrite

    result = store.create_transaction(
        USER,
        TransactionWrite(
            description="Groceries",
            account_id=account_id,
            category_id="cat-groceries",
            amount_cents=cents,
            kind="spending",
            occurred_on=store.today(),
        ),
    )
    return result.spending_power_cents


@pytest.mark.parametrize("account_type", ["chequing", "credit", "savings"])
def test_any_purchase_lowers_safe_to_spend(account_type: str) -> None:
    store, ids = _setup()
    before = store.dashboard_for_user(USER).spending_power_cents
    assert before == 250_000
    assert _spend(store, ids[account_type], 4_800) == before - 4_800


def test_savings_counts_as_spending_money_when_chosen() -> None:
    store, _ = _setup("chequing_and_savings")
    assert store.dashboard_for_user(USER).spending_power_cents == 350_000
