"""Accounts, transfers between them, sources of pay, and categories."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AuthenticatedUser, ViewMonth, in_view, user_store
from app.dashboard_models import (
    AccountPatch,
    AccountWrite,
    CategoryWrite,
    CreditUtilizationRequest,
    CreditUtilizationResponse,
    DashboardResponse,
    PaydayPlanView,
    PayReceivedWrite,
    PayScheduleWrite,
    TransferWrite,
)
from app.domain.finance import (
    COMMON_UTILIZATION_GUIDELINE_BASIS_POINTS,
    credit_utilization_basis_points,
)

router = APIRouter(prefix="/api/v1")


@router.post("/accounts", response_model=DashboardResponse, tags=["accounts"])
def create_account(request: AccountWrite, current_user: AuthenticatedUser) -> DashboardResponse:
    return user_store(current_user).create_account(current_user.id, request)


@router.patch("/accounts/{account_id}", response_model=DashboardResponse, tags=["accounts"])
def update_account(
    account_id: str, request: AccountPatch, current_user: AuthenticatedUser
) -> DashboardResponse:
    return user_store(current_user).update_account(current_user.id, account_id, request)


@router.delete("/accounts/{account_id}", response_model=DashboardResponse, tags=["accounts"])
def delete_account(account_id: str, current_user: AuthenticatedUser) -> DashboardResponse:
    return user_store(current_user).delete_account(current_user.id, account_id)


@router.post("/transfers", response_model=DashboardResponse, tags=["accounts"])
def add_transfer(
    request: TransferWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    """Record money moved between the user's own accounts, or a credit card payment. Penny
    never moves real money; this records what the user did in their bank."""
    return in_view(
        user_store(current_user).add_transfer(current_user.id, request), current_user, month
    )


@router.delete("/transfers/{transfer_id}", response_model=DashboardResponse, tags=["accounts"])
def delete_transfer(
    transfer_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).delete_transfer(current_user.id, transfer_id),
        current_user,
        month,
    )


@router.post(
    "/calculations/credit-utilization",
    response_model=CreditUtilizationResponse,
    tags=["calculations"],
)
def calculate_credit_utilization(request: CreditUtilizationRequest) -> CreditUtilizationResponse:
    """Educational what-if: utilization in integer basis points. Not a credit-score prediction."""
    basis_points = credit_utilization_basis_points(
        request.balance_cents, request.credit_limit_cents
    )
    return CreditUtilizationResponse(
        balance_cents=request.balance_cents,
        credit_limit_cents=request.credit_limit_cents,
        utilization_basis_points=basis_points,
        within_common_guideline=basis_points <= COMMON_UTILIZATION_GUIDELINE_BASIS_POINTS,
    )


@router.post("/pay-schedules", response_model=DashboardResponse, tags=["pay cycle"])
def add_pay_schedule(
    request: PayScheduleWrite, current_user: AuthenticatedUser
) -> DashboardResponse:
    """Add a source of pay (a job, a scholarship, an allowance); people can have several."""
    return user_store(current_user).add_pay_schedule(current_user.id, request)


@router.put("/pay-schedules/{pay_id}", response_model=DashboardResponse, tags=["pay cycle"])
def update_pay_schedule(
    pay_id: str, request: PayScheduleWrite, current_user: AuthenticatedUser
) -> DashboardResponse:
    return user_store(current_user).update_pay_schedule(current_user.id, pay_id, request)


@router.delete("/pay-schedules/{pay_id}", response_model=DashboardResponse, tags=["pay cycle"])
def delete_pay_schedule(pay_id: str, current_user: AuthenticatedUser) -> DashboardResponse:
    return user_store(current_user).delete_pay_schedule(current_user.id, pay_id)


@router.get("/payday-plan", response_model=PaydayPlanView, tags=["pay cycle"])
def payday_plan(
    current_user: AuthenticatedUser,
    amount_cents: Annotated[int, Query(gt=0, le=100_000_000)],
    pay_id: str | None = None,
) -> PaydayPlanView:
    """The payday check-in for money that just came in: what's due before the next payday,
    and suggestions to act on. `pay_id` names the source of pay; without it, the money isn't
    pay (a bonus, a gift). Changes nothing."""
    return user_store(current_user).payday_plan(current_user.id, amount_cents, pay_id)


@router.post(
    "/pay-schedules/{pay_id}/received", response_model=DashboardResponse, tags=["pay cycle"]
)
def record_pay(
    pay_id: str,
    request: PayReceivedWrite,
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
) -> DashboardResponse:
    """ "I got paid": record a paycheque from this source as income on its account."""
    return in_view(
        user_store(current_user).record_pay(current_user.id, pay_id, request),
        current_user,
        month,
    )


@router.post("/categories", response_model=DashboardResponse, tags=["categories"])
def create_category(request: CategoryWrite, current_user: AuthenticatedUser) -> DashboardResponse:
    return user_store(current_user).create_category(current_user.id, request)


@router.delete("/categories/{category_id}", response_model=DashboardResponse, tags=["categories"])
def delete_category(category_id: str, current_user: AuthenticatedUser) -> DashboardResponse:
    return user_store(current_user).delete_category(current_user.id, category_id)
