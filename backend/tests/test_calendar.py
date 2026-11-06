"""Add to calendar: the .ics file, the money dates in it, and the short-lived link."""

from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.auth import CurrentUser, get_current_user
from app.dashboard_models import (
    AccountPatch,
    AccountWrite,
    BillWrite,
    CalendarExportWrite,
    PayScheduleWrite,
)
from app.domain.calendar_file import CalendarEvent, calendar_file
from app.main import app
from app.store import DashboardStore, fresh_store

USER = "user-1"
STAMP = datetime(2026, 11, 5, 14, 30, tzinfo=UTC)


def _event(title: str = "Rent due · $611.00", day: date = date(2026, 12, 1)) -> CalendarEvent:
    return CalendarEvent(uid="bill-1-20261201@penny", day=day, title=title, description="Paid")


def test_file_is_an_all_day_event_with_a_reminder() -> None:
    text = calendar_file([_event()], STAMP)
    assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
    assert text.endswith("END:VCALENDAR\r\n")
    assert "\n" not in text.replace("\r\n", "")
    for line in [
        "DTSTART;VALUE=DATE:20261201",
        "DTEND;VALUE=DATE:20261202",
        "DTSTAMP:20261105T143000Z",
        "SUMMARY:Rent due · $611.00",
        "TRIGGER:-PT15H",
    ]:
        assert f"\r\n{line}\r\n" in text


@pytest.mark.parametrize(("reminder", "trigger"), [("same_day", "PT9H"), ("none", None)])
def test_reminder_choices(reminder: str, trigger: str | None) -> None:
    text = calendar_file([_event()], STAMP, reminder)  # type: ignore[arg-type]
    assert ("VALARM" in text) is (trigger is not None)
    if trigger:
        assert f"\r\nTRIGGER:{trigger}\r\n" in text


def test_text_is_escaped_and_long_lines_folded() -> None:
    title = "Gym, pool; and \\ sauna\n" + "é" * 60
    text = calendar_file([_event(title)], STAMP)
    assert "Gym\\, pool\\; and \\\\ sauna\\n" in text
    for line in text.split("\r\n"):
        assert len(line.encode()) <= 75
    unfolded = text.replace("\r\n ", "")
    assert "é" * 60 in unfolded


def test_stamp_needs_a_timezone_and_is_written_in_utc() -> None:
    with pytest.raises(ValueError):
        calendar_file([], datetime(2026, 11, 5))
    toronto = datetime(2026, 11, 5, 9, 30, tzinfo=timezone(timedelta(hours=-5)))
    assert "DTSTAMP:20261105T143000Z" in calendar_file([_event()], toronto)


def test_events_are_in_date_order() -> None:
    later, sooner = _event("B", date(2026, 12, 9)), _event("A", date(2026, 11, 9))
    text = calendar_file([later, sooner], STAMP)
    assert text.index("SUMMARY:A") < text.index("SUMMARY:B")


def _with_dates(store: DashboardStore) -> None:
    today = store.today()
    store.update_account(USER, "acct-chequing", AccountPatch(balance_cents=100_000))
    store.create_bill(
        USER,
        BillWrite(
            name="Rent",
            amount_cents=61_100,
            account_id="acct-chequing",
            next_due=today + timedelta(days=4),
        ),
    )
    store.add_pay_schedule(
        USER,
        PayScheduleWrite(
            name="Campus job",
            amount_cents=50_000,
            account_id="acct-chequing",
            frequency="biweekly",
            next_payday=today + timedelta(days=2),
        ),
    )
    store.create_account(
        USER,
        AccountWrite(
            name="Student card",
            account_type="credit",
            balance_cents=8_000,
            credit_limit_cents=100_000,
            payment_next_due=today + timedelta(days=10),
        ),
    )


def test_six_months_of_money_dates() -> None:
    store = fresh_store(USER, None)
    _with_dates(store)
    events = store.calendar_events(USER, CalendarExportWrite())
    rent = [e for e in events if e.title.startswith("Rent")]
    pay = [e for e in events if e.title.startswith("Payday")]
    card = [e for e in events if e.title.startswith("Student card")]
    assert len(rent) == 6 and rent[0].title == "Rent due · $611.00"
    assert len(pay) == 13 and pay[0].title == "Payday: Campus job · about $500.00"
    assert len(card) == 6 and "$80.00" in card[0].description and "$" not in card[1].description
    assert len({e.uid for e in events}) == len(events)
    assert [e.day for e in events] == sorted(e.day for e in events)
    end = store.today() + timedelta(days=183)
    assert all(store.today() <= e.day <= end for e in events)


def test_amounts_can_be_hidden_and_kinds_left_out() -> None:
    store = fresh_store(USER, None)
    _with_dates(store)
    events = store.calendar_events(USER, CalendarExportWrite(show_amounts=False, pay=False))
    assert events and all("$" not in e.title + e.description for e in events)
    assert not [e for e in events if e.title.startswith("Payday")]


@pytest.fixture
def client() -> TestClient:
    store = fresh_store(USER, None)
    _with_dates(store)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=USER)
    from app.api import calendar as calendar_api

    original = calendar_api.user_store
    calendar_api.user_store = lambda _user: store  # type: ignore[assignment]
    yield TestClient(app)  # type: ignore[misc]
    calendar_api.user_store = original  # type: ignore[assignment]
    app.dependency_overrides.clear()


def test_link_opens_the_file_without_signing_in(client: TestClient) -> None:
    made = client.post("/api/v1/calendar/exports", json={"reminder": "same_day"})
    assert made.status_code == 200
    body = made.json()
    assert body["event_count"] > 0 and body["path"].endswith(".ics")
    app.dependency_overrides.clear()  # the calendar app has no sign-in
    file = client.get(body["path"])
    assert file.status_code == 200
    assert file.headers["content-type"].startswith("text/calendar")
    assert file.headers["cache-control"] == "no-store"
    assert file.text.count("BEGIN:VEVENT") == body["event_count"]


def test_unknown_or_expired_link(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.get("/api/v1/calendar/files/nope.ics").status_code == 404
    path = client.post("/api/v1/calendar/exports", json={}).json()["path"]
    from app.api import calendar as calendar_api

    later = calendar_api.time.monotonic() + calendar_api.LINK_SECONDS + 1
    monkeypatch.setattr(calendar_api.time, "monotonic", lambda: later)
    assert client.get(path).status_code == 404


def test_export_needs_something_to_add(client: TestClient) -> None:
    none = {"bills": False, "cards": False, "pay": False}
    assert client.post("/api/v1/calendar/exports", json=none).status_code == 422
    assert client.post("/api/v1/calendar/exports", json={"extra": 1}).status_code == 422
