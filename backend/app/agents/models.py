"""What a mission looks like to the app: the orchestrator's plan, one lane per subagent with its
live trace and results, the verifier's check, and the steps waiting for the user's approval."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field

from app.agent_models import AgentStep
from app.coach.guard import Redacted, web_url
from app.dashboard_models import DashboardModel

# "specialist": an agent Penny creates for one mission, with its own name, role, and tools.
AgentId = Literal["analyst", "planner", "cashflow", "benefits", "people", "tutor", "specialist"]
MissionKind = Literal[
    "checkup", "free_money", "life_event", "payoff", "purchase", "custom", "autopilot", "watch"
]
LaneStatus = Literal["queued", "running", "waiting", "done", "failed"]
RunStatus = Literal["running", "done", "failed"]
Source = Literal["ai", "built_in"]


class TraceStep(DashboardModel):
    """One thing an agent did, in order: planned, thought, called a tool, checked, or failed."""

    at_ms: int = Field(ge=0)  # since the mission started
    kind: Literal["plan", "think", "tool", "draft", "auto", "check", "error", "ask", "web"]
    title: str
    detail: str | None = None
    # A tool's input and a short view of what it returned.
    data: dict[str, Any] | None = None


class Finding(DashboardModel):
    tone: Literal["good", "watch", "alert", "info"]
    title: str = Field(min_length=1, max_length=160)
    detail: str = Field(max_length=500)


class AutoTask(DashboardModel):
    """Something an agent did on its own because it moves no money and can't go wrong: a
    reminder on the device, a lesson or guide to read. The app carries these out."""

    kind: Literal["reminder", "lesson", "guide", "link"]
    title: str
    detail: str
    due_on: date | None = None
    # A lesson id, a Money Guide id, or an official link.
    ref: str | None = None


class WebSource(DashboardModel):
    title: str
    url: Annotated[str, AfterValidator(web_url)]


class AgentLane(DashboardModel):
    agent: AgentId
    name: str
    emoji: str
    role: str
    task: str
    status: LaneStatus = "queued"
    # What it's doing right now ("Calling simulate_spending_cut…").
    current: str | None = None
    steps: list[TraceStep] = Field(default_factory=list)
    summary: str | None = None
    findings: list[Finding] = Field(default_factory=list)
    auto: list[AutoTask] = Field(default_factory=list)
    # Ids of the mission's approval steps this agent drafted.
    drafted: list[str] = Field(default_factory=list)
    tool_calls: int = 0
    ai_calls: int = 0
    elapsed_ms: int | None = None
    source: Source = "built_in"
    # The model that wrote its report (None for a playbook).
    model: str | None = None
    # 1 for the first round; 2 for follow-ups Penny sent after reading the first round's reports.
    wave: int = 1
    # Why Penny sent a follow-up ("Benefits finder found the Canada Workers Benefit").
    because: str | None = None
    # Web pages the agent read, for the user to check.
    sources: list[WebSource] = Field(default_factory=list)


class Verification(DashboardModel):
    status: Literal["running", "passed", "fixed"]
    figures_checked: int = 0
    actions_checked: int = 0
    # Problems found and what was done about each ("Planner: $412.00 isn't from a tool, sent back").
    notes: list[str] = Field(default_factory=list)
    steps: list[TraceStep] = Field(default_factory=list)


class AgentQuestion(DashboardModel):
    """An agent stopped to ask the user something it couldn't work out. Without an answer in
    time, it carries on with `assumption`."""

    id: str
    # "penny" when Penny asks before sending the team out.
    agent: AgentId | Literal["penny"]
    question: str = Field(max_length=200)
    why: str = Field(max_length=200)
    choices: list[str] = Field(default_factory=list, max_length=4)
    assumption: str = Field(max_length=200)
    answer: str | None = None
    # True when nobody answered and the agent went with its assumption.
    assumed: bool = False


class MemoryNote(DashboardModel):
    """Something Penny remembered from an earlier mission and checked again."""

    tone: Literal["good", "watch", "alert", "info"]
    title: str
    detail: str
    # The earlier mission's start date.
    from_on: date


class BriefNumber(DashboardModel):
    label: str = Field(max_length=60)
    value: str = Field(max_length=40)


class BriefOption(DashboardModel):
    """A path the user can choose; picking it is sent to Penny as their next message."""

    title: str = Field(max_length=60)
    detail: str = Field(max_length=240)
    recommended: bool = False


class PictureItem(DashboardModel):
    """One part of the full picture: something the user has to do, something Penny's agents
    did or drafted, or something that isn't worth their money or time."""

    group: Literal["you_do", "penny_did", "skip"]
    title: str = Field(max_length=80)
    detail: str = Field(max_length=240)


class Brief(DashboardModel):
    """The answer to the user's question, the way an adviser would give it: the direct answer,
    the numbers behind it, the full picture, and the options. Every figure is verified like a
    report's."""

    answer: str = Field(max_length=400)
    numbers: list[BriefNumber] = Field(default_factory=list, max_length=5)
    options: list[BriefOption] = Field(default_factory=list, max_length=3)
    picture: list[PictureItem] = Field(default_factory=list, max_length=10)


class Consideration(DashboardModel):
    """Something the user needs to keep in mind, from Penny thinking the situation through
    before planning: what it is, why it matters, and who on the team covers it."""

    topic: str = Field(max_length=80)
    why: str = Field(max_length=200)
    kind: Literal["cost", "task", "decision", "risk", "benefit"]
    # Where the answer comes from: Penny's numbers, the web, or the user.
    source: Literal["penny", "web", "user", "none"]
    # The name of the agent covering it.
    owner: str | None = Field(default=None, max_length=60)


class TokenUse(DashboardModel):
    """What a mission cost in model tokens; `cached` input tokens are billed at a discount."""

    input: int = 0
    cached: int = 0
    output: int = 0
    # Answers reused instead of asked again (web searches, a repeated mission).
    reused: int = 0


class CostItem(DashboardModel):
    """One cost in a plan. `basis`: the user said it, the web found it, what they spend on it
    now, worked out from another cost (a deposit from the rent), or not priced yet (never made
    up)."""

    id: str
    label: str
    amount: str | None = None
    basis: Literal["you", "web", "now", "rent", "to_price"]
    # The user asked about it (the rest are what the situation needs that they didn't mention).
    asked: bool = False


class CostPlan(DashboardModel):
    """A situation costed in full (cost_plan or plan_move): upfront and monthly costs, against
    what the same things cost the user now and their typical surplus."""

    title: str
    upfront: list[CostItem] = Field(default_factory=list)
    monthly: list[CostItem] = Field(default_factory=list)
    upfront_total: str
    monthly_total: str
    monthly_now: str
    monthly_change: str
    change_up: bool
    surplus_after: str | None = None
    months_to_save: int | None = None


class ChecklistItem(DashboardModel):
    id: str
    title: str
    detail: str
    due_on: date
    stage: Literal["before", "moving", "after"]


class MissionRun(DashboardModel):
    id: str
    kind: MissionKind
    goal: str
    title: str
    status: RunStatus = "running"
    started_at: datetime
    finished_at: datetime | None = None
    elapsed_ms: int | None = None
    # The orchestrator's plan: why these agents, in its own words.
    plan: str | None = None
    plan_steps: list[TraceStep] = Field(default_factory=list)
    # What set off a "watch" mission ("Groceries went over budget").
    trigger: str | None = None
    # What Penny remembered from earlier missions, checked against today's numbers.
    memory: list[MemoryNote] = Field(default_factory=list)
    lanes: list[AgentLane] = Field(default_factory=list)
    # Penny's read of the first round's reports, and why it sent follow-ups (or didn't).
    review: str | None = None
    # A question waiting for the user, and the ones already asked.
    question: AgentQuestion | None = None
    asked: list[AgentQuestion] = Field(default_factory=list)
    verification: Verification | None = None
    summary: str | None = None
    brief: Brief | None = None
    # What Penny decided the user needs to keep in mind, before planning.
    considerations: list[Consideration] = Field(default_factory=list)
    # The situation costed in full, and a dated checklist (a move).
    costs: CostPlan | None = None
    checklist: list[ChecklistItem] = Field(default_factory=list)
    # Everything the agents drafted that changes money or data, for one approval.
    steps: list[AgentStep] = Field(default_factory=list)
    auto: list[AutoTask] = Field(default_factory=list)
    approved: list[str] = Field(default_factory=list)
    # Steps the user turned down: Penny won't suggest them again for a while.
    declined: list[str] = Field(default_factory=list)
    undo_id: str | None = None
    # A newer mission started, so steps not approved here were drafted from old numbers.
    superseded: bool = False
    ai_calls: int = 0
    tokens: TokenUse = Field(default_factory=TokenUse)
    source: Source = "built_in"
    error: str | None = None
    # A follow-up: what the user said or picked next, and the mission it follows.
    follow_up: str | None = None
    after: str | None = None
    # The question and the numbers it was worked out from, so the same mission asked again on
    # the same numbers can be answered from this one.
    fingerprint: str | None = None


class MissionStart(DashboardModel):
    kind: MissionKind
    # The user's own words for a life event or a custom mission.
    goal: Annotated[str, Redacted] = Field(default="", max_length=500)
    # A follow-up in the same chat: the mission it follows (its kind and question carry over,
    # and `goal` is what the user said or picked next).
    after: str | None = Field(default=None, max_length=40)


class MissionApproved(DashboardModel):
    """The user approved (and the app applied) these steps; kept as the mission's audit trail."""

    step_ids: list[str] = Field(min_length=1, max_length=20)
    undo_id: str | None = Field(default=None, max_length=80)
    # Steps the user unticked: turned down, so Penny remembers not to suggest them again.
    declined: list[str] = Field(default_factory=list, max_length=20)


class MissionDeclined(DashboardModel):
    step_ids: list[str] = Field(min_length=1, max_length=20)


class QuestionAnswer(DashboardModel):
    question_id: str = Field(max_length=40)
    answer: Annotated[str, Redacted] = Field(min_length=1, max_length=200)


class MissionSummary(DashboardModel):
    id: str
    kind: MissionKind
    title: str
    status: RunStatus
    started_at: datetime
    elapsed_ms: int | None
    agents: list[AgentId]
    drafted: int
    approved: int
    auto: int
    superseded: bool


class AgentStats(DashboardModel):
    agent: AgentId
    name: str
    emoji: str
    role: str
    runs: int
    findings: int
    drafted: int
    approved: int
