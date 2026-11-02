"""Per-request loading and saving of people's stores (a unit of work).

A request loads each person's store the first time it asks for it; when the request succeeds,
everything that changed is saved in one transaction per person, guarded by a version number.
The financial code itself stays unaware of the database.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from threading import RLock

from app.db import repository
from app.db.pool import connection
from app.db.rows import Row, Rows, profile_row, to_rows
from app.store.store import DashboardStore

logger = logging.getLogger(__name__)


@dataclass
class _Loaded:
    store: DashboardStore
    profile: Row
    rows: Rows
    version: int


class Unit:
    def __init__(self) -> None:
        self._loaded: dict[str, _Loaded] = {}
        self._lock = RLock()

    def store_for(
        self, user_id: str, create: Callable[[], DashboardStore], owner_user_ids: Iterable[str] = ()
    ) -> DashboardStore:
        """This person's store, loaded once per unit. Someone new is created and saved straight
        away, so two first requests at once can't both create them."""
        with self._lock:
            loaded = self._loaded.get(user_id)
            if loaded is None:
                loaded = self._loaded[user_id] = self._load(user_id, create, tuple(owner_user_ids))
            return loaded.store

    def _load(
        self, user_id: str, create: Callable[[], DashboardStore], owners: tuple[str, ...]
    ) -> _Loaded:
        with connection() as conn:
            found = repository.load(conn, user_id)
            if found is None:
                snapshot = create().snapshot()
                try:
                    version = repository.save(
                        conn, user_id, profile_row(snapshot.profile), None, {}, to_rows(snapshot)
                    )
                    found = (snapshot, version)
                except repository.StaleDataError:
                    found = repository.load(conn, user_id)  # created by a request running alongside
                    if found is None:
                        raise
        snapshot, version = found
        return _Loaded(
            DashboardStore(snapshot, owners),
            profile_row(snapshot.profile),
            to_rows(snapshot),
            version,
        )

    def commit(self) -> None:
        """Saves every loaded store that changed. Raises StaleDataError on a conflict."""
        with self._lock:
            for user_id, loaded in self._loaded.items():
                snapshot = loaded.store.snapshot()
                profile, rows = profile_row(snapshot.profile), to_rows(snapshot)
                if profile == loaded.profile and rows == loaded.rows:
                    continue
                with connection() as conn:
                    loaded.version = repository.save(
                        conn, user_id, profile, loaded.version, loaded.rows, rows
                    )
                loaded.profile, loaded.rows = profile, rows


_current: ContextVar[Unit | None] = ContextVar("penny_unit", default=None)


def current_unit() -> Unit:
    unit = _current.get()
    if unit is None:
        raise RuntimeError("No unit of work: run this inside a request or unit_scope()")
    return unit


@asynccontextmanager
async def unit_scope(*, commit: bool = True) -> AsyncIterator[Unit]:
    """A unit of work for code outside a request (e.g. a background job). With commit=False the
    caller commits, e.g. only when a request succeeded."""
    unit = Unit()
    token = _current.set(unit)
    try:
        yield unit
        if commit:
            await asyncio.to_thread(unit.commit)
    finally:
        _current.reset(token)
