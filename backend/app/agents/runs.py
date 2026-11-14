"""Missions: live in memory while they run, and kept in Postgres (agent_runs) once they finish,
so Mission Control's history and audit trail follow the user across devices. Without a
database they stay in memory.
"""

import asyncio
import logging
from collections import OrderedDict
from collections.abc import Coroutine
from threading import Lock
from typing import Any

from psycopg.types.json import Jsonb

from app.agents.models import MissionRun
from app.db.pool import connection, database_enabled

MAX_RUNS = 30
INTERRUPTED = (
    "This mission stopped when Penny's server restarted. Ask again and the agents will redo it."
)

logger = logging.getLogger(__name__)


def _settled(run: MissionRun) -> MissionRun:
    """A saved run still marked running that this server isn't running was cut off by a
    restart: it reports that, instead of waiting forever."""
    if run.status == "running":
        run.status, run.error = "failed", INTERRUPTED
    return run


class RunStore:
    def __init__(self) -> None:
        self._memory: dict[str, OrderedDict[str, MissionRun]] = {}
        self._lock = Lock()
        # Running missions, kept referenced until they finish.
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, owner: str, run: MissionRun, work: Coroutine[Any, Any, None]) -> None:
        """Keeps `run` and runs `work` in the background, saving the run as it starts (so it
        survives a restart) and when it ends."""
        self.save(owner, run)

        async def go() -> None:
            await work
            await asyncio.to_thread(self.save, owner, run)

        task = asyncio.create_task(go())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _remember(self, owner: str, run: MissionRun) -> None:
        with self._lock:
            mine = self._memory.setdefault(owner, OrderedDict())
            mine[run.id] = run
            mine.move_to_end(run.id)
            while len(mine) > MAX_RUNS:
                mine.popitem(last=False)

    def save(self, owner: str, run: MissionRun) -> None:
        """Keeps the run in memory and in Postgres. A database failure is logged, not raised:
        the mission carries on from memory."""
        self._remember(owner, run)
        if not database_enabled():
            return
        try:
            self._write(owner, run)
        except Exception:
            logger.exception("Couldn't save mission %s", run.id)

    def _write(self, owner: str, run: MissionRun) -> None:
        with connection() as conn:
            conn.execute(
                "insert into public.agent_runs (user_id, id, kind, status, run, created_at,"
                " updated_at) values (%s, %s, %s, %s, %s, %s, now()) on conflict (user_id, id)"
                " do update set status = excluded.status, run = excluded.run, updated_at = now()",
                (
                    owner,
                    run.id,
                    run.kind,
                    run.status,
                    Jsonb(run.model_dump(mode="json")),
                    run.started_at,
                ),
            )
            conn.execute(
                "delete from public.agent_runs where user_id = %s and id not in (select id from"
                " public.agent_runs where user_id = %s order by created_at desc limit %s)",
                (owner, owner, MAX_RUNS),
            )

    def running(self, owner: str) -> int:
        """How many of this person's missions this server is running now."""
        with self._lock:
            return sum(run.status == "running" for run in self._memory.get(owner, {}).values())

    def get(self, owner: str, run_id: str) -> MissionRun | None:
        with self._lock:
            found = self._memory.get(owner, {}).get(run_id)
        if found or not database_enabled():
            return found
        with connection() as conn:
            row = conn.execute(
                "select run from public.agent_runs where user_id = %s and id = %s",
                (owner, run_id),
            ).fetchone()
        return _settled(MissionRun.model_validate(row["run"])) if row else None

    def list(self, owner: str) -> list[MissionRun]:
        """Most recent first: saved missions, with any still running in this server."""
        with self._lock:
            live = dict(self._memory.get(owner, {}))
        runs = dict(live)
        if database_enabled():
            with connection() as conn:
                rows = conn.execute(
                    "select run from public.agent_runs where user_id = %s"
                    " order by created_at desc limit %s",
                    (owner, MAX_RUNS),
                ).fetchall()
            for row in rows:
                saved = MissionRun.model_validate(row["run"])
                if saved.id not in runs:
                    runs[saved.id] = _settled(saved)
        return sorted(runs.values(), key=lambda run: run.started_at, reverse=True)[:MAX_RUNS]

    def delete_all(self, owner: str) -> None:
        with self._lock:
            self._memory.pop(owner, None)
        if database_enabled():
            with connection() as conn:
                conn.execute("delete from public.agent_runs where user_id = %s", (owner,))


run_store = RunStore()
