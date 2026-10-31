"""One shared connection pool, opened on first use and closed at shutdown."""

from collections.abc import Iterator
from contextlib import contextmanager
from threading import Lock

from psycopg import Connection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

_pool: ConnectionPool[Connection[DictRow]] | None = None
_lock = Lock()


def database_enabled() -> bool:
    return get_settings().database_url is not None


def _get_pool() -> ConnectionPool[Connection[DictRow]]:
    global _pool
    with _lock:
        if _pool is None:
            url = get_settings().database_url
            if url is None:
                raise RuntimeError("PENNY_DATABASE_URL is not set")
            _pool = ConnectionPool(
                url.get_secret_value(),
                connection_class=Connection[DictRow],
                # prepare_threshold=None: Supabase's transaction pooler can't keep prepared
                # statements between transactions; harmless on a direct connection.
                kwargs={"row_factory": dict_row, "prepare_threshold": None},
                min_size=1,
                max_size=10,
                timeout=15,
                open=True,
            )
        return _pool


@contextmanager
def connection() -> Iterator[Connection[DictRow]]:
    """A pooled connection. Wrap writes in `with conn.transaction():`."""
    with _get_pool().connection() as conn:
        yield conn


def close() -> None:
    global _pool
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None
