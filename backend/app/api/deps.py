"""What the routes share: the signed-in user, their store, and the month a change returns."""

from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status

from app.auth import CurrentUser, get_current_user
from app.dashboard_models import DashboardResponse
from app.store import DashboardStore, stores

AuthenticatedUser = Annotated[CurrentUser, Depends(get_current_user)]
# Optional month (any day in it) whose snapshot a mutation should return; defaults to today.
ViewMonth = Annotated[date | None, Query(description="Month to return, e.g. 2026-09-01")]
PeriodStart = Annotated[date | None, Query(description="Start of a custom period")]
PeriodEnd = Annotated[date | None, Query(description="End of a custom period (inclusive)")]


def user_store(user: CurrentUser) -> DashboardStore:
    """The signed-in user's data: the demo data set, or their own fresh account."""
    return stores.for_user(user.id, user.email)


def in_view(result: DashboardResponse, user: CurrentUser, month: date | None) -> DashboardResponse:
    """A change's result, as the snapshot of the month the app is showing when it sent one."""
    return user_store(user).dashboard_for_user(user.id, month) if month else result


def dashboard_for(
    user: CurrentUser, month: date | None, start: date | None, end: date | None
) -> DashboardResponse:
    """One month (default: this month), or a custom period with both start and end."""
    if (start is None) != (end is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Send both start and end")
    store = user_store(user)
    if start and end:
        return store.dashboard_for_range(user.id, start, end)
    return store.dashboard_for_user(user.id, month)
