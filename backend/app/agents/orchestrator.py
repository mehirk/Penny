"""Penny the orchestrator: plans a mission, runs the subagents at once, has the verifier check
their work, and hands the user one report with everything to approve.

    goal or trigger → recall (what earlier missions drafted, checked against today)
    → plan (which agents, what task each) → subagents in parallel
    → review (Penny reads their reports and hands findings to other agents: a second wave)
    → verifier (every figure against the FactBook, every draft against the cash cushion,
      duplicates merged, a report with unverified figures sent back once) → summary

Each step is written to the mission as it happens, so the app can show it live. Nothing here
saves anything: the user's approval goes through /agent/apply like any other agent plan.
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.agents.asking import Asker
from app.agents.memory import action_key
from app.agents.models import (
    AgentId,
    AgentLane,
    Brief,
    BriefNumber,
    BriefOption,
    Consideration,
    MissionKind,
    MissionRun,
    PictureItem,
    TraceStep,
    Verification,
)
from app.agents.research import Researcher
from app.agents.runtime import Act, Budget, Clock, LaneOutcome, Playbook, Report, run_lane
from app.agents.team import (
    CUSHION_CENTS,
    MAX_SPECIALISTS,
    SPECIALIST_TOOLS,
    TEAM,
    Subagent,
    benefit_to_goal,
    close_gap,
    fit_plan,
    instructions_for,
    item_from_text,
    move_thinking,
    specialist,
)
from app.agents.tools import benefits_screen, forecast_for
from app.agents.workspace import Outbox, Workspace
from app.assist import agent as planner
from app.assist.common import logger
from app.coach.facts import parse_cad
from app.coach.guard import picks_investments
from app.coach.llm import ModelUnavailable, ask_json
from app.config import Settings
from app.domain import relocation
from app.domain.finance import format_cad

# The result card's headline, and the whole answer, in characters.
HEADLINE_CHARS = 140
ANSWER_CHARS = 400
# Model calls one mission may make (plan, every subagent's rounds, revisions, summary).
MISSION_AI_CALLS = 40
MAX_STEPS = 8
MAX_FOLLOW_UPS = 3
PURCHASE_TASK = (
    "Find the current Canadian price, check whether it fits after bills, and plan how to "
    "save for it if it doesn't."
)
# Missions the user didn't start: nobody is there to answer a question.
UNATTENDED: tuple[MissionKind, ...] = ("autopilot", "watch")
# Presets whose team is always the same: planning them with the model would spend a call to
# learn what the roster already says. (The agents still use the model.)
ROSTERS_ARE_ENOUGH: tuple[MissionKind, ...] = ("checkup", "free_money", "payoff")
PLAN_TIMEOUT_SECONDS = 20.0
# Thinking a situation through writes the most: the considerations, the team, and questions.
THINK_TIMEOUT_SECONDS = 45.0

ROSTERS: dict[MissionKind, tuple[AgentId, ...]] = {
    "checkup": ("analyst", "cashflow", "planner", "people", "tutor"),
    "autopilot": ("cashflow", "analyst", "planner", "people"),
    "free_money": ("benefits", "analyst", "people", "tutor"),
    "life_event": ("planner", "cashflow", "benefits", "tutor"),
    "purchase": ("planner", "cashflow"),
    "payoff": ("cashflow", "planner", "analyst", "tutor"),
    "custom": ("analyst", "cashflow", "planner", "benefits", "people", "tutor"),
    "watch": ("cashflow", "analyst", "planner"),
}
TITLES: dict[MissionKind, str] = {
    "checkup": "Monthly check-up",
    "autopilot": "Autopilot check",
    "free_money": "Find me free money",
    "life_event": "Plan a life event",
    "purchase": "Can I afford it?",
    "payoff": "Pay off my credit card",
    "custom": "Custom mission",
    "watch": "Penny noticed something",
}
DEFAULT_TASKS: dict[AgentId, str] = {
    "analyst": "Find what stands out in this month's spending and subscriptions.",
    "cashflow": "Make sure every bill is covered until payday; cover any gap.",
    "planner": "Turn the goal into a plan: savings, budgets, and a schedule.",
    "benefits": "Find benefits and credits the user may be missing.",
    "people": "Check who owes whom and set reminders.",
    "tutor": "Pick lessons for the gaps this mission turns up.",
}
_KEYWORDS: dict[AgentId, tuple[str, ...]] = {
    "analyst": ("spend", "subscription", "budget", "where"),
    "cashflow": ("bill", "rent", "cash", "short", "card", "pay off", "debt"),
    "planner": ("save", "goal", "plan", "afford", "move", "trip", "buy"),
    "benefits": ("benefit", "tax", "credit", "grant", "free money", "aid"),
    "people": ("owe", "friend", "split", "roommate"),
    "tutor": ("learn", "teach", "understand", "explain"),
}
_FIGURE = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?\s?%")


def _metered(budget: Budget, step: str) -> dict[str, Any]:
    """Options for Penny's own model calls: counted once (by the mission's budget), their tokens
    recorded, and their fixed instructions kept in the prompt cache."""
    return {"cache_key": f"penny-{step}", "on_usage": budget.record, "counted": True}


def title_for(kind: MissionKind, goal: str) -> str:
    if kind in ("life_event", "purchase", "custom", "watch") and goal.strip():
        text = goal.strip().rstrip(".")
        return text[:1].upper() + text[1:80]
    return TITLES[kind]


def _move_plan(goal: str) -> list[tuple[AgentId, str]]:
    """A move touches everything the user has, so the whole team goes (People when there are
    roommates or friends in it)."""
    place = relocation.destination(goal)
    city = place.city if place else "the new city"
    province = relocation.PROVINCE_NAMES.get(place.province or "") if place else None
    tasks: list[tuple[AgentId, str]] = [
        (
            "planner",
            f"Cost the whole move to {city}: getting there, deposit, movers, setting up, and "
            "monthly living costs; build the savings goal and the checklist.",
        ),
        (
            "analyst",
            f"Show what rent, transit, groceries, and phone cost the user now, as the baseline "
            f"for {city}, and what flexible spending could make room.",
        ),
        (
            "cashflow",
            "Check every bill is covered until the move and what can be set aside each payday.",
        ),
        (
            "benefits",
            f"Find benefits and credits that change with a move to {province or city}.",
        ),
        ("tutor", "Pick lessons on renting in a new city and budgeting for a move."),
    ]
    if any(word in goal.casefold() for word in _KEYWORDS["people"]):
        tasks.append(("people", "Check who owes whom before the move, and set reminders."))
    return tasks


def _rule_plan(kind: MissionKind, goal: str) -> list[tuple[AgentId, str]]:
    roster = ROSTERS[kind]
    if kind == "custom":
        text = goal.casefold()
        picked = tuple(a for a in roster if any(word in text for word in _KEYWORDS[a]))
        roster = picked or ROSTERS["checkup"]
    return [(agent, DEFAULT_TASKS[agent]) for agent in roster]


_KINDS = ["cost", "task", "decision", "risk", "benefit"]
_SOURCES = ["penny", "web", "user", "none"]
_THINK_SCHEMA = {
    "type": "object",
    "properties": {
        "situation": {"type": "string"},
        "considerations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "why": {"type": "string"},
                    "kind": {"type": "string", "enum": _KINDS},
                    "source": {"type": "string", "enum": _SOURCES},
                    "owner": {"type": "string"},
                },
                "required": ["topic", "why", "kind", "source", "owner"],
                "additionalProperties": False,
            },
        },
        "team": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "agent": {"type": "string", "enum": list(TEAM)},
                    "task": {"type": "string"},
                },
                "required": ["agent", "task"],
                "additionalProperties": False,
            },
        },
        "specialists": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "emoji": {"type": "string"},
                    "role": {"type": "string"},
                    "task": {"type": "string"},
                    "tools": {
                        "type": "array",
                        "items": {"type": "string", "enum": list(SPECIALIST_TOOLS)},
                    },
                },
                "required": ["name", "emoji", "role", "task", "tools"],
                "additionalProperties": False,
            },
        },
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "why": {"type": "string"},
                    "choices": {"type": "array", "items": {"type": "string"}},
                    "assumption": {"type": "string"},
                },
                "required": ["question", "why", "choices", "assumption"],
                "additionalProperties": False,
            },
        },
        "plan": {"type": "string"},
    },
    "required": ["situation", "considerations", "team", "specialists", "questions", "plan"],
    "additionalProperties": False,
}
MAX_CONSIDERATIONS = 10
MAX_AGENTS = 7

_THINK_INSTRUCTIONS = """You are Penny, the orchestrator of a team of money agents for a Canadian
student or young adult. Before anyone works, think the situation through like an adviser who
has helped hundreds of people in exactly this spot.
1. `situation`: one sentence on what the user is really facing.
2. `considerations`: 5 to 10 things they need to keep in mind, above all the ones they didn't
   ask about (a move: the deposit, movers, switching the health card; a car: insurance and
   parking; an exchange term: tuition still owed at home, a study permit). Each: `topic` under 6
   words, `why` in one sentence, `kind` (cost, task, decision, risk, benefit), `source` (penny:
   their own numbers; web: current outside facts; user: only they know; none), and `owner`:
   the name of the agent who covers it.
3. `team`: the built-in agents that help, each with one clear task (1 to 5). A situation with
   costs needs the Planner to cost it in full (cost_plan, or plan_move for a move).
4. `specialists`: 0 to 3 new agents you create when no built-in agent covers a part well
   (a "Housing scout" for rent and neighbourhoods, a "Health coverage checker", a "Car cost
   analyst"). Each: a short `name`, one `emoji`, a one-sentence `role` and `task`, and the
   `tools` it needs. Never duplicate a built-in agent's job.
5. `questions`: 0 to 2 questions for the user, only when the answer changes the plan and
   neither their data nor the web can tell you (their rent budget, whether they'll have a car,
   a roommate). Each with 2 to 4 short `choices` and the `assumption` used if they don't answer.
6. `plan`: one or two plain, confident sentences to the user on how the team will tackle it
   (no hedging: never call anything an estimate or say it could change).
Don't calculate anything. A month already past this year means next year's."""


@dataclass
class Thinking:
    plan: str
    situation: str
    considerations: list[Consideration]
    questions: list[dict[str, Any]]
    tasks: list[tuple[Subagent, str]]


def _snapshot(ws: Workspace) -> str:
    """The user's money in a few lines, so Penny plans around their real situation."""
    d = ws.dashboard
    lines = [f"- {a.name}: {format_cad(a.balance_cents)}" for a in d.accounts[:6]]
    lines += [
        f"- Goal {g.name}: {format_cad(g.current_cents)} of {format_cad(g.target_cents)}"
        for g in d.savings_goals
        if g.status == "active"
    ][:4]
    lines.append(f"- Typical monthly surplus: {format_cad(ws.coach.typical_surplus_cents)}")
    return "\n".join(lines)


async def _model_think(
    settings: Settings, budget: Budget, run: MissionRun, ws: Workspace
) -> Thinking:
    budget.charge()
    team = "\n".join(f"- {a.id}: {a.name}. {a.role}" for a in TEAM.values())
    profile = ws.dashboard.profile
    where = ", ".join(x for x in (profile.city, profile.province) if x) or "Canada"
    value = await ask_json(
        settings,
        _THINK_INSTRUCTIONS,
        f"Mission: {TITLES[run.kind]}\nUser's words: {run.goal or '(none)'}\nPersona: "
        f"{profile.persona}\nLives in: {where}\nToday: {ws.today}\nTheir money:\n"
        f"{_snapshot(ws)}\nBuilt-in team:\n{team}\nTools a specialist can have: "
        f"{', '.join(SPECIALIST_TOOLS)}"
        + (f"\nWhat Penny remembers:\n{ws.memory.prompt()}" if ws.memory.prompt() else "")
        + (
            f"\nEarlier in this chat:\n{ws.earlier}\nThe user now says: {ws.follow_up}"
            if ws.follow_up
            else ""
        ),
        "mission_think",
        _THINK_SCHEMA,
        timeout_seconds=THINK_TIMEOUT_SECONDS,
        **_metered(budget, "think"),
    )
    tasks: list[tuple[Subagent, str]] = []
    for item in value.get("team", []):
        agent, task = item.get("agent"), " ".join(str(item.get("task", "")).split())
        if agent in TEAM and task and agent not in [m.id for m, _ in tasks]:
            tasks.append((TEAM[agent], task[:300]))
    taken = {m.name.casefold() for m, _ in tasks} | {a.name.casefold() for a in TEAM.values()}
    for item in value.get("specialists", [])[:MAX_SPECIALISTS]:
        member = specialist(
            str(item.get("name", "")),
            str(item.get("emoji", "")),
            str(item.get("role", "")),
            [str(t) for t in item.get("tools", [])],
        )
        task = " ".join(str(item.get("task", "")).split())[:300]
        if task and member.role and member.name.casefold() not in taken:
            taken.add(member.name.casefold())
            tasks.append((member, task))
    if not tasks:
        raise ModelUnavailable("empty plan")
    # An owner may be named by its name ("Cash-flow guard") or its id ("cashflow").
    names = {m.name.casefold(): m.name for m, _ in tasks}
    names |= {m.id: m.name for m, _ in tasks if m.id != "specialist"}
    considerations = [
        Consideration(
            topic=" ".join(str(c["topic"]).split())[:80],
            why=" ".join(str(c["why"]).split())[:200],
            kind=c["kind"],
            source=c["source"],
            owner=names.get(str(c.get("owner", "")).casefold()),
        )
        for c in value.get("considerations", [])
        if c.get("kind") in _KINDS and c.get("source") in _SOURCES and str(c.get("topic")).strip()
    ][:MAX_CONSIDERATIONS]
    questions = [
        q
        for q in value.get("questions", [])
        if str(q.get("question", "")).strip() and len(q.get("choices", [])) >= 2
    ][:2]
    return Thinking(
        plan=" ".join(str(value.get("plan", "")).split())[:400],
        situation=" ".join(str(value.get("situation", "")).split())[:300],
        considerations=considerations,
        questions=questions,
        tasks=tasks[:MAX_AGENTS],
    )


def _considered(run: MissionRun) -> str:
    if not run.considerations:
        return ""
    lines = [f"- {c.topic} ({c.kind}): {c.why}" for c in run.considerations]
    return "\nWhat Penny considered before planning:\n" + "\n".join(lines)


@dataclass
class FollowUp:
    agent: AgentId
    task: str
    because: str
    # How it works without a model (or when its model run fails).
    playbook: Playbook


def _rule_follow_ups(ws: Workspace, outcomes: list[LaneOutcome]) -> list[FollowUp]:
    """Hand-offs worth making between agents, decided by deterministic code."""
    done = {o.lane.agent: o for o in outcomes if o.lane.status == "done"}
    ups: list[FollowUp] = []
    if "cashflow" in done:
        forecast = forecast_for(ws, 30)
        if forecast.shortfall_cents:
            gap = ws.facts.money("Shortfall", forecast.shortfall_cents, "cash_forecast")
            ups.append(
                FollowUp(
                    "analyst",
                    f"Find spending to cut so chequing doesn't run {gap} short again.",
                    f"{done['cashflow'].lane.name} found chequing running short",
                    close_gap(gap),
                )
            )
    plan = ws.costs
    if (
        plan
        and plan.surplus_after
        and plan.surplus_after.startswith("-")
        and not any(u.agent == "analyst" for u in ups)
    ):
        gap = plan.surplus_after.lstrip("-")
        costed_by = next(
            (o.lane.name for o in outcomes if o.lane.status == "done" and o.lane.tool_calls),
            "The team",
        )
        ups.append(
            FollowUp(
                "analyst",
                f"Find {gap} a month so {plan.title} fits: trim the wants first, then work "
                "out what the biggest new cost can be.",
                f"{costed_by} found it leaves you {gap} short a month",
                fit_plan(gap),
            )
        )
    if "benefits" in done:
        matches = benefits_screen(ws, Outbox(), {})["matches"]
        best = next((m for m in matches if m["status"] == "likely" and m["up_to"]), None)
        new_goal = next(
            (
                i
                for o in outcomes
                for i in o.out.intents
                if i.kind == "goal_new" and i.goal_name and i.amount
            ),
            None,
        )
        if best and new_goal:
            goal, target_cents = new_goal.goal_name, parse_cad(str(new_goal.amount))
        else:
            active = [g for g in ws.dashboard.savings_goals if g.status == "active"]
            soonest = min(
                active, key=lambda g: (g.target_date is None, g.target_date), default=None
            )
            goal = soonest.name if soonest else None
            target_cents = soonest.target_cents if soonest else 0
        if best and goal and target_cents:
            target = ws.facts.money(f"{goal} target", target_cents, "goals")
            ups.append(
                FollowUp(
                    "planner",
                    f"Plan where the {best['name']} (up to {best['up_to']}) could go: {goal}.",
                    f"{done['benefits'].lane.name} found the {best['name']}",
                    benefit_to_goal(best["name"], best["up_to"], str(goal), target),
                )
            )
    return ups[:MAX_FOLLOW_UPS]


async def _nothing_more(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    await act.think("Checking the hand-off against what's already done")
    return Report(summary="Nothing more to add to what the team found.")


_REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "thought": {"type": "string"},
        "follow_ups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "agent": {"type": "string", "enum": list(TEAM)},
                    "task": {"type": "string"},
                    "because": {"type": "string"},
                },
                "required": ["agent", "task", "because"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["thought", "follow_ups"],
    "additionalProperties": False,
}


def _reports(lanes: list[AgentLane]) -> str:
    lines = []
    for lane in lanes:
        if lane.status != "done":
            continue
        lines.append(f"- {lane.name} ({lane.agent}): {lane.summary}")
        lines += [f"    • [{f.tone}] {f.title}: {f.detail}" for f in lane.findings]
    return "\n".join(lines)


async def _model_review(
    settings: Settings, budget: Budget, ws: Workspace, run: MissionRun, suggested: list[FollowUp]
) -> tuple[str, list[FollowUp]]:
    budget.charge()
    hints = "\n".join(f"- {u.agent}: {u.task} (because {u.because})" for u in suggested)
    value = await ask_json(
        settings,
        "You are Penny, orchestrating money agents. Read their reports and hand on findings "
        "that create new work for another agent: money found → the Planner points it at a "
        "goal; a cash gap → the Analyst finds spending to cut; a new goal → the Cash-flow guard "
        "checks the monthly saving fits; overspending → the Planner drafts a budget. Never send "
        "a follow-up to confirm an assumption, re-check, or repeat work. The hand-offs Penny's "
        f"rules suggest are usually worth sending. Send 0 to {MAX_FOLLOW_UPS} follow-ups, each a "
        "one-sentence task built on a specific finding; `because` names the agent and what it "
        "found in under 12 words. `thought` is one plain sentence to the user about what you "
        "noticed. Don't calculate.",
        f"Mission: {run.title}\nUser's words: {run.goal or '(none)'}\nReports:\n"
        f"{_reports(run.lanes)}\nHand-offs Penny's rules suggest:\n{hints or '(none)'}",
        "mission_review",
        _REVIEW_SCHEMA,
        timeout_seconds=PLAN_TIMEOUT_SECONDS,
        **_metered(budget, "review"),
    )
    rules = {u.agent: u for u in suggested}
    ups: list[FollowUp] = []
    for item in value.get("follow_ups", [])[:MAX_FOLLOW_UPS]:
        agent, task = item.get("agent"), str(item.get("task", "")).strip()[:300]
        if agent not in TEAM or not task or agent in [u.agent for u in ups]:
            continue
        rule = rules.get(agent)
        ups.append(
            FollowUp(
                agent,
                task,
                str(item.get("because", "")).strip()[:120] or "Penny's review",
                rule.playbook if rule else _nothing_more,
            )
        )
    return str(value.get("thought", "")).strip()[:300], ups


def _figures(text: str) -> int:
    return len(_FIGURE.findall(text))


def _report_text(lane: AgentLane) -> str:
    return " ".join([lane.summary or "", *(f"{f.title} {f.detail}" for f in lane.findings)])


async def _verify(
    ws: Workspace, run: MissionRun, outcomes: list[LaneOutcome], clock: Clock
) -> None:
    v = Verification(status="running")
    run.verification = v

    def note(kind: str, title: str, detail: str | None = None) -> None:
        v.steps.append(TraceStep(at_ms=clock.ms(), kind=kind, title=title, detail=detail))  # type: ignore[arg-type]

    # 1. Every figure in every report must be one a tool produced (or the user wrote).
    for outcome in outcomes:
        lane = outcome.lane
        if lane.status != "done":
            continue
        text = _report_text(lane)
        v.figures_checked += _figures(text)
        problems = ws.facts.unverified_figures(text)
        if not problems:
            continue
        note("check", f"{lane.name}: {', '.join(problems)} not from a tool", "Sent back")
        fixed = False
        if outcome.session:
            try:
                revised = await outcome.session.revise(problems)
                if not ws.facts.unverified_figures(
                    " ".join(
                        [revised.summary, *(f"{f.title} {f.detail}" for f in revised.findings)]
                    )
                ):
                    lane.summary, lane.findings = revised.summary, revised.findings
                    fixed = True
                    v.notes.append(f"{lane.name}: rewrote its report with verified figures")
            except ModelUnavailable:
                pass
        if not fixed:
            scratch = Act(lane.model_copy(deep=True), ws, Outbox(), clock, 0)
            fallback: Report = await outcome.playbook(scratch, ws, run.kind)
            lane.summary, lane.findings = fallback.summary, fallback.findings
            v.notes.append(f"{lane.name}: replaced its report with built-in findings")
        note("check", f"{lane.name}: report fixed")
    await asyncio.sleep(0)

    # 2. Drafts: no duplicates, and together they must leave the cushion in chequing.
    chequing_ids = {a.id for a in ws.dashboard.accounts if a.account_type == "chequing"}
    room = ws.coach.account_total("chequing") - ws.coach.unpaid_bills_cents - CUSHION_CENTS
    seen: set[tuple[Any, ...]] = set()
    out_of_chequing = 0
    steps = []
    for outcome in outcomes:
        lane = outcome.lane
        for intent in outcome.out.intents:
            v.actions_checked += 1
            built, _, question, _ = planner.build_steps(ws.plan, [intent])
            if question or not built:
                v.notes.append(f"{lane.name}: dropped an incomplete draft ({question})")
                continue
            step = built[0]
            action = step.action
            key = action_key(action)
            if key in seen:
                v.notes.append(f"{lane.name}: “{step.title}” was already drafted, merged")
                note("check", f"Merged a duplicate: {step.title}")
                continue
            declined = ws.memory.declined.get(action_key(action))
            if declined:
                v.notes.append(
                    f"{lane.name}: skipped “{step.title}”: you turned it down on "
                    f"{declined[1]:%b} {declined[1].day}"
                )
                note("check", f"Remembered you said no: {step.title}")
                continue
            leaves = 0
            if (
                action.kind == "transfer"
                and action.from_account_id in chequing_ids
                or action.kind == "goal_add"
                and action.account_id in chequing_ids
            ):
                leaves = action.amount_cents
            if leaves and out_of_chequing + leaves > room:
                v.notes.append(
                    f"{lane.name}: held back “{step.title}”: with the other steps it would "
                    f"leave less than {format_cad(CUSHION_CENTS)} in chequing after bills"
                )
                note("check", f"Held back: {step.title}", "Would break the chequing cushion")
                continue
            out_of_chequing += leaves
            seen.add(key)
            if len(steps) >= MAX_STEPS:
                break
            step.id = f"step-{len(steps) + 1}"
            step.lines = [*step.lines, f"Suggested by {lane.emoji} {lane.name}"]
            lane.drafted.append(step.id)
            steps.append(step)
    run.steps = steps
    note(
        "check",
        f"Checked {v.figures_checked} figures and {v.actions_checked} drafts",
        "All figures trace back to tested code" if not v.notes else None,
    )
    v.status = "fixed" if v.notes else "passed"


def _whole_sentences(text: str, limit: int) -> str:
    """As many whole sentences as fit in `limit` characters (never cut mid-word)."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    kept = ""
    for sentence in re.findall(r"[^.!?]+[.!?]+(?=\s|$)", text):
        if len(kept) + len(sentence) > limit:
            break
        kept += sentence
    return kept.strip() or text[: limit - 1].rsplit(" ", 1)[0] + "…"


def _headline(run: MissionRun) -> str:
    urgent = [f.title for lane in run.lanes for f in lane.findings if f.tone == "alert"]
    if urgent:
        return f"{urgent[0]}: your agents have a plan."
    if run.steps:
        return "Your agents found a few ways to get ahead."
    return "You're on track. Your agents took care of the rest."


def _first_sentence(text: str) -> str:
    found = re.match(r"^.*?[.!?](?=\s|$)", text.strip())
    sentence = found.group(0) if found else text.strip()
    if len(sentence) <= HEADLINE_CHARS:
        return sentence
    return sentence[: HEADLINE_CHARS - 1].rsplit(" ", 1)[0].rstrip(",;:—-") + "…"


def _fact(ws: Workspace, label_starts: str) -> str | None:
    """The first figure registered under a label (the 3-month plan comes before the 6-month)."""
    return next((f.display for f in ws.facts.facts if f.label.startswith(label_starts)), None)


def _built_in_brief(ws: Workspace, run: MissionRun) -> Brief:
    """Without a model: the lead finding as the answer, and for a purchase, its numbers and
    the three ways to go."""
    lead = next(
        (f for lane in run.lanes for f in sorted(lane.findings, key=lambda f: _RANK[f.tone])),
        None,
    )
    answer = f"{lead.title}. {lead.detail}" if lead else _headline(run)
    picture = _built_in_picture(ws, run)
    if ws.costs:
        return _costs_brief(ws, run).model_copy(update={"picture": picture})
    if run.kind != "purchase" or lead is None:
        return Brief(answer=answer[:400], picture=picture)
    item = item_from_text(run.goal)
    planner = next((lane for lane in run.lanes if lane.agent == "planner"), None)
    if planner and planner.summary:
        answer = planner.summary
    price = _fact(ws, f"{item} before tax") or _fact(ws, f"{item} price")
    if price is None:  # no price yet: nothing to weigh
        return Brief(answer=answer[:400])
    total = _fact(ws, f"{item} with tax")
    numbers = [
        BriefNumber(label=label, value=value)
        for label, value in (
            ("Price", price),
            ("With tax", total),
            ("Safe to spend", _fact(ws, "Safe to spend")),
            ("Chequing after buying", _fact(ws, f"Chequing after bills and {item}")),
            ("Saving for 3 months", _fact(ws, f"Monthly saving for {item}")),
        )
        if value
    ]
    save = [
        BriefOption(
            title="Save for it over 3 months",
            detail="Start a goal and set money aside after each payday.",
            recommended=lead.tone != "good",
        ),
        BriefOption(
            title="Save for it over 6 months",
            detail="Smaller monthly amounts that leave more room each month.",
        ),
    ]
    cheaper = BriefOption(
        title="Look for a cheaper option",
        detail="A previous model or a refurbished one costs less.",
    )
    if lead.tone == "alert":  # it doesn't fit: buying now isn't an option
        options = [*save, cheaper]
    else:
        buy = BriefOption(
            title="Buy it now",
            detail="It fits after bills this month."
            if lead.tone == "good"
            else "Possible, but it eats into savings or your budget.",
            recommended=lead.tone == "good",
        )
        options = [buy, save[0], cheaper]
    # After the user picked an option, the others are what's left to choose.
    picked = ws.follow_up.casefold()
    options = [o for o in options if o.title.casefold() != picked]
    return Brief(answer=answer[:400], numbers=numbers[:5], options=options)


def _built_in_picture(ws: Workspace, run: MissionRun) -> list[PictureItem]:
    """Without a model: what the agents drafted and did, and the first dated tasks."""
    items = [
        PictureItem(group="you_do", title=t.title, detail=f"By {t.due_on:%B} {t.due_on.day}.")
        for t in ws.checklist[:3]
    ]
    items += [
        PictureItem(group="penny_did", title=step.title, detail="Drafted: approve it below.")
        for step in run.steps[:2]
    ]
    items += [
        PictureItem(group="penny_did", title=task.title, detail=task.detail[:240])
        for task in run.auto[:2]
    ]
    return items


def _costs_context(ws: Workspace) -> str:
    """When the situation was costed: the plan in brief, and how to answer it (kept out of the
    fixed instructions so their prompt cache holds)."""
    plan = ws.costs
    if plan is None:
        return ""
    priced = [i.label.lower() for i in [*plan.upfront, *plan.monthly] if i.amount and not i.asked]
    return (
        f"\nCosted plan, {plan.title}: upfront {plan.upfront_total}; {plan.monthly_total} a "
        f"month vs {plan.monthly_now} for the same things now; surplus after "
        f"{plan.surplus_after}."
        + (f" A {len(ws.checklist)}-step dated checklist is shown too." if ws.checklist else "")
        + (f" Priced though they didn't ask: {', '.join(priced[:4])}." if priced else "")
        + "\nSo `numbers` are 'Upfront', 'Monthly', 'Change a month', and 'Surplus after'."
    )


def _costs_numbers(ws: Workspace) -> list[BriefNumber]:
    plan = ws.costs
    if plan is None:
        return []
    change = ("+" if plan.change_up else "−") + plan.monthly_change
    return [
        BriefNumber(label=label, value=value)
        for label, value in (
            ("Upfront", plan.upfront_total),
            ("Monthly", plan.monthly_total),
            ("Change a month", change),
            ("Surplus after", plan.surplus_after),
        )
        if value
    ]


def _costs_brief(ws: Workspace, run: MissionRun) -> Brief:
    """Without a model: the plan in numbers, what the user didn't ask about, and three ways to
    go."""
    plan = ws.costs
    assert plan is not None
    short = bool(plan.surplus_after and plan.surplus_after.startswith("-"))
    answer = (
        f"{plan.title} takes about {plan.upfront_total} upfront, and your monthly costs go "
        f"{'up' if plan.change_up else 'down'} {plan.monthly_change}"
        + (
            f", which leaves you {plan.surplus_after.lstrip('-')} short a month."
            if short and plan.surplus_after
            else "."
        )
    )
    extra = [i.label.lower() for i in [*plan.upfront, *plan.monthly] if i.amount and not i.asked]
    if extra:
        answer += f" I also counted {', '.join(extra[:3])}."
    months = plan.months_to_save
    moving = relocation.is_move(run.goal)
    options = [
        BriefOption(
            title=f"Save for it over {months} months" if months else "Start saving for it",
            detail=f"Set money aside after each payday toward {plan.upfront_total}.",
            recommended=not short,
        ),
        BriefOption(
            title="Look at a shared place" if moving else "Find a cheaper way",
            detail="A room in a shared place cuts the rent and the deposit."
            if moving
            else "Cut the biggest monthly cost until it fits.",
            recommended=short,
        ),
        BriefOption(
            title="Move a month later" if moving else "Start a month later",
            detail="One more month of saving before the upfront costs land.",
        ),
    ]
    picked = ws.follow_up.casefold()
    return Brief(
        answer=_whole_sentences(answer, ANSWER_CHARS),
        numbers=_costs_numbers(ws),
        options=[o for o in options if o.title.casefold() != picked],
    )


_RANK = {"alert": 0, "watch": 1, "good": 2, "info": 3}
_BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "numbers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"label": {"type": "string"}, "value": {"type": "string"}},
                "required": ["label", "value"],
                "additionalProperties": False,
            },
        },
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "recommended": {"type": "boolean"},
                },
                "required": ["title", "detail", "recommended"],
                "additionalProperties": False,
            },
        },
        "picture": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "group": {"type": "string", "enum": ["you_do", "penny_did", "skip"]},
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["group", "title", "detail"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["answer", "numbers", "options", "picture"],
    "additionalProperties": False,
}


async def _brief(settings: Settings, budget: Budget, ws: Workspace, run: MissionRun) -> Brief:
    """The answer to the user, like an adviser would give it. Every figure must be verified;
    a number or option that isn't is dropped, and an answer that isn't falls back."""
    fallback = _built_in_brief(ws, run)
    if run.source != "ai":
        return fallback
    try:
        budget.charge()
        steps = "\n".join(f"- {s.title}: {'; '.join(s.lines[:2])}" for s in run.steps)
        facts = "\n".join(f"- {f.label}: {f.display}" for f in ws.facts.facts[-60:])
        value = await ask_json(
            settings,
            "You are Penny, a sharp money coach for a Canadian student or young adult. Answer"
            " like a confident financial adviser, from your agents' work below. `answer`: two"
            " or three short sentences, under 60 words. Start with the direct answer (yes, "
            "not yet, yes if…), then the reason in their numbers: what it costs with tax, "
            "what they have, and what doing it leaves them with. Every figure below is "
            "checked: state them plainly. Never say a figure is unverified, an estimate to "
            "double-check, or needs confirming; never tell the user to confirm the price or "
            "tax; never say you can't do something or that earlier answers were wrong. Name "
            "where a web price comes from ('Apple Canada lists…'). Sales tax is for the "
            "user's province on file. `numbers`: the 4 figures that matter most, each a label"
            " of one to three words ('Price', 'With tax', 'Left after', 'Monthly saving') and"
            " its value exactly as written below. `options`: 2 or 3 different paths they "
            "could take next, each a title in their voice under 6 words ('Buy it now', 'Save "
            "for it over 6 months', 'Look at a cheaper model') and one sentence under 18 "
            "words on what happens; mark the one you'd suggest as recommended. Approving a "
            "draft is the button under your answer, so never offer 'approve' as an option. "
            "When the user already picked an option, answer that choice: say what's now set "
            "up and what's next. `picture`: the full picture, from what Penny considered and "
            "the reports: up to 4 `you_do` (what only the user can do, with when if known), up "
            "to 3 `penny_did` (what the agents set up or drafted), and up to 2 `skip` (what "
            "looks important but isn't worth their money or time here, and why); titles under "
            "8 words, details under 20. Use only figures that appear below. No investment, "
            "tax, legal, or credit advice.",
            (
                f"Earlier in this chat:\n{ws.earlier}\nThe user now says: {ws.follow_up}\n"
                "Answer what they chose.\n"
                if ws.follow_up
                else ""
            )
            + f"User's words: {run.goal or run.title}\nAgent reports:\n{_reports(run.lanes)}\n"
            f"Drafted for approval:\n{steps or '(nothing)'}\nVerified figures:\n{facts}"
            + _considered(run)
            + _costs_context(ws),
            "mission_brief",
            _BRIEF_SCHEMA,
            timeout_seconds=PLAN_TIMEOUT_SECONDS,
            **_metered(budget, "brief"),
        )
        answer = _whole_sentences(str(value.get("answer", "")), ANSWER_CHARS)
        if not answer or ws.facts.unverified_figures(answer) or picks_investments(answer):
            return fallback
        numbers = [
            BriefNumber(label=str(n["label"])[:60], value=str(n["value"])[:40])
            for n in value.get("numbers", [])
            if not ws.facts.unverified_figures(str(n.get("value", "")))
        ][:5]
        options = [
            BriefOption(
                title=str(o["title"])[:60],
                detail=str(o["detail"])[:240],
                recommended=bool(o.get("recommended")),
            )
            for o in value.get("options", [])
            if not ws.facts.unverified_figures(f"{o.get('title', '')} {o.get('detail', '')}")
            and not picks_investments(f"{o.get('title', '')} {o.get('detail', '')}")
        ][:3]
        picture = [
            PictureItem(
                group=item["group"],
                title=str(item["title"])[:80],
                detail=str(item["detail"])[:240],
            )
            for item in value.get("picture", [])
            if item.get("group") in ("you_do", "penny_did", "skip")
            and not ws.facts.unverified_figures(f"{item.get('title', '')} {item.get('detail', '')}")
            and not picks_investments(f"{item.get('title', '')} {item.get('detail', '')}")
        ][:10]
        if ws.costs and len(numbers) < 3:
            numbers = _costs_numbers(ws)
        return Brief(
            answer=answer, numbers=numbers, options=options, picture=picture or fallback.picture
        )
    except ModelUnavailable:
        return fallback


def _lane(member: Subagent, task: str, wave: int = 1, because: str | None = None) -> AgentLane:
    return AgentLane(
        agent=member.id,
        name=member.name,
        emoji=member.emoji,
        role=member.role,
        task=task,
        wave=wave,
        because=because,
    )


async def _run(
    lane: AgentLane,
    member: Subagent,
    playbook: Playbook,
    ws: Workspace,
    run: MissionRun,
    settings: Settings,
    budget: Budget,
    clock: Clock,
    use_model: bool,
    context: str,
) -> LaneOutcome:
    return await run_lane(
        lane=lane,
        ws=ws,
        kind=run.kind,
        playbook=playbook,
        instructions=instructions_for(member, run.kind, run.goal),
        tools=member.tool_list(),
        settings=settings,
        budget=budget,
        clock=clock,
        # Agents whose job is a lookup run their playbook: same result, no tokens.
        use_model=use_model and member.thinks,
        context=context,
        light=member.light,
    )


def _names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


async def _ask_first(
    ws: Workspace, questions: list[dict[str, Any]], run: MissionRun, clock: Clock
) -> str:
    """Asks the user what Penny can't work out before the team goes out; returns what they said
    (or the assumptions used) for every agent to know."""
    if ws.asker is None:
        return ""
    lines = []
    for q in questions:
        if not ws.asker.can_ask():
            break
        asked = await ws.asker.ask(
            "penny",
            str(q["question"]),
            str(q.get("why", "")),
            [str(c) for c in q.get("choices", [])],
            str(q.get("assumption", "")),
        )
        if asked.answer:
            ws.facts.allow_user_amounts(asked.answer)
            lines.append(f"- {asked.question} The user said: {asked.answer}")
        else:
            lines.append(f"- {asked.question} No answer; assume: {asked.assumption}")
        run.plan_steps.append(
            TraceStep(
                at_ms=clock.ms(),
                kind="ask",
                title=f"Asked you: {asked.question}",
                detail=asked.answer or f"No answer, so assuming: {asked.assumption}",
            )
        )
    return "Penny asked the user before planning:\n" + "\n".join(lines) if lines else ""


async def run_mission(settings: Settings, ws: Workspace, run: MissionRun) -> None:
    """Runs the whole mission, updating `run` as it goes. Never raises."""
    clock = Clock()
    budget = Budget(MISSION_AI_CALLS)
    # Missions nobody asked for (Autopilot, Watch) run on the built-in playbooks: no tokens are
    # spent until the user opens one and asks for more.
    use_model = bool(settings.openai_api_key) and run.kind not in UNATTENDED
    ws.asker = Asker(run, enabled=run.kind not in UNATTENDED)
    ws.researcher = Researcher(settings, budget)
    run.memory = list(ws.memory.notes)
    try:
        if run.memory:
            run.plan_steps.append(
                TraceStep(
                    at_ms=clock.ms(),
                    kind="plan",
                    title=f"Remembered {len(run.memory)} thing"
                    + ("s" if len(run.memory) > 1 else "")
                    + " from earlier missions",
                    detail="; ".join(note.title for note in run.memory),
                )
            )
        run.plan_steps.append(
            TraceStep(
                at_ms=clock.ms(), kind="plan", title="Reading the mission", detail=run.goal or None
            )
        )
        tasks: list[tuple[Subagent, str]] | None = None
        told = ""  # what the user answered before the team went out
        moving = run.kind == "life_event" and relocation.is_move(run.goal)
        if use_model and run.kind == "purchase":
            # The price comes first: the Planner finds it, then Penny hands on what it found.
            run.source = "ai"
            tasks = [
                (
                    TEAM["planner"],
                    f"The user chose “{ws.follow_up}”: do that for this purchase."
                    if ws.follow_up
                    else PURCHASE_TASK,
                )
            ]
            run.plan = (
                "I'll have the Planner find the price and check it against your money, then "
                "hand on whatever needs more work."
            )
        elif use_model and run.kind not in ROSTERS_ARE_ENOUGH:
            run.plan_steps.append(
                TraceStep(
                    at_ms=clock.ms(),
                    kind="plan",
                    title="Thinking it through: what does this take?",
                )
            )
            try:
                thinking = await _model_think(settings, budget, run, ws)
                run.source = "ai"
                run.plan, tasks = thinking.plan, thinking.tasks
                run.considerations = thinking.considerations
                created = [m.name for m, _ in tasks if m.id == "specialist"]
                run.plan_steps[-1] = TraceStep(
                    at_ms=clock.ms(),
                    kind="plan",
                    title=f"Thought it through: {len(run.considerations)} things to keep in mind",
                    detail=" ".join(
                        x
                        for x in (
                            thinking.situation,
                            "Including: " + "; ".join(c.topic for c in run.considerations[:6]) + "."
                            if run.considerations
                            else "",
                            f"Created {_names(created)} for this mission." if created else "",
                        )
                        if x
                    ),
                )
                told = await _ask_first(ws, thinking.questions, run, clock)
            except ModelUnavailable as error:
                run.plan_steps.append(
                    TraceStep(
                        at_ms=clock.ms(),
                        kind="error",
                        title="Planned with built-in rules",
                        detail=str(error),
                    )
                )
        if tasks is None:
            if moving:
                # Without a model: Penny's built-in way through a move.
                title, detail = move_thinking(ws)
                run.plan_steps.append(
                    TraceStep(at_ms=clock.ms(), kind="plan", title=title, detail=detail)
                )
                tasks = [(TEAM[a], task) for a, task in _move_plan(run.goal)]
            else:
                tasks = [(TEAM[a], task) for a, task in _rule_plan(run.kind, run.goal)]
            if use_model:
                run.source = "ai"
            run.plan = "I'll send " + _names([m.name for m, _ in tasks]) + " at the same time."
            await asyncio.sleep(0.4)
        members = {m.name: m for m, _ in tasks}
        run.lanes = [_lane(member, task) for member, task in tasks]
        run.plan_steps.append(
            TraceStep(
                at_ms=clock.ms(),
                kind="plan",
                title=f"Sent {len(tasks)} agents in parallel",
                detail=run.plan,
            )
        )
        remembered = ws.memory.prompt()
        context = "\n\n".join(
            part
            for part in (
                f"Earlier in this chat:\n{ws.earlier}\nThe user now says: {ws.follow_up}\n"
                "Act on that: do what they chose, without re-checking what's settled."
                if ws.follow_up
                else "",
                f"What Penny remembers:\n{remembered}" if remembered else "",
                told,
                _considered(run).strip(),
            )
            if part
        )
        outcomes = list(
            await asyncio.gather(
                *(
                    _run(
                        lane,
                        members[lane.name],
                        members[lane.name].playbook,
                        ws,
                        run,
                        settings,
                        budget,
                        clock,
                        use_model,
                        context,
                    )
                    for lane in run.lanes
                )
            )
        )

        # Penny reads the reports and hands findings on: the second wave.
        suggested = _rule_follow_ups(ws, outcomes)
        follow_ups = suggested
        run.review = None
        if run.source == "ai":
            try:
                run.review, follow_ups = await _model_review(settings, budget, ws, run, suggested)
            except ModelUnavailable as error:
                logger.info("Review fell back to rules: %s", error)
        if follow_ups:
            run.review = run.review or "Some of what the team found is worth acting on: " + (
                "; ".join(u.because.rstrip(".") for u in follow_ups) + "."
            )
            wave = [_lane(TEAM[u.agent], u.task, wave=2, because=u.because) for u in follow_ups]
            run.lanes += wave
            run.plan_steps.append(
                TraceStep(
                    at_ms=clock.ms(),
                    kind="plan",
                    title=f"Read the reports: sent {len(wave)} follow-up"
                    + ("s" if len(wave) > 1 else ""),
                    detail=run.review,
                )
            )
            team_said = f"What your teammates reported:\n{_reports(run.lanes[: len(tasks)])}"
            outcomes += await asyncio.gather(
                *(
                    _run(
                        lane,
                        TEAM[up.agent],
                        up.playbook,
                        ws,
                        run,
                        settings,
                        budget,
                        clock,
                        use_model,
                        "\n\n".join(x for x in (team_said, context) if x),
                    )
                    for lane, up in zip(wave, follow_ups, strict=True)
                )
            )
        else:
            run.plan_steps.append(
                TraceStep(
                    at_ms=clock.ms(),
                    kind="plan",
                    title="Read the reports: nothing to hand off",
                    detail=run.review,
                )
            )
        await _verify(ws, run, outcomes, clock)
        run.auto = [task for lane in run.lanes for task in lane.auto]
        run.costs, run.checklist = ws.costs, ws.checklist
        run.ai_calls = budget.used
        run.tokens = budget.tokens
        run.brief = await _brief(settings, budget, ws, run)
        answered = run.source == "ai" or run.kind == "purchase"
        run.summary = _first_sentence(run.brief.answer) if answered else _headline(run)
        run.ai_calls = budget.used
        run.tokens = budget.tokens
        run.status = "done"
    except Exception:  # the mission reports its failure instead of vanishing
        logger.exception("Mission %s failed", run.id)
        run.status = "failed"
        run.error = "Something went wrong running this mission. Try again."
    run.finished_at = datetime.now(UTC)
    run.elapsed_ms = clock.ms()
