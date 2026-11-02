from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.dashboard_models import PayScheduleWrite
from app.db.rows import from_rows, profile_row, to_rows
from app.store import DashboardStore, fresh_store
from app.store.pay import MAX_PAY_SCHEDULES

USER = "user-1"


def _pay(store: DashboardStore, name: str, cents: int, frequency: str, days_ahead: int) -> str:
    result = store.add_pay_schedule(
        USER,
        PayScheduleWrite(
            name=name,
            amount_cents=cents,
            account_id="acct-chequing",
            frequency=frequency,  # type: ignore[arg-type]
            next_payday=store.today() + timedelta(days=days_ahead),
        ),
    )
    assert result.pay is not None
    return next(s.id for s in result.pay.sources if s.name == name)


def test_several_sources_add_up_and_the_largest_is_main() -> None:
    store = fresh_store(USER, None)
    _pay(store, "Bookstore", 60_000, "biweekly", 9)  # 60,000 × 26 ÷ 12 = 130,000
    _pay(store, "Scholarship", 100_000, "monthly", 3)
    d = store.dashboard_for_user(USER)
    assert d.pay is not None
    assert d.pay.monthly_cents == 130_000 + 100_000
    # The largest a month (the bookstore's) is the main pay and comes first.
    assert [s.name for s in d.pay.sources][0] == "Bookstore"
    # The combined list is in date order, so the scholarship (in 3 days) comes first.
    assert d.pay.upcoming[0].name == "Scholarship"
    assert all(len(s.upcoming) == 3 for s in d.pay.sources)


def test_edit_and_delete_one_source() -> None:
    store = fresh_store(USER, None)
    job = _pay(store, "Job", 50_000, "biweekly", 10)
    other = _pay(store, "Tutoring", 10_000, "weekly", 4)
    edited = store.update_pay_schedule(
        USER,
        other,
        PayScheduleWrite(
            name="Tutoring",
            amount_cents=15_000,
            account_id="acct-chequing",
            frequency="weekly",
            next_payday=store.today() + timedelta(days=4),
        ),
    )
    assert edited.pay is not None
    assert {s.id: s.amount_cents for s in edited.pay.sources}[other] == 15_000
    after = store.delete_pay_schedule(USER, other)
    assert after.pay is not None and [s.id for s in after.pay.sources] == [job]
    gone = store.delete_pay_schedule(USER, job)
    assert gone.pay is None
    with pytest.raises(HTTPException) as error:
        store.delete_pay_schedule(USER, job)
    assert error.value.status_code == 404


def test_limit_and_account_checks() -> None:
    store = fresh_store(USER, None)
    for index in range(MAX_PAY_SCHEDULES):
        _pay(store, f"Pay {index}", 1_000, "monthly", index + 1)
    with pytest.raises(HTTPException):
        _pay(store, "One too many", 1_000, "monthly", 1)
    with pytest.raises(HTTPException) as error:
        store.delete_account(USER, "acct-chequing")
    assert error.value.status_code == 409


def test_forecast_projects_every_source() -> None:
    store = fresh_store(USER, None)
    _pay(store, "Job", 80_000, "biweekly", 5)
    _pay(store, "Allowance", 5_000, "weekly", 1)
    # This cycle runs up to the main payday (the Job's); the next one starts on it.
    names = {
        e.name
        for offset in (0, 1)
        for day in store.pay_cycle_outlook(USER, offset).days
        for e in day.events
        if e.kind == "income"
    }
    assert names == {"Job", "Allowance"}


def test_sources_survive_saving_and_loading() -> None:
    store = fresh_store(USER, None)
    _pay(store, "Job", 80_000, "biweekly", 5)
    _pay(store, "Allowance", 5_000, "weekly", 1)
    snapshot = store.snapshot()
    tables = {table: list(rows.values()) for table, rows in to_rows(snapshot).items()}
    loaded = from_rows(USER, profile_row(snapshot.profile), tables)
    assert {p.name for p in loaded.pay_schedules} == {"Job", "Allowance"}
