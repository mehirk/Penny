"""Splitting a purchase with friends, and settling up (each friend is a "person" account)."""

import pytest
from fastapi import HTTPException

from app.dashboard_models import (
    AccountWrite,
    BillWrite,
    GoalWrite,
    SharedPurchaseWrite,
    TransactionSplit,
    TransferWrite,
)
from app.store import DashboardStore, fresh_store

USER = "user-1"


def _friend(store: DashboardStore, name: str, cents: int = 0) -> str:
    result = store.create_account(
        USER, AccountWrite(name=name, account_type="person", balance_cents=cents)
    )
    return next(a.id for a in result.accounts if a.name == name)


def _balances(store: DashboardStore) -> dict[str, int]:
    return {a.id: a.balance_cents for a in store.dashboard_for_user(USER).accounts}


def _pizza(store: DashboardStore, paid_from: str, mine: int, owed: dict[str, int]) -> None:
    store.create_shared_purchase(
        USER,
        SharedPurchaseWrite(
            description="Pizza",
            occurred_on=store.today(),
            paid_from=paid_from,
            my_share_cents=mine,
            owed_by=[TransactionSplit(account_id=k, amount_cents=v) for k, v in owed.items()],
        ),
    )


def test_a_friend_paid_so_you_owe_them_your_share() -> None:
    store = fresh_store(USER, None)
    alex = _friend(store, "Alex")
    _pizza(store, alex, 1_500, {})
    assert _balances(store) == {"acct-chequing": 0, alex: -1_500}
    assert store.dashboard_for_user(USER).totals.spending_cents == 1_500


def test_you_paid_so_friends_owe_you_and_only_your_share_is_spending() -> None:
    store = fresh_store(USER, None)
    alex, sam = _friend(store, "Alex"), _friend(store, "Sam")
    _pizza(store, "acct-chequing", 1_500, {alex: 1_500, sam: 1_500})
    dashboard = store.dashboard_for_user(USER)
    assert _balances(store) == {"acct-chequing": -4_500, alex: 1_500, sam: 1_500}
    assert dashboard.totals.spending_cents == 1_500
    assert len(dashboard.transfers) == 2
    # Their share was the user's money all along: net worth only drops by the user's share.
    assert dashboard.accounts_overview.net_worth_cents == -1_500


def test_settling_up_is_a_transfer_not_spending() -> None:
    store = fresh_store(USER, None)
    alex = _friend(store, "Alex")
    _pizza(store, "acct-chequing", 1_500, {alex: 1_500})
    store.add_transfer(
        USER,
        TransferWrite(
            from_account_id=alex,
            to_account_id="acct-chequing",
            amount_cents=1_500,
            occurred_on=store.today(),
        ),
    )
    assert _balances(store) == {"acct-chequing": -1_500, alex: 0}
    assert store.dashboard_for_user(USER).totals.spending_cents == 1_500


def test_paying_a_friend_back() -> None:
    store = fresh_store(USER, None)
    store.create_account(
        USER, AccountWrite(name="Savings", account_type="savings", balance_cents=10_000)
    )
    alex = _friend(store, "Alex")
    _pizza(store, alex, 1_500, {})
    savings = next(a.id for a in store.dashboard_for_user(USER).accounts if a.name == "Savings")
    store.add_transfer(
        USER,
        TransferWrite(
            from_account_id=savings,
            to_account_id=alex,
            amount_cents=1_500,
            occurred_on=store.today(),
        ),
    )
    assert _balances(store)[alex] == 0 and _balances(store)[savings] == 8_500


def test_a_share_put_on_a_card_can_be_removed() -> None:
    store = fresh_store(USER, None)
    card = store.create_account(
        USER, AccountWrite(name="Visa", account_type="credit", credit_limit_cents=50_000)
    )
    visa = next(a.id for a in card.accounts if a.account_type == "credit")
    alex = _friend(store, "Alex")
    _pizza(store, visa, 1_500, {alex: 1_500})
    assert _balances(store)[visa] == 3_000  # owed on the card
    lent = store.dashboard_for_user(USER).transfers[0]
    store.delete_transfer(USER, lent.id)
    assert _balances(store)[visa] == 1_500 and _balances(store)[alex] == 0


@pytest.mark.parametrize("case", ["not a friend", "friend paid and others owe", "no one owes"])
def test_rejected(case: str) -> None:
    store = fresh_store(USER, None)
    alex, sam = _friend(store, "Alex"), _friend(store, "Sam")
    paid_from, owed = {
        "not a friend": ("acct-chequing", {"acct-chequing": 100}),
        "friend paid and others owe": (alex, {sam: 100}),
        "no one owes": ("acct-chequing", {}),
    }[case]
    with pytest.raises((HTTPException, ValueError)):
        _pizza(store, paid_from, 100, owed)
    assert _balances(store) == {"acct-chequing": 0, alex: 0, sam: 0}


def test_money_a_friend_owes_is_never_suggested_to_cover_a_bill() -> None:
    store = fresh_store(USER, None)
    _friend(store, "Alex", 100_000)
    store.create_bill(
        USER,
        BillWrite(
            name="Rent",
            amount_cents=61_100,
            account_id="acct-chequing",
            next_due=store.today(),
            auto_record=False,
        ),
    )
    warning = store.dashboard_for_user(USER).cash_warnings[0]
    assert warning.cover_account_id is None


def test_goal_money_cant_come_from_a_friend() -> None:
    store = fresh_store(USER, None)
    alex = _friend(store, "Alex", 10_000)
    goal = store.create_goal(
        USER, GoalWrite(name="Trip", target_cents=50_000, current_cents=0)
    ).savings_goals[0]
    with pytest.raises(HTTPException):
        store.contribute_to_goal(USER, goal.id, 1_000, alex)
