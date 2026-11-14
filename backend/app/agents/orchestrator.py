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
    MissionKind,
    MissionRun,
    TraceStep,
    Verification,
)
from app.agents.research import Researcher
from app.agents.runtime import Act, Budget, Clock, LaneOutcome, Playbook, Report, run_lane
from app.agents.team import (
    CUSHION_CENTS,
    TEAM,
    benefit_to_goal,
    close_gap,
    instructions_for,
    item_from_text,
)
from app.agents.tools import benefits_screen, forecast_for
from app.agents.workspace import Outbox, Workspace
from app.assist import agent as planner
from app.assist.common import logger
from app.coach.facts import parse_cad
from app.coach.llm import ModelUnavailable, ask_json
from app.config import Settings
from app.domain.finance import format_cad

# The result card's headline, and the whole answer, in characters.
HEADLINE_CHARS = 140
ANSWER_CHARS = 400
# Model calls one mission may make (plan, every subagent's rounds, revisions, summary).
MISSION_AI_CALLS = 30
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


def _rule_plan(kind: MissionKind, goal: str) -> list[tuple[AgentId, str]]:
    roster = ROSTERS[kind]
    if kind == "custom":
        text = goal.casefold()
        picked = tuple(a for a in roster if any(word in text for word in _KEYWORDS[a]))
        roster = picked or ROSTERS["checkup"]
    return [(agent, DEFAULT_TASKS[agent]) for agent in roster]


_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "plan": {"type": "string"},
        "tasks": {
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
    },
    "required": ["plan", "tasks"],
    "additionalProperties": False,
}


async def _model_plan(
    settings: Settings, budget: Budget, kind: MissionKind, goal: str, ws: Workspace
) -> tuple[str, list[tuple[AgentId, str]]]:
    budget.charge()
    team = "\n".join(f"- {a.id}: {a.name}. {a.role}" for a in TEAM.values())
    value = await ask_json(
        settings,
        "You are Penny, the orchestrator of a team of money agents for a Canadian student or "
        "young adult. Break the mission into one task per agent that's needed (2 to 6 agents), "
        "each a single clear sentence. Don't calculate anything. You can't ask the user anything: "
        "assume what's sensible (a month already past this year means next year's). Write "
        "`plan` as one or two plain sentences to the user about how the team will tackle it.",
        f"Mission: {TITLES[kind]}\nUser's words: {goal or '(none)'}\nPersona: "
        f"{ws.dashboard.profile.persona}\nToday: {ws.today}\nYour team:\n{team}"
        + (f"\nWhat Penny remembers:\n{ws.memory.prompt()}" if ws.memory.prompt() else ""),
        "mission_plan",
        _PLAN_SCHEMA,
        timeout_seconds=PLAN_TIMEOUT_SECONDS,
        **_metered(budget, "plan"),
    )
    tasks: list[tuple[AgentId, str]] = []
    for item in value.get("tasks", []):
        agent, task = item.get("agent"), str(item.get("task", "")).strip()
        if agent in TEAM and task and agent not in [a for a, _ in tasks]:
            tasks.append((agent, task[:300]))
    if len(tasks) < 1:
        raise ModelUnavailable("empty plan")
    return str(value.get("plan", "")).strip()[:400], tasks[:6]


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
    return next(
        (f.display for f in reversed(ws.facts.facts) if f.label.startswith(label_starts)), None
    )


def _built_in_brief(ws: Workspace, run: MissionRun) -> Brief:
    """Without a model: the lead finding as the answer, and for a purchase, its numbers and
    the three ways to go."""
    lead = next(
        (f for lane in run.lanes for f in sorted(lane.findings, key=lambda f: _RANK[f.tone])),
        None,
    )
    answer = f"{lead.title}. {lead.detail}" if lead else _headline(run)
    if run.kind != "purchase" or lead is None:
        return Brief(answer=answer[:400])
    item = item_from_text(run.goal)
    planner = next((lane for lane in run.lanes if lane.agent == "planner"), None)
    if planner and planner.summary:
        answer = planner.summary
    price = _fact(ws, f"{item} price")
    if price is None:  # no price yet: nothing to weigh
        return Brief(answer=answer[:400])
    numbers = [
        BriefNumber(label=label, value=value)
        for label, value in (
            ("Price", price),
            ("Safe to spend", _fact(ws, "Safe to spend")),
            ("Chequing after buying", _fact(ws, f"Chequing after bills and {item}")),
            ("Saving for 3 months", _fact(ws, f"Monthly saving for {item}")),
        )
        if value
    ]
    fits = lead.tone == "good"
    options = [
        BriefOption(
            title="Buy it now",
            detail="It fits after bills this month."
            if fits
            else "Possible, but it eats into savings or your budget.",
            recommended=fits,
        ),
        BriefOption(
            title="Save for it over 3 months",
            detail="Start a goal and set money aside after each payday.",
            recommended=not fits,
        ),
        BriefOption(
            title="Look for a cheaper option",
            detail="A previous model or a refurbished one costs less.",
        ),
    ]
    return Brief(answer=answer[:400], numbers=numbers[:5], options=options)


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
    },
    "required": ["answer", "numbers", "options"],
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
            "You are Penny, a money coach for a Canadian student or young adult. Answer the "
            "user's question the way a good financial adviser would, from your agents' work "
            "below. `answer`: two or three short sentences, under 60 words. Start with the direct"
            " answer (yes, not yet, yes if…), then the reason in their numbers: what it costs, "
            "what they have, and what buying or doing it leaves them with. `numbers`: the 3 to 5 "
            "figures that matter most, each a short label and its value exactly as written below "
            "(a price, safe to spend, what's left after, a monthly saving). `options`: 2 or 3 "
            "things the user could choose to do next, each a title in their voice under 6 words "
            "('Buy it now', 'Save for it over 3 months', 'Look at a cheaper model') and one "
            "sentence on what happens; mark the one you'd suggest as recommended. Use only "
            "figures that appear below; say when a price is from the web. No investment, tax, "
            "legal, or credit advice.",
            f"User's words: {run.goal or run.title}\nAgent reports:\n{_reports(run.lanes)}\n"
            f"Drafted for approval:\n{steps or '(nothing)'}\nVerified figures:\n{facts}",
            "mission_brief",
            _BRIEF_SCHEMA,
            timeout_seconds=PLAN_TIMEOUT_SECONDS,
            **_metered(budget, "brief"),
        )
        answer = _whole_sentences(str(value.get("answer", "")), ANSWER_CHARS)
        if not answer or ws.facts.unverified_figures(answer):
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
        ][:3]
        return Brief(answer=answer, numbers=numbers, options=options)
    except ModelUnavailable:
        return fallback


def _lane(agent: AgentId, task: str, wave: int = 1, because: str | None = None) -> AgentLane:
    member = TEAM[agent]
    return AgentLane(
        agent=agent,
        name=member.name,
        emoji=member.emoji,
        role=member.role,
        task=task,
        wave=wave,
        because=because,
    )


async def _run(
    lane: AgentLane,
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
        instructions=instructions_for(TEAM[lane.agent], run.kind),
        tools=TEAM[lane.agent].tool_list(),
        settings=settings,
        budget=budget,
        clock=clock,
        # Agents whose job is a lookup run their playbook: same result, no tokens.
        use_model=use_model and TEAM[lane.agent].thinks,
        context=context,
        light=TEAM[lane.agent].light,
    )


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
        tasks: list[tuple[AgentId, str]] | None = None
        if use_model and run.kind == "purchase":
            # The price comes first: the Planner finds it, then Penny hands on what it found.
            run.source = "ai"
            tasks = [("planner", PURCHASE_TASK)]
            run.plan = (
                "I'll have the Planner find the price and check it against your money, then "
                "hand on whatever needs more work."
            )
        elif use_model and run.kind not in ROSTERS_ARE_ENOUGH:
            try:
                run.plan, tasks = await _model_plan(settings, budget, run.kind, run.goal, ws)
                run.source = "ai"
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
            tasks = _rule_plan(run.kind, run.goal)
            if use_model:
                run.source = "ai"
            run.plan = (
                "I'll send " + ", ".join(TEAM[a].name for a, _ in tasks) + " at the same time."
            )
            await asyncio.sleep(0.4)
        run.lanes = [_lane(agent, task) for agent, task in tasks]
        run.plan_steps.append(
            TraceStep(
                at_ms=clock.ms(),
                kind="plan",
                title=f"Sent {len(tasks)} agents in parallel",
                detail=run.plan,
            )
        )
        remembered = ws.memory.prompt()
        context = f"What Penny remembers:\n{remembered}" if remembered else ""
        outcomes = list(
            await asyncio.gather(
                *(
                    _run(
                        lane,
                        TEAM[lane.agent].playbook,
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
            wave = [_lane(u.agent, u.task, wave=2, because=u.because) for u in follow_ups]
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
