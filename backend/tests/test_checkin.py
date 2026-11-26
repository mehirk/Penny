"""Plan check-in: which approved missions Home keeps track of, and how far along each one is."""

from datetime import UTC, date, datetime

from app.agent_models import AgentStep, ExpenseAction, GoalAddAction, GoalNewAction
from app.agents.checkin import MAX_PLANS, check_in, check_ins
from app.agents.models import ChecklistItem, MissionRun
from app.dashboard_models import Goal

TODAY = date(2026, 11, 26)


def _goal(goal_id: str = "goal-1", name: str = "Toronto move fund", current: int = 66_400) -> Goal:
    return Goal(
        id=goal_id,
        name=name,
        target_cents=265_600,
        current_cents=current,
        target_date=date(2027, 1, 1),
        status="active",
        progress_basis_points=current * 10_000 // 265_600,
    )


def _run(run_id: str = "run-1", **change: object) -> MissionRun:
    run = MissionRun(
        id=run_id,
        kind="life_event",
        goal="I'm moving from Halifax to Toronto. What will it cost?",
        title="Move to Toronto",
        status="done",
        started_at=datetime(2026, 11, 20, tzinfo=UTC),
        checklist=[
            ChecklistItem(
                id="c1", title="Give notice", detail="", due_on=date(2026, 11, 20), stage="before"
            ),
            ChecklistItem(
                id="c2", title="Book movers", detail="", due_on=date(2026, 12, 10), stage="before"
            ),
            ChecklistItem(
                id="c3", title="Get an OHIP card", detail="", due_on=date(2027, 1, 8), stage="after"
            ),
        ],
        steps=[
            AgentStep(
                id="s1",
                emoji="🎯",
                title="Start a goal: Toronto move fund",
                lines=[],
                action=GoalNewAction(name="Toronto Move  Fund", target_cents=265_600),
            ),
            AgentStep(
                id="s2",
                emoji="💸",
                title="Log a deposit",
                lines=[],
                action=ExpenseAction(
                    description="Deposit", amount_cents=50_000, account_id="a1", occurred_on=TODAY
                ),
            ),
        ],
        approved=["s1"],
    )
    return run.model_copy(update=change)


def test_an_approved_plan_tracks_its_checklist_and_goal() -> None:
    plan = check_in(_run(ticked=["c2"]), [_goal()], TODAY)
    assert plan is not None
    assert (plan.done, plan.total, plan.overdue) == (1, 3, 1)
    # The earliest item still to do comes next, and it's past due.
    assert plan.next is not None and plan.next.item_id == "c1" and plan.next.overdue
    # The goal the approved step started, matched by name whatever the spacing and case.
    assert plan.goal is not None and plan.goal.goal_id == "goal-1"
    assert (plan.goal.current_cents, plan.goal.target_cents) == (66_400, 265_600)
    assert plan.goal.progress_basis_points == 2_500


def test_a_goal_the_mission_added_to_is_found_by_id() -> None:
    step = AgentStep(
        id="s3",
        emoji="💰",
        title="Add to a goal",
        lines=[],
        action=GoalAddAction(goal_id="goal-2", amount_cents=10_000, account_id="a1"),
    )
    plan = check_in(_run(steps=[step], approved=["s3"]), [_goal(), _goal("goal-2", "Trip")], TODAY)
    assert plan is not None and plan.goal is not None and plan.goal.goal_id == "goal-2"


def test_no_goal_when_the_goal_step_was_not_approved_or_is_gone() -> None:
    for run, goals in (
        (_run(approved=["s2"]), [_goal()]),
        (_run(), [_goal(name="Something else")]),
    ):
        plan = check_in(run, goals, TODAY)
        assert plan is not None and plan.goal is None


def test_all_done_has_nothing_next() -> None:
    plan = check_in(_run(ticked=["c1", "c2", "c3"]), [], TODAY)
    assert (
        plan is not None
        and plan.done == plan.total == 3
        and plan.next is None
        and plan.overdue == 0
    )


def test_only_finished_approved_current_plans_with_a_checklist() -> None:
    assert check_in(_run(approved=[]), [], TODAY) is None  # nothing approved: not a plan yet
    assert check_in(_run(status="running"), [], TODAY) is None
    assert check_in(_run(status="failed"), [], TODAY) is None
    assert check_in(_run(superseded=True), [], TODAY) is None
    assert check_in(_run(checklist=[]), [], TODAY) is None


def test_unfinished_plans_come_first_and_at_most_three() -> None:
    finished = _run("run-done", ticked=["c1", "c2", "c3"])
    runs = [finished, *[_run(f"run-{n}") for n in range(5)], _run("run-x", approved=[])]
    plans = check_ins(runs, [], TODAY)
    assert len(plans) == MAX_PLANS
    assert [plan.run_id for plan in plans] == ["run-0", "run-1", "run-2"]
    assert check_ins([], [], TODAY) == []
