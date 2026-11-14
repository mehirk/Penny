"""Penny's agent: snap a receipt or say what happened, get a plan, approve it in one tap.

`/agent/plan` and `/agent/transcribe` save nothing. `/agent/apply` is the user's approval: it
runs the actions they kept, all or nothing. `/agent/undo` puts everything back while nothing
else has changed since.
"""

import logging
import secrets
import time
from dataclasses import dataclass
from threading import RLock

from fastapi import APIRouter, HTTPException, status

from app.agent_models import (
    AgentApplied,
    AgentApply,
    AgentPlan,
    AgentRequest,
    AgentUndo,
    AgentUpload,
    Transcript,
)
from app.api.deps import AuthenticatedUser, user_store
from app.assist import agent, voice
from app.config import get_settings
from app.dashboard_models import DashboardResponse
from app.db.rows import Rows, to_rows
from app.store.state import StoreSnapshot

router = APIRouter(prefix="/api/v1", tags=["agent"])
logger = logging.getLogger("penny.agent")
UNDO_SECONDS = 15 * 60


@dataclass
class _Undo:
    undo_id: str
    before: StoreSnapshot
    after: Rows
    expires: float


class UndoLog:
    """The last agent change per person, kept in memory for a while so it can be undone."""

    def __init__(self) -> None:
        self._items: dict[str, _Undo] = {}
        self._lock = RLock()

    def remember(self, user_id: str, before: StoreSnapshot, after: StoreSnapshot) -> str:
        undo_id = f"undo-{secrets.token_urlsafe(12)}"
        with self._lock:
            now = time.monotonic()
            self._items = {k: v for k, v in self._items.items() if v.expires > now}
            self._items[user_id] = _Undo(undo_id, before, to_rows(after), now + UNDO_SECONDS)
        return undo_id

    def take(self, user_id: str, undo_id: str) -> _Undo:
        with self._lock:
            item = self._items.get(user_id)
            if not item or item.undo_id != undo_id or item.expires <= time.monotonic():
                raise HTTPException(status.HTTP_410_GONE, "That can't be undone anymore")
            del self._items[user_id]
            return item


undo_log = UndoLog()


@router.post("/agent/plan", response_model=AgentPlan)
async def plan(request: AgentRequest, current_user: AuthenticatedUser) -> AgentPlan:
    """Reads what the user said or snapped into steps to approve. Saves nothing."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    return await agent.plan(get_settings(), store, current_user.id, request)


@router.post("/agent/transcribe", response_model=Transcript)
async def transcribe(upload: AgentUpload, current_user: AuthenticatedUser) -> Transcript:
    """A voice note as text. Saves nothing; the recording isn't kept."""
    user_store(current_user).require_owner(current_user.id)
    return await voice.transcribe(get_settings(), upload)


@router.post("/agent/apply", response_model=AgentApplied)
def apply(request: AgentApply, current_user: AuthenticatedUser) -> AgentApplied:
    """The user tapped "Do it": runs the steps they kept, all or nothing."""
    store = user_store(current_user)
    dashboard, done, before = store.apply_agent_actions(current_user.id, request.actions)
    undo_id = undo_log.remember(current_user.id, before, store.snapshot())
    # The audit trail: who approved which actions.
    logger.info(
        "agent apply user=%s actions=%s",
        current_user.id,
        [action.kind for action in request.actions],
    )
    return AgentApplied(dashboard=dashboard, done=done, undo_id=undo_id)


@router.post("/agent/undo", response_model=DashboardResponse)
def undo(request: AgentUndo, current_user: AuthenticatedUser) -> DashboardResponse:
    """Reverses the last agent change, if nothing else has changed since."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    item = undo_log.take(current_user.id, request.undo_id)
    if to_rows(store.snapshot()) != item.after:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Something else changed since, so undo it by hand"
        )
    logger.info("agent undo user=%s", current_user.id)
    return store.restore(current_user.id, item.before)
