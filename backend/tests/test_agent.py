"""Penny's agent: say or snap what happened, approve the plan, and undo it."""

import asyncio
from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.agent_models import (
    AgentRequest,
    BudgetAction,
    ExpenseAction,
    FriendRef,
    GoalAddAction,
    GoalNewAction,
    ReceiptItem,
    SplitAction,
)
from app.api.agent import UndoLog
from app.assist import agent
from app.config import get_settings
from app.db.rows import to_rows
from app.domain.splits import even_split
from app.store import DashboardStore, demo_store


@pytest.fixture
def store() -> DashboardStore:
    return demo_store()


def _user(store: DashboardStore) -> str:
    return next(iter(store.owner_user_ids))


def _plan(store: DashboardStore, text: str = "", receipt: list[ReceiptItem] | None = None):
    request = AgentRequest(text=text, receipt=receipt or [])
    return asyncio.run(agent.plan(get_settings(), store, _user(store), request))


def test_even_split_gives_the_odd_cents_to_the_user() -> None:
    assert even_split(10_000, 3) == (3_334, 3_333)
    assert even_split(9_000, 3) == (3_000, 3_000)
    assert even_split(2, 2) == (1, 1)
    for bad in ((0, 3), (100, 1), (100, 51), (1, 2)):
        with pytest.raises(ValueError):
            even_split(*bad)


def test_spoken_split_with_named_friends_becomes_one_step(store: DashboardStore) -> None:
    plan = _plan(store, "Dinner with Sam and Ana, I paid $90, split 3 ways")
    assert plan.question is None and plan.source == "built_in"
    [step] = plan.steps
    action = step.action
    assert isinstance(action, SplitAction)
    assert action.total_cents == 9_000
    assert [f.name for f in action.friends] == ["Sam", "Ana"] and action.paid_by is None
    assert step.needs_friends == 0
    assert "Sam and Ana owe you $30.00 each" in step.lines
    assert "Adds Sam and Ana to your friends" in step.lines


def test_split_without_names_asks_to_pick_friends(store: DashboardStore) -> None:
    plan = _plan(store, "went out to eat with friends, paid 60 split by 3 people")
    [step] = plan.steps
    assert isinstance(step.action, SplitAction) and step.action.friends == []
    assert step.needs_friends == 2
    assert step.title == "Split Food with friends 3 ways"


def test_missing_amount_is_asked_not_guessed(store: DashboardStore) -> None:
    plan = _plan(store, "today i went out to eat food with friends, i paid split by 3 people")
    assert plan.steps == []
    assert plan.question and plan.question.startswith("How much was")


def test_expense_shows_its_budget_after_this(store: DashboardStore) -> None:
    plan = _plan(store, "uber 18.40 yesterday")
    [step] = plan.steps
    assert isinstance(step.action, ExpenseAction)
    assert step.action.amount_cents == 1_840
    assert step.action.occurred_on == date(2026, 10, 30)
    assert "Transportation budget: $36.80 of $30.00 · over by $6.80" in step.lines


def test_budget_and_goal_sentences(store: DashboardStore) -> None:
    [budget] = _plan(store, "set my entertainment budget to $120").steps
    assert budget.action == BudgetAction(category_id="cat-fun", limit_cents=12_000)
    assert budget.lines[0] == "$80.00 → $120.00 this month"

    [goal] = _plan(store, "put $50 into my laptop fund").steps
    assert isinstance(goal.action, GoalAddAction) and goal.action.goal_id == "goal-laptop"
    assert "Laptop fund: $350.00 of $1,200.00 after this" in goal.lines

    [new] = _plan(store, "I'm saving for a trip to Banff $800 by march").steps
    assert isinstance(new.action, GoalNewAction)
    assert new.action.target_cents == 80_000 and new.action.target_date == date(2027, 3, 1)


def test_receipt_alone_and_receipt_split(store: DashboardStore) -> None:
    receipt = [
        ReceiptItem(
            description="Pizza Pizza",
            amount_cents=4_520,
            category_id="cat-eating-out",
            occurred_on=date(2026, 10, 31),
        )
    ]
    [step] = _plan(store, receipt=receipt).steps
    assert isinstance(step.action, ExpenseAction) and step.action.amount_cents == 4_520
    [split] = _plan(store, "split it with Sam", receipt).steps
    assert isinstance(split.action, SplitAction)
    assert split.action.total_cents == 4_520 and split.action.category_id == "cat-eating-out"
    assert "Sam owes you $22.60" in split.lines


def test_apply_runs_everything_and_undo_puts_it_back(store: DashboardStore) -> None:
    user = _user(store)
    before = to_rows(store.snapshot())
    split = SplitAction(
        description="Dinner",
        total_cents=10_000,
        category_id="cat-eating-out",
        occurred_on=date(2026, 10, 31),
        account_id="acct-chequing",
        friends=[FriendRef(name="Sam"), FriendRef(name="Ana")],
    )
    budget = BudgetAction(category_id="cat-fun", limit_cents=12_000)
    dashboard, done, saved = store.apply_agent_actions(user, [split, budget])
    friends = {a.name: a for a in dashboard.accounts if a.account_type == "person"}
    assert friends["Sam"].balance_cents == 3_333 and friends["Ana"].balance_cents == 3_333
    dinner = next(t for t in dashboard.transactions if t.description == "Dinner")
    assert dinner.amount_cents == 3_334
    assert done == [
        "Split Dinner: Sam and Ana owe you $33.33 each",
        "Entertainment budget set to $120.00",
    ]

    log = UndoLog()
    undo_id = log.remember(user, saved, store.snapshot())
    item = log.take(user, undo_id)
    store.restore(user, item.before)
    assert to_rows(store.snapshot()) == before
    with pytest.raises(HTTPException):
        log.take(user, undo_id)


def test_apply_is_all_or_nothing(store: DashboardStore) -> None:
    user = _user(store)
    before = to_rows(store.snapshot())
    good = ExpenseAction(
        description="Coffee",
        amount_cents=450,
        account_id="acct-chequing",
        occurred_on=date(2026, 10, 31),
    )
    too_much = GoalAddAction(
        goal_id="goal-laptop", amount_cents=999_999, account_id="acct-chequing"
    )
    with pytest.raises(HTTPException):
        store.apply_agent_actions(user, [good, too_much])
    assert to_rows(store.snapshot()) == before


def test_friend_who_paid_means_the_user_owes_them(store: DashboardStore) -> None:
    user = _user(store)
    action = SplitAction(
        description="Pizza",
        total_cents=3_000,
        occurred_on=date(2026, 10, 31),
        account_id="acct-chequing",
        friends=[FriendRef(name="Sam")],
        paid_by=0,
    )
    dashboard, done, _ = store.apply_agent_actions(user, [action])
    sam = next(a for a in dashboard.accounts if a.name == "Sam")
    assert sam.balance_cents == -1_500
    assert done == ["Split Pizza: you owe Sam $15.00"]


def test_split_needs_friends_and_valid_payer() -> None:
    with pytest.raises(ValidationError):
        SplitAction(
            description="x",
            total_cents=100,
            occurred_on=date(2026, 10, 31),
            account_id="a",
            friends=[FriendRef(name="Sam")],
            paid_by=1,
        )
    with pytest.raises(ValidationError):
        AgentRequest(text="  ")


def test_built_in_rules_read_several_things_from_one_message(store: DashboardStore) -> None:
    plan = _plan(
        store,
        "Went out to eat with Sam, paid 60, split 2 ways. Also set my entertainment budget to "
        "120 and put $50 in my laptop fund",
    )
    assert [step.action.kind for step in plan.steps] == ["split", "budget", "goal_add"]
    assert plan.question is None


def test_answering_how_much_fills_in_the_amount(store: DashboardStore) -> None:
    plan = _plan(store, "went out to eat with friends, i paid, split by 3 people. It was $75")
    [step] = plan.steps
    assert isinstance(step.action, SplitAction) and step.action.total_cents == 7_500
    assert plan.question is None


@pytest.mark.parametrize(
    ("said", "kind", "value"),
    [
        ("switch to dark mode", "theme", "dark"),
        ("make it light mode", "theme", "light"),
        ("change the colours to emerald", "palette", "emerald"),
        ("hide my balances", "hide_amounts", "on"),
        ("mute the sounds", "sound", "off"),
        ("open my goals", "navigate", "goals"),
        ("take me to settings", "navigate", "settings"),
        ("Can I afford a $300 concert trip?", "ask", "Can I afford a $300 concert trip?"),
    ],
)
def test_app_commands_run_on_the_device(store: DashboardStore, said: str, kind: str, value: str):
    plan = _plan(store, said)
    assert plan.steps == [] and plan.question is None
    [app] = plan.app
    assert (app.kind, app.value) == (kind, value)


def test_account_commands_become_steps_and_apply(store: DashboardStore) -> None:
    user = _user(store)
    said = {
        "pay off my credit card": "transfer",
        "paid my mobile plan": "bill_paid",
        "pause my laptop fund": "goal_update",
        "I'm a student": "persona",
        "move $100 to savings": "transfer",
        "delete my last transaction": "delete",
    }
    actions = []
    for text, kind in said.items():
        plan = _plan(store, text)
        assert len(plan.steps) == 1, (text, plan)
        [step] = plan.steps
        assert step.action.kind == kind, text
        actions.append(step.action)
    card = next(s for s in _plan(store, "pay off my credit card").steps)
    assert "Pays it off in full" in card.lines and "$243.80" in card.lines[0]

    dashboard, done, _ = store.apply_agent_actions(user, actions)
    assert done[0] == "Paid $243.80 to Student Credit Card"
    assert done[1] == "Marked Mobile plan paid"
    assert done[2] == "Paused Laptop fund"
    assert done[3] == "Penny now coaches you as a student"
    assert next(g for g in dashboard.savings_goals if g.id == "goal-laptop").status == "paused"
    assert done[4] == "Moved $100.00 from Everyday Chequing to High Interest Savings"
    assert done[5].startswith("Deleted ")


def test_settle_up_defaults_to_what_is_owed(store: DashboardStore) -> None:
    user = _user(store)
    [split] = _plan(store, "Dinner with Sam, I paid $50, split 2 ways").steps
    store.apply_agent_actions(user, [split.action])
    [settle] = _plan(store, "Sam paid me back").steps
    assert settle.title == "Sam paid you back"
    assert "All settled up after this ✅" in settle.lines
    dashboard, done, _ = store.apply_agent_actions(user, [settle.action])
    assert done == ["Sam paid you back $25.00"]
    assert next(a for a in dashboard.accounts if a.name == "Sam").balance_cents == 0


def test_new_bill_guesses_the_next_due_date_and_says_so(store: DashboardStore) -> None:
    ctx = agent.context_for(store, _user(store))
    steps, apps, question, _ = agent.build_steps(
        ctx, [agent.Intent(kind="bill_new", description="Spotify", amount="11.99")]
    )
    assert question is None and apps == []
    [step] = steps
    assert step.lines == [
        "$11.99 monthly from Everyday Chequing",
        "Next due Mon, Nov 30 (change it if that's wrong)",
    ]


@pytest.mark.parametrize("said", ["hi penny", "tell me about my spending", "thanks!"])
def test_conversation_goes_to_penny_ai(store: DashboardStore, said: str) -> None:
    plan = _plan(store, said)
    assert plan.steps == [] and plan.question is None
    [app] = plan.app
    assert (app.kind, app.value) == ("ask", said)


def test_a_purchase_without_an_amount_is_still_asked_about(store: DashboardStore) -> None:
    plan = _plan(store, "I bought lunch at Tim's")
    assert plan.question and plan.question.startswith("How much was")


def test_budget_without_a_category_asks_with_choices_and_keeps_the_question(
    store: DashboardStore,
) -> None:
    said = "make me a budget of $200 and see if I can afford a $200 trip"
    plan = _plan(store, said)
    assert plan.steps == []
    assert plan.question == "Which category is the $200.00 budget for?"
    assert "Food" in plan.choices and "Entertainment" in plan.choices
    [ask] = plan.app
    assert ask.kind == "ask" and "afford" in ask.value

    # Answering keeps the whole request: the budget is made and the question still goes on.
    answered = _plan(store, f"{said}. Fun")
    assert [s.action.kind for s in answered.steps] == ["budget"]
    assert answered.question is None and answered.app[0].kind == "ask"


def test_a_new_category_budget_is_made_in_one_step(store: DashboardStore) -> None:
    plan = _plan(store, "make me a budget of $200. Just make a new one called Trips")
    [step] = plan.steps
    assert step.title == "New budget: Trips"
    assert step.action == BudgetAction(new_category="Trips", limit_cents=20_000)
    dashboard, done, _ = store.apply_agent_actions(_user(store), [step.action])
    assert done == ["Trips budget set to $200.00"]
    trips = next(c for c in dashboard.categories if c.name == "Trips")
    assert any(b.category_id == trips.id and b.limit_cents == 20_000 for b in dashboard.budgets)


def test_usuals_are_the_most_frequent_everyday_purchases(store: DashboardStore) -> None:
    usuals = store.usual_transactions(_user(store))
    assert usuals[0].text == "Atlantic Market $189.42" and usuals[0].count == 4
    names = [item.description for item in usuals]
    # Bills record themselves, so they aren't offered.
    assert "Mobile plan" not in names and "Halifax Transit pass" not in names


def test_a_repeat_purchase_is_filed_the_way_the_user_filed_it(store: DashboardStore) -> None:
    [step] = _plan(store, "Movie night $18").steps
    assert isinstance(step.action, ExpenseAction) and step.action.category_id == "cat-fun"
    [usual] = _plan(store, "Atlantic Market $40").steps
    assert isinstance(usual.action, ExpenseAction) and usual.action.category_id == "cat-groceries"
