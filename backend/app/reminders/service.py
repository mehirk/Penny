"""Per-user reminder settings, delivery, de-duplication, and a short log. Kept in Postgres
when a database is configured (reminder_* tables), otherwise in memory."""

import re
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Literal, Protocol
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import Settings
from app.dashboard_store import DashboardStore, stores
from app.db.pool import connection, database_enabled
from app.db.unit import unit_scope
from app.reminders import mailer
from app.reminders.compose import KINDS, Reminder, ReminderKind, due_reminders, render

MAX_EMAILS_PER_HOUR = 6
LOG_SIZE = 20
_EMAIL = re.compile(r"^[^@\s<>,;\"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


class ReminderModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReminderKinds(ReminderModel):
    bills: bool = True
    budgets: bool = True
    streaks: bool = True
    lessons: bool = False

    def enabled(self) -> set[ReminderKind]:
        return {kind for kind in KINDS if getattr(self, kind)}


class ReminderSettingsWrite(ReminderModel):
    enabled: bool
    email: str | None = Field(default=None, max_length=254)
    kinds: ReminderKinds

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not _EMAIL.match(value):
            raise ValueError("Enter a valid email address")
        return value


class ReminderItem(ReminderModel):
    kind: ReminderKind
    title: str
    detail: str
    already_sent: bool


class SentEmail(ReminderModel):
    id: str
    at: datetime
    to: str
    subject: str
    text: str
    status: Literal["sent", "preview", "failed"]
    trigger: Literal["scheduled", "manual", "test"]
    error: str | None = None


class ReminderState(ReminderModel):
    enabled: bool
    email: str | None
    kinds: ReminderKinds
    # "smtp": emails are really sent. "preview": no server configured, so they're only logged.
    delivery: Literal["smtp", "preview"]
    sender: str | None
    check_minutes: int
    due: list[ReminderItem]
    log: list[SentEmail]
    emails_left_this_hour: int


@dataclass
class _UserReminders:
    enabled: bool = False
    email: str | None = None
    kinds: ReminderKinds = field(default_factory=ReminderKinds)
    sent_keys: set[str] = field(default_factory=set)
    # Newest last. Also the rate limit: every email in the last hour counts.
    log: deque[SentEmail] = field(default_factory=lambda: deque(maxlen=LOG_SIZE))


class _Storage(Protocol):
    def load(self, user_id: str) -> _UserReminders: ...
    def save_settings(
        self, user_id: str, enabled: bool, email: str | None, kinds: ReminderKinds, reset_sent: bool
    ) -> None: ...
    def record(self, user_id: str, email: SentEmail, sent_keys: Iterable[str]) -> None: ...
    def opted_in(self) -> list[str]: ...


class _MemoryStorage:
    def __init__(self) -> None:
        self._users: dict[str, _UserReminders] = {}
        self._lock = Lock()

    def load(self, user_id: str) -> _UserReminders:
        with self._lock:
            return self._users.setdefault(user_id, _UserReminders())

    def save_settings(
        self, user_id: str, enabled: bool, email: str | None, kinds: ReminderKinds, reset_sent: bool
    ) -> None:
        user = self.load(user_id)
        with self._lock:
            if reset_sent:
                user.sent_keys.clear()
            user.enabled, user.email, user.kinds = enabled, email, kinds

    def record(self, user_id: str, email: SentEmail, sent_keys: Iterable[str]) -> None:
        user = self.load(user_id)
        with self._lock:
            user.log.append(email)
            user.sent_keys.update(sent_keys)

    def opted_in(self) -> list[str]:
        with self._lock:
            return [uid for uid, user in self._users.items() if user.enabled and user.email]


class _PostgresStorage:
    def load(self, user_id: str) -> _UserReminders:
        with connection() as conn:
            settings = conn.execute(
                "select * from public.reminder_settings where user_id = %s", (user_id,)
            ).fetchone()
            keys = conn.execute(
                "select key from public.reminder_sent_keys where user_id = %s", (user_id,)
            ).fetchall()
            log = conn.execute(
                "select id, sent_at as at, to_address as to, subject, body_text as text, status,"
                " trigger, error from public.reminder_emails where user_id = %s"
                " order by sent_at desc limit %s",
                (user_id, LOG_SIZE),
            ).fetchall()
        user = _UserReminders(sent_keys={row["key"] for row in keys})
        user.log.extend(SentEmail.model_validate(row) for row in reversed(log))
        if settings:
            user.enabled, user.email = settings["enabled"], settings["email"]
            user.kinds = ReminderKinds(**{kind: settings[kind] for kind in KINDS})
        return user

    def save_settings(
        self, user_id: str, enabled: bool, email: str | None, kinds: ReminderKinds, reset_sent: bool
    ) -> None:
        with connection() as conn, conn.transaction():
            conn.execute(
                "insert into public.reminder_settings"
                " (user_id, enabled, email, bills, budgets, streaks, lessons, updated_at)"
                " values (%s, %s, %s, %s, %s, %s, %s, now()) on conflict (user_id) do update set"
                " enabled = excluded.enabled, email = excluded.email, bills = excluded.bills,"
                " budgets = excluded.budgets, streaks = excluded.streaks,"
                " lessons = excluded.lessons, updated_at = now()",
                (user_id, enabled, email, kinds.bills, kinds.budgets, kinds.streaks, kinds.lessons),
            )
            if reset_sent:
                conn.execute("delete from public.reminder_sent_keys where user_id = %s", (user_id,))

    def record(self, user_id: str, email: SentEmail, sent_keys: Iterable[str]) -> None:
        with connection() as conn, conn.transaction():
            conn.execute(
                "insert into public.reminder_emails (user_id, id, sent_at, to_address, subject,"
                " body_text, status, trigger, error) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " on conflict do nothing",
                (
                    user_id,
                    email.id,
                    email.at,
                    email.to,
                    email.subject,
                    email.text,
                    email.status,
                    email.trigger,
                    email.error,
                ),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into public.reminder_sent_keys (user_id, key) values (%s, %s)"
                    " on conflict do nothing",
                    [(user_id, key) for key in sent_keys],
                )

    def opted_in(self) -> list[str]:
        with connection() as conn:
            rows = conn.execute(
                "select user_id::text from public.reminder_settings"
                " where enabled and email is not null"
            ).fetchall()
        return [row["user_id"] for row in rows]


class ReminderError(ValueError):
    """A request that can't be honoured (no address, rate limit). Safe to show the user."""


class ReminderService:
    def __init__(self, store_for: Callable[[str], DashboardStore]) -> None:
        # Looks up a user's own data (the demo set, or their fresh account).
        self._store_for = store_for
        self._memory = _MemoryStorage()
        self._postgres = _PostgresStorage()

    def _storage(self) -> _Storage:
        return self._postgres if database_enabled() else self._memory

    def _user(self, user_id: str) -> _UserReminders:
        # Saved under the data's owner: the offline demo identity shares the owner's settings.
        return self._storage().load(stores.data_owner(user_id))

    def _due(self, user_id: str, user: _UserReminders) -> list[Reminder]:
        store = self._store_for(user_id)
        return due_reminders(store.dashboard_for_user(user_id), user.kinds.enabled(), store.today())

    def _left(self, user: _UserReminders, now: datetime) -> int:
        recent = sum(1 for email in user.log if email.at > now - timedelta(hours=1))
        return max(0, MAX_EMAILS_PER_HOUR - recent)

    def state(self, settings: Settings, user_id: str, default_email: str | None) -> ReminderState:
        self._store_for(user_id).require_owner(user_id)
        user = self._user(user_id)
        due = self._due(user_id, user)
        return ReminderState(
            enabled=user.enabled,
            email=user.email or default_email,
            kinds=user.kinds,
            delivery="smtp" if mailer.configured(settings) else "preview",
            sender=mailer.sender(settings) if mailer.configured(settings) else None,
            check_minutes=settings.reminder_check_minutes,
            due=[
                ReminderItem(
                    kind=item.kind,
                    title=item.title,
                    detail=item.detail,
                    already_sent=item.key in user.sent_keys,
                )
                for item in due
            ],
            log=list(reversed(user.log)),
            emails_left_this_hour=self._left(user, datetime.now(UTC)),
        )

    def update(
        self,
        settings: Settings,
        user_id: str,
        request: ReminderSettingsWrite,
        default_email: str | None,
    ) -> ReminderState:
        self._store_for(user_id).require_owner(user_id)
        email = request.email or default_email
        if request.enabled and not email:
            raise ReminderError("Add an email address to turn reminders on.")
        user = self._user(user_id)
        # A new address hasn't seen anything yet.
        self._storage().save_settings(
            stores.data_owner(user_id), request.enabled, email, request.kinds, email != user.email
        )
        return self.state(settings, user_id, default_email)

    async def _deliver(
        self,
        settings: Settings,
        user_id: str,
        user: _UserReminders,
        items: list[Reminder],
        trigger: Literal["scheduled", "manual", "test"],
    ) -> SentEmail:
        if not user.email:
            raise ReminderError("Add an email address first.")
        now = datetime.now(UTC)
        if self._left(user, now) == 0:
            raise ReminderError(
                f"Penny sends at most {MAX_EMAILS_PER_HOUR} emails an hour. Try again later."
            )
        to = user.email
        store = self._store_for(user_id)
        subject, text, body = render(
            items,
            store.profile_name(user_id),
            str(settings.frontend_origin).rstrip("/"),
            fictional=store.has_fictional_data(user_id),
        )
        if trigger == "test":
            subject = "Penny: test email"
            text = "This is a test. Email reminders from Penny are working.\n\n" + text
        status: Literal["sent", "preview", "failed"] = "preview"
        error = None
        if mailer.configured(settings):
            try:
                await mailer.send(settings, mailer.build_message(settings, to, subject, text, body))
                status = "sent"
            except mailer.MailError as failure:
                status, error = "failed", str(failure)
        record = SentEmail(
            id=f"{now.timestamp():.0f}-{uuid4().hex[:8]}",
            at=now,
            to=to,
            subject=subject,
            text=text,
            status=status,
            trigger=trigger,
            error=error,
        )
        sent_keys = [item.key for item in items] if status != "failed" else []
        self._storage().record(stores.data_owner(user_id), record, sent_keys)
        return record

    async def send_test(self, settings: Settings, user_id: str) -> SentEmail:
        self._store_for(user_id).require_owner(user_id)
        user = self._user(user_id)
        return await self._deliver(settings, user_id, user, self._due(user_id, user), "test")

    async def send_now(self, settings: Settings, user_id: str) -> SentEmail:
        """Everything due right now, including items already emailed."""
        self._store_for(user_id).require_owner(user_id)
        user = self._user(user_id)
        return await self._deliver(settings, user_id, user, self._due(user_id, user), "manual")

    async def run_scheduled(self, settings: Settings) -> list[SentEmail]:
        """One background pass: email each opted-in user only the reminders they haven't had.
        With a database, each user's pass saves anything it changed (bills recorded today)."""
        sent = []
        for user_id in self._storage().opted_in():
            try:
                if database_enabled():
                    async with unit_scope():
                        email = await self._scheduled_for(settings, user_id)
                else:
                    email = await self._scheduled_for(settings, user_id)
            except ReminderError:
                continue  # rate limited; the next pass picks these up
            if email:
                sent.append(email)
        return sent

    async def _scheduled_for(self, settings: Settings, user_id: str) -> SentEmail | None:
        user = self._user(user_id)
        if not (user.enabled and user.email):
            return None
        fresh = [item for item in self._due(user_id, user) if item.key not in user.sent_keys]
        if not fresh:
            return None
        return await self._deliver(settings, user_id, user, fresh, "scheduled")
