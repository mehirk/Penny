"""Recurring bills and subscriptions."""

from fastapi import APIRouter

from app.api.deps import AuthenticatedUser, ViewMonth, in_view, user_store
from app.dashboard_models import BillHistory, BillPatch, BillWrite, DashboardResponse

router = APIRouter(prefix="/api/v1/bills", tags=["bills"])


@router.post("", response_model=DashboardResponse)
def create_bill(
    request: BillWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).create_bill(current_user.id, request), current_user, month
    )


@router.patch("/{bill_id}", response_model=DashboardResponse)
def update_bill(
    bill_id: str, request: BillPatch, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).update_bill(current_user.id, bill_id, request),
        current_user,
        month,
    )


@router.delete("/{bill_id}", response_model=DashboardResponse)
def delete_bill(
    bill_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).delete_bill(current_user.id, bill_id), current_user, month
    )


@router.get("/{bill_id}/history", response_model=BillHistory)
def bill_history(bill_id: str, current_user: AuthenticatedUser) -> BillHistory:
    """Every recorded payment of a bill, newest first, with totals."""
    return user_store(current_user).bill_history(current_user.id, bill_id)


@router.post("/{bill_id}/mark-paid", response_model=DashboardResponse)
def mark_bill_paid(
    bill_id: str,
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
    account_id: str | None = None,
) -> DashboardResponse:
    """Record this payment as a transaction and move the bill to its next due date.
    `account_id` pays it from a different account this time."""
    return in_view(
        user_store(current_user).mark_bill_paid(current_user.id, bill_id, account_id),
        current_user,
        month,
    )
