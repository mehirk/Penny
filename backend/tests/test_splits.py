"""The Splits page: totals, activity, groups, and uneven splits."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.dashboard_models import (
    AccountWrite,
    SharedPurchaseWrite,
    SplitGroupWrite,
    SplitsOverview,
    TransactionSplit,
    TransferWrite,
)
from app.db.rows import from_rows, profile_row, to_rows
from app.domain.splits import split_totals
from app.store import DashboardStore, fresh_store

USER = "user-1"


def _friend(store: DashboardStore, name: str) -> str:
    result = store.create_account(USER, AccountWrite(name=name, account_type="person"))
    return next(a.id for a in result.accounts if a.name == name)


def _split(
    store: DashboardStore,
    paid_from: str,
    mine: int,
    owed: dict[str, int],
    group_id: str | None = None,
    description: str = "Groceries",
) -> SplitsOverview:
    result = store.create_shared_purchase(
        USER,
        SharedPurchaseWrite(
            description=description,
            occurred_on=store.today(),
            paid_from=paid_from,
            my_share_cents=mine,
            owed_by=[TransactionSplit(account_id=k, amount_cents=v) for k, v in owed.items()],
            group_id=group_id,
        ),
    )
    assert result.splits is not None
    return result.splits


@pytest.mark.parametrize(
    ("balances", "expected"),
    [
        ([], (0, 0, 0)),
        ([3_300, 3_300], (6_600, 0, 6_600)),
        ([2_000, -500, 0], (2_000, 500, 1_500)),
        ([-1_200], (0, 1_200, -1_200)),
    ],
)
def test_split_totals(balances: list[int], expected: tuple[int, int, int]) -> None:
    assert split_totals(balances) == expected


def test_overview_totals_friends_and_activity() -> None:
    store = fresh_store(USER, None)
    neer, laksh = _friend(store, "Neer"), _friend(store, "Laksh")
    _split(store, "acct-chequing", 3_300, {neer: 3_300, laksh: 3_300}, description="Indian food")
    splits = _split(store, laksh, 1_200, {}, description="Movie")
    assert (splits.owed_to_you_cents, splits.you_owe_cents, splits.net_cents) == (5_400, 0, 5_400)
    by_name = {f.name: f.balance_cents for f in splits.friends}
    assert by_name == {"Neer": 3_300, "Laksh": 2_100}
    assert splits.friends[0].name == "Neer"  # biggest balance first
    kinds = [(a.kind, a.friend_name, a.description, a.amount_cents) for a in splits.activity]
    assert kinds[0] == ("borrowed", "Laksh", "Movie", 1_200)
    assert set(kinds[1:]) == {
        ("lent", "Neer", "Indian food", 3_300),
        ("lent", "Laksh", "Indian food", 3_300),
    }

    after = store.add_transfer(
        USER,
        TransferWrite(
            from_account_id=neer,
            to_account_id="acct-chequing",
            amount_cents=3_300,
            occurred_on=store.today(),
        ),
    ).splits
    assert after is not None
    (paid_back,) = [a for a in after.activity if a.kind == "paid_back"]
    assert paid_back.description == "Neer paid you back"
    assert after.net_cents == 2_100


def test_uneven_split_and_paying_only_for_friends() -> None:
    store = fresh_store(USER, None)
    neer, laksh = _friend(store, "Neer"), _friend(store, "Laksh")
    _split(store, "acct-chequing", 1_000, {neer: 2_500, laksh: 500})
    splits = _split(store, "acct-chequing", 0, {neer: 1_500})
    assert {f.name: f.balance_cents for f in splits.friends} == {"Neer": 4_000, "Laksh": 500}
    spent = store.dashboard_for_user(USER).totals.spending_cents
    assert spent == 1_000  # only the user's share is spending
    with pytest.raises(HTTPException):
        _split(store, neer, 0, {})  # a friend paid: the user's share is needed


def test_groups_tag_purchases_and_check_members() -> None:
    store = fresh_store(USER, None)
    neer, laksh = _friend(store, "Neer"), _friend(store, "Laksh")
    result = store.create_split_group(
        USER, SplitGroupWrite(name=" Roommates ", member_ids=[neer, laksh])
    )
    assert result.splits is not None
    (group,) = result.splits.groups
    assert (group.name, group.member_ids, group.expense_count) == ("Roommates", [neer, laksh], 0)
    _split(store, "acct-chequing", 1_000, {neer: 1_000, laksh: 1_000}, group_id=group.id)
    splits = _split(store, neer, 800, {}, group_id=group.id, description="Hydro")
    (group,) = splits.groups
    assert (group.expense_count, group.spent_cents) == (2, 3_800)
    assert all(item.group_id == group.id for item in splits.activity)

    with pytest.raises(HTTPException):
        store.create_split_group(USER, SplitGroupWrite(name="Me", member_ids=["acct-chequing"]))
    with pytest.raises(HTTPException):
        _split(store, "acct-chequing", 100, {neer: 100}, group_id="group-missing")
    with pytest.raises(ValidationError):
        SplitGroupWrite(name="Twice", member_ids=[neer, neer])

    renamed = store.update_split_group(
        USER, group.id, SplitGroupWrite(name="Home", member_ids=[neer])
    )
    assert renamed.splits is not None and renamed.splits.groups[0].name == "Home"
    gone = store.delete_split_group(USER, group.id)
    assert gone.splits is not None and gone.splits.groups == []
    assert gone.splits.net_cents == 1_000 + 1_000 - 800  # what's owed stays


def test_removing_a_friend_takes_them_out_of_groups() -> None:
    store = fresh_store(USER, None)
    neer, sam = _friend(store, "Neer"), _friend(store, "Sam")
    store.create_split_group(USER, SplitGroupWrite(name="Trip", member_ids=[neer, sam]))
    store.create_split_group(USER, SplitGroupWrite(name="Just Sam", member_ids=[sam]))
    splits = store.delete_account(USER, sam).splits
    assert splits is not None
    assert [(g.name, g.member_ids) for g in splits.groups] == [("Trip", [neer])]


def test_groups_and_tags_are_saved_and_loaded() -> None:
    store = fresh_store(USER, None)
    neer = _friend(store, "Neer")
    group = store.create_split_group(
        USER, SplitGroupWrite(name="Roommates", member_ids=[neer])
    ).splits.groups[0]  # type: ignore[union-attr]
    _split(store, "acct-chequing", 500, {neer: 500}, group_id=group.id)
    snapshot = store.snapshot()
    rows = to_rows(snapshot)
    tables = {table: list(keyed.values()) for table, keyed in rows.items()}
    loaded = from_rows(USER, profile_row(snapshot.profile), tables)
    assert loaded.split_groups == snapshot.split_groups
    assert {t.group_id for t in loaded.transfers} == {group.id}
    assert {t.group_id for t in loaded.transactions if t.description == "Groceries"} == {group.id}
