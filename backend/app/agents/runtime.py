"""How one subagent works.

With a model: a bounded loop. The model sees its task and its tools, calls tools, reads what
they return, and keeps going until it writes its report (a summary and findings). Every call,
input, and result is written to the lane's trace as it happens, which the app shows live.

Without a model (no key, a failure, or the mission's AI budget used up): the agent's built-in
playbook calls the same tools in a fixed order and decides with deterministic code. Either way
the agent only reads and drafts; nothing is saved until the user approves.
"""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from openai import AsyncOpenAI, OpenAIError
from pydantic import ValidationError

from app import limits
from app.agents.models import AgentLane, Finding, MissionKind, TokenUse, TraceStep
from app.agents.tools import TOOLS, Tool, compact, run_tool
from app.agents.workspace import Outbox, Workspace
from app.coach.llm import AiLimitReached, ModelUnavailable, cache_options
from app.config import Settings

# Built-in playbooks pause briefly after each step so the live view can follow along; the
# model's own latency does that when it runs.
PACE_SECONDS = 0.35
MAX_AGENT_ROUNDS = 5
MAX_FINDINGS = 5
# A report is short; this is mostly room for low-effort reasoning.
MAX_OUTPUT_TOKENS = 1_600
# A tool result sent back to the model, in characters: lists are cut, not the whole result.
MAX_TOOL_RESULT_CHARS = 4_000


# What an agent is doing, in words, while a tool runs ("Forecasting your cash…").
DOING = {
    "money_overview": "Checking your balances",
    "spending_by_category": "Reading your spending",
    "subscriptions_and_bills": "Going through your bills",
    "cash_forecast": "Forecasting your cash",
    "goals_status": "Checking your goals",
    "project_goal": "Projecting a goal",
    "simulate_spending_cut": "Testing a spending cut",
    "check_affordability": "Checking what you can afford",
    "plan_savings": "Working out a savings plan",
    "price_with_tax": "Adding sales tax",
    "credit_card_payment": "Modelling a card payment",
    "move_cost_estimate": "Estimating moving costs",
    "who_owes_me": "Checking who owes you",
    "benefits_screen": "Screening for benefits",
    "learning_progress": "Checking your lessons",
    "find_lessons": "Finding lessons",
    "draft_budget": "Drafting a budget",
    "draft_goal": "Drafting a goal",
    "draft_goal_contribution": "Drafting a savings step",
    "draft_transfer": "Drafting a transfer",
    "set_reminder": "Setting a reminder",
    "assign_lesson": "Adding a lesson",
    "recommend_guide": "Picking a guide",
    "ask_user": "Waiting for your answer",
    "web_research": "Searching the web",
}


class Clock:
    def __init__(self) -> None:
        self._start = time.monotonic()

    def ms(self) -> int:
        return int((time.monotonic() - self._start) * 1000)


@dataclass
class Budget:
    """Model calls one mission may make in total; past it, agents use their playbooks."""

    limit: int
    used: int = 0
    tokens: TokenUse = field(default_factory=TokenUse)

    def record(self, usage: Any) -> None:
        """Adds one response's token usage to the mission's total."""
        self.tokens.input += getattr(usage, "input_tokens", 0) or 0
        self.tokens.output += getattr(usage, "output_tokens", 0) or 0
        details = getattr(usage, "input_tokens_details", None)
        self.tokens.cached += getattr(details, "cached_tokens", 0) or 0

    def charge(self) -> None:
        if self.used >= self.limit:
            raise ModelUnavailable("mission_budget")
        if not limits.spend_ai_call():
            raise AiLimitReached("ai_limit")
        self.used += 1


@dataclass
class Report:
    summary: str
    findings: list[Finding] = field(default_factory=list)


class Act:
    """What an agent does, recorded in its lane's trace as it happens."""

    def __init__(
        self, lane: AgentLane, ws: Workspace, out: Outbox, clock: Clock, pace: float
    ) -> None:
        self.lane, self.ws, self.out, self.clock, self.pace = lane, ws, out, clock, pace

    def note(
        self,
        kind: str,
        title: str,
        detail: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        self.lane.steps.append(
            TraceStep(at_ms=self.clock.ms(), kind=kind, title=title, detail=detail, data=data)  # type: ignore[arg-type]
        )

    async def think(self, title: str, detail: str | None = None) -> None:
        self.lane.current = title
        self.note("think", title, detail)
        if self.pace:
            await asyncio.sleep(self.pace)

    async def ask(
        self, question: str, why: str, choices: list[str], assumption: str
    ) -> dict[str, Any]:
        """Asks the user; the answer's amounts become usable figures."""
        asker = self.ws.asker
        if asker is None or not asker.can_ask():
            return {"answer": None, "go_with": assumption, "note": "Nobody to ask: assume."}
        self.lane.status = "waiting"
        self.lane.current = "Waiting for your answer…"
        self.note("ask", question, why)
        asked = await asker.ask(self.lane.agent, question, why, choices, assumption)
        self.lane.status = "running"
        if asked.answer is None:
            self.note("ask", "No answer, so I went with my assumption", assumption)
            return {"answer": None, "go_with": assumption, "note": "Say what you assumed."}
        self.ws.facts.allow_user_amounts(asked.answer)
        self.note("ask", f"You answered: {asked.answer}")
        return {"answer": asked.answer}

    async def research(self, question: str) -> dict[str, Any]:
        researcher = self.ws.researcher
        if researcher is None:
            return {"error": "Web research isn't available; use Penny's tools."}
        self.lane.current = "Searching the web…"
        result, sources = await researcher.search(question, self.ws.facts)
        known = {source.url for source in self.lane.sources}
        self.lane.sources += [source for source in sources if source.url not in known]
        self.note(
            "error" if "error" in result else "web",
            f"Searched the web: {question[:90]}",
            ", ".join(source.title for source in sources) or None,
            {"input": {"question": question}, "output": compact(result)},
        )
        return result

    async def use(self, name: str, /, **args: Any) -> dict[str, Any]:
        if name == "ask_user":
            self.lane.tool_calls += 1
            choices = args.get("choices")
            return await self.ask(
                str(args.get("question") or ""),
                str(args.get("why") or ""),
                [str(c) for c in choices] if isinstance(choices, list) else [],
                str(args.get("assumption") or ""),
            )
        if name == "web_research":
            self.lane.tool_calls += 1
            return await self.research(str(args.get("question") or ""))
        self.lane.current = f"{DOING.get(name, 'Working')}…"
        result = run_tool(self.ws, self.out, name, args)
        self.lane.tool_calls += 1
        tool = TOOLS.get(name)
        data = {"input": args, "output": compact(result)}
        if "error" in result:
            self.note("error", f"{name} said no", str(result["error"]), data)
        elif tool and tool.kind == "draft":
            self.note("draft", f"Drafted: {result.get('drafted')}", "Waits for your approval", data)
        elif tool and tool.kind == "auto":
            self.note("auto", _auto_title(name, result), "Done automatically", data)
        else:
            self.note("tool", DOING.get(name, f"Called {name}"), name, data)
        if self.pace:
            await asyncio.sleep(self.pace)
        return result


def _auto_title(name: str, result: dict[str, Any]) -> str:
    if name == "set_reminder":
        return f"Set a reminder for {result.get('reminder_set_for')}"
    return f"Added: {result.get('assigned') or result.get('recommended')}"


Playbook = Callable[[Act, Workspace, MissionKind], Awaitable[Report]]


_REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tone": {"type": "string", "enum": ["good", "watch", "alert", "info"]},
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["tone", "title", "detail"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "findings"],
    "additionalProperties": False,
}


def parse_report(text: str) -> Report:
    try:
        value = json.loads(text)
        findings = [Finding.model_validate(item) for item in value["findings"][:MAX_FINDINGS]]
        summary = str(value["summary"]).strip()
    except (json.JSONDecodeError, KeyError, TypeError, ValidationError) as error:
        raise ModelUnavailable("invalid report") from error
    if not summary:
        raise ModelUnavailable("empty report")
    return Report(summary=summary[:600], findings=findings)


class AgentSession:
    """One subagent's conversation with the model, kept so the verifier can send it back."""

    def __init__(
        self,
        settings: Settings,
        budget: Budget,
        act: Act,
        instructions: str,
        prompt: str,
        tools: list[Tool],
        model: str | None = None,
    ) -> None:
        if not settings.openai_api_key:
            raise ModelUnavailable("no_api_key")
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key, timeout=settings.coach_timeout_seconds, max_retries=1
        )
        self.model = model or settings.openai_model
        self._settings = settings
        self._budget = budget
        self._act = act
        self._instructions = instructions
        self._items: list[Any] = [{"role": "user", "content": prompt}]
        self._tools = [tool.spec() for tool in tools]

    async def _call(self, with_tools: bool) -> Any:
        self._budget.charge()
        self._act.lane.ai_calls += 1
        self._act.lane.current = "Thinking…"
        response = await self._client.responses.create(
            model=self.model,
            instructions=self._instructions,
            input=self._items,
            tools=self._tools,  # type: ignore[arg-type]
            tool_choice="auto" if with_tools else "none",
            parallel_tool_calls=True,
            max_output_tokens=MAX_OUTPUT_TOKENS,
            reasoning={"effort": "low"},
            include=["reasoning.encrypted_content"],
            store=False,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "agent_report",
                    "strict": True,
                    "schema": _REPORT_SCHEMA,
                }
            },
            # Instructions and tools come first and never change for an agent, so every round
            # (and every mission) after the first reads them from the prompt cache.
            **cache_options(self._settings, f"penny-agent-{self._act.lane.agent}"),
        )
        if response.usage:
            self._budget.record(response.usage)
        return response

    async def run(self) -> Report:
        for round_number in range(MAX_AGENT_ROUNDS):
            response = await self._call(with_tools=round_number < MAX_AGENT_ROUNDS - 1)
            calls = [item for item in response.output if item.type == "function_call"]
            if not calls:
                if response.status != "completed" or not response.output_text:
                    raise ModelUnavailable("incomplete response")
                self._items.append({"role": "assistant", "content": response.output_text})
                return parse_report(response.output_text)
            self._items.extend(item.model_dump(exclude_none=True) for item in response.output)
            for call in calls:
                try:
                    args = json.loads(call.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await self._act.use(call.name, **(args if isinstance(args, dict) else {}))
                self._items.append(
                    {
                        "type": "function_call_output",
                        "call_id": call.call_id,
                        "output": _for_model(result),
                    }
                )
        raise ModelUnavailable("round limit reached")

    async def revise(self, problems: list[str]) -> Report:
        """The verifier sent the report back: rewrite it with only figures from the tools."""
        self._items.append(
            {
                "role": "user",
                "content": "VERIFIER: these figures in your report don't match any tool result: "
                + ", ".join(problems)
                + ". Rewrite the report using only figures your tools returned.",
            }
        )
        response = await self._call(with_tools=False)
        if response.status != "completed" or not response.output_text:
            raise ModelUnavailable("incomplete response")
        return parse_report(response.output_text)


def _for_model(result: dict[str, Any]) -> str:
    """A tool result as compact JSON (no spaces), with long lists shortened to fit."""
    text = json.dumps(result, default=str, separators=(",", ":"), ensure_ascii=False)
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    trimmed = {
        key: value[:8] + [f"…{len(value) - 8} more"] if isinstance(value, list) else value
        for key, value in result.items()
    }
    return json.dumps(trimmed, default=str, separators=(",", ":"), ensure_ascii=False)[
        :MAX_TOOL_RESULT_CHARS
    ]


@dataclass
class LaneOutcome:
    lane: AgentLane
    out: Outbox
    session: AgentSession | None
    playbook: Playbook


async def run_lane(
    *,
    lane: AgentLane,
    ws: Workspace,
    kind: MissionKind,
    playbook: Playbook,
    instructions: str,
    tools: list[Tool],
    settings: Settings,
    budget: Budget,
    clock: Clock,
    use_model: bool,
    context: str = "",
    light: bool = False,
) -> LaneOutcome:
    """`context`: what the agent should know beyond its task (Penny's memory, and for a
    follow-up, what its teammates reported)."""
    lane.status = "running"
    started = clock.ms()
    out = Outbox()
    session: AgentSession | None = None
    report: Report | None = None
    if use_model:
        act = Act(lane, ws, out, clock, pace=0)
        profile = ws.dashboard.profile
        where = ", ".join(x for x in (profile.city, profile.province) if x) or "Canada"
        prompt = (
            f"Mission: {ws.goal or kind}\nYour task: {lane.task}\nToday: {ws.today}\n"
            f"The user lives in: {where}"
        )
        if context:
            prompt += f"\n\n{context}"
        # A light agent starts on the cheaper model; if that fails, it tries again on the main
        # one before falling back to its playbook, so the answer doesn't get worse.
        models = [settings.openai_model]
        if light and settings.openai_agent_model not in (None, "", settings.openai_model):
            models.insert(0, settings.openai_agent_model)
        for model in models:
            try:
                session = AgentSession(settings, budget, act, instructions, prompt, tools, model)
                report = await session.run()
                lane.source, lane.model = "ai", model
                break
            except (ModelUnavailable, OpenAIError) as error:
                # Out of AI calls, or the main model failed too: the playbook takes over.
                final = model == models[-1] or isinstance(error, AiLimitReached)
                act.note(
                    "error",
                    "Switched to the built-in playbook"
                    if final
                    else "Trying again on the main model",
                    str(error) or None,
                )
                session = None
                out.intents.clear()
                out.auto.clear()
                if final:
                    break
    try:
        if report is None:
            report = await playbook(Act(lane, ws, out, clock, PACE_SECONDS), ws, kind)
            lane.source = "built_in"
        lane.summary, lane.findings = report.summary, report.findings
        lane.auto = list(out.auto)
        lane.status = "done"
    except Exception as error:  # one agent failing mustn't stop the mission
        lane.status = "failed"
        Act(lane, ws, out, clock, 0).note("error", "This agent failed", str(error)[:200])
        out.intents.clear()
        out.auto.clear()
    lane.current = None
    lane.elapsed_ms = clock.ms() - started
    return LaneOutcome(lane, out, session, playbook)
