"""Plan check-in: after the user approves a mission, Home keeps track of it. How much of its
checklist is done, what's next and what's overdue, and how the savings goal it set up is coming
along. Pure and deterministic: no model call, and money stays in integer cents from the goal.
"""

from collections.abc import Iterable, Sequence
from datetime import date

from app.agent_models import GoalAddAction, GoalNewAction, GoalUpdateAction
from app.agents.models import MissionRun
from app.dashboard_models import DashboardModel, Goal

# Plans shown at once on Home.
MAX_PLANS = 3


class PlanNext(DashboardModel):
    item_id: str
    title: str
    due_on: date
    overdue: bool


class PlanGoal(DashboardModel):
    goal_id: str
    name: str
    current_cents: int
    target_cents: int
    progress_basis_points: int
    target_date: date | None


class PlanCheckIn(DashboardModel):
    run_id: str
    title: str
    done: int
    total: int
    overdue: int
    next: PlanNext | None
    goal: PlanGoal | None


def _same_name(a: str, b: str) -> bool:
    return " ".join(a.casefold().split()) == " ".join(b.casefold().split())


def _goal_for(run: MissionRun, goals: Sequence[Goal]) -> Goal | None:
    """The savings goal an approved step of this mission created or added to."""
    for step in run.steps:
        if step.id not in run.approved:
            continue
        action = step.action
        if isinstance(action, (GoalAddAction, GoalUpdateAction)):
            found = next((goal for goal in goals if goal.id == action.goal_id), None)
        elif isinstance(action, GoalNewAction):
            found = next((goal for goal in goals if _same_name(goal.name, action.name)), None)
        else:
            continue
        if found is not None:
            return found
    return None


def check_in(run: MissionRun, goals: Sequence[Goal], today: date) -> PlanCheckIn | None:
    """A plan to keep track of, or None: only a finished mission the user approved something in,
    with a checklist, and not replaced by a newer one."""
    if run.status != "done" or run.superseded or not run.approved or not run.checklist:
        return None
    ticked = set(run.ticked)
    left = sorted(
        (item for item in run.checklist if item.id not in ticked), key=lambda item: item.due_on
    )
    goal = _goal_for(run, goals)
    first = left[0] if left else None
    return PlanCheckIn(
        run_id=run.id,
        title=run.title,
        done=len(run.checklist) - len(left),
        total=len(run.checklist),
        overdue=sum(1 for item in left if item.due_on < today),
        next=PlanNext(
            item_id=first.id, title=first.title, due_on=first.due_on, overdue=first.due_on < today
        )
        if first
        else None,
        goal=PlanGoal(
            goal_id=goal.id,
            name=goal.name,
            current_cents=goal.current_cents,
            target_cents=goal.target_cents,
            progress_basis_points=goal.progress_basis_points,
            target_date=goal.target_date,
        )
        if goal
        else None,
    )


def check_ins(runs: Iterable[MissionRun], goals: Sequence[Goal], today: date) -> list[PlanCheckIn]:
    """The plans to show, most recent mission first (runs come newest first), unfinished before
    finished, at most MAX_PLANS."""
    plans = [plan for run in runs if (plan := check_in(run, goals, today)) is not None]
    plans.sort(key=lambda plan: plan.done == plan.total)  # stable: keeps newest first
    return plans[:MAX_PLANS]
