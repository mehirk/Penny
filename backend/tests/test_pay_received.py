"""'I got paid': matching paycheques to paydays, recording one, and card dates from Settings."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.dashboard_models import (
    AccountPatch,
    AccountWrite,
    PayReceivedWrite,
    PayScheduleWrite,
    TransactionWrite,
)
from app.domain.card_due import next_card_due
from app.domain.pay_received import received_paydays
from app.store import DashboardStore, fresh_store

USER = "user-1"
D = date(2026, 11, 5)


@pytest.mark.parametrize(
    ("paydays", "received", "expected"),
    [
        ([D], [D], {D}),
        ([D], [D - timedelta(days=2)], {D}),  # landed early
        ([D], [D + timedelta(days=3)], {D}),  # landed late, at the edge of the window
        ([D], [D + timedelta(days=4)], set()),  # too far away to be this payday's
        ([D], [D, D], {D}),  # two paycheques still cover one payday once
        ([D, D + timedelta(days=7)], [D + timedelta(days=1)], {D}),  # the closest one
        ([D, D + timedelta(days=2)], [D + timedelta(days=1)], {D}),  # a tie: the earlier one
        ([], [D], set()),
    ],
)
def test_received_paydays(paydays: list[date], received: list[date], expected: set[date]) -> None:
    assert received_paydays(paydays, received) == expected


def test_received_paydays_rejects_a_negative_window() -> None:
    with pytest.raises(ValueError):
        received_paydays([D], [D], window_days=-1)


def _with_pay(store: DashboardStore, amount: int = 50_000) -> str:
    result = store.add_pay_schedule(
        USER,
        PayScheduleWrite(
            name="Campus job",
            amount_cents=amount,
            account_id="acct-chequing",
            frequency="weekly",
            next_payday=store.today(),
        ),
    )
    assert result.pay is not None
    return result.pay.sources[0].id


def _chequing(store: DashboardStore) -> int:
    accounts = store.dashboard_for_user(USER).accounts
    return next(a.balance_cents for a in accounts if a.id == "acct-chequing")


def test_payday_asks_until_the_paycheque_is_recorded() -> None:
    store = fresh_store(USER, None)
    pay_id = _with_pay(store)
    pay = store.dashboard_for_user(USER).pay
    assert pay is not None
    assert [(item.pay_id, item.on) for item in pay.to_confirm] == [(pay_id, store.today())]
    assert pay.upcoming[0].received is False

    before = _chequing(store)
    result = store.record_pay(
        USER, pay_id, PayReceivedWrite(occurred_on=store.today(), amount_cents=52_500)
    )
    assert result.pay is not None
    assert result.pay.to_confirm == []
    assert result.pay.upcoming[0].on == store.today() and result.pay.upcoming[0].received
    assert _chequing(store) == before + 52_500  # what actually landed, not the usual amount
    (paycheque,) = [t for t in result.transactions if t.pay_id == pay_id]
    assert (paycheque.kind, paycheque.description, paycheque.category) == (
        "income",
        "Campus job",
        "Paycheque",
    )


def test_already_in_the_balance_goes_into_history_only() -> None:
    store = fresh_store(USER, None)
    pay_id = _with_pay(store)
    before = _chequing(store)
    result = store.record_pay(
        USER,
        pay_id,
        PayReceivedWrite(occurred_on=store.today(), amount_cents=50_000, affect_balance=False),
    )
    assert _chequing(store) == before
    assert result.pay is not None and result.pay.to_confirm == []


def test_income_added_by_hand_counts_for_its_payday() -> None:
    store = fresh_store(USER, None)
    _with_pay(store)
    result = store.create_transaction(
        USER,
        TransactionWrite(
            description="Campus job",
            amount_cents=50_000,
            kind="income",
            occurred_on=store.today() - timedelta(days=1),
            account_id="acct-chequing",
        ),
    )
    assert result.pay is not None and result.pay.to_confirm == []


def test_record_pay_checks_its_input() -> None:
    store = fresh_store(USER, None)
    pay_id = _with_pay(store)
    tomorrow = store.today() + timedelta(days=1)
    with pytest.raises(HTTPException):
        store.record_pay(USER, pay_id, PayReceivedWrite(occurred_on=tomorrow, amount_cents=100))
    with pytest.raises(HTTPException):
        store.record_pay(
            USER, "pay-missing", PayReceivedWrite(occurred_on=store.today(), amount_cents=100)
        )


def _card(store: DashboardStore, next_due: date) -> str:
    result = store.create_account(
        USER,
        AccountWrite(
            name="Student card",
            account_type="credit",
            credit_limit_cents=100_000,
            payment_next_due=next_due,
        ),
    )
    return next(a.id for a in result.accounts if a.name == "Student card")


def _account(store: DashboardStore, account_id: str):  # type: ignore[no-untyped-def]
    return next(a for a in store.dashboard_for_user(USER).accounts if a.id == account_id)


def test_settings_card_from_its_next_payment_date() -> None:
    store = fresh_store(USER, None)
    today = store.today()
    coming = next_card_due(today, 20)
    card = _account(store, _card(store, coming))
    assert (card.payment_due_day, card.card_paid_on) == (20, None)

    # Editing it to next month's date says this month's is already paid.
    after = next_card_due(coming + timedelta(days=1), 20)
    store.update_account(USER, card.id, AccountPatch(payment_next_due=after))
    edited = _account(store, card.id)
    assert (edited.payment_due_day, edited.card_paid_on) == (20, today)

    # And back to the coming date: not paid after all.
    store.update_account(USER, card.id, AccountPatch(payment_next_due=coming))
    assert _account(store, card.id).card_paid_on is None


def test_settings_card_date_is_checked() -> None:
    store = fresh_store(USER, None)
    with pytest.raises(HTTPException):
        _card(store, store.today() + timedelta(days=100))  # more than two cycles away
    with pytest.raises(HTTPException):
        store.create_account(
            USER,
            AccountWrite(
                name="Savings",
                account_type="savings",
                payment_next_due=store.today() + timedelta(days=3),
            ),
        )
    card_id = _card(store, store.today() + timedelta(days=3))
    with pytest.raises(HTTPException):
        store.update_account(
            USER,
            card_id,
            AccountPatch(payment_due_day=4, payment_next_due=store.today() + timedelta(days=3)),
        )
