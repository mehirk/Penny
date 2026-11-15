"""Penny thinking a situation through: what to keep in mind, which agents to send (and which
to create), what to ask first, and the full picture in the answer."""

import asyncio
from datetime import UTC, date, datetime
from typing import Any

import pytest

from app.agents import asking, orchestrator, runtime
from app.agents.models import MissionRun
from app.agents.team import SPECIALIST_TOOLS, specialist
from app.agents.tools import run_tool
from app.agents.workspace import Outbox, load_workspace
from app.coach.llm import ModelUnavailable
from app.config import get_settings
from app.domain import relocation
from app.store import DashboardStore, demo_store

GOAL = "I'm moving from Halifax to Toronto in May for school. What do I need to think about?"


@pytest.fixture(autouse=True)
def _quick_questions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(asking, "ANSWER_TIMEOUT_SECONDS", 0.01)


@pytest.fixture
def store() -> DashboardStore:
    return demo_store()


def _user(store: DashboardStore) -> str:
    return next(iter(store.owner_user_ids))


THINKING = {
    "situation": "A student moving provinces for school, on a tight monthly surplus.",
    "considerations": [
        {
            "topic": "First and last month's rent",
            "why": "The biggest upfront cost.",
            "kind": "cost",
            "source": "web",
            "owner": "Planner",
        },
        {
            "topic": "Switching to OHIP",
            "why": "Coverage changes with the province.",
            "kind": "task",
            "source": "web",
            "owner": "Health coverage checker",
        },
        {"topic": "", "why": "dropped: no topic", "kind": "cost", "source": "web", "owner": ""},
    ],
    "team": [
        {"agent": "planner", "task": "Cost the move in full."},
        {"agent": "planner", "task": "Duplicate: dropped."},
        {"agent": "cashflow", "task": "Check bills until the move."},
    ],
    "specialists": [
        {
            "name": "Health coverage checker",
            "emoji": "🩺",
            "role": "Checks what changes with health coverage when moving provinces.",
            "task": "Find how to switch from MSI to OHIP and any gap in coverage.",
            "tools": ["web_research", "set_reminder", "draft_transfer"],
        },
        {
            "name": "Planner",
            "emoji": "x",
            "role": "Dropped: same name as a built-in agent.",
            "task": "Anything.",
            "tools": [],
        },
    ],
    "questions": [
        {
            "question": "Will you live alone or with roommates?",
            "why": "It halves the rent.",
            "choices": ["Alone", "With roommates"],
            "assumption": "With roommates",
        }
    ],
    "plan": "The Planner costs it, a Health coverage checker sorts out OHIP.",
}


def _fake_model(monkeypatch: pytest.MonkeyPatch, brief: dict[str, Any]) -> None:
    async def ask_json(settings: Any, instructions: str, prompt: str, name: str, *a: Any, **k: Any):
        if name == "mission_think":
            return THINKING
        if name == "mission_review":
            return {"thought": "Nothing to hand on.", "follow_ups": []}
        if name == "mission_brief":
            return brief
        raise AssertionError(name)

    class NoAgentModel:
        def __init__(self, *args: Any) -> None:
            pass

        async def run(self) -> Any:
            raise ModelUnavailable("no model in tests")

    monkeypatch.setattr(orchestrator, "ask_json", ask_json)
    monkeypatch.setattr(runtime, "AgentSession", NoAgentModel)


def _run(store: DashboardStore, goal: str = GOAL) -> MissionRun:
    ws = load_workspace(store, _user(store), goal)
    run = MissionRun(
        id="run-think",
        kind="life_event",
        goal=goal,
        title=goal,
        started_at=datetime.now(UTC),
    )
    settings = get_settings().model_copy(update={"openai_api_key": "sk-test"})
    asyncio.run(orchestrator.run_mission(settings, ws, run))
    return run


def test_penny_thinks_it_through_creates_specialists_and_asks_first(
    store: DashboardStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_model(
        monkeypatch,
        {
            "answer": "Yes, with roommates it works.",
            "numbers": [],
            "options": [],
            "picture": [
                {"group": "you_do", "title": "Apply for OHIP", "detail": "When you arrive."},
                {"group": "skip", "title": "Movers", "detail": "Ship boxes for $9,999.99."},
                {"group": "penny_did", "title": "Drafted a goal", "detail": "Approve it below."},
            ],
        },
    )
    run = _run(store)
    assert run.status == "done", run.error
    assert [c.topic for c in run.considerations] == [
        "First and last month's rent",
        "Switching to OHIP",
    ]
    assert run.considerations[1].owner == "Health coverage checker"
    names = [lane.name for lane in run.lanes if lane.wave == 1]
    assert names == ["Planner", "Cash-flow guard", "Health coverage checker"]
    checker = next(lane for lane in run.lanes if lane.agent == "specialist")
    assert checker.emoji == "🩺"
    # Penny asked before sending anyone, and the team went on its assumption.
    assert run.asked[0].agent == "penny" and run.asked[0].assumed
    assert any(step.title.startswith("Asked you:") for step in run.plan_steps)
    assert any(s.title.startswith("Thought it through: 2 things") for s in run.plan_steps)
    # A picture item with a figure no tool produced is dropped.
    assert run.brief and [p.title for p in run.brief.picture] == [
        "Apply for OHIP",
        "Drafted a goal",
    ]


def test_specialists_never_get_tools_that_move_money() -> None:
    member = specialist("Car cost analyst", "🚗", "Costs owning a car.", ["draft_transfer"])
    assert "draft_transfer" not in member.tools
    assert "draft_transfer" not in SPECIALIST_TOOLS
    assert set(member.tools) == {"money_overview", "web_research"}


def test_without_a_model_a_move_still_gets_the_whole_team(store: DashboardStore) -> None:
    ws = load_workspace(store, _user(store), GOAL)
    run = MissionRun(
        id="run-x", kind="life_event", goal=GOAL, title=GOAL, started_at=datetime.now(UTC)
    )
    asyncio.run(orchestrator.run_mission(get_settings(), ws, run))
    assert {lane.agent for lane in run.lanes} >= {"planner", "analyst", "cashflow", "benefits"}
    assert run.costs and run.costs.title == "Move to Toronto"
    assert [t.id for t in run.checklist][-3:] == ["health", "licence", "receipts"]


# ------------------------------------------------------------------ cost_plan


def test_cost_plan_costs_any_situation_against_today(store: DashboardStore) -> None:
    ws = load_workspace(store, _user(store), "Should I get a car? Insurance is $180 a month")
    out = Outbox()
    ws.facts.web_amounts("A used Corolla runs $12,500 and gas is about $160 a month.")
    result = run_tool(
        ws,
        out,
        "cost_plan",
        {
            "title": "Getting a car",
            "items": [
                {"label": "Used car", "amount": "12500.00", "kind": "upfront", "replaces": None},
                {"label": "Insurance", "amount": "180.00", "kind": "monthly", "replaces": None},
                {
                    "label": "Gas",
                    "amount": "160.00",
                    "kind": "monthly",
                    "replaces": "Transportation",
                },
                {"label": "Parking", "amount": None, "kind": "monthly", "replaces": None},
            ],
        },
    )
    assert result["upfront_total"] == "$12,500.00"
    assert result["monthly_total"] == "$340.00"
    # Gas replaces today's transit: $90.00 a month on average.
    assert result["same_costs_now"] == "$90.00" and result["monthly_costs_go"] == "up $250.00"
    assert result["still_to_price"] == ["Parking"]
    assert ws.costs and [i.basis for i in ws.costs.monthly] == ["you", "web", "to_price"]


def test_cost_plan_refuses_made_up_amounts(store: DashboardStore) -> None:
    ws = load_workspace(store, _user(store), "Getting a car")
    result = run_tool(
        ws,
        Outbox(),
        "cost_plan",
        {
            "title": "Car",
            "items": [{"label": "Car", "amount": "9876.54", "kind": "upfront", "replaces": None}],
        },
    )
    assert "isn't from a tool result" in result["error"] and ws.costs is None


# ------------------------------------------------------------------ relocation


def test_where_and_when_a_move_is() -> None:
    text = "I live in Halifax and I'm moving to Toronto in May"
    assert relocation.destination(text) == relocation.Place("Toronto", "ON")
    assert relocation.move_date(text, date(2026, 11, 14)) == date(2027, 5, 1)
    assert relocation.move_date("I may move next month", date(2026, 11, 14)) == date(2026, 12, 1)
    assert relocation.move_date("moving in 3 months", date(2026, 11, 14)) == date(2027, 2, 1)
    assert relocation.is_move(text) and not relocation.is_move("Can I afford a laptop?")


def test_costs_people_forget_are_found() -> None:
    asked, missed = relocation.asked_about("flights, rent, transit and groceries in Vancouver")
    assert [c.id for c in asked] == ["travel", "rent", "transit", "groceries"]
    assert "deposit" in [c.id for c in missed] and "movers" in [c.id for c in missed]
    # Whole words: "current" isn't rent and "Vancouver" isn't a van.
    assert relocation.asked_about("my current place in Vancouver")[0] == []


def test_move_costs_are_totalled_in_cents() -> None:
    costs = relocation.costs(
        {"rent": (180_000, "you"), "transit": (15_600, "web"), "travel": (25_000, "web")},
        {"rent": 82_500, "transit": 9_000},
    )
    assert costs.upfront_cents == 25_000 + 360_000  # the deposit is two months of rent
    assert costs.monthly_cents == 195_600 and costs.monthly_change_cents == 195_600 - 91_500
    with pytest.raises(ValueError):
        relocation.costs({"rent": (-1, "you")}, {})
    assert relocation.months_to_save(385_000, 0) is None
    assert relocation.months_to_save(385_000, 100_000) == 4


def test_moving_provinces_adds_the_health_card_and_licence() -> None:
    same = relocation.checklist(date(2027, 5, 1), date(2026, 11, 14), "ON", "ON")
    away = relocation.checklist(date(2027, 5, 1), date(2026, 11, 14), "NS", "ON")
    assert "health" not in [t.id for t in same]
    health = next(t for t in away if t.id == "health")
    assert health.title == "Apply for OHIP" and "MSI" in health.detail
    # Never due in the past, however close the move is.
    soon = relocation.checklist(date(2026, 11, 20), date(2026, 11, 14), "NS", "ON")
    assert min(t.due_on for t in soon) == date(2026, 11, 14)
