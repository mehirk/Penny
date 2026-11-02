import pytest

from app.domain.smart_budget import CategoryBase, smart_budget


def _base(category: str, cents: int, want: bool = False) -> CategoryBase:
    return CategoryBase(category, cents, want, "history")


def test_fits_keeps_usual_spending_rounded_up_and_leaves_a_buffer() -> None:
    # $2,000 in, $650 bills, 10% savings ($200): $1,150 for everyday.
    plan = smart_budget(200_000, 65_000, 0, [_base("food", 30_120), _base("fun", 7_000, True)])
    assert (plan.savings_cents, plan.everyday_cents, plan.status) == (20_000, 115_000, "fits")
    assert {line.category_id: line.suggested_cents for line in plan.lines} == {
        "food": 30_500,
        "fun": 7_000,
    }
    assert plan.buffer_cents == 115_000 - 37_500
    assert not any(line.trimmed for line in plan.lines)


def test_goals_get_more_savings_from_what_would_be_left_over() -> None:
    # 10% is $200; goals need $350 and there's plenty spare: savings rise to $350.
    assert smart_budget(200_000, 65_000, 35_000, []).savings_cents == 35_000


def test_goals_are_capped_at_a_fifth_of_income() -> None:
    assert smart_budget(200_000, 0, 90_000, []).savings_cents == 40_000


def test_goals_never_squeeze_everyday_spending() -> None:
    # $1,000 in, $600 bills, $100 (10%) saved, $250 usual spending: only $50 spare for goals.
    plan = smart_budget(100_000, 60_000, 50_000, [_base("food", 25_000)])
    assert (plan.savings_cents, plan.status) == (15_000, "fits")
    assert plan.lines[0].suggested_cents == 25_000


def test_savings_never_take_more_than_is_left_after_bills() -> None:
    plan = smart_budget(100_000, 95_000, 50_000, [])
    assert (plan.savings_cents, plan.everyday_cents) == (5_000, 0)


def test_trims_wants_first() -> None:
    # $1,000 in, $600 bills, 10% savings: $300 room. Food $250 + fun $100 = $350, $50 over.
    plan = smart_budget(100_000, 60_000, 0, [_base("food", 25_000), _base("fun", 10_000, True)])
    amounts = {line.category_id: line.suggested_cents for line in plan.lines}
    assert plan.status == "trimmed"
    assert amounts == {"food": 25_000, "fun": 5_000}
    assert plan.planned_cents <= plan.everyday_cents


def test_scales_everything_when_cutting_wants_is_not_enough() -> None:
    plan = smart_budget(100_000, 70_000, 0, [_base("food", 25_000), _base("fun", 10_000, True)])
    assert plan.status == "trimmed"
    assert plan.planned_cents <= plan.everyday_cents == 20_000
    assert all(line.suggested_cents % 500 == 0 for line in plan.lines)
    assert all(line.trimmed for line in plan.lines)


def test_bills_above_income_is_short_and_shows_usual_spending() -> None:
    plan = smart_budget(50_000, 60_000, 0, [_base("food", 20_000)])
    assert (plan.status, plan.everyday_cents, plan.buffer_cents) == ("short", 0, 0)
    assert plan.lines[0].suggested_cents == 20_000


def test_no_income_yet() -> None:
    plan = smart_budget(0, 0, 0, [CategoryBase("food", 25_000, False, "typical")])
    assert plan.status == "no_income"
    assert plan.lines[0].basis == "typical"


def test_zero_categories_are_left_out() -> None:
    plan = smart_budget(100_000, 0, 0, [_base("food", 0), _base("fun", 4_000, True)])
    assert [line.category_id for line in plan.lines] == ["fun"]


@pytest.mark.parametrize(
    "args",
    [
        (-1, 0, 0, []),
        (0, -1, 0, []),
        (0, 0, -1, []),
        (100, 0, 0, [CategoryBase("a", -1, False, "history")]),
        (
            100,
            0,
            0,
            [CategoryBase("a", 1, False, "history"), CategoryBase("a", 1, False, "history")],
        ),
    ],
)
def test_rejects_bad_inputs(args: tuple) -> None:  # type: ignore[type-arg]
    with pytest.raises(ValueError):
        smart_budget(*args)


def test_rejects_bad_savings_share() -> None:
    with pytest.raises(ValueError):
        smart_budget(100, 0, 0, [], savings_basis_points=6_000)


def test_demo_store_plan_uses_every_pay_source_and_leaves_bills_out() -> None:
    from app.store import demo_store

    store = demo_store()
    owner = store.snapshot().profile.id
    plan, source = store.smart_budget_plan(owner)
    assert source == "pay"
    assert plan.income_cents == 126_400 + 7_500 * 52 // 12
    assert "cat-housing" not in {line.category_id for line in plan.lines}  # rent is a bill
    stated, source = store.smart_budget_plan(owner, 200_000)
    assert (stated.income_cents, source) == (200_000, "stated")


def test_coach_builds_a_budget_card_without_the_model() -> None:
    import asyncio

    from app.coach.coach import Coach
    from app.coach.models import ChatRequest
    from app.config import Settings
    from app.store import demo_store

    store = demo_store()
    owner = store.snapshot().profile.id
    coach = Coach(store, Settings(_env_file=None, openai_api_key=None))  # type: ignore[call-arg]
    request = ChatRequest.model_validate(
        {"messages": [{"role": "user", "content": "I make $2000 a month, make me a budget"}]}
    )
    reply = asyncio.run(coach.chat(request, owner))
    assert reply.budget_plan is not None and reply.budget_plan.income_source == "stated"
    assert reply.budget_plan.lines
    assert "Add to my budgets" in reply.reply
