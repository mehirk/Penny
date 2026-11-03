from datetime import date

import pytest

from app.domain.card_due import card_cycle, due_day_from, next_card_due


@pytest.mark.parametrize(
    ("today", "day", "expected"),
    [
        (date(2026, 11, 1), 20, date(2026, 11, 20)),  # later this month
        (date(2026, 11, 20), 20, date(2026, 11, 20)),  # due today
        (date(2026, 11, 21), 20, date(2026, 12, 20)),  # passed: next month
        (date(2026, 12, 25), 5, date(2027, 1, 5)),  # across the year
        (date(2027, 2, 1), 31, date(2027, 2, 28)),  # short month: last day
        (date(2028, 2, 1), 30, date(2028, 2, 29)),  # leap year
        (date(2026, 11, 30), 31, date(2026, 11, 30)),  # 31st in a 30-day month is today
    ],
)
def test_next_card_due(today: date, day: int, expected: date) -> None:
    assert next_card_due(today, day) == expected


@pytest.mark.parametrize("day", [0, 32, -1])
def test_rejects_impossible_days(day: int) -> None:
    with pytest.raises(ValueError):
        next_card_due(date(2026, 11, 1), day)


@pytest.mark.parametrize(
    ("today", "payments", "expected"),
    [
        (date(2026, 11, 1), [], (date(2026, 11, 2), None)),  # not paid yet
        (date(2026, 11, 1), [date(2026, 10, 30)], (date(2026, 12, 2), date(2026, 10, 30))),
        (date(2026, 11, 2), [date(2026, 11, 2)], (date(2026, 12, 2), date(2026, 11, 2))),
        (date(2026, 11, 1), [date(2026, 10, 1)], (date(2026, 11, 2), None)),  # paid last cycle
        (date(2026, 11, 3), [date(2026, 11, 1)], (date(2026, 12, 2), None)),  # that paid Nov 2
    ],
)
def test_a_payment_moves_the_card_to_next_month(
    today: date, payments: list[date], expected: tuple[date, date | None]
) -> None:
    assert card_cycle(today, 2, payments) == expected


def test_card_cycle_on_short_months() -> None:
    assert card_cycle(date(2027, 2, 10), 31, [date(2027, 2, 5)]) == (
        date(2027, 3, 31),
        date(2027, 2, 5),
    )


def test_recording_a_card_payment_shows_the_next_due_date() -> None:
    from app.dashboard_models import AccountPatch, AccountWrite, TransferWrite
    from app.store import fresh_store

    store = fresh_store("user-1", None)
    card = store.create_account(
        "user-1",
        AccountWrite(
            name="Visa",
            account_type="credit",
            balance_cents=5_000,
            credit_limit_cents=50_000,
            payment_due_day=store.today().day,
        ),
    )
    visa = next(a.id for a in card.accounts if a.account_type == "credit")
    before = store.dashboard_for_user("user-1").card_payments[0]
    assert (before.due_on, before.paid_on) == (store.today(), None)
    store.update_account("user-1", "acct-chequing", AccountPatch(balance_cents=10_000))
    after = store.add_transfer(
        "user-1",
        TransferWrite(
            from_account_id="acct-chequing",
            to_account_id=visa,
            amount_cents=5_000,
            occurred_on=store.today(),
        ),
    ).card_payments[0]
    assert after.paid_on == store.today() and after.due_on > store.today()


@pytest.mark.parametrize(
    ("next_due", "expected"),
    [
        (date(2026, 11, 5), (5, False)),  # the coming payment
        (date(2026, 11, 2), (2, False)),  # due today
        (date(2026, 12, 5), (5, True)),  # next month's: November's is paid
        (date(2026, 12, 1), (1, False)),  # Nov 1 has passed, so Dec 1 is the coming one
        (date(2027, 1, 1), (1, True)),
    ],
)
def test_due_day_from_the_next_payment_date(next_due: date, expected: tuple[int, bool]) -> None:
    assert due_day_from(date(2026, 11, 2), next_due) == expected


@pytest.mark.parametrize("next_due", [date(2026, 11, 1), date(2027, 1, 5), date(2027, 3, 2)])
def test_due_day_from_rejects_past_or_far_dates(next_due: date) -> None:
    with pytest.raises(ValueError):
        due_day_from(date(2026, 11, 2), next_due)


def _card(store: object) -> object:
    from app.dashboard_models import AccountWrite

    return store.create_account(  # type: ignore[attr-defined]
        "user-1",
        AccountWrite(
            name="Visa",
            account_type="credit",
            balance_cents=5_000,
            credit_limit_cents=50_000,
            payment_due_day=store.today().day,  # type: ignore[attr-defined]
        ),
    )


def test_already_paid_card_moves_on_without_changing_balances() -> None:
    from fastapi import HTTPException

    from app.dashboard_models import AccountPatch
    from app.store import fresh_store

    store = fresh_store("user-1", None)
    visa = next(a.id for a in _card(store).accounts if a.account_type == "credit")
    result = store.update_account("user-1", visa, AccountPatch(card_paid_on=store.today()))
    (card,) = result.card_payments
    assert card.paid_on == store.today() and card.due_on > store.today()
    assert card.owed_cents == 5_000  # nothing moved
    with pytest.raises(HTTPException):
        store.update_account("user-1", "acct-chequing", AccountPatch(card_paid_on=store.today()))
    with pytest.raises(HTTPException):
        store.update_account(
            "user-1",
            visa,
            AccountPatch(card_paid_on=date.fromordinal(store.today().toordinal() + 1)),
        )


def test_setup_card_with_next_months_date_counts_this_month_paid() -> None:
    from fastapi import HTTPException

    from app.dashboard_models import OnboardingAnswers, OnboardingApply
    from app.domain.card_due import next_card_due
    from app.store import fresh_store

    store = fresh_store("user-1", None)
    today = store.today()
    coming = next_card_due(today, 5)
    following = (
        date(coming.year + 1, 1, 5)
        if coming.month == 12
        else date(coming.year, coming.month + 1, 5)
    )

    def answers(next_due: date, account_type: str = "credit") -> OnboardingApply:
        card = {"name": "Visa", "account_type": account_type, "balance_cents": 0}
        if account_type == "credit":
            card["credit_limit_cents"] = 50_000
        return OnboardingApply(
            answers=OnboardingAnswers.model_validate(
                {"new_accounts": [{**card, "payment_next_due": next_due}], "monthly_money_cents": 0}
            )
        )

    with pytest.raises(HTTPException):
        store.apply_onboarding("user-1", answers(following, "savings"))
    with pytest.raises(HTTPException):
        store.apply_onboarding("user-1", answers(date(today.year + 1, today.month, 5)))
    (card,) = store.apply_onboarding("user-1", answers(following)).card_payments
    assert (card.due_on, card.paid_on) == (following, today)
