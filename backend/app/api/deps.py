"""What the routes share: the signed-in user, their store, and the month a change returns."""

from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status

from app import limits
from app.auth import CurrentUser, get_current_user
from app.config import get_settings
from app.dashboard_models import DashboardResponse
from app.store import DashboardStore, stores


async def signed_in(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    """The signed-in person, within their request limit. Async so the person noted for AI
    charges (app.limits) stays with the request instead of a worker thread."""
    wait = limits.note_request(user.id)
    if wait is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many requests. Wait a moment and try again.",
            headers={"Retry-After": str(wait)},
        )
    return user


AuthenticatedUser = Annotated[CurrentUser, Depends(signed_in)]


def spend_penny_ai_turn(user: CurrentUser) -> None:
    """Charges one Penny AI turn (a chat message or a mission the person starts), or refuses with
    429 once today's are used. The demo account is exempt so the team can present."""
    exempt = user.id == get_settings().demo_owner_user_id
    wait = limits.spend_penny_ai_turn(user.id, exempt=exempt)
    if wait is not None:
        hours = max(1, round(wait / 3600))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"You’ve used today’s {limits.PENNY_AI_TURNS_PER_DAY} Penny AI questions. "
            f"More in about {hours} hour{'s' if hours != 1 else ''}.",
            headers={"Retry-After": str(wait)},
        )


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
