"""First-run setup: whether the answers fit the income, and the proposed starter budget."""

from typing import Literal

from app.assist.common import AssistModel, AssistText, phrase
from app.coach.facts import FactBook
from app.config import Settings
from app.dashboard_models import OnboardingAnswers
from app.domain.starter_budget import StarterPlan
from app.store import DashboardStore

# Per try (the client retries once), so the plan shows in under 20 seconds at worst.
PLAN_SUMMARY_TIMEOUT_SECONDS = 8.0


class StarterPlanLine(AssistModel):
    category_id: str
    category_name: str
    fixed_cents: int  # locked: scheduled bills in this category
    flexible_cents: int  # everyday spending, which the user can change
    requested_cents: int
    limit_cents: int


class StarterPlanOut(AssistModel):
    income_cents: int
    fixed_cents: int
    savings_cents: int
    flexible_cents: int
    buffer_cents: int
    over_income_cents: int
    status: Literal["fits", "over", "short"]
    lines: list[StarterPlanLine]
    guide_needs_cents: int
    guide_wants_cents: int
    guide_savings_cents: int
    summary: AssistText


class StarterCheck(AssistModel):
    """Whether the setup answers fit the income, with the 50/30/20 guide. No AI involved."""

    income_cents: int
    fixed_cents: int
    flexible_cents: int
    savings_cents: int
    planned_cents: int  # fixed bills + savings + everyday
    buffer_cents: int  # income not assigned to anything
    over_income_cents: int
    status: Literal["fits", "over", "short"]
    guide_needs_cents: int
    guide_wants_cents: int
    guide_savings_cents: int


def starter_check(store: DashboardStore, user_id: str, answers: OnboardingAnswers) -> StarterCheck:
    plan = store.starter_plan_for(user_id, answers)
    return StarterCheck(
        income_cents=plan.income_cents,
        fixed_cents=plan.fixed_cents,
        flexible_cents=plan.flexible_cents,
        savings_cents=plan.savings_cents,
        planned_cents=plan.fixed_cents + plan.savings_cents + plan.flexible_cents,
        buffer_cents=plan.buffer_cents,
        over_income_cents=plan.over_income_cents,
        status=plan.status,
        guide_needs_cents=plan.guide_needs_cents,
        guide_wants_cents=plan.guide_wants_cents,
        guide_savings_cents=plan.guide_savings_cents,
    )


async def onboarding_plan(
    settings: Settings, store: DashboardStore, user_id: str, answers: OnboardingAnswers
) -> StarterPlanOut:
    """A proposed starting budget. The numbers come from app.domain.starter_budget; the model
    only words the summary, and every figure in it must match them."""
    plan = store.starter_plan_for(user_id, answers)
    names = {c.id: c.name for c in store.snapshot().categories}
    f = FactBook()
    income = f.money("Monthly money in", plan.income_cents, "onboarding")
    fixed = f.money("Fixed costs", plan.fixed_cents, "onboarding")
    savings = f.money("Savings", plan.savings_cents, "onboarding")
    everyday = f.money("Everyday spending", plan.flexible_cents, "onboarding")
    buffer = f.money("Unassigned buffer", plan.buffer_cents, "onboarding")
    over = f.money("Over income by", plan.over_income_cents, "onboarding")
    needs = f.money("50/30/20 needs", plan.guide_needs_cents, "onboarding")
    wants = f.money("50/30/20 wants", plan.guide_wants_cents, "onboarding")
    saved = f.money("50/30/20 savings", plan.guide_savings_cents, "onboarding")
    if not (plan.income_cents or plan.fixed_cents or plan.flexible_cents):
        # Every step was skipped: there's nothing to explain, so don't wait on the model.
        empty = AssistText(
            items=[
                "You skipped the setup questions, so this plan starts empty. Add your pay, bills, "
                "and budgets any time and Penny will fill it in."
            ],
            source="built_in",
            model=None,
        )
        return _plan_out(plan, names, empty)
    if plan.status == "short":
        fallback = [
            f"Your fixed costs ({fixed}) are more than the {income} coming in each month. You "
            "can keep this plan, but look at your bills or add income when you can."
        ]
    elif plan.status == "over":
        fallback = [
            f"This plan is {over} more than the {income} coming in. The 50/30/20 rule suggests "
            f"about {needs} for needs, {wants} for wants, and {saved} for savings."
        ]
    else:
        fallback = [
            f"{fixed} covers your fixed costs, {savings} goes to savings, and {everyday} is for "
            f"everyday spending, leaving a {buffer} buffer."
        ]
    summary = await phrase(
        settings,
        f,
        "Write one or two friendly sentences (max 45 words) explaining this starter budget to "
        "a student: what's fixed, what's saved, what's left for everyday spending. Educational "
        "only, no investment, tax, or credit advice.",
        f"PLAN: income {income}, fixed {fixed}, savings {savings}, everyday {everyday}, "
        f"buffer {buffer}, over income by {over}, status {plan.status}, 50/30/20 guide: "
        f"needs {needs}, wants {wants}, savings {saved}. If status is over or short, say so "
        "kindly and mention the 50/30/20 guide; never tell them they can't keep it.",
        fallback,
        1,
        max_chars=320,
        # Setup waits on this; a slow model shouldn't hold up the plan.
        timeout_seconds=PLAN_SUMMARY_TIMEOUT_SECONDS,
    )
    return _plan_out(plan, names, summary)


def _plan_out(plan: StarterPlan, names: dict[str, str], summary: AssistText) -> StarterPlanOut:
    return StarterPlanOut(
        income_cents=plan.income_cents,
        fixed_cents=plan.fixed_cents,
        savings_cents=plan.savings_cents,
        flexible_cents=plan.flexible_cents,
        buffer_cents=plan.buffer_cents,
        over_income_cents=plan.over_income_cents,
        status=plan.status,
        guide_needs_cents=plan.guide_needs_cents,
        guide_wants_cents=plan.guide_wants_cents,
        guide_savings_cents=plan.guide_savings_cents,
        lines=[
            StarterPlanLine(
                category_id=line.category_id,
                category_name=names.get(line.category_id, line.category_id),
                fixed_cents=line.fixed_cents,
                flexible_cents=line.flexible_cents,
                requested_cents=line.requested_cents,
                limit_cents=line.limit_cents,
            )
            for line in plan.lines
        ],
        summary=summary,
    )
