"""Groups of friends to split costs with."""

from fastapi import APIRouter

from app.api.deps import AuthenticatedUser, ViewMonth, in_view, user_store
from app.dashboard_models import DashboardResponse, SplitGroupWrite

router = APIRouter(prefix="/api/v1")


@router.post("/split-groups", response_model=DashboardResponse, tags=["splits"])
def create_split_group(
    request: SplitGroupWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).create_split_group(current_user.id, request), current_user, month
    )


@router.put("/split-groups/{group_id}", response_model=DashboardResponse, tags=["splits"])
def update_split_group(
    group_id: str,
    request: SplitGroupWrite,
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
) -> DashboardResponse:
    return in_view(
        user_store(current_user).update_split_group(current_user.id, group_id, request),
        current_user,
        month,
    )


@router.delete("/split-groups/{group_id}", response_model=DashboardResponse, tags=["splits"])
def delete_split_group(
    group_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).delete_split_group(current_user.id, group_id), current_user, month
    )
