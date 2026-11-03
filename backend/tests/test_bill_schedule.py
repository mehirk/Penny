"""A bill keeps its usual day, can move one payment, and can be marked as paid before Penny knew."""

from datetime import date, timedelta

from app.dashboard_models import (
    Bill,
    BillPatch,
    BillWrite,
    OnboardingAnswers,
    OnboardingApply,
    OnboardingBill,
)
from app.store import DashboardStore, fresh_store
from app.store.sections import bill_due_dates, next_due_after

USER = "user-1"


def _bill(store: DashboardStore, due: date, **extra: object) -> Bill:
    result = store.create_bill(
        USER,
        BillWrite(
            name="Rent",
            amount_cents=61_100,
            account_id="acct-chequing",
            next_due=due,
            auto_record=False,
            **extra,  # type: ignore[arg-type]
        ),
    )
    return result.bills[0]


def _balance(store: DashboardStore) -> int:
    return store.dashboard_for_user(USER).accounts[0].balance_cents


def _payments(store: DashboardStore) -> list[tuple[date, int]]:
    return [(t.occurred_on, t.amount_cents) for t in store.snapshot().transactions]


def _month_after(day: date) -> date:
    return next_due_after(day, "monthly")


def test_the_31st_comes_back_after_a_short_month() -> None:
    bill = Bill(
        id="b",
        name="Rent",
        amount_cents=100,
        category_id=None,
        account_id="a",
        frequency="monthly",
        next_due=date(2027, 1, 31),
        auto_record=False,
    )
    assert bill.due_day == 31
    assert bill_due_dates(bill, date(2027, 1, 1), date(2027, 4, 30)) == [
        date(2027, 1, 31),
        date(2027, 2, 28),
        date(2027, 3, 31),
        date(2027, 4, 30),
    ]


def test_moving_one_payment_keeps_the_schedule() -> None:
    store = fresh_store(USER, None)
    usual = store.today() + timedelta(days=10)
    bill = _bill(store, usual)
    moved = store.update_bill(
        USER, bill.id, BillPatch(next_due=usual + timedelta(days=3), move_once=True)
    ).bills[0]
    assert (moved.next_due, moved.usual_due) == (usual + timedelta(days=3), usual)
    # The payment after it is still on the usual day.
    following = bill_due_dates(moved, moved.next_due, _month_after(usual))
    assert following == [usual + timedelta(days=3), _month_after(usual)]


def test_moving_every_payment_changes_the_usual_day() -> None:
    store = fresh_store(USER, None)
    usual = store.today() + timedelta(days=10)
    bill = _bill(store, usual)
    new_day = usual + timedelta(days=3)
    moved = store.update_bill(USER, bill.id, BillPatch(next_due=new_day)).bills[0]
    assert (moved.usual_due, moved.due_day) == (None, new_day.day)


def test_paying_a_moved_payment_returns_to_the_usual_schedule() -> None:
    store = fresh_store(USER, None)
    usual = store.today()
    bill = _bill(store, usual)
    store.update_bill(USER, bill.id, BillPatch(next_due=usual - timedelta(days=1), move_once=True))
    paid = store.mark_bill_paid(USER, bill.id, record_only=True).bills[0]
    assert (paid.next_due, paid.usual_due) == (_month_after(usual), None)


def test_already_paid_goes_to_history_without_touching_the_balance() -> None:
    store = fresh_store(USER, None)
    today = store.today()
    bill = _bill(store, today, already_paid="history")
    assert bill.next_due == _month_after(today) and bill.last_paid_on == today
    assert _payments(store) == [(today, 61_100)]
    assert _balance(store) == 0


def test_already_paid_can_also_come_off_the_balance() -> None:
    store = fresh_store(USER, None)
    _bill(store, store.today(), already_paid="balance")
    assert _balance(store) == -61_100


def test_already_paid_records_only_the_latest_past_payment() -> None:
    store = fresh_store(USER, None)
    today = store.today()
    long_ago = today - timedelta(days=70)
    bill = _bill(store, long_ago, already_paid="history")
    assert bill.next_due > today
    assert len(_payments(store)) == 1 and _payments(store)[0][0] <= today


def test_without_an_answer_a_past_bill_stays_due() -> None:
    store = fresh_store(USER, None)
    bill = _bill(store, store.today())
    assert bill.next_due == store.today() and _payments(store) == []


def test_record_only_marks_paid_without_moving_money() -> None:
    # Paid in the bank already, with not enough left in Penny's chequing to pay it again.
    store = fresh_store(USER, None)
    bill = _bill(store, store.today())
    paid = store.mark_bill_paid(USER, bill.id, record_only=True).bills[0]
    assert paid.next_due == _month_after(store.today())
    assert _balance(store) == 0 and len(_payments(store)) == 1


def test_setup_skips_a_bill_already_paid_today() -> None:
    store = fresh_store(USER, None)
    today = store.today()
    result = store.apply_onboarding(
        USER,
        OnboardingApply(
            answers=OnboardingAnswers(
                monthly_money_cents=100_000,
                bills=[
                    OnboardingBill(
                        name="Rent",
                        amount_cents=61_100,
                        category_id="cat-housing",
                        next_due=today,
                        already_paid=True,
                    )
                ],
            )
        ),
    )
    assert result.bills[0].next_due == _month_after(today)
    assert result.bills[0].last_paid_on == today
    assert result.transactions == []


def test_removing_a_record_only_payment_leaves_the_balance_alone() -> None:
    store = fresh_store(USER, None)
    bill = _bill(store, store.today())
    store.mark_bill_paid(USER, bill.id, record_only=True)
    payment = next(t for t in store.dashboard_for_user(USER).transactions if t.bill_id == bill.id)
    assert payment.history_only
    store.delete_transaction(USER, payment.id)
    assert _balance(store) == 0
