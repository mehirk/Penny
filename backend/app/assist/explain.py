"""Short explanations shown around the app, grounded in the user's own numbers: a take on the
period's spending, a goal plan, a read on balances, why Safe to spend is what it is, and how a
lesson applies to them."""

from app.assist.common import AssistText, phrase
from app.coach.context import build_snapshot, load_context
from app.coach.facts import FactBook
from app.config import Settings
from app.dashboard_models import DashboardResponse
from app.domain.finance import ceil_div
from app.learning.content import LESSONS_BY_ID
from app.store import DashboardStore

_take_cache: dict[tuple[object, ...], AssistText] = {}


async def spending_take(settings: Settings, dashboard: DashboardResponse) -> AssistText:
    """Three short points about the period on screen: what stands out, a comparison, a tip."""
    period, totals = dashboard.period, dashboard.totals
    key = (
        period.start,
        period.end,
        len(dashboard.transactions),
        totals.spending_cents,
        totals.total_budget_cents,
        settings.openai_model,
    )
    if key in _take_cache:
        return _take_cache[key]
    f = FactBook()
    spent = f.money("Spent", totals.spending_cents, "transactions")
    facts: dict[str, object] = {"period": period.phrase, "spent": spent}
    fallback: list[str] = []
    change = dashboard.home.spending_change_basis_points
    compared = "last month so far" if period.phrase == "this month" else "the period before"
    if change is not None:
        facts["change_vs_before"] = f.percent("Change in spending", abs(change), "history")
        facts["direction"] = "less" if change <= 0 else "more"
        fallback.append(
            f"You spent {spent} {period.phrase}, {facts['change_vs_before']} "
            f"{facts['direction']} than {compared}."
        )
    else:
        fallback.append(f"You spent {spent} {period.phrase}.")
    top = dashboard.category_spending[:3]
    facts["top_categories"] = [
        {
            "name": c.category_name,
            "spent": f.money(c.category_name, c.spent_cents, "transactions"),
            "share": f.percent(f"{c.category_name} share", c.share_basis_points, "transactions"),
        }
        for c in top
    ]
    if top:
        first = facts["top_categories"][0]  # type: ignore[index]
        fallback.append(
            f"{first['name']} was your biggest category at {first['spent']} "
            f"({first['share']} of spending)."
        )
    spending = [t for t in dashboard.transactions if t.kind == "spending" and not t.bill_id]
    if spending:
        biggest = max(spending, key=lambda t: t.amount_cents)
        facts["biggest_flexible_purchase"] = {
            "description": biggest.description,
            "amount": f.money(biggest.description, biggest.amount_cents, "transactions"),
            "date": biggest.occurred_on.isoformat(),
        }
    wants = dashboard.spending_classification
    facts["nice_to_haves"] = f.money("Wants", wants.wants_cents, "transactions")
    left = totals.budget_remaining_cents
    if totals.total_budget_cents:
        if left < 0:
            facts["over_budget_by"] = f.money("Over budget", -left, "budgets")
            fallback.append(
                f"You’re {facts['over_budget_by']} over budget; trimming "
                f"nice-to-haves ({facts['nice_to_haves']}) is the quickest fix."
            )
        else:
            facts["budget_left"] = f.money("Budget left", left, "budgets")
            fallback.append(f"You have {facts['budget_left']} of your budget left {period.phrase}.")
    result = await phrase(
        settings,
        f,
        "Write exactly 3 bullets of at most 25 words: what stands out, one comparison, and one "
        "specific, doable action for the coming week.",
        f"FACTS: {facts}",
        fallback,
        3,
    )
    if len(_take_cache) > 200:
        _take_cache.clear()
    _take_cache[key] = result
    return result


LESSON_MAX_CHARS = 420
_TRACK_FOCUS = {
    "budgeting": "this month's spending against the budget and the biggest categories",
    "saving": "savings goals, the emergency fund, and the typical monthly surplus",
    "tax": "where their income comes from (job pay and scholarships); no tax amounts or advice",
    "credit": "the credit card balance, limit, and utilization",
    "investing": "the typical monthly surplus and whether short-term goals come first",
    "rules": "their accounts and balances; explain the protection or rule, no legal advice",
}


async def lesson_example(
    settings: Settings, store: DashboardStore, user_id: str, lesson_id: str
) -> AssistText | None:
    """Two or three sentences connecting a lesson to the user's own numbers (None if unknown)."""
    lesson = LESSONS_BY_ID.get(lesson_id)
    if not lesson:
        return None
    track, title = lesson.topic, lesson.title
    ctx = load_context(store, user_id)
    snapshot = build_snapshot(ctx)
    d, f = ctx.dashboard, ctx.facts
    surplus = f.money(
        "Typical monthly surplus (3-month average)", ctx.typical_surplus_cents, "history"
    )
    utilization = (
        f.percent("Credit utilization", d.credit.utilization_basis_points, "accounts")
        if d.credit
        else None
    )
    fallbacks = {
        "budgeting": f"{f.money('Spending this month', d.totals.spending_cents, 'transactions')} "
        f"spent of your {f.money('Total monthly budget', d.totals.total_budget_cents, 'budgets')} "
        "budget this month. Giving every dollar a job is what keeps that gap healthy.",
        "saving": " ".join(
            f"Your {g.name} has {f.money(f'{g.name} saved', g.current_cents, 'goals')} of "
            f"{f.money(f'{g.name} target', g.target_cents, 'goals')}."
            for g in d.savings_goals[:2]
        )
        or "Start with a small first goal, like an emergency cushion.",
        "tax": "Your job pay shows up on a W-2 each year, and freelance pay on a 1099. Knowing "
        "which you get tells you whether tax was already withheld."
        if lesson.country == "US"
        else "Your job pay shows up on a T4 slip each year, and scholarships and tuition have "
        "their own slips. Filing even with a small income can unlock benefits.",
        "rules": "Every account in Penny is fictional, but the same rules apply to real ones: "
        "know your deposit insurance limit, and never share a PIN or passcode.",
        "credit": (
            f"Your card is at {utilization} of its limit, under the 30% many guides mention."
            if d.credit and d.credit.utilization_basis_points <= 3000
            else "Paying your card in full each month avoids interest entirely."
        ),
        "investing": f"Your typical surplus is {surplus} a month. Goals due soon usually "
        "come before investing.",
    }
    focus = _TRACK_FOCUS.get(track, "their overall month")
    return await phrase(
        settings,
        f,
        f"In 2 or 3 short sentences (one bullet), show how the lesson applies to this person, "
        f"using {focus}. Educational only.",
        f"LESSON: {title}\nSNAPSHOT: {snapshot}",
        [fallbacks.get(track, fallbacks["budgeting"])],
        1,
        max_chars=LESSON_MAX_CHARS,
    )


async def goal_plan(
    settings: Settings, store: DashboardStore, user_id: str, goal_id: str
) -> AssistText | None:
    """How to reach one goal, from its numbers and the user's typical surplus (None if unknown)."""
    ctx = load_context(store, user_id)
    goal = next((g for g in ctx.dashboard.savings_goals if g.id == goal_id), None)
    if goal is None:
        return None
    f = FactBook()
    remaining_cents = max(0, goal.target_cents - goal.current_cents)
    remaining = f.money(f"{goal.name} still needed", remaining_cents, "goals")
    surplus_cents = ctx.typical_surplus_cents
    surplus = f.money("Typical monthly surplus (3-month average)", surplus_cents, "history")
    facts: dict[str, object] = {
        "goal": goal.name,
        "saved": f.money(f"{goal.name} saved", goal.current_cents, "goals"),
        "target": f.money(f"{goal.name} target", goal.target_cents, "goals"),
        "still_needed": remaining,
        "typical_monthly_surplus": surplus,
        "added_this_month": f.money("Added this month", goal.contributed_this_month_cents, "goals"),
    }
    fallback: list[str] = []
    if remaining_cents == 0:
        fallback.append(f"{goal.name} is fully funded. You can mark it reached.")
    elif goal.monthly_needed_cents:
        need = f.money(f"{goal.name} monthly need", goal.monthly_needed_cents, "goals")
        facts["needed_per_month"] = need
        facts["target_date"] = goal.target_date.isoformat() if goal.target_date else None
        fallback.append(f"Put aside {need} a month to have {remaining} more by the target date.")
        if surplus_cents > 0:
            share = goal.monthly_needed_cents * 10_000 // surplus_cents
            facts["share_of_surplus"] = f.percent("Share of surplus", share, "history")
            fallback.append(
                f"That’s {facts['share_of_surplus']} of what you typically have left each month "
                f"({surplus})."
                if share <= 10_000
                else f"That’s more than you typically have left ({surplus}); a later date or a "
                "smaller target would make it realistic."
            )
    active = [
        g for g in ctx.dashboard.savings_goals if g.status == "active" and g.monthly_needed_cents
    ]
    all_goals_cents = sum(g.monthly_needed_cents or 0 for g in active)
    if len(active) > 1 and surplus_cents > 0 and all_goals_cents > surplus_cents:
        facts["all_goals_need_per_month"] = f.money("All goals monthly", all_goals_cents, "goals")
        fallback.append(
            f"Together your goals need {facts['all_goals_need_per_month']} a month, more than "
            f"your typical {surplus}; decide which one comes first."
        )
    if remaining_cents and surplus_cents > 0:
        months = ceil_div(remaining_cents, surplus_cents)
        facts["months_if_all_surplus_goes_here"] = months
        fallback.append(
            f"Putting your whole typical surplus toward it would get you there in about "
            f"{months} month{'s' if months != 1 else ''}."
        )
    if not fallback:
        fallback.append("Set a target date and Penny will show what it takes each month.")
    return await phrase(
        settings,
        f,
        "Write 2 or 3 bullets (at most 25 words each) on how this person can reach this "
        "savings goal: whether it's on track, one realistic monthly step, and one trade-off. "
        "Educational, not financial advice.",
        f"FACTS: {facts}",
        fallback,
        3,
    )


async def accounts_read(settings: Settings, store: DashboardStore, user_id: str) -> AssistText:
    """A short read on balances: what stands out and what to watch before payday."""
    ctx = load_context(store, user_id)
    d = ctx.dashboard
    o = d.accounts_overview
    f = FactBook()
    facts: dict[str, object] = {
        "net_worth": f.money("Net worth", o.net_worth_cents, "accounts"),
        "spending_money": f.money("Spending money", o.spending_cents, "accounts"),
        "savings": f.money("Savings", o.savings_cents, "accounts"),
        "set_aside_for_goals": f.money("Goal money", o.goal_cents, "goals"),
        "owed_on_cards": f.money("Owed on cards", o.owed_cents, "accounts"),
        "unpaid_bills": f.money("Unpaid bills", d.recurring.unpaid_bills_cents, "bills"),
    }
    after_bills = o.spending_cents - d.recurring.unpaid_bills_cents
    facts["spending_money_after_those_bills"] = f.money("After bills", after_bills, "accounts")
    fallback = [
        f"Your total balance is {facts['net_worth']}: {facts['spending_money']} to spend, "
        f"{facts['savings']} in savings, minus {facts['owed_on_cards']} owed on cards.",
        f"Bills not yet paid come to {facts['unpaid_bills']}, leaving "
        f"{facts['spending_money_after_those_bills']} of spending money after them.",
    ]
    if d.credit:
        facts["card_utilization"] = f.percent(
            "Credit utilization", d.credit.utilization_basis_points, "accounts"
        )
        fallback.append(
            f"Your card is at {facts['card_utilization']} of its limit; paying it in full by "
            "the due date avoids interest."
        )
    return await phrase(
        settings,
        f,
        "Write exactly 3 bullets (at most 25 words each) about this person's balances: the "
        "overall picture, what to watch before payday, and one practical step.",
        f"FACTS: {facts}",
        fallback,
        3,
    )


# ------------------------------------------------------------------ safe to spend


async def safe_to_spend_read(settings: Settings, store: DashboardStore, user_id: str) -> AssistText:
    """Why Safe to spend is what it is, what's coming, and one practical step."""
    d = store.dashboard_for_user(user_id)
    safe = d.safe_to_spend
    if safe is None or not safe.has_budget:
        return AssistText(
            items=["Set a monthly budget and Safe to spend will show what's left of it."],
            source="built_in",
            model=None,
        )
    f = FactBook()
    facts: dict[str, object] = {
        "safe_to_spend": f.money("Safe to spend", safe.safe_cents, "safe_to_spend"),
        "monthly_budget": f.money("Monthly budget", safe.budget_cents, "budgets"),
        "spent_this_month": f.money("Spent this month", safe.spent_cents, "transactions"),
    }
    # The budget is recurring bills (fixed) plus the category budgets (variable).
    if safe.fixed_cents:
        facts["fixed_bills_in_budget"] = f.money("Recurring bills", safe.fixed_cents, "bills")
        facts["category_budgets"] = f.money("Category budgets", safe.variable_cents, "budgets")
    if safe.unpaid_bills_cents:
        facts["unpaid_bills_this_month"] = f.money("Unpaid bills", safe.unpaid_bills_cents, "bills")
    bills = [
        f"{item.name} {f.money(item.name, item.amount_cents, 'bills')} "
        + (
            f"overdue since {item.due_on:%b} {item.due_on.day}"
            if item.days_until_due < 0
            else f"due {item.due_on:%b} {item.due_on.day}"
        )
        for item in d.recurring.unpaid[:5]
    ]
    facts["unpaid_bill_list"] = bills
    runway = d.spending_runway
    if runway and safe.safe_cents > 0:
        facts["per_day"] = f.money("Per day", runway.per_day_cents, "safe_to_spend")
        facts["days_left_in_month"] = runway.days_left
    if safe.over_cents:
        facts["over_budget_by"] = f.money("Over budget by", safe.over_cents, "safe_to_spend")
    over = [b for b in d.budgets if not b.carried_over and b.remaining_cents < 0]
    if over:
        facts["categories_over"] = [
            f"{b.category_name} over by "
            + f.money(b.category_name + " over", -b.remaining_cents, "budgets")
            for b in over[:3]
        ]

    fallback = [
        f"Your {facts['monthly_budget']} budget, minus {facts['spent_this_month']} spent"
        + (
            f" and {facts['unpaid_bills_this_month']} in bills still due this month"
            if safe.unpaid_bills_cents
            else ""
        )
        + f", leaves {facts['safe_to_spend']}."
    ]
    if safe.over_cents:
        fallback.append(
            f"You're {facts['over_budget_by']} over budget. Pausing extras until next month, "
            "or moving room from another budget, gets you back on track."
        )
    elif bills:
        fallback.append(f"Next up: {bills[0]}. It's already set aside.")
    if runway and safe.safe_cents > 0:
        fallback.append(
            f"That's about {facts['per_day']} a day for {runway.days_left} "
            f"day{'' if runway.days_left == 1 else 's'}."
        )
    return await phrase(
        settings,
        f,
        "Explain this person's Safe to spend in exactly 3 bullets (at most 28 words each): "
        "1) what it is (monthly budget minus spent, minus bills still due this month if any), "
        "2) the bill "
        "to watch with its date, or how far over budget they are and which category, 3) one "
        "practical step for the rest of the month. Use only the facts given.",
        f"FACTS: {facts}",
        fallback,
        3,
    )
