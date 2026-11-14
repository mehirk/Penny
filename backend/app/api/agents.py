"""Mission Control: start a mission, watch its agents work, and keep an audit trail of what the
user approved. Starting a mission saves nothing to the user's money; approving its steps goes
through /agent/apply like any other agent plan, and is then recorded here.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status

from app.agents import asking
from app.agents.models import (
    AgentStats,
    MissionApproved,
    MissionDeclined,
    MissionKind,
    MissionRun,
    MissionStart,
    MissionSummary,
    QuestionAnswer,
)
from app.agents.orchestrator import run_mission, title_for
from app.agents.runs import run_store
from app.agents.team import TEAM
from app.agents.workspace import load_workspace
from app.api.deps import AuthenticatedUser, user_store
from app.auth import CurrentUser
from app.coach.guard import validate_user_question
from app.config import get_settings
from app.store import stores

router = APIRouter(prefix="/api/v1", tags=["agents"])


# The same mission asked again on the same numbers within this window is answered from the
# earlier run: no tokens spent twice.
REUSE_WINDOW = timedelta(minutes=30)
# Missions one person can have running at once: each makes a dozen or so model calls.
MAX_RUNNING = 3
# Watch missions: at most one this often, so a burst of purchases doesn't start a crowd.
WATCH_COOLDOWN = timedelta(minutes=10)


def _earlier(run: MissionRun) -> str:
    """The earlier answer a follow-up builds on, for the agents."""
    lines = [f"The user asked: {run.goal or run.title}"]
    if run.brief:
        lines.append(f"Penny answered: {run.brief.answer}")
        lines += [f"- {n.label}: {n.value}" for n in run.brief.numbers]
        if run.brief.options:
            lines.append("Options offered: " + "; ".join(o.title for o in run.brief.options))
    elif run.summary:
        lines.append(f"Penny answered: {run.summary}")
    return "\n".join(lines)


def _start(user: CurrentUser, kind: MissionKind, goal: str, after: str | None = None) -> MissionRun:
    store = user_store(user)
    store.require_owner(user.id)
    goal = goal.strip()
    if kind in ("life_event", "purchase", "custom", "watch") and not goal:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Tell Penny what the mission is")
    owner = stores.data_owner(user.id)
    history = run_store.list(owner)
    # A follow-up keeps the earlier mission's kind and question; the new words are the choice.
    earlier = run_store.get(owner, after) if after else None
    follow_up = goal if earlier else ""
    if earlier:
        kind = earlier.kind if earlier.kind not in ("autopilot", "watch") else "custom"
        goal = earlier.goal or earlier.title
    # Everything the agents read is loaded now, while this request holds the user's data.
    ws = load_workspace(store, user.id, goal, history)
    if earlier:
        ws.follow_up, ws.earlier = follow_up, _earlier(earlier)
        ws.facts.allow_user_amounts(follow_up)
    fingerprint = hashlib.sha256(
        f"{kind}|{' '.join(goal.casefold().split())}|{follow_up.casefold()}|"
        f"{ws.dashboard.model_dump_json()}".encode()
    ).hexdigest()
    now = datetime.now(UTC)
    for older in history:
        if (
            older.fingerprint == fingerprint
            and older.status == "done"
            and not older.superseded
            and now - older.started_at < REUSE_WINDOW
        ):
            return older
    if run_store.running(owner) >= MAX_RUNNING:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Penny's agents are still on your last missions. Give them a moment.",
            headers={"Retry-After": "15"},
        )
    run = MissionRun(
        id=f"run-{secrets.token_urlsafe(9)}",
        kind=kind,
        goal=goal,
        title=follow_up[:1].upper() + follow_up[1:80] if follow_up else title_for(kind, goal),
        started_at=datetime.now(UTC),
        trigger=goal if kind == "watch" else None,
        fingerprint=fingerprint,
        follow_up=follow_up or None,
        after=earlier.id if earlier else None,
    )
    # Older drafts were worked out from numbers this mission may change: only the newest counts.
    # A Watch mission leaves the user's own missions alone.
    for older in history:
        if kind == "watch" and older.kind not in ("watch", "autopilot"):
            continue
        if not older.superseded and (older.status == "running" or older.steps):
            older.superseded = True
            run_store.save(owner, older)
    run_store.start(owner, run, run_mission(get_settings(), ws, run))
    return run


async def watch(user: CurrentUser, trigger: str) -> None:
    """Starts a Watch mission for something Penny noticed, unless one ran just now."""
    owner = stores.data_owner(user.id)
    now = datetime.now(UTC)
    if run_store.running(owner) >= MAX_RUNNING or any(
        run.kind == "watch" and now - run.started_at < WATCH_COOLDOWN
        for run in run_store.list(owner)
    ):
        return
    _start(user, "watch", trigger)


@router.post("/agents/runs", response_model=MissionRun, status_code=status.HTTP_201_CREATED)
async def start_mission(request: MissionStart, current_user: AuthenticatedUser) -> MissionRun:
    """Starts a mission in the background; poll GET /agents/runs/{id} to watch it."""
    return _start(current_user, request.kind, validate_user_question(request.goal), request.after)


@router.post("/agents/autopilot", response_model=MissionRun | None)
async def autopilot(current_user: AuthenticatedUser) -> MissionRun | None:
    """Penny's daily check, run when the app opens: starts today's if there isn't one yet,
    otherwise returns it. Nothing changes without the user's approval."""
    owner = stores.data_owner(current_user.id)
    today = user_store(current_user).today()
    for run in run_store.list(owner):
        if run.kind == "autopilot" and run.started_at.date() >= today:
            return run
    return _start(current_user, "autopilot", "")


@router.get("/agents/runs", response_model=list[MissionSummary])
def list_missions(current_user: AuthenticatedUser) -> list[MissionSummary]:
    return [
        MissionSummary(
            id=run.id,
            kind=run.kind,
            title=run.title,
            status=run.status,
            started_at=run.started_at,
            elapsed_ms=run.elapsed_ms,
            agents=[lane.agent for lane in run.lanes],
            drafted=len(run.steps),
            approved=len(run.approved),
            auto=len(run.auto),
            superseded=run.superseded,
        )
        for run in run_store.list(stores.data_owner(current_user.id))
    ]


@router.get("/agents/runs/{run_id}", response_model=MissionRun)
def get_mission(run_id: str, current_user: AuthenticatedUser) -> MissionRun:
    run = run_store.get(stores.data_owner(current_user.id), run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mission not found")
    return run


@router.post("/agents/runs/{run_id}/approved", response_model=MissionRun)
def record_approval(
    run_id: str, request: MissionApproved, current_user: AuthenticatedUser
) -> MissionRun:
    """Records which of the mission's steps the user approved (after /agent/apply ran them)."""
    owner = stores.data_owner(current_user.id)
    run = run_store.get(owner, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mission not found")
    if run.superseded:
        raise HTTPException(status.HTTP_409_CONFLICT, "A newer mission replaced these steps")
    known = {step.id for step in run.steps}
    if not set(request.step_ids) <= known:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown step")
    if not set(request.declined) <= known:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown step")
    run.approved = sorted({*run.approved, *request.step_ids})
    run.declined = sorted((set(run.declined) | set(request.declined)) - set(run.approved))
    run.undo_id = request.undo_id
    run_store.save(owner, run)
    return run


@router.post("/agents/runs/{run_id}/declined", response_model=MissionRun)
def record_declined(
    run_id: str, request: MissionDeclined, current_user: AuthenticatedUser
) -> MissionRun:
    """The user turned these steps down; Penny won't suggest them again for a while."""
    owner = stores.data_owner(current_user.id)
    run = run_store.get(owner, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mission not found")
    known = {step.id for step in run.steps}
    if not set(request.step_ids) <= known:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown step")
    run.declined = sorted((set(run.declined) | set(request.step_ids)) - set(run.approved))
    run_store.save(owner, run)
    return run


@router.post("/agents/runs/{run_id}/answer", response_model=MissionRun)
def answer_question(
    run_id: str, request: QuestionAnswer, current_user: AuthenticatedUser
) -> MissionRun:
    """The user's answer to the question an agent is waiting on."""
    run = run_store.get(stores.data_owner(current_user.id), run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mission not found")
    if run.question is None or run.question.id != request.question_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "That question isn't waiting any more")
    answer = validate_user_question(request.answer)
    if not asking.answer(request.question_id, answer):
        raise HTTPException(status.HTTP_409_CONFLICT, "That question isn't waiting any more")
    return run


@router.get("/agents/stats", response_model=list[AgentStats])
def agent_stats(current_user: AuthenticatedUser) -> list[AgentStats]:
    """Each agent's record across the user's missions."""
    runs = run_store.list(stores.data_owner(current_user.id))
    stats = []
    for agent in TEAM.values():
        lanes = [(run, lane) for run in runs for lane in run.lanes if lane.agent == agent.id]
        stats.append(
            AgentStats(
                agent=agent.id,
                name=agent.name,
                emoji=agent.emoji,
                role=agent.role,
                runs=len(lanes),
                findings=sum(len(lane.findings) for _, lane in lanes),
                drafted=sum(len(lane.drafted) for _, lane in lanes),
                approved=sum(
                    1 for run, lane in lanes for step in lane.drafted if step in run.approved
                ),
            )
        )
    return stats
