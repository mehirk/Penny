"""Purchases the user records are saved even when Penny's balance is behind their bank's."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.dashboard_models import (
    AccountWrite,
    BillWrite,
    SplitTransactionWrite,
    TransactionPatch,
    TransactionSplit,
    TransactionWrite,
)
from app.db.rows import from_rows, profile_row, to_rows
from app.models import Account
from app.store import DashboardStore, fresh_store

USER = "user-1"


def _spend(store: DashboardStore, account_id: str, cents: int) -> str:
    result = store.create_transaction(
        USER,
        TransactionWrite(
            description="Coffee",
            account_id=account_id,
            amount_cents=cents,
            kind="spending",
            occurred_on=store.today(),
        ),
    )
    return next(t.id for t in result.transactions if t.description == "Coffee")


def _add_account(store: DashboardStore, account_type: str, cents: int) -> str:
    result = store.create_account(
        USER,
        AccountWrite(name=account_type.title(), account_type=account_type, balance_cents=cents),  # type: ignore[arg-type]
    )
    return next(a.id for a in result.accounts if a.account_type == account_type)


def _balance(store: DashboardStore, account_id: str) -> int:
    return next(
        a.balance_cents for a in store.dashboard_for_user(USER).accounts if a.id == account_id
    )


def test_a_purchase_from_an_empty_chequing_account_is_saved_as_overdrawn() -> None:
    store = fresh_store(USER, None)
    _spend(store, "acct-chequing", 450)
    dashboard = store.dashboard_for_user(USER)
    assert _balance(store, "acct-chequing") == -450
    overview = dashboard.accounts_overview
    assert overview.spending_cents == -450 and overview.net_worth_cents == -450
    chequing = overview.accounts[0]
    assert chequing.net_cents == -450 and chequing.goal_cents == 0
    assert dashboard.home.available_cents == -450


def test_cash_can_be_overdrawn_but_savings_cannot() -> None:
    store = fresh_store(USER, None)
    cash = _add_account(store, "cash", 100)
    _spend(store, cash, 500)
    assert _balance(store, cash) == -400
    savings = _add_account(store, "savings", 100)
    with pytest.raises(HTTPException) as error:
        _spend(store, savings, 500)
    assert error.value.status_code == 422
    assert _balance(store, savings) == 100


def test_editing_and_deleting_an_overdrawing_purchase() -> None:
    store = fresh_store(USER, None)
    coffee = _spend(store, "acct-chequing", 450)
    store.update_transaction(USER, coffee, TransactionPatch(amount_cents=600))
    assert _balance(store, "acct-chequing") == -600
    store.delete_transaction(USER, coffee)
    assert _balance(store, "acct-chequing") == 0


def test_a_split_purchase_can_overdraw_its_accounts() -> None:
    store = fresh_store(USER, None)
    cash = _add_account(store, "cash", 0)
    store.create_split_transaction(
        USER,
        SplitTransactionWrite(
            description="Groceries",
            kind="spending",
            occurred_on=store.today(),
            splits=[
                TransactionSplit(account_id="acct-chequing", amount_cents=2_000),
                TransactionSplit(account_id=cash, amount_cents=500),
            ],
        ),
    )
    assert (_balance(store, "acct-chequing"), _balance(store, cash)) == (-2_000, -500)


def test_a_bill_payment_still_needs_the_money_first() -> None:
    # The app then offers to move money in or pay from another account (D-113).
    store = fresh_store(USER, None)
    result = store.create_bill(
        USER,
        BillWrite(
            name="Rent",
            amount_cents=61_100,
            account_id="acct-chequing",
            next_due=store.today(),
            auto_record=False,
        ),
    )
    with pytest.raises(HTTPException) as error:
        store.mark_bill_paid(USER, result.bills[0].id)
    assert "negative" in str(error.value.detail)
    assert _balance(store, "acct-chequing") == 0


def test_only_chequing_and_cash_may_hold_a_negative_balance() -> None:
    Account(id="a", name="Chequing", account_type="chequing", balance_cents=-1)
    for account_type in ("savings", "credit", "investment", "other"):
        with pytest.raises(ValidationError):
            Account(id="a", name="A", account_type=account_type, balance_cents=-1)  # type: ignore[arg-type]


def test_an_overdrawn_balance_survives_saving_and_loading() -> None:
    store = fresh_store(USER, None)
    _spend(store, "acct-chequing", 450)
    snapshot = store.snapshot()
    tables = {table: list(rows.values()) for table, rows in to_rows(snapshot).items()}
    loaded = from_rows(USER, profile_row(snapshot.profile), tables)
    assert loaded.accounts[0].balance_cents == -450


def test_same_day_transactions_list_the_last_recorded_first() -> None:
    # The app takes "Paid from" for a new entry from the latest one in this list.
    store = fresh_store(USER, None)
    result = store.create_account(
        USER,
        AccountWrite(name="Visa", account_type="credit", credit_limit_cents=50_000),
    )
    card = next(a.id for a in result.accounts if a.account_type == "credit")
    _spend(store, "acct-chequing", 100)
    _spend(store, card, 200)
    first, second = store.dashboard_for_user(USER).transactions[:2]
    assert (first.account_id, second.account_id) == (card, "acct-chequing")


def _history(store: DashboardStore, **changes: object) -> TransactionWrite:
    values: dict[str, object] = {
        "description": "Textbook",
        "account_id": "acct-chequing",
        "amount_cents": 9_000,
        "kind": "spending",
        "occurred_on": store.today().replace(day=1),
        "history_only": True,
    }
    values.update(changes)
    return TransactionWrite.model_validate(values)


def test_history_only_purchase_counts_as_spending_but_not_against_the_balance() -> None:
    store = fresh_store(USER, None)
    result = store.create_transaction(USER, _history(store))
    (textbook,) = [t for t in result.transactions if t.description == "Textbook"]
    assert textbook.history_only
    assert result.totals.spending_cents == 9_000
    chequing = next(a for a in result.accounts if a.id == "acct-chequing")
    assert chequing.balance_cents == 0
    # Editing or removing it doesn't touch the balance either.
    store.update_transaction(USER, textbook.id, TransactionPatch(amount_cents=12_000))
    after = store.delete_transaction(USER, textbook.id)
    assert next(a for a in after.accounts if a.id == "acct-chequing").balance_cents == 0


def test_history_only_must_already_have_happened() -> None:
    from datetime import timedelta

    store = fresh_store(USER, None)
    with pytest.raises(HTTPException) as error:
        store.create_transaction(
            USER, _history(store, occurred_on=store.today() + timedelta(days=1))
        )
    assert error.value.status_code == 422
