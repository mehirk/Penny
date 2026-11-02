"""The dashboard snapshot, reports over time, and account-wide settings."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import (
    AuthenticatedUser,
    PeriodEnd,
    PeriodStart,
    ViewMonth,
    dashboard_for,
    in_view,
    user_store,
)
from app.coach.chats import chat_store
from app.dashboard_models import (
    ChartsResponse,
    DashboardResponse,
    HistoryResponse,
    ResetRequest,
    SpendingFromWrite,
)
from app.models import CurrentUserResponse
from app.store import stores

router = APIRouter(prefix="/api/v1")


@router.get("/me", response_model=CurrentUserResponse, tags=["auth"])
def me(current_user: AuthenticatedUser) -> CurrentUserResponse:
    """Echo the verified identity so sign-in can be tested without touching financial data."""
    return CurrentUserResponse(
        user_id=current_user.id,
        email=current_user.email,
        auth_method=current_user.auth_method,
        has_demo_financial_data=stores.is_demo(current_user.id),
    )


@router.get("/dashboard", response_model=DashboardResponse, tags=["dashboard"])
def dashboard(
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
    start: PeriodStart = None,
    end: PeriodEnd = None,
) -> DashboardResponse:
    """One month (default: this month), or any period up to 36 months with start and end."""
    return dashboard_for(current_user, month, start, end)


@router.get("/charts", response_model=ChartsResponse, tags=["history"])
def charts(
    current_user: AuthenticatedUser,
    start: Annotated[date, Query(description="First month in the range")],
    end: Annotated[date, Query(description="Last month in the range")],
    account: Annotated[list[str] | None, Query(description="Only these accounts")] = None,
    category: Annotated[
        list[str] | None, Query(description="Only these top-level categories, or uncategorized")
    ] = None,
) -> ChartsResponse:
    """Month-by-month figures for the Charts tab, up to 24 months, optionally filtered."""
    return user_store(current_user).charts_for_user(
        current_user.id, start, end, frozenset(account or ()), frozenset(category or ())
    )


@router.get("/history", response_model=HistoryResponse, tags=["history"])
def history(
    current_user: AuthenticatedUser,
    start: Annotated[date, Query(description="First month in the range")],
    end: Annotated[date, Query(description="Last month in the range")],
) -> HistoryResponse:
    """Monthly totals and category spending for a range of up to 24 months."""
    return user_store(current_user).history_for_user(current_user.id, start, end)


@router.put("/profile/spending-from", response_model=DashboardResponse, tags=["profile"])
def set_spending_from(
    request: SpendingFromWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    """Which accounts count as spending money for Safe to spend."""
    return in_view(
        user_store(current_user).set_spending_from(current_user.id, request.spending_from),
        current_user,
        month,
    )


@router.post("/account/reset", response_model=DashboardResponse, tags=["account"])
def reset_account(request: ResetRequest, current_user: AuthenticatedUser) -> DashboardResponse:
    """Erase all of this person's data and Penny AI chats (Settings › Reset data). Asks for
    "reset" in the body; the app confirms with the user first."""
    del request  # validated: confirm == "reset"
    result = user_store(current_user).reset(current_user.id)
    chat_store.delete_all(stores.data_owner(current_user.id))
    return result
