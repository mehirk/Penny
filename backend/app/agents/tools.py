"""The agents' tools. Read tools run deterministic code and register every figure they return
in the shared FactBook. Draft tools add a step for the user to approve, and refuse any amount a
tool didn't produce and the user didn't say, so the model never invents money. Auto tools do
things that move no money (a reminder, a lesson to read).

Each subagent gets only the tools its job needs (app.agents.team).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

from app.agents.models import AutoTask
from app.agents.workspace import Outbox, Workspace
from app.assist import agent as planner
from app.coach import tools as coach_tools
from app.coach.facts import parse_cad
from app.domain import benefits as benefit_rules
from app.domain.cash_forecast import Flow, Forecast, forecast
from app.domain.finance import format_cad

ToolKind = Literal["read", "draft", "auto", "ask", "research"]
MAX_FORECAST_DAYS = 60
MAX_REMINDER_DAYS = 400


class ToolError(ValueError):
    """An input problem the agent should correct."""


@dataclass(frozen=True)
class Tool:
    name: str
    kind: ToolKind
    description: str
    # JSON schema properties; every one is required (use a null type for optional ones).
    properties: dict[str, Any]
    run: Callable[[Workspace, Outbox, dict[str, Any]], dict[str, Any]]

    def spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "name": self.name,
            "description": self.description,
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": self.properties,
                "required": list(self.properties),
                "additionalProperties": False,
            },
        }


def _text(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def _optional(description: str) -> dict[str, Any]:
    return {"type": ["string", "null"], "description": description}


def _cents(value: object, field: str) -> int:
    try:
        cents = parse_cad(str(value))
    except ValueError as error:
        raise ToolError(f"{field} must be a CAD amount like 150.00") from error
    if cents <= 0:
        raise ToolError(f"{field} must be more than zero")
    return cents


def _plain(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def _date(value: object, field: str) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as error:
        raise ToolError(f"{field} must be a date like 2027-03-01") from error


# ------------------------------------------------------------------ read tools


def money_overview(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    d, f, c = ws.dashboard, ws.facts, ws.coach
    chequing = c.account_total("chequing")
    result: dict[str, Any] = {
        "safe_to_spend": f.money("Safe to spend", d.spending_power_cents, "dashboard"),
        "chequing": f.money("Chequing balance", chequing, "accounts"),
        "savings": f.money("Savings balance", c.account_total("savings"), "accounts"),
        "unpaid_bills_before_payday": f.money(
            "Unpaid bills before payday", c.unpaid_bills_cents, "bills"
        ),
        "chequing_after_bills": f.money(
            "Chequing after bills", chequing - c.unpaid_bills_cents, "accounts"
        ),
        "typical_monthly_surplus": f.money(
            "Typical monthly surplus (3-month average)", c.typical_surplus_cents, "history"
        ),
        "accounts": [
            {
                "id": a.id,
                "name": a.name,
                "type": a.account_type,
                "balance": f.money(f"{a.name} balance", a.balance_cents, "accounts"),
            }
            for a in d.accounts
            if a.account_type != "person"
        ],
    }
    if d.credit:
        result["credit_card"] = {
            "id": d.credit.account_id,
            "owed": f.money("Card balance owed", d.credit.balance_cents, "accounts"),
            "utilization": f.percent(
                "Credit utilization", d.credit.utilization_basis_points, "accounts"
            ),
        }
    if d.pay:
        result["next_paydays"] = [
            {
                "name": p.name,
                "on": p.on.isoformat(),
                "amount": f.money(p.name, p.amount_cents, "pay"),
            }
            for p in d.pay.upcoming[:3]
            if not p.received
        ]
    return result


def spending_by_category(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    d, f = ws.dashboard, ws.facts
    budgets = {b.category_id: b for b in d.budgets}
    rows = []
    for item in d.category_spending:
        name = item.category_name
        budget = budgets.get(item.category_id)
        average = ws.coach.category_average_cents(name)
        row: dict[str, Any] = {
            "category": name,
            "spent_this_month": f.money(
                f"{name} spent this month", item.spent_cents, "transactions"
            ),
        }
        if average is not None:
            row["three_month_average"] = f.money(f"{name} 3-month average", average, "history")
            row["above_usual"] = item.spent_cents > average
        if budget and budget.limit_cents:
            row["budget"] = f.money(f"{name} budget", budget.limit_cents, "budgets")
            row["budget_left"] = f.money(f"{name} budget left", budget.remaining_cents, "budgets")
            row["over_budget"] = budget.remaining_cents < 0
            bills = item.spent_cents - budget.spent_cents
            if bills > 0:
                # Recurring bills are planned separately, so they don't use up the budget.
                row["of_which_bills_outside_budget"] = f.money(
                    f"{name} bills outside the budget", bills, "budgets"
                )
        rows.append(row)
    return {
        "month": d.active_month.strftime("%B %Y"),
        "total_spent": f.money("Spent this month", d.totals.spending_cents, "transactions"),
        "categories": rows,
    }


def subscriptions_and_bills(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    d, f = ws.dashboard, ws.facts
    items = []
    subscriptions_monthly = 0
    for item in d.recurring.items:
        yearly = item.monthly_cents * 12
        if item.kind == "subscription":
            subscriptions_monthly += item.monthly_cents
        items.append(
            {
                "id": item.id,
                "name": item.name,
                "kind": item.kind,
                "amount": f.money(item.name, item.amount_cents, "recurring"),
                "frequency": item.frequency,
                "per_year": f.money(f"{item.name} per year", yearly, "recurring"),
                "next_due": item.next_due.isoformat(),
                "days_until_due": item.days_until_due,
                "ever_paid_in_penny": item.payment_count > 0,
            }
        )
    return {
        "items": items,
        "subscriptions_per_month": f.money(
            "Subscriptions per month", subscriptions_monthly, "recurring"
        ),
        "subscriptions_per_year": f.money(
            "Subscriptions per year", subscriptions_monthly * 12, "recurring"
        ),
    }


def forecast_for(ws: Workspace, days: int) -> Forecast:
    """Chequing from today through `days` of bills, card payments, and paydays."""
    d = ws.dashboard
    until = ws.today + timedelta(days=days)
    chequing_ids = {a.id for a in d.accounts if a.account_type == "chequing"}
    bill_accounts = {b.id: b.account_id for b in d.bills}
    flows = [
        Flow(item.due_on, item.name, -item.amount_cents)
        for item in d.recurring.upcoming
        if item.due_on <= until and bill_accounts.get(item.bill_id) in chequing_ids
    ]
    if d.pay:
        accounts = {source.id: source.account_id for source in d.pay.sources}
        flows += [
            Flow(item.on, item.name, item.amount_cents)
            for item in d.pay.upcoming
            if not item.received and item.on <= until and accounts.get(item.pay_id) in chequing_ids
        ]
    flows += [
        Flow(card.due_on, f"{card.account_name} payment", -card.owed_cents)
        for card in d.card_payments
        if card.owed_cents and card.due_on <= until
    ]
    return forecast(ws.coach.account_total("chequing"), flows)


def cash_forecast(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    f = ws.facts
    days = int(args.get("days") or 30)
    if not 1 <= days <= MAX_FORECAST_DAYS:
        raise ToolError(f"days must be between 1 and {MAX_FORECAST_DAYS}")
    result = forecast_for(ws, days)
    return {
        "days": days,
        "chequing_now": f.money("Chequing balance", result.start_cents, "accounts"),
        "chequing_at_end": f.money(f"Chequing in {days} days", result.end_cents, "cash_forecast"),
        "lowest_point": f.money(
            "Lowest chequing balance ahead", result.lowest_cents, "cash_forecast"
        ),
        "lowest_on": result.lowest_on.isoformat() if result.lowest_on else None,
        "first_day_short": result.first_short_on.isoformat() if result.first_short_on else None,
        "shortfall": f.money("Chequing shortfall ahead", result.shortfall_cents, "cash_forecast"),
        "flows": [
            {
                "on": flow.on.isoformat(),
                "what": flow.label,
                "amount": f.money(flow.label, flow.cents, "cash_forecast"),
            }
            for flow in result.flows[:15]
        ],
    }


def goals_status(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    d, f = ws.dashboard, ws.facts
    surplus = ws.coach.typical_surplus_cents
    goals = []
    for goal in d.savings_goals:
        needed = goal.monthly_needed_cents if goal.status == "active" else None
        goals.append(
            {
                "id": goal.id,
                "name": goal.name,
                "status": goal.status,
                "target": f.money(f"{goal.name} target", goal.target_cents, "goals"),
                "saved": f.money(f"{goal.name} saved", goal.current_cents, "goals"),
                "still_needed": f.money(
                    f"{goal.name} still needed",
                    max(0, goal.target_cents - goal.current_cents),
                    "goals",
                ),
                "target_date": goal.target_date.isoformat() if goal.target_date else None,
                "monthly_needed": (
                    f.money(f"Monthly saving needed for {goal.name}", needed, "goals")
                    if needed
                    else None
                ),
                "fits_typical_surplus": needed is not None and needed <= surplus,
            }
        )
    return {
        "typical_monthly_surplus": f.money(
            "Typical monthly surplus (3-month average)", surplus, "history"
        ),
        "goals": goals,
    }


def _coach(name: str) -> Callable[[Workspace, Outbox, dict[str, Any]], dict[str, Any]]:
    """One of Penny AI's calculators, shared with the agents."""
    handler = getattr(coach_tools, name)

    def run(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
        try:
            return handler(ws.coach, **args)
        except coach_tools.ToolError as error:
            raise ToolError(str(error)) from error

    return run


def move_cost_estimate(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    """A starting target for a move: first and last month's rent, at the rent the user expects
    in the new place (from them or from web research) or else at today's rent."""
    f = ws.facts
    rent = next((b for b in ws.dashboard.bills if b.category_id == "cat-housing"), None)
    result: dict[str, Any] = {}
    if rent:
        result["current_rent"] = f.money("Current rent", rent.amount_cents, "bills")
    if args.get("monthly_rent") not in (None, ""):
        monthly = _cents(args.get("monthly_rent"), "monthly_rent")
        _known(ws, monthly, "monthly_rent", web=True)
        # A rent only the web gave stays a web figure: usable here, never as an amount to move.
        source = "move_cost_estimate" if ws.facts.knows_cents(monthly) else "web"
        basis = "the new rent"
    elif rent:
        monthly = rent.amount_cents
        source = "bills"
        basis = "today's rent; a new city's rent can differ"
    else:
        raise ToolError("No rent on record: pass monthly_rent (from the user or web research)")
    result["new_rent"] = f.money("Expected rent", monthly, source)
    result["first_and_last_month"] = f.money(
        "First and last month's rent", monthly * 2, "move_cost_estimate"
    )
    if rent and monthly != rent.amount_cents:
        change = monthly - rent.amount_cents
        result["rent_change_per_month"] = f.money(
            "Rent change per month", abs(change), "move_cost_estimate"
        )
        result["rent_goes"] = "up" if change > 0 else "down"
    result["note"] = f"Based on {basis}."
    return result


def who_owes_me(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    f = ws.facts
    people = []
    for friend in ws.dashboard.accounts:
        if friend.account_type != "person" or not friend.balance_cents:
            continue
        owes_you = friend.balance_cents > 0
        people.append(
            {
                "id": friend.id,
                "name": friend.name,
                "direction": "owes you" if owes_you else "you owe them",
                "amount": f.money(
                    f"{friend.name} {'owes you' if owes_you else 'is owed'}",
                    abs(friend.balance_cents),
                    "splits",
                ),
            }
        )
    return {"people": people}


def benefits_screen(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    d, f = ws.dashboard, ws.facts
    prior = ws.coach.prior.totals
    months = max(1, prior.months_with_activity)
    yearly = prior.income_cents * 12 // months
    working = sum(source.monthly_cents for source in d.pay.sources) * 12 if d.pay else 0
    profile = benefit_rules.Profile(
        age=d.profile.age,
        student=d.profile.persona == "student" or bool(d.profile.school),
        yearly_income_cents=yearly,
        yearly_working_income_cents=working,
    )
    deadline = benefit_rules.tax_deadline(ws.today)
    return {
        "estimated_yearly_income": f.money(
            "Estimated yearly income (last 3 months × 4)", yearly, "benefits_screen"
        ),
        "tax_filing_deadline": deadline.isoformat(),
        "note": "A screen, not a decision: the CRA or the student aid office decides.",
        "matches": [
            {
                "id": m.id,
                "name": m.name,
                "status": m.status,
                "why": m.why,
                "up_to": f.money(f"{m.name} maximum", m.up_to_cents, "benefits_screen")
                if m.up_to_cents
                else None,
                "how": m.how,
                "guide_id": m.guide_id,
                "source_url": m.source_url,
            }
            for m in benefit_rules.screen(profile)
        ],
    }


def learning_progress(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    topics = []
    for topic in ws.learn.topics:
        lessons = topic.lessons
        next_lesson = next((x for x in lessons if not x.locked and not x.passed), None)
        topics.append(
            {
                "topic": topic.id,
                "label": topic.label,
                "passed": sum(1 for x in lessons if x.passed),
                "lessons": len(lessons),
                "next_lesson": {"id": next_lesson.id, "title": next_lesson.title}
                if next_lesson
                else None,
            }
        )
    return {"topics": sorted(topics, key=lambda t: t["passed"] / max(1, t["lessons"]))}


def find_lessons(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or "").strip().casefold()
    if not query:
        raise ToolError("query is required, like 'credit' or 'rent'")
    words = [w for w in query.split() if len(w) > 2] or [query]
    found = [
        {"id": lesson.id, "title": lesson.title, "summary": lesson.summary, "locked": lesson.locked}
        for topic in ws.learn.topics
        for lesson in topic.lessons
        if topic.id == query
        or any(w in f"{lesson.title} {lesson.summary}".casefold() for w in words)
    ]
    return {"lessons": found[:6]}


# ------------------------------------------------------------------ draft tools (need approval)


def _known(ws: Workspace, cents: int, field: str, *, web: bool = False) -> None:
    if not ws.facts.knows_cents(cents, web=web):
        raise ToolError(
            f"{field} {format_cad(cents)} isn't from a tool result or the user's words. "
            "Use a figure a tool returned (or call one that works it out)."
        )


def _draft(ws: Workspace, out: Outbox, intent: planner.Intent) -> dict[str, Any]:
    """Checks the draft the way the app will, and keeps it only if it's complete."""
    steps, _, question, _ = planner.build_steps(ws.plan, [intent])
    if question or not steps:
        raise ToolError(question or "That can't be drafted")
    out.intents.append(intent)
    step = steps[0]
    return {"drafted": step.title, "details": step.lines, "needs_user_approval": True}


def draft_budget(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    name = str(args.get("category") or "").strip().casefold()
    category = next(
        (
            c
            for c in ws.dashboard.categories
            if c.kind == "spending" and name in (c.id.casefold(), c.name.casefold())
        ),
        None,
    )
    if category is None:
        names = ", ".join(c.name for c in ws.dashboard.categories if c.kind == "spending")
        raise ToolError(f"No spending category '{name}'. Known: {names}")
    cents = _cents(args.get("monthly_limit"), "monthly_limit")
    _known(ws, cents, "monthly_limit")
    spent = next(
        (c.spent_cents for c in ws.dashboard.category_spending if c.category_id == category.id), 0
    )
    budget = next((b for b in ws.dashboard.budgets if b.category_id == category.id), None)
    spent = budget.spent_cents if budget else spent
    if cents < spent:
        raise ToolError(
            f"Budgets are for this month, and {format_cad(spent)} is already spent in "
            f"{category.name}: a lower limit would be over at once."
        )
    return _draft(
        ws, out, planner.Intent(kind="budget", category_id=category.id, amount=_plain(cents))
    )


def draft_goal(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    name = str(args.get("name") or "").strip()
    if not name or len(name) > 40:
        raise ToolError("name must be a short goal name, 2 to 4 words")
    cents = _cents(args.get("target"), "target")
    # A target is something to save toward, not money moving: a researched price may set it.
    _known(ws, cents, "target", web=True)
    when = _date(args.get("target_date"), "target_date")
    if when and when <= ws.today:
        raise ToolError("target_date must be in the future")
    return _draft(
        ws,
        out,
        planner.Intent(kind="goal_new", goal_name=name, amount=_plain(cents), target_date=when),
    )


def draft_goal_contribution(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    goal = ws.coach.find_goal(str(args.get("goal_id") or ""))
    if goal is None:
        raise ToolError("Unknown goal_id; call goals_status for the ids")
    cents = _cents(args.get("amount"), "amount")
    _known(ws, cents, "amount")
    return _draft(ws, out, planner.Intent(kind="goal_add", goal_id=goal.id, amount=_plain(cents)))


def draft_transfer(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    own = {a.id: a for a in ws.dashboard.accounts if a.account_type != "person"}
    source, target = str(args.get("from_account_id")), str(args.get("to_account_id"))
    if source not in own or target not in own or source == target:
        raise ToolError("Use two different account ids from money_overview")
    cents = _cents(args.get("amount"), "amount")
    _known(ws, cents, "amount")
    if own[source].account_type != "credit" and cents > own[source].balance_cents:
        raise ToolError(f"{own[source].name} doesn't have {format_cad(cents)}")
    return _draft(
        ws,
        out,
        planner.Intent(
            kind="transfer", account_id=source, to_account_id=target, amount=_plain(cents)
        ),
    )


# ------------------------------------------------------------------ auto tools (no money moves)


def set_reminder(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    title = str(args.get("title") or "").strip()[:120]
    if not title:
        raise ToolError("title is required")
    when = _date(args.get("due_on"), "due_on")
    if when is None or not ws.today <= when <= ws.today + timedelta(days=MAX_REMINDER_DAYS):
        raise ToolError("due_on must be a date from today to about a year ahead")
    detail = str(args.get("detail") or "").strip()[:300]
    out.auto.append(AutoTask(kind="reminder", title=title, detail=detail, due_on=when))
    return {"reminder_set_for": when.isoformat(), "done_automatically": True}


def assign_lesson(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    lesson_id = str(args.get("lesson_id") or "")
    lesson = next((x for t in ws.learn.topics for x in t.lessons if x.id == lesson_id), None)
    if lesson is None:
        raise ToolError("Unknown lesson_id; call find_lessons or learning_progress")
    why = str(args.get("why") or "").strip()[:200]
    out.auto.append(
        AutoTask(kind="lesson", title=lesson.title, detail=why or lesson.summary, ref=lesson.id)
    )
    return {"assigned": lesson.title, "done_automatically": True}


GUIDES = {
    "budgeting": "Budgeting basics",
    "emergency-fund": "Emergency funds",
    "credit-cards": "Credit cards",
    "credit-score": "Credit scores",
    "student-loans": "Student loans and grants",
    "filing": "Filing your taxes",
    "benefits": "Benefits you might be missing",
    "tfsa": "TFSA",
    "fhsa": "FHSA",
    "resp": "RESP and the Canada Learning Bond",
    "scams": "Spotting scams",
    "chequing-savings": "Chequing and savings accounts",
}


def recommend_guide(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    guide_id = str(args.get("guide_id") or "")
    if guide_id not in GUIDES:
        raise ToolError(f"guide_id must be one of: {', '.join(GUIDES)}")
    why = str(args.get("why") or "").strip()[:200]
    out.auto.append(AutoTask(kind="guide", title=GUIDES[guide_id], detail=why, ref=guide_id))
    return {"recommended": GUIDES[guide_id], "done_automatically": True}


def _runtime_only(ws: Workspace, out: Outbox, args: dict[str, Any]) -> dict[str, Any]:
    raise ToolError("This tool is run by the agent runtime")


# ------------------------------------------------------------------ registry

TOOLS: dict[str, Tool] = {
    tool.name: tool
    for tool in (
        Tool(
            "money_overview",
            "read",
            "Balances, Safe to spend, bills before payday, typical surplus, card, paydays, ids.",
            {},
            money_overview,
        ),
        Tool(
            "spending_by_category",
            "read",
            "This month's spending per category with its budget and 3-month average.",
            {},
            spending_by_category,
        ),
        Tool(
            "subscriptions_and_bills",
            "read",
            "Every recurring bill and subscription with its yearly cost and next due date.",
            {},
            subscriptions_and_bills,
        ),
        Tool(
            "cash_forecast",
            "read",
            "Walks chequing day by day through bills and paydays; finds the low point and gaps.",
            {"days": {"type": "integer", "description": "How far ahead, 1 to 60"}},
            cash_forecast,
        ),
        Tool(
            "goals_status",
            "read",
            "Savings goals with ids, progress, and the monthly amount each needs.",
            {},
            goals_status,
        ),
        Tool(
            "project_goal",
            "read",
            "When a goal is reached at a monthly contribution.",
            {"goal_id": _text("Goal id"), "monthly_contribution": _text("CAD amount")},
            _coach("project_goal"),
        ),
        Tool(
            "simulate_spending_cut",
            "read",
            "What cutting a category by a monthly amount frees up, optionally toward a goal.",
            {
                "category": _text("Category name"),
                "monthly_cut": _text("CAD amount"),
                "goal_id": _optional("Goal id or null"),
            },
            _coach("simulate_spending_cut"),
        ),
        Tool(
            "check_affordability",
            "read",
            "Whether a purchase fits now after bills and budget.",
            {"item": _text("What it is"), "price": _text("CAD amount")},
            _coach("check_affordability"),
        ),
        Tool(
            "plan_savings",
            "read",
            "Monthly saving to reach a price in a number of months, and what's left of the "
            "typical surplus after it.",
            {
                "item": _text("What it is"),
                "price": _text("CAD amount"),
                "months": {"type": "integer", "description": "1 to 36"},
                "goal_id": _optional("A goal already saving for it, or null"),
            },
            _coach("plan_savings"),
        ),
        Tool(
            "credit_card_payment",
            "read",
            "Card balance and utilization after a payment.",
            {"payment": _text("CAD amount")},
            _coach("credit_card_payment"),
        ),
        Tool(
            "move_cost_estimate",
            "read",
            "A starting target for a move: first and last month's rent. Pass monthly_rent when "
            "the user said it or web research found it; otherwise today's rent is used.",
            {"monthly_rent": _optional("CAD amount the new place's rent, or null")},
            move_cost_estimate,
        ),
        Tool(
            "who_owes_me",
            "read",
            "Friends who owe the user money, or whom the user owes.",
            {},
            who_owes_me,
        ),
        Tool(
            "benefits_screen",
            "read",
            "Screens for Canadian benefits and credits, with official links.",
            {},
            benefits_screen,
        ),
        Tool(
            "learning_progress",
            "read",
            "Lessons passed per topic and the next lesson in each.",
            {},
            learning_progress,
        ),
        Tool(
            "find_lessons",
            "read",
            "Lessons for a topic (budgeting, saving, tax, credit, rules, investing) or keywords.",
            {"query": _text("Topic or keywords")},
            find_lessons,
        ),
        Tool(
            "draft_budget",
            "draft",
            "Draft this month's budget for a category. Amount from a tool result or the user.",
            {"category": _text("Category name"), "monthly_limit": _text("CAD amount")},
            draft_budget,
        ),
        Tool(
            "draft_goal",
            "draft",
            "Draft a new savings goal, short name (2-4 words). Target from a tool or the user.",
            {
                "name": _text("Goal name"),
                "target": _text("CAD amount"),
                "target_date": _optional("YYYY-MM-DD or null"),
            },
            draft_goal,
        ),
        Tool(
            "draft_goal_contribution",
            "draft",
            "Draft moving money into a goal. The amount must come from a tool result.",
            {"goal_id": _text("Goal id"), "amount": _text("CAD amount")},
            draft_goal_contribution,
        ),
        Tool(
            "draft_transfer",
            "draft",
            "Draft a transfer between accounts or a card payment. Amount from a tool result.",
            {
                "from_account_id": _text("Account id"),
                "to_account_id": _text("Account id"),
                "amount": _text("CAD amount"),
            },
            draft_transfer,
        ),
        Tool(
            "set_reminder",
            "auto",
            "Set a reminder on the user's device (done automatically).",
            {
                "title": _text("Short title"),
                "detail": _text("One sentence"),
                "due_on": _text("YYYY-MM-DD"),
            },
            set_reminder,
        ),
        Tool(
            "ask_user",
            "ask",
            "Ask the user ONE short question, only when the answer changes your plan and no tool "
            "can tell you (their expected rent, their co-op pay). The mission waits for the "
            "answer; if none comes, you carry on with your assumption.",
            {
                "question": _text("Under 15 words"),
                "why": _text("Why you need it, under 15 words"),
                "choices": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "2 to 4 short answers to tap",
                },
                "assumption": _text("What you'll assume if there's no answer"),
            },
            _runtime_only,
        ),
        Tool(
            "web_research",
            "research",
            "Search the web for a current fact Penny's tools don't have (a city's typical rent, "
            "a program's deadline). Returns a short answer with sources. A few per mission.",
            {"question": _text("One specific question")},
            _runtime_only,
        ),
        Tool(
            "assign_lesson",
            "auto",
            "Add a lesson to the user's learning plan (done automatically).",
            {"lesson_id": _text("Lesson id"), "why": _text("One sentence")},
            assign_lesson,
        ),
        Tool(
            "recommend_guide",
            "auto",
            "Recommend a Money Guide article (done automatically).",
            {"guide_id": _text("Guide id"), "why": _text("One sentence")},
            recommend_guide,
        ),
    )
}


def run_tool(ws: Workspace, out: Outbox, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Runs one tool; input problems come back as {"error": ...} for the agent to fix."""
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": f"Unknown tool {name}"}
    try:
        return tool.run(ws, out, args)
    except (ToolError, TypeError, ValueError) as error:
        return {"error": str(error)}


def compact(result: dict[str, Any], limit: int = 600) -> str:
    """A short view of a tool result for the trace."""
    text = json.dumps(result, default=str, separators=(",", ":"))
    return text if len(text) <= limit else text[: limit - 1] + "…"
