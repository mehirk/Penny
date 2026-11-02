"""Monthly category budgets."""

from fastapi import APIRouter

from app.api.deps import AuthenticatedUser, ViewMonth, in_view, user_store
from app.dashboard_models import (
    BudgetChangesRequest,
    BudgetCopyRequest,
    BudgetPatch,
    BudgetWrite,
    DashboardResponse,
)

router = APIRouter(prefix="/api/v1/budgets", tags=["budgets"])


@router.post("", response_model=DashboardResponse)
def create_budget(
    request: BudgetWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).create_budget(current_user.id, request), current_user, month
    )


@router.patch("/{budget_id}", response_model=DashboardResponse)
def update_budget(
    budget_id: str, request: BudgetPatch, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).update_budget(current_user.id, budget_id, request),
        current_user,
        month,
    )


@router.delete("/{budget_id}", response_model=DashboardResponse)
def delete_budget(
    budget_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).delete_budget(current_user.id, budget_id), current_user, month
    )


@router.post("/changes", response_model=DashboardResponse)
def apply_budget_changes(
    request: BudgetChangesRequest, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    """Set several limits together once the user approves them (e.g. a suggested rebalance)."""
    return in_view(
        user_store(current_user).apply_budget_changes(current_user.id, request.changes),
        current_user,
        month,
    )


@router.post("/copy", response_model=DashboardResponse)
def copy_budgets(request: BudgetCopyRequest, current_user: AuthenticatedUser) -> DashboardResponse:
    """Copy category limits from one month into another, skipping categories already budgeted."""
    return user_store(current_user).copy_budgets(
        current_user.id, request.from_month, request.to_month
    )
