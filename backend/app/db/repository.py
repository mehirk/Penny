"""Loads one person's data in a single query and saves only what changed."""

from typing import Any

from psycopg import Connection, errors, sql
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from app.db.rows import (
    JSON_COLUMNS,
    ORDERED_TABLES,
    PROFILE_COLUMNS,
    TABLE_KEYS,
    Row,
    Rows,
    diff,
    from_rows,
)
from app.store.state import StoreSnapshot


class StaleDataError(Exception):
    """Someone saved this person's data after we loaded it (another tab, device, or server)."""


def _load_query() -> sql.Composed:
    columns = []
    for table in TABLE_KEYS:
        order = sql.SQL(" order by t.seq") if table in ORDERED_TABLES else sql.SQL("")
        columns.append(
            sql.SQL(
                "(select coalesce(jsonb_agg(to_jsonb(t) - 'user_id' - 'seq'{order}), '[]'::jsonb)"
                " from public.{table} t where t.user_id = p.user_id) as {alias}"
            ).format(order=order, table=sql.Identifier(table), alias=sql.Identifier(table))
        )
    return sql.SQL("select p.*, {columns} from public.profiles p where p.user_id = %s").format(
        columns=sql.SQL(", ").join(columns)
    )


_LOAD = _load_query()


def load(conn: Connection[DictRow], user_id: str) -> tuple[StoreSnapshot, int] | None:
    """The saved snapshot and its version, or None for someone who has never been saved."""
    row = conn.execute(_LOAD, (user_id,)).fetchone()
    if row is None:
        return None
    tables = {table: row[table] for table in TABLE_KEYS}
    return from_rows(user_id, row, tables), row["state_version"]


def save(
    conn: Connection[DictRow],
    user_id: str,
    profile: Row,
    version: int | None,
    before: Rows,
    after: Rows,
) -> int:
    """Writes the changes in one transaction and returns the new version. Raises
    StaleDataError if the saved version is no longer `version` (None: not saved yet)."""
    upserts, deletes = diff(before, after)
    values = [profile[column] for column in PROFILE_COLUMNS]
    with conn.transaction():
        if version is None:
            cursor = conn.execute(
                sql.SQL(
                    "insert into public.profiles (user_id, {columns}) values (%s, {params})"
                    " on conflict (user_id) do nothing"
                ).format(
                    columns=sql.SQL(", ").join(map(sql.Identifier, PROFILE_COLUMNS)),
                    params=sql.SQL(", ").join(sql.Placeholder() * len(PROFILE_COLUMNS)),
                ),
                (user_id, *values),
            )
            new_version = 0
        else:
            cursor = conn.execute(
                sql.SQL(
                    "update public.profiles set state_version = state_version + 1,"
                    " updated_at = now(), {assignments} where user_id = %s and state_version = %s"
                ).format(
                    assignments=sql.SQL(", ").join(
                        sql.SQL("{} = %s").format(sql.Identifier(c)) for c in PROFILE_COLUMNS
                    )
                ),
                (*values, user_id, version),
            )
            new_version = version + 1
        if cursor.rowcount != 1:
            raise StaleDataError(user_id)

        with conn.cursor() as cur:
            for table, keys in deletes.items():
                cur.executemany(_delete_sql(table), [(user_id, *key) for key in keys])
            for table, rows in upserts.items():
                columns = list(rows[0])
                cur.executemany(
                    _upsert_sql(table, columns),
                    [(user_id, *(_value(table, c, row[c]) for c in columns)) for row in rows],
                )
    return new_version


def _value(table: str, column: str, value: Any) -> Any:
    return Jsonb(value) if column in JSON_COLUMNS.get(table, ()) else value


def _delete_sql(table: str) -> sql.Composed:
    conditions = [sql.SQL("user_id = %s")] + [
        sql.SQL("{} = %s").format(sql.Identifier(key)) for key in TABLE_KEYS[table]
    ]
    return sql.SQL("delete from public.{} where {}").format(
        sql.Identifier(table), sql.SQL(" and ").join(conditions)
    )


def _upsert_sql(table: str, columns: list[str]) -> sql.Composed:
    keys = ("user_id", *TABLE_KEYS[table])
    updates = [column for column in columns if column not in keys]
    action = (
        sql.SQL("do update set {}").format(
            sql.SQL(", ").join(
                sql.SQL("{0} = excluded.{0}").format(sql.Identifier(c)) for c in updates
            )
        )
        if updates
        else sql.SQL("do nothing")
    )
    return sql.SQL(
        "insert into public.{table} ({columns}) values ({params}) on conflict ({keys}) {action}"
    ).format(
        table=sql.Identifier(table),
        columns=sql.SQL(", ").join(map(sql.Identifier, ["user_id", *columns])),
        params=sql.SQL(", ").join(sql.Placeholder() * (len(columns) + 1)),
        keys=sql.SQL(", ").join(map(sql.Identifier, keys)),
        action=action,
    )


def delete_user(conn: Connection[DictRow], user_id: str) -> bool:
    """Deletes this person's sign-in (auth.users), which deletes every row of theirs through
    `on delete cascade`. If the database role isn't allowed to delete sign-ins, deletes their
    profile instead (which cascades to all their data) and returns False."""
    try:
        with conn.transaction():
            if conn.execute("delete from auth.users where id = %s", (user_id,)).rowcount:
                return True
    except (errors.InsufficientPrivilege, errors.UndefinedTable):
        pass
    with conn.transaction():
        conn.execute("delete from public.profiles where user_id = %s", (user_id,))
    return False
