"""Everything a mission's agents read, loaded once while the request that starts it is open.

The agents then work from this snapshot in the background; none of them writes. One FactBook
is shared by every agent, so the verifier can check any figure against what a tool produced.
"""

from dataclasses import dataclass, field
from datetime import date

from app.agents.asking import Asker
from app.agents.memory import Memory, recall
from app.agents.models import AutoTask, ChecklistItem, CostPlan, MissionRun
from app.agents.research import Researcher
from app.assist import agent as planner
from app.coach.context import CoachContext, load_context
from app.coach.facts import FactBook
from app.dashboard_models import DashboardResponse
from app.learning.models import LearnState
from app.store import DashboardStore


@dataclass
class Workspace:
    user_id: str
    coach: CoachContext
    plan: planner.Context
    learn: LearnState
    goal: str
    memory: Memory = field(default_factory=Memory)
    # In a follow-up: what the user said or picked next, and the earlier answer it follows.
    follow_up: str = ""
    earlier: str = ""
    # Set when the mission starts: questions for the user, and web research.
    asker: Asker | None = None
    researcher: Researcher | None = None
    # The situation costed in full (cost_plan, plan_move) and a move's checklist, for the answer.
    costs: CostPlan | None = None
    checklist: list[ChecklistItem] = field(default_factory=list)

    @property
    def dashboard(self) -> DashboardResponse:
        return self.coach.dashboard

    @property
    def facts(self) -> FactBook:
        return self.coach.facts

    @property
    def today(self) -> date:
        return self.plan.today


@dataclass
class Outbox:
    """What one agent drafted (to approve) and did on its own (no money involved)."""

    intents: list[planner.Intent] = field(default_factory=list)
    auto: list[AutoTask] = field(default_factory=list)


def load_workspace(
    store: DashboardStore, user_id: str, goal: str, history: list[MissionRun] | None = None
) -> Workspace:
    """`history`: the user's earlier missions, most recent first, for Penny's memory."""
    coach = load_context(store, user_id)
    coach.facts.allow_user_amounts(goal)
    plan = planner.context_for(store, user_id)
    return Workspace(
        user_id=user_id,
        coach=coach,
        plan=plan,
        learn=store.learn_state(user_id),
        goal=goal,
        memory=recall(history or [], coach.dashboard, coach.facts, plan.today),
    )
