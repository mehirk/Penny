"""Groups of friends who share costs. What's owed is kept on each friend's account (see
transactions.create_shared_purchase); a group only saves who's in it."""

from app.dashboard_models import DashboardResponse, SplitGroup, SplitGroupWrite
from app.store.dashboard import DashboardViews
from app.store.state import invalid, new_id, not_found

MAX_GROUPS = 50


class SplitOps(DashboardViews):
    def _checked_group(self, request: SplitGroupWrite) -> SplitGroupWrite:
        for member_id in request.member_ids:
            if self._require_account(member_id).account_type != "person":
                raise invalid("Only friends can be in a group")
        return request.model_copy(update={"name": request.name.strip()})

    def create_split_group(self, user_id: str, request: SplitGroupWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if len(self._split_groups) >= MAX_GROUPS:
                raise invalid(f"You can have up to {MAX_GROUPS} groups")
            group = SplitGroup(id=new_id("group", 10), **self._checked_group(request).model_dump())
            self._split_groups[group.id] = group
            return self._snapshot()

    def update_split_group(
        self, user_id: str, group_id: str, request: SplitGroupWrite
    ) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if group_id not in self._split_groups:
                raise not_found("Group not found")
            self._split_groups[group_id] = SplitGroup(
                id=group_id, **self._checked_group(request).model_dump()
            )
            return self._snapshot()

    def delete_split_group(self, user_id: str, group_id: str) -> DashboardResponse:
        """Removes the group only; what friends owe stays, and its purchases stay in history."""
        with self._lock:
            self.require_owner(user_id)
            if self._split_groups.pop(group_id, None) is None:
                raise not_found("Group not found")
            return self._snapshot()
