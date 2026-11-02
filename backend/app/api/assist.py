"""Smart helpers and first-run setup. They only read data or fill in forms: nothing here saves
anything except `/onboarding/apply`, which is the user's approval of their plan."""

from fastapi import APIRouter, HTTPException, status

from app.api.deps import (
    AuthenticatedUser,
    PeriodEnd,
    PeriodStart,
    ViewMonth,
    dashboard_for,
    user_store,
)
from app.assist import budgets, explain, onboarding, quick_add, search
from app.assist.common import AssistText
from app.assist.statements import StatementDraft, StatementUpload, read_statement
from app.config import get_settings
from app.dashboard_models import DashboardResponse, OnboardingAnswers, OnboardingApply

router = APIRouter(prefix="/api/v1")


@router.post(
    "/assist/parse-transactions", response_model=quick_add.ParsedTransactions, tags=["assist"]
)
async def parse_transactions(
    request: quick_add.QuickAddManyRequest, current_user: AuthenticatedUser
) -> quick_add.ParsedTransactions:
    """Turn a note with several entries (one per line, or separated by ; or commas) into
    transaction drafts. Nothing is saved; the user reviews and adds them."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    categories = store.dashboard_for_user(current_user.id).categories
    return await quick_add.parse_transactions(
        get_settings(), request.text.strip(), store.today(), categories
    )


@router.post("/assist/search", response_model=search.SearchFilters, tags=["assist"])
async def search_transactions(
    request: search.SearchRequest, current_user: AuthenticatedUser
) -> search.SearchFilters:
    """Read a plain-language search ("coffee over $5 last month") into list filters."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    categories = store.dashboard_for_user(current_user.id).categories
    return await search.search_transactions(
        get_settings(), request.text.strip(), store.today(), categories
    )


@router.post("/assist/read-statement", response_model=StatementDraft, tags=["assist"])
async def read_statement_upload(
    upload: StatementUpload, current_user: AuthenticatedUser
) -> StatementDraft:
    """Read a PDF, Excel, or CSV statement into rows to review. Nothing is saved."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    dashboard = store.dashboard_for_user(current_user.id)
    return await read_statement(
        get_settings(), upload, store.today(), dashboard.categories, dashboard.accounts
    )


@router.get("/assist/spending-take", response_model=AssistText, tags=["assist"])
async def spending_take(
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
    start: PeriodStart = None,
    end: PeriodEnd = None,
) -> AssistText:
    """Three short points about the period on screen, grounded in its totals."""
    return await explain.spending_take(
        get_settings(), dashboard_for(current_user, month, start, end)
    )


@router.get("/assist/goal-plan/{goal_id}", response_model=AssistText, tags=["assist"])
async def goal_plan(goal_id: str, current_user: AuthenticatedUser) -> AssistText:
    """A short plan for one goal, grounded in its numbers and the typical monthly surplus."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    result = await explain.goal_plan(get_settings(), store, current_user.id, goal_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Savings goal not found")
    return result


@router.get("/assist/accounts-read", response_model=AssistText, tags=["assist"])
async def accounts_read(current_user: AuthenticatedUser) -> AssistText:
    """Penny's read on balances: the picture, what to watch before payday, one step."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    return await explain.accounts_read(get_settings(), store, current_user.id)


@router.get("/assist/safe-to-spend", response_model=AssistText, tags=["assist"])
async def safe_to_spend_read(current_user: AuthenticatedUser) -> AssistText:
    """Why Safe to spend is what it is. The figures come from the dashboard's own sum."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    return await explain.safe_to_spend_read(get_settings(), store, current_user.id)


@router.get("/assist/lesson-example/{lesson_id}", response_model=AssistText, tags=["assist"])
async def lesson_example(lesson_id: str, current_user: AuthenticatedUser) -> AssistText:
    """Connect a lesson to the user's own fictional numbers."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    result = await explain.lesson_example(get_settings(), store, current_user.id, lesson_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lesson not found")
    return result


@router.get("/assist/budget-suggestions", response_model=budgets.BudgetSuggestions, tags=["assist"])
async def budget_suggestions(current_user: AuthenticatedUser) -> budgets.BudgetSuggestions:
    """Suggested limits from recent spending. Applying any of them is a separate user action."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    return await budgets.budget_suggestions(get_settings(), store, current_user.id)


@router.get("/assist/budget-rebalance", response_model=budgets.BudgetRebalance, tags=["assist"])
async def budget_rebalance(current_user: AuthenticatedUser) -> budgets.BudgetRebalance:
    """Ways to cover overspent budgets from ones with room. Applying is a separate approval."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    return await budgets.budget_rebalance(get_settings(), store, current_user.id)


@router.post("/onboarding/plan", response_model=onboarding.StarterPlanOut, tags=["onboarding"])
async def onboarding_plan(
    answers: OnboardingAnswers, current_user: AuthenticatedUser
) -> onboarding.StarterPlanOut:
    """A proposed starting budget from the setup answers. Nothing is saved."""
    return await onboarding.onboarding_plan(
        get_settings(), user_store(current_user), current_user.id, answers
    )


@router.post("/onboarding/check", response_model=onboarding.StarterCheck, tags=["onboarding"])
def onboarding_check(
    answers: OnboardingAnswers, current_user: AuthenticatedUser
) -> onboarding.StarterCheck:
    """Does the budget so far fit the income? Used to warn, never to block. Nothing is saved."""
    return onboarding.starter_check(user_store(current_user), current_user.id, answers)


@router.post("/onboarding/apply", response_model=DashboardResponse, tags=["onboarding"])
def onboarding_apply(
    request: OnboardingApply, current_user: AuthenticatedUser
) -> DashboardResponse:
    """Saves the setup the user approved (accounts, pay, bills, and this month's budgets)."""
    return user_store(current_user).apply_onboarding(current_user.id, request)
