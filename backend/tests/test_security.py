"""Abuse limits, security headers, request size, and deleting an account."""

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from psycopg import errors
from pydantic import SecretStr

from app import limits
from app.auth import DEMO_USER_ID, CurrentUser, get_current_user
from app.coach.llm import AiLimitReached, ModelUnavailable, ask_json
from app.config import Settings
from app.db import repository
from app.main import MAX_BODY_BYTES, app
from app.store import stores


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def test_limiter_allows_up_to_the_limit_then_says_how_long_to_wait() -> None:
    clock = Clock()
    limiter = limits.RateLimiter(3, 60, clock)
    assert [limiter.retry_after("a") for _ in range(3)] == [None, None, None]
    clock.now += 10
    assert limiter.retry_after("a") == 50
    assert limiter.retry_after("b") is None  # each person has their own count


def test_limiter_window_slides() -> None:
    clock = Clock()
    limiter = limits.RateLimiter(2, 60, clock)
    limiter.retry_after("a")
    clock.now += 30
    limiter.retry_after("a")
    clock.now += 30  # the first event is now outside the window
    assert limiter.retry_after("a") is None
    assert limiter.retry_after("a") is not None


def test_refused_events_dont_count() -> None:
    clock = Clock()
    limiter = limits.RateLimiter(1, 60, clock)
    limiter.retry_after("a")
    for _ in range(50):
        assert limiter.retry_after("a") is not None
    clock.now += 60
    assert limiter.retry_after("a") is None


def test_limiter_forgets_the_least_recently_seen_beyond_its_size() -> None:
    limiter = limits.RateLimiter(1, 60, Clock(), max_keys=2)
    limiter.retry_after("a")
    limiter.retry_after("b")
    limiter.retry_after("c")  # "a" is forgotten
    assert limiter.retry_after("a") is None
    assert limiter.retry_after("c") is not None


def test_limiter_checks_its_settings() -> None:
    with pytest.raises(ValueError):
        limits.RateLimiter(0, 60)
    with pytest.raises(ValueError):
        limits.RateLimiter(1, 0)


def test_ai_calls_are_charged_to_the_person_asking(monkeypatch: pytest.MonkeyPatch) -> None:
    assert limits.spend_ai_call()  # outside a request: not limited
    monkeypatch.setattr(limits, "ai_per_minute", limits.RateLimiter(2, 60))
    limits.note_request("user-1")
    assert limits.spend_ai_call() and limits.spend_ai_call()
    assert not limits.spend_ai_call()


def test_ai_day_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(limits, "ai_per_day", limits.RateLimiter(1, 86_400))
    limits.note_request("user-1")
    assert limits.spend_ai_call()
    assert not limits.spend_ai_call()


def test_model_isnt_called_over_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(limits, "ai_per_minute", limits.RateLimiter(1, 60))
    limits.note_request("user-1")
    limits.spend_ai_call()
    settings = Settings(openai_api_key="sk-test-not-real", database_url=None)
    with pytest.raises(AiLimitReached):
        asyncio.run(ask_json(settings, "x", "y", "name", {"type": "object"}))
    assert issubclass(AiLimitReached, ModelUnavailable)  # callers fall back to built-in answers


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="user-sec")
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_too_many_requests(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(limits, "requests", limits.RateLimiter(2, 60))
    assert client.get("/api/v1/me").status_code == 200
    assert client.get("/api/v1/me").status_code == 200
    refused = client.get("/api/v1/me")
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) >= 1


def test_security_headers(client: TestClient) -> None:
    for response in (client.get("/health"), client.get("/api/v1/me")):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cache-control"] == "no-store"
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_oversized_and_unsized_bodies_are_refused(client: TestClient) -> None:
    too_big = client.post(
        "/api/v1/transactions",
        content=b"{}",
        headers={"content-length": str(MAX_BODY_BYTES + 1), "content-type": "application/json"},
    )
    assert too_big.status_code == 413

    def chunks() -> Iterator[bytes]:
        yield b"{}"

    unsized = client.post("/api/v1/transactions", content=chunks())
    assert unsized.status_code == 411


def test_unauthenticated_requests_are_refused() -> None:
    response = TestClient(app).get("/api/v1/dashboard")
    assert response.status_code == 401
    assert response.headers["x-frame-options"] == "DENY"


def test_delete_account(client: TestClient) -> None:
    assert client.get("/api/v1/dashboard").status_code == 200
    assert "user-sec" in stores._fresh
    assert client.post("/api/v1/account/delete", json={"confirm": "yes"}).status_code == 422
    deleted = client.post("/api/v1/account/delete", json={"confirm": "delete"})
    assert deleted.status_code == 200 and deleted.json() == {"signin_deleted": False}
    assert "user-sec" not in stores._fresh


def test_the_demo_account_cant_be_deleted() -> None:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=DEMO_USER_ID, auth_method="demo"
    )
    try:
        response = TestClient(app).post("/api/v1/account/delete", json={"confirm": "delete"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 403


class FakeConnection:
    """Enough of a psycopg connection to see which statements ran."""

    def __init__(self, auth_error: Exception | None = None, auth_rows: int = 1) -> None:
        self.auth_error = auth_error
        self.auth_rows = auth_rows
        self.statements: list[str] = []

    @contextmanager
    def transaction(self) -> Iterator[None]:
        yield

    def execute(self, query: str, params: Any) -> Any:
        self.statements.append(query)
        if "auth.users" in query:
            if self.auth_error:
                raise self.auth_error
            return type("Result", (), {"rowcount": self.auth_rows})()
        return type("Result", (), {"rowcount": 1})()


def test_deleting_the_signin_cascades_to_everything() -> None:
    conn = FakeConnection()
    assert repository.delete_user(conn, "u1") is True  # type: ignore[arg-type]
    assert conn.statements == ["delete from auth.users where id = %s"]


@pytest.mark.parametrize(
    "conn",
    [FakeConnection(errors.InsufficientPrivilege()), FakeConnection(auth_rows=0)],
)
def test_without_access_to_signins_the_data_is_still_deleted(conn: FakeConnection) -> None:
    assert repository.delete_user(conn, "u1") is False  # type: ignore[arg-type]
    assert conn.statements[-1] == "delete from public.profiles where user_id = %s"


def test_settings_never_print_the_database_url() -> None:
    settings = Settings(database_url=SecretStr("postgresql://user:hunter2@db/penny"))
    assert "hunter2" not in repr(settings) and "hunter2" not in str(settings.model_dump())


@pytest.mark.parametrize(
    ("basis_points", "shown"),
    [
        (1_219, "12%"),
        (6_019, "60%"),
        (1_250, "13%"),
        (1_000, "10%"),
        (410, "4.1%"),
        (999, "10%"),
        (400, "4%"),
        (4, "0%"),
        (0, "0%"),
        (-1_219, "-12%"),
        (-45, "-0.5%"),
    ],
)
def test_percents_are_easy_to_read(basis_points: int, shown: str) -> None:
    from app.coach.facts import FactBook, format_percent

    assert format_percent(basis_points) == shown
    book = FactBook()
    book.percent("Change", basis_points, "test")
    assert book.unverified_figures(f"That's {shown.lstrip('-')}.") == []
