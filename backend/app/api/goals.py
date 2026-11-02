"""Savings goals and the challenges (missions) on Learn."""

from fastapi import APIRouter

from app.api.deps import AuthenticatedUser, ViewMonth, in_view, user_store
from app.dashboard_models import DashboardResponse, GoalContributionRequest, GoalPatch, GoalWrite

router = APIRouter(prefix="/api/v1")


@router.post("/savings-goals", response_model=DashboardResponse, tags=["goals"])
def create_goal(
    request: GoalWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).create_goal(current_user.id, request), current_user, month
    )


@router.patch("/savings-goals/{goal_id}", response_model=DashboardResponse, tags=["goals"])
def update_goal(
    goal_id: str, request: GoalPatch, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).update_goal(current_user.id, goal_id, request),
        current_user,
        month,
    )


@router.delete("/savings-goals/{goal_id}", response_model=DashboardResponse, tags=["goals"])
def delete_goal(
    goal_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).delete_goal(current_user.id, goal_id), current_user, month
    )


@router.post(
    "/savings-goals/{goal_id}/contributions", response_model=DashboardResponse, tags=["goals"]
)
def contribute_to_goal(
    goal_id: str,
    request: GoalContributionRequest,
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
) -> DashboardResponse:
    return in_view(
        user_store(current_user).contribute_to_goal(
            current_user.id, goal_id, request.amount_cents, request.from_account_id
        ),
        current_user,
        month,
    )


@router.post("/missions/{mission_id}/complete", response_model=DashboardResponse, tags=["missions"])
def complete_mission(
    mission_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).complete_mission(current_user.id, mission_id),
        current_user,
        month,
    )
