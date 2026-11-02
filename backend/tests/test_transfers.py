import pytest
from fastapi import HTTPException

from app.domain.transfers import move, undo


def test_savings_to_chequing() -> None:
    # $6,000 in savings, $0 in chequing, rent $611.
    assert move("savings", 600_000, "chequing", 0, 61_100) == (538_900, 61_100)


def test_paying_a_card_lowers_what_is_owed() -> None:
    assert move("chequing", 100_000, "credit", 85_000, 85_000) == (15_000, 0)


@pytest.mark.parametrize(
    "args",
    [
        ("chequing", 1_000, "savings", 0, 1_001),  # not enough
        ("credit", 0, "chequing", 0, 100),  # no cash advances
        ("chequing", 10_000, "credit", 2_000, 3_000),  # more than owed
        ("chequing", 10_000, "savings", 0, 0),  # nothing to move
    ],
)
def test_rejected(args: tuple[str, int, str, int, int]) -> None:
    with pytest.raises(ValueError):
        move(*args)


def test_undo_reverses_move() -> None:
    after = move("savings", 600_000, "chequing", 0, 61_100)
    assert undo("savings", after[0], "chequing", after[1], 61_100) == (600_000, 0)
    paid = move("chequing", 100_000, "credit", 85_000, 85_000)
    assert undo("chequing", paid[0], "credit", paid[1], 85_000) == (100_000, 85_000)


def test_undo_refuses_when_the_money_has_been_spent() -> None:
    with pytest.raises(ValueError):
        undo("savings", 538_900, "chequing", 0, 61_100)


def _store_with_savings():  # type: ignore[no-untyped-def]
    from app.dashboard_models import AccountWrite
    from app.dashboard_store import _fresh_store

    store = _fresh_store("user-1", None)
    result = store.create_account(
        "user-1", AccountWrite(name="Savings", account_type="savings", balance_cents=600_000)
    )
    savings = next(a.id for a in result.accounts if a.account_type == "savings")
    return store, savings


def test_store_transfer_moves_balances_not_budgets() -> None:
    from app.dashboard_models import TransferWrite

    store, savings = _store_with_savings()
    before = store.dashboard_for_user("user-1")
    after = store.add_transfer(
        "user-1",
        TransferWrite(
            from_account_id=savings,
            to_account_id="acct-chequing",
            amount_cents=61_100,
            occurred_on=store.today(),
        ),
    )
    balances = {a.id: a.balance_cents for a in after.accounts}
    assert balances == {"acct-chequing": 61_100, savings: 538_900}
    assert after.totals.spending_cents == before.totals.spending_cents
    assert after.spending_power_cents == before.spending_power_cents
    assert [t.kind for t in after.transfers] == ["transfer"]
    undone = store.delete_transfer("user-1", after.transfers[0].id)
    assert {a.id: a.balance_cents for a in undone.accounts}[savings] == 600_000


def test_bill_can_be_paid_from_another_account_once() -> None:
    from app.dashboard_models import BillWrite

    store, savings = _store_with_savings()
    created = store.create_bill(
        "user-1",
        BillWrite(
            name="Rent",
            amount_cents=61_100,
            category_id="cat-housing",
            account_id="acct-chequing",
            next_due=store.today(),
            auto_record=False,
        ),
    )
    rent = created.bills[0]
    with pytest.raises(HTTPException):
        store.mark_bill_paid("user-1", rent.id)  # chequing has $0
    paid = store.mark_bill_paid("user-1", rent.id, savings)
    assert {a.id: a.balance_cents for a in paid.accounts}[savings] == 538_900
    assert paid.bills[0].account_id == "acct-chequing"  # its usual account stays


def test_card_payment_and_heads_up() -> None:
    from app.dashboard_models import AccountWrite, TransferWrite

    store, savings = _store_with_savings()
    result = store.create_account(
        "user-1",
        AccountWrite(
            name="Visa",
            account_type="credit",
            balance_cents=30_000,
            credit_limit_cents=100_000,
            payment_due_day=store.today().day,
        ),
    )
    card = next(a.id for a in result.accounts if a.account_type == "credit")
    [warning] = result.cash_warnings
    assert warning.bill_names == ["Visa payment"] and warning.short_cents == 30_000
    paid = store.add_transfer(
        "user-1",
        TransferWrite(
            from_account_id=savings,
            to_account_id=card,
            amount_cents=30_000,
            occurred_on=store.today(),
        ),
    )
    assert paid.transfers[0].kind == "card_payment"
    assert {a.id: a.balance_cents for a in paid.accounts}[card] == 0
    assert paid.cash_warnings == []
