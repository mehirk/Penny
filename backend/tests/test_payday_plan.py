"""The payday check-in: what's due before the next payday, a saving, and windfalls."""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.dashboard_models import (
    AccountPatch,
    AccountWrite,
    BillWrite,
    GoalPatch,
    GoalWrite,
    PayReceivedWrite,
    PayScheduleWrite,
)
from app.domain.payday_plan import is_windfall, plan_payday
from app.store import DashboardStore, fresh_store

USER = "user-1"


def plan(**overrides: int | None):  # type: ignore[no-untyped-def]
    values: dict[str, int | None] = {
        "amount_cents": 50_000,
        "usual_cents": 50_000,
        "spendable_cents": 100_000,
        "due_cents": 30_000,
        "card_owed_cents": 0,
        "goal_left_cents": None,
    }
    values.update(overrides)
    return plan_payday(**values)  # type: ignore[arg-type]


def test_a_usual_paycheque_suggests_saving_a_tenth() -> None:
    result = plan()
    assert (result.windfall, result.extra_cents, result.short_cents) == (False, 0, 0)
    assert (result.card_cents, result.save_cents, result.yours_cents) == (0, 5_000, 0)


def test_saving_is_rounded_down_to_whole_dollars() -> None:
    assert plan(amount_cents=48_250, usual_cents=48_250).save_cents == 4_800


def test_nothing_is_suggested_when_whats_due_takes_it_all() -> None:
    result = plan(spendable_cents=20_000, due_cents=30_000)
    assert result.short_cents == 10_000
    assert (result.card_cents, result.save_cents, result.yours_cents) == (0, 0, 0)


def test_saving_fits_in_what_is_left_after_whats_due() -> None:
    assert plan(spendable_cents=32_550, due_cents=30_000).save_cents == 2_500


def test_saving_stops_at_what_the_goal_needs_to_the_cent() -> None:
    assert plan(goal_left_cents=1_234).save_cents == 1_234


def test_a_whole_card_balance_is_paid_to_the_cent() -> None:
    result = plan(amount_cents=120_000, spendable_cents=200_000, card_owed_cents=24_380)
    assert result.card_cents == 24_380
    partial = plan(amount_cents=120_000, spendable_cents=200_000, card_owed_cents=90_050)
    assert partial.card_cents == 35_000


def test_a_windfall_pays_the_card_first_then_saves_and_keeps_the_rest() -> None:
    # $500 usual, $1,200 came in: $700 extra. Half of it ($350) goes to work.
    result = plan(amount_cents=120_000, spendable_cents=200_000, card_owed_cents=20_000)
    assert (result.windfall, result.extra_cents) == (True, 70_000)
    assert result.card_cents == 20_000  # the whole card balance
    assert result.save_cents == 5_000 + 15_000  # 10% of the usual part, plus the rest of the half
    assert result.yours_cents == 35_000


def test_a_windfall_without_card_debt_saves_half_the_extra() -> None:
    result = plan(amount_cents=120_000, spendable_cents=200_000)
    assert (result.card_cents, result.save_cents, result.yours_cents) == (0, 40_000, 35_000)


def test_money_that_isnt_pay_is_all_extra() -> None:
    result = plan(amount_cents=70_000, usual_cents=0, spendable_cents=200_000)
    assert (result.windfall, result.extra_cents) == (True, 70_000)
    assert (result.save_cents, result.yours_cents) == (35_000, 35_000)


def test_a_windfall_never_suggests_more_than_is_left() -> None:
    result = plan(amount_cents=120_000, spendable_cents=60_000, card_owed_cents=90_000)
    assert result.card_cents + result.save_cents + result.yours_cents <= 60_000 - 30_000
    assert result.card_cents == 30_000 and result.save_cents == result.yours_cents == 0


@pytest.mark.parametrize(
    ("amount", "usual", "expected"),
    [
        (60_000, 50_000, True),  # $100 and 20% more
        (59_999, 50_000, False),  # just under 20%
        (15_000, 10_000, True),  # $50 and 50% more
        (14_999, 10_000, False),  # under $50
        (5_000, 0, True),  # not pay: $50 is a windfall
        (4_999, 0, False),
    ],
)
def test_what_counts_as_a_windfall(amount: int, usual: int, expected: bool) -> None:
    assert is_windfall(amount, usual) is expected


@pytest.mark.parametrize(
    "bad",
    [
        {"amount_cents": 0},
        {"usual_cents": -1},
        {"due_cents": -1},
        {"card_owed_cents": -1},
        {"goal_left_cents": -1},
    ],
)
def test_plan_checks_its_input(bad: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        plan(**bad)


def _setup(store: DashboardStore) -> str:
    today = store.today()
    store.update_account(USER, "acct-chequing", AccountPatch(balance_cents=150_000))
    pay = store.add_pay_schedule(
        USER,
        PayScheduleWrite(
            name="Campus job",
            amount_cents=50_000,
            account_id="acct-chequing",
            frequency="biweekly",
            next_payday=today,
        ),
    )
    assert pay.pay is not None
    store.create_bill(
        USER,
        BillWrite(
            name="Phone",
            amount_cents=4_000,
            account_id="acct-chequing",
            next_due=today + timedelta(days=3),
        ),
    )
    store.create_bill(  # after the next payday: not in this check-in
        USER,
        BillWrite(
            name="Rent",
            amount_cents=60_000,
            account_id="acct-chequing",
            next_due=today + timedelta(days=20),
        ),
    )
    store.create_goal(USER, GoalWrite(name="Emergency fund", target_cents=100_000, current_cents=0))
    return pay.pay.sources[0].id


def test_check_in_after_a_usual_paycheque() -> None:
    store = fresh_store(USER, None)
    pay_id = _setup(store)
    today = store.today()
    store.record_pay(USER, pay_id, PayReceivedWrite(occurred_on=today, amount_cents=50_000))
    view = store.payday_plan(USER, 50_000, pay_id)
    assert view.next_payday == today + timedelta(days=14)
    assert [(item.name, item.kind) for item in view.due] == [("Phone", "bill")]
    assert (view.due_cents, view.short_cents, view.windfall) == (4_000, 0, False)
    assert view.save is not None and (view.save.goal_name, view.save.amount_cents) == (
        "Emergency fund",
        5_000,
    )
    assert view.card is None and view.from_account_id == "acct-chequing"


def test_check_in_for_a_bonus_includes_a_card_balance() -> None:
    store = fresh_store(USER, None)
    _setup(store)
    today = store.today()
    store.create_account(
        USER,
        AccountWrite(
            name="Student card",
            account_type="credit",
            balance_cents=25_000,
            credit_limit_cents=100_000,
            payment_next_due=today + timedelta(days=25),
        ),
    )
    view = store.payday_plan(USER, 70_000, None)
    assert (view.usual_cents, view.extra_cents, view.windfall) == (0, 70_000, True)
    assert view.card is not None and (view.card.account_name, view.card.amount_cents) == (
        "Student card",
        25_000,
    )
    assert view.save is not None and view.save.amount_cents == 10_000
    assert view.yours_cents == 35_000


def test_a_card_due_before_payday_counts_as_due() -> None:
    store = fresh_store(USER, None)
    _setup(store)
    today = store.today()
    store.create_account(
        USER,
        AccountWrite(
            name="Student card",
            account_type="credit",
            balance_cents=12_000,
            credit_limit_cents=100_000,
            payment_next_due=today + timedelta(days=5),
        ),
    )
    view = store.payday_plan(USER, 70_000, None)
    assert ("Student card payment", 12_000) in [(item.name, item.amount_cents) for item in view.due]
    assert view.card is None


def test_check_in_without_goals_or_pay() -> None:
    store = fresh_store(USER, None)
    store.update_account(USER, "acct-chequing", AccountPatch(balance_cents=80_000))
    view = store.payday_plan(USER, 80_000, None)
    assert view.next_payday is None and view.until == store.today() + timedelta(days=30)
    assert view.save is not None and view.save.goal_id is None


def test_check_in_for_unknown_pay() -> None:
    store = fresh_store(USER, None)
    with pytest.raises(HTTPException):
        store.payday_plan(USER, 1_000, "pay-missing")


def test_check_in_changes_nothing() -> None:
    store = fresh_store(USER, None)
    _setup(store)
    before = store.dashboard_for_user(USER).model_dump()
    store.payday_plan(USER, 70_000, None)
    assert store.dashboard_for_user(USER).model_dump() == before


def test_a_paused_goal_is_skipped() -> None:
    store = fresh_store(USER, None)
    store.update_account(USER, "acct-chequing", AccountPatch(balance_cents=80_000))
    store.create_goal(
        USER,
        GoalWrite(name="Trip", target_cents=50_000, current_cents=0, target_date=date(2027, 6, 1)),
    )
    goal_id = store.dashboard_for_user(USER).savings_goals[0].id
    store.update_goal(USER, goal_id, GoalPatch(status="paused"))
    view = store.payday_plan(USER, 80_000, None)
    assert view.save is not None and view.save.goal_id is None


def test_penny_ai_counts_the_same_bills_before_payday() -> None:
    from app.coach.context import load_context

    store = fresh_store(USER, None)
    _setup(store)  # Phone in 3 days (before payday); Rent in 20 (after it)
    assert load_context(store, USER).unpaid_bills_cents == 4_000
    assert [item.name for item in store.due_before_next_payday(USER)] == ["Phone"]
