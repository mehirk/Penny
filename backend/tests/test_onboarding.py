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


def test_a_used_up_budget_does_not_zero_safe_to_spend() -> None:
    # Paying a bill fills its budget, but the money already left the balance; the rest is safe.
    from app.dashboard_models import BudgetWrite

    store, ids = _setup()
    store.create_budget(
        USER,
        BudgetWrite(
            category_id="cat-groceries",
            month_start=store.today().replace(day=1),
            limit_cents=4_800,
        ),
    )
    assert _spend(store, ids["chequing"], 4_800) == 250_000 - 4_800


def _add_rent(store, account_id: str, due: date) -> str:  # type: ignore[no-untyped-def]
    from app.dashboard_models import BillWrite

    result = store.create_bill(
        USER,
        BillWrite(
            name="Rent",
            amount_cents=10_000,
            category_id="cat-housing",
            account_id=account_id,
            next_due=due,
            auto_record=False,
        ),
    )
    return next(b.id for b in result.bills if b.name == "Rent")


def test_unpaid_bill_is_held_back_and_paying_it_changes_nothing() -> None:
    # $2,500 in chequing and $100 rent not yet paid: $2,400 is safe. Paying the rent takes the
    # balance to $2,400 and Safe to spend stays $2,400, since the bill isn't counted twice.
    store, ids = _setup()
    rent = _add_rent(store, ids["chequing"], store.today())
    assert store.dashboard_for_user(USER).spending_power_cents == 240_000
    paid = store.mark_bill_paid(USER, rent)
    assert paid.spending_power_cents == 240_000


def test_overdue_bill_is_held_back() -> None:
    from datetime import timedelta

    store, ids = _setup()
    _add_rent(store, ids["chequing"], store.today() - timedelta(days=40))
    # Two missed months still unpaid, plus this month's if it's still to come.
    assert store.dashboard_for_user(USER).spending_power_cents <= 250_000 - 20_000


def test_breakdown_shows_each_step() -> None:
    store, ids = _setup()
    _add_rent(store, ids["chequing"], store.today())
    safe = store.dashboard_for_user(USER).safe_to_spend
    assert safe is not None
    assert (safe.spending_money_cents, safe.unpaid_bills_cents, safe.safe_cents) == (
        250_000,
        10_000,
        240_000,
    )


def test_import_rows_skips_duplicates_and_keeps_balances() -> None:
    from app.dashboard_models import ImportRow

    store, ids = _setup()
    row = ImportRow(
        occurred_on=store.today(), description="Loblaws", amount_cents=4_820, kind="spending"
    )
    imported, errors = store.import_rows(USER, [row, row], ids["chequing"])
    assert (imported, len(errors)) == (1, 1)
    assert store.dashboard_for_user(USER).safe_to_spend.spending_money_cents == 250_000  # type: ignore[union-attr]


def test_budget_changes_apply_together_or_not_at_all() -> None:
    from app.dashboard_models import BudgetLimitChange, BudgetWrite

    store, ids = _setup()
    month = store.today().replace(day=1)
    for category in ("cat-groceries", "cat-fun"):
        store.create_budget(
            USER, BudgetWrite(category_id=category, month_start=month, limit_cents=10_000)
        )
    budgets = {b.category_id: b.id for b in store.dashboard_for_user(USER).budgets}
    with pytest.raises(HTTPException):
        store.apply_budget_changes(
            USER,
            [
                BudgetLimitChange(budget_id=budgets["cat-groceries"], limit_cents=15_000),
                BudgetLimitChange(budget_id="missing", limit_cents=5_000),
            ],
        )
    limits = {b.category_id: b.limit_cents for b in store.dashboard_for_user(USER).budgets}
    assert limits["cat-groceries"] == 10_000
    result = store.apply_budget_changes(
        USER,
        [
            BudgetLimitChange(budget_id=budgets["cat-groceries"], limit_cents=15_000),
            BudgetLimitChange(budget_id=budgets["cat-fun"], limit_cents=5_000),
        ],
    )
    assert {b.category_id: b.limit_cents for b in result.budgets} == {
        "cat-groceries": 15_000,
        "cat-fun": 5_000,
    }
