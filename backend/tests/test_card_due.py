from datetime import date

import pytest

from app.domain.card_due import card_cycle, next_card_due


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
