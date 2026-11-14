"""Mission Control: the cash forecast and benefits screen, every subagent's built-in playbook,
the draft tools' guardrails, the verifier, and the API from start to approval."""

import asyncio
import time
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from app.agents import asking, runtime
from app.agents.models import AgentLane, Finding, MissionKind, MissionRun
from app.agents.orchestrator import _verify, run_mission, title_for
from app.agents.research import Researcher, sources_in
from app.agents.runs import RunStore
from app.agents.team import TEAM
from app.agents.tools import run_tool
from app.agents.watch import noticed
from app.agents.workspace import Outbox, Workspace, load_workspace
from app.auth import CurrentUser, get_current_user
from app.config import get_settings
from app.domain import benefits
from app.domain.cash_forecast import Flow, forecast, round_up
from app.store import DashboardStore, demo_store


@pytest.fixture(autouse=True)
def _no_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime, "PACE_SECONDS", 0)
    # Questions nobody answers in a test fall back to the agent's assumption at once.
    monkeypatch.setattr(asking, "ANSWER_TIMEOUT_SECONDS", 0.01)


@pytest.fixture
def store() -> DashboardStore:
    return demo_store()


def _user(store: DashboardStore) -> str:
    return next(iter(store.owner_user_ids))


def _mission(store: DashboardStore, kind: MissionKind, goal: str = "") -> MissionRun:
    ws = load_workspace(store, _user(store), goal)
    run = MissionRun(
        id="run-test",
        kind=kind,
        goal=goal,
        title=title_for(kind, goal),
        started_at=datetime.now(UTC),
    )
    asyncio.run(run_mission(get_settings(), ws, run))
    return run


# ------------------------------------------------------------------ domain


def test_forecast_finds_the_low_point_and_counts_bills_before_pay_on_the_same_day() -> None:
    day = date(2026, 11, 1)
    result = forecast(
        10_000,
        [
            Flow(day, "Pay", 50_000),
            Flow(day, "Rent", -30_000),
            Flow(date(2026, 11, 3), "Phone", -5_000),
        ],
    )
    assert result.lowest_cents == -20_000 and result.lowest_on == day
    assert result.first_short_on == day and result.shortfall_cents == 20_000
    assert result.end_cents == 25_000
    assert forecast(5_000, []).shortfall_cents == 0
    assert round_up(3_740) == 4_000 and round_up(4_000) == 4_000 and round_up(0) == 0


def test_benefits_screen_for_a_working_student() -> None:
    found = benefits.screen(
        benefits.Profile(
            age=20,
            student=True,
            yearly_income_cents=2_000_000,
            yearly_working_income_cents=1_500_000,
        )
    )
    ids = [m.id for m in found]
    assert ids[0] == "file_return"
    assert {"groceries_essentials", "workers_benefit", "student_grant", "tuition_credit"} <= set(
        ids
    )
    assert next(m for m in found if m.id == "learning_bond").status == "check"
    assert all(m.status == "likely" for m in found[: ids.index("learning_bond")])


def test_benefits_screen_edges() -> None:
    no_work = benefits.screen(benefits.Profile(None, False, 0, 0))
    ids = {m.id for m in no_work}
    assert "workers_benefit" not in ids and "student_grant" not in ids
    # Age unknown: worth checking, not "likely".
    assert next(m for m in no_work if m.id == "groceries_essentials").status == "check"
    high = benefits.screen(benefits.Profile(30, False, 10_000_000, 10_000_000))
    assert next(m for m in high if m.id == "workers_benefit").status == "check"
    assert "dental" not in {m.id for m in high}
    assert benefits.tax_deadline(date(2026, 11, 1)) == date(2027, 4, 30)
    assert benefits.tax_deadline(date(2027, 2, 1)) == date(2027, 4, 30)


# ------------------------------------------------------------------ missions (built-in)


def test_checkup_runs_every_agent_and_the_verifier_keeps_the_cushion(store: DashboardStore) -> None:
    run = _mission(store, "checkup")
    assert run.status == "done" and run.source == "built_in"
    assert [lane.agent for lane in run.lanes] == [
        "analyst",
        "cashflow",
        "planner",
        "people",
        "tutor",
    ]
    assert all(lane.status == "done" and lane.steps for lane in run.lanes)
    # The card payoff and the laptop contribution together would leave chequing under the
    # cushion after bills, so the verifier holds the second one back.
    assert [step.title for step in run.steps] == ["Pay Student Credit Card"]
    assert run.verification and run.verification.status == "fixed"
    assert any("held back" in note for note in run.verification.notes)
    cashflow = next(lane for lane in run.lanes if lane.agent == "cashflow")
    assert cashflow.drafted == ["step-1"]
    assert {task.kind for task in run.auto} == {"lesson"}
    assert run.summary == "Food is over budget: your agents have a plan."


def test_every_report_quotes_only_verified_figures(store: DashboardStore) -> None:
    for kind in ("checkup", "free_money", "payoff"):
        run = _mission(demo_store(), kind)
        assert run.verification and not any("replaced" in n for n in run.verification.notes)
        assert run.verification.figures_checked > 0


def test_life_event_drafts_a_goal_from_the_users_words(store: DashboardStore) -> None:
    run = _mission(store, "life_event", "I'm moving to Toronto in September for a co-op")
    planner = next(lane for lane in run.lanes if lane.agent == "planner")
    assert planner.status == "done"
    goal = next(step for step in run.steps if step.action.kind == "goal_new")
    # No amount given: first and last month at the current $825.00 rent.
    assert goal.title == "Start a goal: Move to Toronto"
    assert goal.action.target_cents == 165_000  # type: ignore[union-attr]
    assert goal.action.target_date == date(2027, 9, 1)  # type: ignore[union-attr]
    assert any(task.kind == "reminder" and "Move to Toronto" in task.title for task in run.auto)


def test_life_event_uses_the_amount_the_user_said(store: DashboardStore) -> None:
    run = _mission(store, "life_event", "Trip to Montreal in March, about $1,200")
    goal = next(step for step in run.steps if step.action.kind == "goal_new")
    assert goal.action.target_cents == 120_000  # type: ignore[union-attr]
    assert goal.action.target_date == date(2027, 3, 1)  # type: ignore[union-attr]


def test_free_money_sets_the_tax_reminder_and_guides(store: DashboardStore) -> None:
    run = _mission(store, "free_money")
    finder = next(lane for lane in run.lanes if lane.agent == "benefits")
    assert finder.findings[0].title == "File a tax return every year"
    reminder = next(task for task in run.auto if task.kind == "reminder")
    assert reminder.due_on == date(2027, 3, 31)
    assert {"benefits", "student-loans"} <= {task.ref for task in run.auto if task.kind == "guide"}
    assert not run.steps  # finding money moves none


def test_custom_mission_picks_agents_from_the_words(store: DashboardStore) -> None:
    run = _mission(store, "custom", "Which of my friends owe me money?")
    assert [lane.agent for lane in run.lanes] == ["people"]


# ------------------------------------------------------------------ guardrails


def _ws(store: DashboardStore, goal: str = "") -> Workspace:
    return load_workspace(store, _user(store), goal)


def test_draft_tools_refuse_amounts_no_tool_produced(store: DashboardStore) -> None:
    ws, out = _ws(store), Outbox()
    refused = run_tool(ws, out, "draft_budget", {"category": "Food", "monthly_limit": "123.45"})
    assert "isn't from a tool result" in refused["error"] and not out.intents
    run_tool(ws, out, "spending_by_category", {})
    # $330.17 is already spent on Food this month, so a $300.00 limit would be over at once.
    below = run_tool(ws, out, "draft_budget", {"category": "Food", "monthly_limit": "300.00"})
    assert "already spent" in below["error"]
    ok = run_tool(ws, out, "draft_budget", {"category": "School", "monthly_limit": "100.00"})
    assert ok["needs_user_approval"] and len(out.intents) == 1


def test_amounts_the_user_said_can_be_drafted(store: DashboardStore) -> None:
    ws, out = _ws(store, "Save $640 for a bike"), Outbox()
    ok = run_tool(ws, out, "draft_goal", {"name": "Bike", "target": "640", "target_date": None})
    assert ok["drafted"] == "Start a goal: Bike"


def test_tools_check_their_inputs(store: DashboardStore) -> None:
    ws, out = _ws(store), Outbox()
    assert "error" in run_tool(ws, out, "nope", {})
    assert "error" in run_tool(ws, out, "cash_forecast", {"days": 400})
    assert "error" in run_tool(ws, out, "set_reminder", {"title": "x", "due_on": "2020-01-01"})
    assert "error" in run_tool(ws, out, "assign_lesson", {"lesson_id": "missing"})
    assert "error" in run_tool(
        ws,
        out,
        "draft_transfer",
        {"from_account_id": "acct-chequing", "to_account_id": "acct-chequing", "amount": "1"},
    )
    assert not out.intents and not out.auto


def test_every_agent_only_has_draft_tools_it_needs() -> None:
    drafters = {a.id for a in TEAM.values() if any(t.startswith("draft_") for t in a.tools)}
    assert drafters == {"cashflow", "planner"}


def test_verifier_replaces_a_report_with_made_up_figures(store: DashboardStore) -> None:
    ws = _ws(store)
    run = MissionRun(id="r", kind="checkup", goal="", title="t", started_at=datetime.now(UTC))
    lane = AgentLane(agent="analyst", name="Analyst", emoji="🔎", role="", task="", status="done")
    lane.summary = "You could save $9,999.99 a year."
    lane.findings = [
        Finding(tone="info", title="Big savings", detail="About 73% of your spending.")
    ]
    run.lanes = [lane]
    outcome = runtime.LaneOutcome(lane, Outbox(), None, TEAM["analyst"].playbook)
    asyncio.run(_verify(ws, run, [outcome], runtime.Clock()))
    assert run.verification and run.verification.status == "fixed"
    assert "$9,999.99" not in (lane.summary or "")
    assert ws.facts.unverified_figures(lane.summary or "") == []


def test_a_failing_agent_does_not_stop_the_mission(
    store: DashboardStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(act: runtime.Act, ws: Workspace, kind: MissionKind) -> runtime.Report:
        raise RuntimeError("boom")

    monkeypatch.setitem(TEAM, "people", replace(TEAM["people"], playbook=broken))
    run = _mission(store, "checkup")
    assert run.status == "done"
    people = next(lane for lane in run.lanes if lane.agent == "people")
    assert people.status == "failed" and people.steps[-1].kind == "error"


# ------------------------------------------------------------------ API


@pytest.fixture
def client(store: DashboardStore, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from app.api import agent as agent_api
    from app.api import agents as agents_api

    user = _user(store)
    app_store = RunStore()
    monkeypatch.setattr(agents_api, "run_store", app_store)
    monkeypatch.setattr(agents_api, "user_store", lambda _user: store)
    # Approvals land in the same store the missions read.
    monkeypatch.setattr(agent_api, "user_store", lambda _user: store)
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=user)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _wait(client: TestClient, run_id: str) -> dict:
    for _ in range(100):
        run = client.get(f"/api/v1/agents/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.02)
    raise AssertionError("mission didn't finish")


def test_api_runs_a_mission_and_records_the_approval(client: TestClient) -> None:
    started = client.post("/api/v1/agents/runs", json={"kind": "checkup"})
    assert started.status_code == 201 and started.json()["status"] == "running"
    run = _wait(client, started.json()["id"])
    assert run["status"] == "done" and run["steps"]
    step = run["steps"][0]
    applied = client.post("/api/v1/agent/apply", json={"actions": [step["action"]]})
    assert applied.status_code == 200
    recorded = client.post(
        f"/api/v1/agents/runs/{run['id']}/approved",
        json={"step_ids": [step["id"]], "undo_id": applied.json()["undo_id"]},
    ).json()
    assert recorded["approved"] == [step["id"]]
    listed = client.get("/api/v1/agents/runs").json()
    assert listed[0]["approved"] == 1 and listed[0]["drafted"] == len(run["steps"])
    stats = {s["agent"]: s for s in client.get("/api/v1/agents/stats").json()}
    assert stats["cashflow"]["approved"] == 1 and stats["analyst"]["runs"] == 1


def test_api_checks_its_inputs(client: TestClient) -> None:
    assert client.post("/api/v1/agents/runs", json={"kind": "life_event"}).status_code == 422
    assert client.post("/api/v1/agents/runs", json={"kind": "nope"}).status_code == 422
    assert client.get("/api/v1/agents/runs/missing").status_code == 404
    run = _wait(client, client.post("/api/v1/agents/runs", json={"kind": "payoff"}).json()["id"])
    bad = client.post(f"/api/v1/agents/runs/{run['id']}/approved", json={"step_ids": ["step-99"]})
    assert bad.status_code == 422


def test_autopilot_runs_once_a_day(client: TestClient) -> None:
    first = client.post("/api/v1/agents/autopilot").json()
    _wait(client, first["id"])
    again = client.post("/api/v1/agents/autopilot").json()
    assert again["id"] == first["id"] and first["kind"] == "autopilot"


def test_a_newer_mission_supersedes_older_drafts(client: TestClient) -> None:
    first = _wait(client, client.post("/api/v1/agents/runs", json={"kind": "checkup"}).json()["id"])
    assert first["steps"]
    _wait(client, client.post("/api/v1/agents/runs", json={"kind": "payoff"}).json()["id"])
    older = client.get(f"/api/v1/agents/runs/{first['id']}").json()
    assert older["superseded"]
    late = client.post(
        f"/api/v1/agents/runs/{first['id']}/approved", json={"step_ids": [first["steps"][0]["id"]]}
    )
    assert late.status_code == 409


# ------------------------------------------------------------------ second wave, asking, memory


def test_penny_hands_a_benefit_to_the_planner_in_a_second_wave(store: DashboardStore) -> None:
    run = _mission(store, "life_event", "I'm moving to Toronto in September for a co-op")
    follow_up = next(lane for lane in run.lanes if lane.wave == 2)
    assert follow_up.agent == "planner" and follow_up.status == "done"
    assert follow_up.because == "Benefits finder found the Canada Workers Benefit"
    assert run.review and "Canada Workers Benefit" in run.review
    assert follow_up.findings[0].title == "The Canada Workers Benefit could fund Move to Toronto"
    assert any(task.title.startswith("If the Canada Workers Benefit") for task in run.auto)
    assert run.verification and not any("replaced" in n for n in run.verification.notes)


def test_an_unanswered_question_goes_with_the_assumption(store: DashboardStore) -> None:
    run = _mission(store, "life_event", "I'm moving to Toronto in September for a co-op")
    asked = run.asked[0]
    assert asked.agent == "planner" and asked.question == "What rent do you expect in Toronto?"
    assert asked.choices[0] == "Same as now" and asked.assumed and asked.answer is None
    assert run.question is None


def test_missions_nobody_started_never_ask(store: DashboardStore) -> None:
    assert not _mission(store, "autopilot").asked


def test_the_cash_gap_goes_to_the_analyst(
    store: DashboardStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.agents import orchestrator
    from app.domain.cash_forecast import Forecast

    short = Forecast(
        start_cents=10_000,
        end_cents=0,
        lowest_cents=-41_250,
        lowest_on=date(2026, 11, 20),
        first_short_on=date(2026, 11, 20),
        shortfall_cents=41_250,
        flows=(),
    )
    monkeypatch.setattr(orchestrator, "forecast_for", lambda ws, days: short)
    run = _mission(store, "autopilot")
    analyst = next(lane for lane in run.lanes if lane.wave == 2)
    assert analyst.agent == "analyst" and analyst.because.startswith("Cash-flow guard")
    assert analyst.findings and analyst.findings[0].title.startswith("Trim ")


def _drain(client: TestClient, run_id: str) -> dict:
    for _ in range(300):
        run = client.get(f"/api/v1/agents/runs/{run_id}").json()
        if run["question"] or run["status"] != "running":
            return run
        time.sleep(0.01)
    raise AssertionError("mission didn't ask or finish")


def test_api_answers_a_question_and_the_plan_uses_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(asking, "ANSWER_TIMEOUT_SECONDS", 10)
    started = client.post(
        "/api/v1/agents/runs",
        json={"kind": "life_event", "goal": "I'm moving to Toronto in September for a co-op"},
    ).json()
    waiting = _drain(client, started["id"])
    question = waiting["question"]
    assert question and question["agent"] == "planner"
    planner = next(lane for lane in waiting["lanes"] if lane["agent"] == "planner")
    assert planner["status"] == "waiting"
    stale = client.post(
        f"/api/v1/agents/runs/{started['id']}/answer", json={"question_id": "q-x", "answer": "Hi"}
    )
    assert stale.status_code == 409
    answered = client.post(
        f"/api/v1/agents/runs/{started['id']}/answer",
        json={"question_id": question["id"], "answer": question["choices"][2]},
    )
    assert answered.status_code == 200
    run = _wait(client, started["id"])
    goal = next(step for step in run["steps"] if step["action"]["kind"] == "goal_new")
    # $1,250.00 a month: first and last month's rent.
    assert goal["action"]["target_cents"] == 250_000
    assert run["asked"][0]["answer"] == "$1,250.00 a month"
    lane = next(lane for lane in run["lanes"] if lane["agent"] == "planner")
    assert any(f["title"] == "Rent goes up $425.00 a month" for f in lane["findings"])


def test_penny_remembers_approvals_and_what_the_user_turned_down(client: TestClient) -> None:
    first = _wait(
        client,
        client.post(
            "/api/v1/agents/runs",
            json={"kind": "life_event", "goal": "I'm moving to Toronto in September"},
        ).json()["id"],
    )
    goal = next(step for step in first["steps"] if step["action"]["kind"] == "goal_new")
    card = next(step for step in first["steps"] if step["action"]["kind"] == "transfer")
    applied = client.post("/api/v1/agent/apply", json={"actions": [goal["action"]]}).json()
    recorded = client.post(
        f"/api/v1/agents/runs/{first['id']}/approved",
        json={"step_ids": [goal["id"]], "undo_id": applied["undo_id"], "declined": [card["id"]]},
    ).json()
    assert recorded["declined"] == [card["id"]]

    later = _wait(client, client.post("/api/v1/agents/runs", json={"kind": "payoff"}).json()["id"])
    assert later["memory"][0]["title"].startswith("Move to Toronto")
    assert "You approved “Start a goal: Move to Toronto”" in later["memory"][0]["detail"]
    # The card payoff the user turned down isn't suggested again.
    assert not any(step["action"]["kind"] == "transfer" for step in later["steps"])
    assert any("you turned it down" in note for note in later["verification"]["notes"])


def test_api_declines_steps(client: TestClient) -> None:
    run = _wait(client, client.post("/api/v1/agents/runs", json={"kind": "payoff"}).json()["id"])
    step = run["steps"][0]["id"]
    declined = client.post(f"/api/v1/agents/runs/{run['id']}/declined", json={"step_ids": [step]})
    assert declined.json()["declined"] == [step]
    bad = client.post(f"/api/v1/agents/runs/{run['id']}/declined", json={"step_ids": ["nope"]})
    assert bad.status_code == 422


# ------------------------------------------------------------------ watch


def test_a_purchase_that_tips_a_budget_over_is_noticed(store: DashboardStore) -> None:
    from app.dashboard_models import TransactionWrite

    after = store.dashboard_for_user(_user(store))
    over = next(b for b in after.budgets if b.remaining_cents < 0)
    tipping = TransactionWrite(
        description="Groceries at Loblaws",
        account_id="acct-chequing",
        category_id=over.category_id,
        amount_cents=-over.remaining_cents + 100,
        kind="spending",
        occurred_on=over.month_start,
    )
    assert noticed(tipping, after) == (
        f"{over.category_name} just went ${-over.remaining_cents / 100:,.2f} over budget "
        "after Groceries at Loblaws"
    )
    # Already over before this purchase, or income: nothing new to notice.
    assert noticed(tipping.model_copy(update={"amount_cents": 1}), after) is None
    assert noticed(tipping.model_copy(update={"kind": "income"}), after) is None


def test_watch_starts_a_mission_once_per_cooldown(
    client: TestClient, store: DashboardStore
) -> None:
    from app.api import agents as agents_api

    user = CurrentUser(id=_user(store))
    client.portal.call(agents_api.watch, user, "Food just went $12.00 over budget")  # type: ignore[union-attr]
    client.portal.call(agents_api.watch, user, "Food just went $20.00 over budget")  # type: ignore[union-attr]
    runs = [r for r in client.get("/api/v1/agents/runs").json() if r["kind"] == "watch"]
    assert len(runs) == 1
    run = _wait(client, runs[0]["id"])
    assert run["trigger"] == "Food just went $12.00 over budget" and not run["asked"]
    assert [lane["agent"] for lane in run["lanes"]][:3] == ["cashflow", "analyst", "planner"]


# ------------------------------------------------------------------ research


def test_research_is_off_without_a_key(store: DashboardStore) -> None:
    ws = _ws(store)
    off = Researcher(get_settings().model_copy(update={"openai_api_key": None}), runtime.Budget(5))
    result, sources = asyncio.run(off.search("Typical rent in Toronto?", ws.facts))
    assert "error" in result and not sources


def test_sources_are_read_from_citations() -> None:
    from types import SimpleNamespace as N

    cite = N(
        type="url_citation",
        url="https://cmhc.ca/rent?utm_source=openai",
        title="CMHC rental market",
    )
    response = N(
        output=[
            N(type="web_search_call"),
            N(type="message", content=[N(annotations=[cite, cite, N(type="file_citation")])]),
        ]
    )
    assert [(s.title, s.url) for s in sources_in(response)] == [
        ("CMHC rental market", "https://cmhc.ca/rent")
    ]


def test_web_figures_feed_estimates_but_never_move_money(store: DashboardStore) -> None:
    ws = _ws(store, "I'm moving to Toronto")
    ws.facts.web_amounts("A shared room in Toronto averages $1,220 a month.")
    out = Outbox()
    estimate = run_tool(ws, out, "move_cost_estimate", {"monthly_rent": "1220.00"})
    assert estimate["first_and_last_month"] == "$2,440.00"
    accounts = [a.id for a in ws.dashboard.accounts if a.account_type in ("chequing", "savings")]
    moved = run_tool(
        ws,
        out,
        "draft_transfer",
        {"from_account_id": accounts[0], "to_account_id": accounts[1], "amount": "1220.00"},
    )
    assert "error" in moved and not out.intents


# ------------------------------------------------------------------ purchases


def test_a_purchase_question_gets_an_answer_numbers_and_options(store: DashboardStore) -> None:
    run = _mission(store, "purchase", "Can I afford a $1,999 laptop?")
    # Maya lives in Halifax: Nova Scotia's 14% HST is on top of the price.
    assert run.brief and run.summary == "The Laptop doesn't fit yet."
    assert run.brief.answer.startswith("The Laptop doesn't fit yet. At $2,278.86 with HST 14%")
    numbers = {n.label: n.value for n in run.brief.numbers}
    assert numbers["Price"] == "$1,999.00" and numbers["With tax"] == "$2,278.86"
    assert numbers["Saving for 3 months"] == "$759.62"
    assert [o.title for o in run.brief.options] == [
        "Save for it over 3 months",
        "Save for it over 6 months",
        "Look for a cheaper option",
    ]
    # Saving toward it is drafted (at the total with tax); paying the card off isn't this question.
    [goal] = run.steps
    assert goal.title == "Start a goal: Laptop" and goal.action.target_cents == 227_886  # type: ignore[union-attr]


def test_picking_an_option_does_that(store: DashboardStore) -> None:
    ws = load_workspace(store, _user(store), "Can I afford a $1,999 laptop?")
    ws.follow_up = "Save for it over 6 months"
    run = MissionRun(
        id="run-follow",
        kind="purchase",
        goal=ws.goal,
        title="Save for it over 6 months",
        started_at=datetime.now(UTC),
    )
    asyncio.run(run_mission(get_settings(), ws, run))
    planner = next(lane for lane in run.lanes if lane.agent == "planner")
    assert planner.findings[0].title == "Save $379.81 a month for 6 months"
    [goal] = run.steps
    assert goal.action.target_date == date(2027, 4, 1)  # type: ignore[union-attr]


def test_sales_tax_by_province() -> None:
    from app.domain import sales_tax

    assert sales_tax.with_tax(189_900, "NS").total_cents == 216_486
    assert sales_tax.with_tax(189_900, "Ontario").tax_cents == 24_687
    assert sales_tax.with_tax(100_000, "qc").total_cents == 114_975
    assert sales_tax.with_tax(1, "AB").tax_cents == 0
    assert sales_tax.province_code("Nowhere") is None
    with pytest.raises(ValueError):
        sales_tax.with_tax(0, "NS")


def test_a_purchase_without_a_price_asks_for_it(store: DashboardStore) -> None:
    run = _mission(store, "purchase", "Iphone 18 pro 256 price in canada can i buy it?")
    assert run.asked[0].question == "What does the Iphone 18 pro 256 cost?"
    assert run.brief and not run.brief.options and "Tell me the price" in run.brief.answer


def test_purchase_questions_go_to_the_agents() -> None:
    from app.agents.team import item_from_text
    from app.assist.agent_more import rule_mission

    for text, item in (
        ("Iphone 18 pro 256 price in canada can i buy it?", "Iphone 18 pro 256"),
        ("Can I afford a $1,999 laptop?", "Laptop"),
        ("how much is a PS5, can I get one", "PS5"),
    ):
        assert rule_mission(text, lambda **kw: kw)["option"] == "purchase"
        assert item_from_text(text) == item


# ------------------------------------------------------------------ cost


def test_the_same_mission_on_the_same_numbers_is_reused(client: TestClient) -> None:
    first = _wait(client, client.post("/api/v1/agents/runs", json={"kind": "payoff"}).json()["id"])
    again = client.post("/api/v1/agents/runs", json={"kind": "payoff"}).json()
    assert again["id"] == first["id"]
    other = client.post("/api/v1/agents/runs", json={"kind": "checkup"}).json()
    assert other["id"] != first["id"]


def test_a_web_answer_is_reused_for_the_same_question(
    store: DashboardStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace as N

    from app.agents import research

    calls = []

    class Responses:
        async def create(self, **kwargs):  # type: ignore[no-untyped-def]
            calls.append(kwargs)
            return N(
                output_text="A shared room in Toronto is about $1,220 a month.",
                output=[],
                usage=N(
                    input_tokens=900, output_tokens=60, input_tokens_details=N(cached_tokens=0)
                ),
            )

    monkeypatch.setattr(research, "AsyncOpenAI", lambda **_: N(responses=Responses()))
    monkeypatch.setattr(research, "_cache", {})
    settings = get_settings().model_copy(update={"openai_api_key": "test", "web_research": True})
    budget = runtime.Budget(10)
    searcher = research.Researcher(settings, budget)
    ws = _ws(store)
    first, _ = asyncio.run(searcher.search("Typical rent in Toronto?", ws.facts))
    second, _ = asyncio.run(searcher.search("typical rent in toronto", _ws(store).facts))
    assert len(calls) == 1 and calls[0]["prompt_cache_key"] == "penny-research"
    assert second["answer"] == first["answer"] and budget.tokens.reused == 1
    assert budget.tokens.input == 900 and budget.used == 1


def test_long_tool_results_are_shortened_for_the_model() -> None:
    text = runtime._for_model({"items": [{"name": "x" * 50}] * 200, "total": "$1.00"})
    assert len(text) <= runtime.MAX_TOOL_RESULT_CHARS and '"…192 more"' in text
    assert runtime._for_model({"a": 1}) == '{"a":1}'


def test_lookup_agents_never_use_the_model() -> None:
    assert {a.id for a in TEAM.values() if not a.thinks} == {"people", "tutor"}


def test_light_agents_use_the_cheaper_model_and_fall_back_to_the_main_one(
    store: DashboardStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert {a.id for a in TEAM.values() if a.light} == {"analyst", "cashflow", "benefits"}
    settings = get_settings().model_copy(
        update={"openai_api_key": "test", "openai_model": "main", "openai_agent_model": "light"}
    )
    tried: list[str | None] = []

    async def run(self: runtime.AgentSession) -> runtime.Report:
        tried.append(self.model)
        if self.model == "light":
            raise runtime.ModelUnavailable("incomplete response")
        return runtime.Report(summary="Checked.")

    monkeypatch.setattr(runtime.AgentSession, "run", run)
    ws = _ws(store)
    lane = AgentLane(agent="analyst", name="Analyst", emoji="🔎", role="r", task="t")
    outcome = asyncio.run(
        runtime.run_lane(
            lane=lane,
            ws=ws,
            kind="checkup",
            playbook=TEAM["analyst"].playbook,
            instructions="",
            tools=[],
            settings=settings,
            budget=runtime.Budget(5),
            clock=runtime.Clock(),
            use_model=True,
            light=True,
        )
    )
    assert tried == ["light", "main"] and outcome.lane.model == "main"
    assert outcome.lane.summary == "Checked." and outcome.lane.source == "ai"
    assert any(step.title == "Trying again on the main model" for step in lane.steps)


def test_a_long_answer_keeps_whole_sentences() -> None:
    from app.agents.orchestrator import _whole_sentences

    text = "Yes, it fits. " + "You keep $87.45 safe to spend after bills this month. " * 10
    kept = _whole_sentences(text, 120)
    assert len(kept) <= 120 and kept.endswith(".") and kept.startswith("Yes, it fits.")
    assert _whole_sentences("Short.", 120) == "Short."


def test_api_follow_up_keeps_the_question_and_acts_on_the_choice(client: TestClient) -> None:
    first = _wait(
        client,
        client.post(
            "/api/v1/agents/runs",
            json={"kind": "purchase", "goal": "Can I afford a $1,999 laptop?"},
        ).json()["id"],
    )
    picked = client.post(
        "/api/v1/agents/runs",
        json={"kind": "custom", "goal": "Save for it over 6 months", "after": first["id"]},
    ).json()
    assert picked["kind"] == "purchase" and picked["goal"] == "Can I afford a $1,999 laptop?"
    assert picked["title"] == "Save for it over 6 months" and picked["after"] == first["id"]
    run = _wait(client, picked["id"])
    assert run["summary"].startswith("Here's your 6-month plan for the Laptop")


def test_saved_missions_survive_a_failing_database_and_a_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.agents import runs

    store = runs.RunStore()
    monkeypatch.setattr(runs, "database_enabled", lambda: True)

    def broken(owner: str, run: MissionRun) -> None:
        raise RuntimeError("check constraint")

    monkeypatch.setattr(store, "_write", broken)
    run = MissionRun(id="run-x", kind="purchase", goal="g", title="t", started_at=datetime.now(UTC))
    store.save("owner", run)  # logged, not raised: the mission carries on from memory
    assert store.get("owner", "run-x") is run
    # Saved as running by a server that has since restarted: reported, not left hanging.
    cut_off = runs._settled(run.model_copy())
    assert cut_off.status == "failed" and cut_off.error == runs.INTERRUPTED
