"""Who sees which data: the demo identity (and the configured owner) get the fictional Sam data
set; every other signed-in user gets their own empty account, made on first use.

With PENNY_DATABASE_URL set, stores are loaded from and saved to Postgres for each request
(app/db). The demo set is saved under PENNY_DEMO_OWNER_USER_ID; without one it stays in
memory. Without a database everything is in memory and resets when the server restarts.
"""

import re
from collections.abc import Iterable
from threading import RLock

from fastapi import HTTPException, status

from app.config import get_settings
from app.models import DemoUser
from app.store.seed import demo_snapshot, empty_snapshot
from app.store.store import DashboardStore

MAX_FRESH_ACCOUNTS = 200


def _configured_owner_ids() -> tuple[str, ...]:
    owner = get_settings().demo_owner_user_id
    return (owner,) if owner else ()


def _name_from_email(email: str | None) -> str:
    """ "maya.singh@x.com" -> "Maya". Falls back to "there" (as in "Good morning, there")."""
    local = (email or "").split("@")[0]
    word = next((part for part in re.split(r"[._+\-\d]+", local) if part.isalpha()), "")
    return word[:30].capitalize() or "there"


def demo_store(owner_user_ids: Iterable[str] = ()) -> DashboardStore:
    """The fictional demo data set, owned by the demo identity and `owner_user_ids`."""
    return DashboardStore(demo_snapshot(), owner_user_ids)


def fresh_store(user_id: str, email: str | None) -> DashboardStore:
    """A new person's empty account, named from their email address."""
    owner = DemoUser(
        id=user_id, display_name=_name_from_email(email), currency="CAD", is_fictional=False
    )
    return DashboardStore(empty_snapshot(owner))


class StoreRegistry:
    def __init__(self, demo: DashboardStore) -> None:
        self.demo = demo
        self._fresh: dict[str, DashboardStore] = {}
        self._lock = RLock()

    def for_user(self, user_id: str, email: str | None = None) -> DashboardStore:
        from app.db.pool import database_enabled
        from app.db.unit import current_unit

        if database_enabled():
            owners = _configured_owner_ids()
            if self.demo.is_owner(user_id) and owners:
                return current_unit().store_for(
                    owners[0], lambda: demo_store(owners), self.demo.owner_user_ids
                )
            if not self.demo.is_owner(user_id):
                return current_unit().store_for(user_id, lambda: fresh_store(user_id, email))
        if self.demo.is_owner(user_id):
            return self.demo
        with self._lock:
            store = self._fresh.get(user_id)
            if store is None:
                if len(self._fresh) >= MAX_FRESH_ACCOUNTS:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE, "Penny can’t open new accounts now"
                    )
                store = self._fresh[user_id] = fresh_store(user_id, email)
            return store

    def delete_user(self, user_id: str) -> bool:
        """Erases everything this person saved; True when their sign-in was deleted too. Never
        the fictional demo, which other people share."""
        from app.db import repository
        from app.db.pool import connection, database_enabled

        if self.demo.is_owner(user_id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "The fictional demo account can’t be deleted"
            )
        if database_enabled():
            with connection() as conn:
                return repository.delete_user(conn, user_id)
        with self._lock:
            self._fresh.pop(user_id, None)
        return False

    def is_demo(self, user_id: str) -> bool:
        return self.demo.is_owner(user_id)

    def data_owner(self, user_id: str) -> str:
        """Whose saved data this is. The offline demo identity shares the configured owner's."""
        owners = _configured_owner_ids()
        return owners[0] if owners and self.demo.is_owner(user_id) else user_id


stores = StoreRegistry(demo_store(_configured_owner_ids()))
