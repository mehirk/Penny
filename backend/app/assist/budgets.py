"""Budget helpers: a suggested budget from everything known, and moves that cover overspending.
Applying any of them is a separate user action."""

from datetime import date
from typing import Literal

from app.assist.common import AssistModel, AssistText, phrase
from app.coach.facts import FactBook
from app.config import Settings
from app.domain.rebalance import BudgetLine, rebalance
from app.store import DashboardStore


class BudgetSuggestion(AssistModel):
    category_id: str
    budget_id: str | None  # the month's existing budget to update, or None to create one
    category_name: str
    current_limit_cents: int | None
    suggested_cents: int
    average_cents: int
    reason: str


class BudgetPlanOut(AssistModel):
    """The whole picture behind the suggestions (app.domain.smart_budget)."""

    income_cents: int
    # Where income came from: given in chat, every source of pay, recent months, or unknown.
    income_source: Literal["stated", "pay", "history", "none"]
    fixed_cents: int
    savings_cents: int
    everyday_cents: int
    planned_cents: int
    buffer_cents: int
    status: Literal["fits", "trimmed", "short", "no_income"]
    history_months: int


class BudgetSuggestions(AssistModel):
    month: date
    suggestions: list[BudgetSuggestion]
    summary: AssistText
    plan: BudgetPlanOut | None = None


def smart_suggestions(
    store: DashboardStore, user_id: str, f: FactBook, stated_income_cents: int | None = None
) -> tuple[list[BudgetSuggestion], BudgetPlanOut, list[str]]:
    """Category budgets from everything known: income (even before pay arrives), bills,
    savings and goals, and usual everyday spending (app.domain.smart_budget). Returns the
    suggestions that would change something, the plan, and a built-in summary."""
    plan, source = store.smart_budget_plan(user_id, stated_income_cents)
    dashboard = store.dashboard_for_user(user_id)
    _, months = store.everyday_averages(dashboard.current_month)
    names = {c.id: c.name for c in dashboard.categories}
    current = {b.category_id: b for b in dashboard.budgets if not b.carried_over}
    suggestions = []
    for line in plan.lines:
        name = names.get(line.category_id, "Other")
        usual = f.money(f"{name} usual", line.usual_cents, "history")
        f.money(f"Suggested {name} budget", line.suggested_cents, "budgets")
        budget = current.get(line.category_id)
        if budget and budget.limit_cents == line.suggested_cents:
            continue
        if line.basis == "typical":
            reason = f"A typical student amount ({usual}); no spending here yet."
        else:
            reason = f"You usually spend {usual} a month."
        if line.trimmed:
            reason += " Lowered to fit what comes in."
        if budget:
            reason += f" Now {f.money(f'{name} budget', budget.limit_cents, 'budgets')}."
        suggestions.append(
            BudgetSuggestion(
                category_id=line.category_id,
                category_name=name,
                budget_id=budget.id if budget else None,
                current_limit_cents=budget.limit_cents if budget else None,
                suggested_cents=line.suggested_cents,
                average_cents=line.usual_cents,
                reason=reason,
            )
        )
    out = BudgetPlanOut(
        income_cents=plan.income_cents,
        income_source=source,  # type: ignore[arg-type]
        fixed_cents=plan.fixed_cents,
        savings_cents=plan.savings_cents,
        everyday_cents=plan.everyday_cents,
        planned_cents=plan.planned_cents,
        buffer_cents=plan.buffer_cents,
        status=plan.status,
        history_months=months,
    )
    usual_words = "your usual spending" if months else "typical student spending"
    income = f.money("Monthly income", plan.income_cents, "pay")
    bills = f.money("Recurring bills", plan.fixed_cents, "bills")
    saving = f.money("Savings", plan.savings_cents, "goals")
    room = f.money("Everyday room", plan.everyday_cents, "budgets")
    f.money("Planned everyday", plan.planned_cents, "budgets")
    f.money("Buffer", plan.buffer_cents, "budgets")
    if plan.status == "no_income":
        summary = [
            "Penny doesn't know your income yet, so these match what you usually spend. Add "
            "your pay in Settings for a plan that fits."
        ]
    elif plan.status == "short":
        summary = [
            f"Your bills ({bills}) are more than the {income} coming in, so there's no room "
            "left for everyday spending. These show what you usually spend."
        ]
    elif plan.status == "trimmed":
        summary = [
            f"From {income} a month, after {bills} in bills and {saving} saved, {room} is left. "
            f"{usual_words.capitalize()} doesn't fit, so wants were trimmed first."
        ]
    else:
        summary = [
            f"From {income} a month, after {bills} in bills and {saving} saved, {room} is left "
            f"for everyday spending. {usual_words.capitalize()} fits."
        ]
    return suggestions, out, summary


async def budget_suggestions(
    settings: Settings, store: DashboardStore, user_id: str
) -> BudgetSuggestions:
    """A whole budget for this month, for the user to review and pick from."""
    f = FactBook()
    suggestions, plan, fallback = smart_suggestions(store, user_id, f)
    dashboard = store.dashboard_for_user(user_id)
    summary = await phrase(
        settings,
        f,
        "Write one or two sentences (max 45 words) explaining this budget plan: where the money "
        "goes (bills, savings, everyday) and whether usual spending fits. Mention at most one "
        "category by name. Educational, not financial advice.",
        f"PLAN: {plan.model_dump()} SUGGESTIONS: {[s.reason for s in suggestions]} "
        f"FACTS: {fallback}",
        fallback,
        1,
        max_chars=320,
    )
    return BudgetSuggestions(
        month=dashboard.active_month, suggestions=suggestions, summary=summary, plan=plan
    )


class BudgetChangeOut(AssistModel):
    budget_id: str
    category_id: str
    category_name: str
    from_cents: int
    to_cents: int
    spent_cents: int


class BudgetRebalance(AssistModel):
    month: date
    over_cents: int
    covered_cents: int
    uncovered_cents: int
    changes: list[BudgetChangeOut]
    summary: AssistText


async def budget_rebalance(
    settings: Settings, store: DashboardStore, user_id: str
) -> BudgetRebalance:
    """Moves that cover overspent budgets from ones with room (app.domain.rebalance), with a
    short explanation. Nothing changes until the user applies them."""
    d = store.dashboard_for_user(user_id)
    budgets = {b.category_id: b for b in d.budgets if not b.carried_over}
    plan = rebalance(
        [
            BudgetLine(
                category_id=b.category_id,
                limit_cents=b.limit_cents,
                spent_cents=b.spent_cents,
                # Category budgets hold no bills (those are the fixed budget), so no floor.
                floor_cents=0,
            )
            for b in budgets.values()
        ]
    )
    changes = [
        BudgetChangeOut(
            budget_id=budgets[c.category_id].id,
            category_id=c.category_id,
            category_name=budgets[c.category_id].category_name,
            from_cents=c.from_cents,
            to_cents=c.to_cents,
            spent_cents=budgets[c.category_id].spent_cents,
        )
        for c in plan.changes
    ]
    f = FactBook()
    raised = [c for c in changes if c.to_cents > c.from_cents]
    lowered = [c for c in changes if c.to_cents < c.from_cents]
    facts: dict[str, object] = {
        "raise": [
            f"{c.category_name} {f.money(c.category_name, c.from_cents, 'budgets')} → "
            f"{f.money(c.category_name + ' new', c.to_cents, 'budgets')} "
            f"(spent {f.money(c.category_name + ' spent', c.spent_cents, 'budgets')})"
            for c in raised
        ],
        "lower": [
            f"{c.category_name} {f.money(c.category_name, c.from_cents, 'budgets')} → "
            f"{f.money(c.category_name + ' new', c.to_cents, 'budgets')}"
            for c in lowered
        ],
        "moved": f.money("Moved", plan.covered_cents, "budgets"),
        "total_budget_unchanged": True,
    }
    if plan.uncovered_cents:
        facts["still_uncovered"] = f.money("Still uncovered", plan.uncovered_cents, "budgets")
    if not plan.over_cents:
        summary = AssistText(
            items=["Every budget is within its limit. Nothing to move."],
            source="built_in",
            model=None,
        )
    else:
        fallback = []
        if changes:
            fallback.append(
                f"Move {facts['moved']} from "
                + ", ".join(c.category_name for c in lowered)
                + " to "
                + ", ".join(c.category_name for c in raised)
                + " so your total budget stays the same."
            )
        if plan.uncovered_cents:
            fallback.append(
                f"{facts['still_uncovered']} can't be covered by other budgets; spending less for "
                "the rest of the month is the way to close it."
            )
        fallback.append("Nothing changes until you apply it.")
        summary = await phrase(
            settings,
            f,
            "In 2 or 3 short bullets (at most 25 words each), explain these budget moves: which "
            "budgets go over and which give up room, that the total budget doesn't grow, and if "
            "anything is still uncovered, one realistic way to spend less. No new numbers.",
            f"FACTS: {facts}",
            fallback,
            3,
        )
    return BudgetRebalance(
        month=d.active_month,
        over_cents=plan.over_cents,
        covered_cents=plan.covered_cents,
        uncovered_cents=plan.uncovered_cents,
        changes=changes,
        summary=summary,
    )
