"""Savings goals, the money moved into them, and the challenges (missions) on Learn."""

from typing import Any, Literal
from uuid import uuid4

from app.dashboard_models import DashboardResponse, GoalContribution, GoalPatch, GoalWrite
from app.domain.finance import format_cad
from app.store.dashboard import DashboardViews
from app.store.state import conflict, invalid, new_id, not_found


class GoalOps(DashboardViews):
    def create_goal(self, user_id: str, request: GoalWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            goal_id = new_id("goal")
            values = request.model_dump()
            # Keep new goals in savings unless the user picks another account.
            if values["account_id"] is None:
                savings = next(iter(self._accounts_of("savings")), None)
                values["account_id"] = savings.id if savings else None
            else:
                self._require_account(values["account_id"])
            self._goals[goal_id] = {"id": goal_id, **values, "status": "active"}
            return self._snapshot()

    def update_goal(self, user_id: str, goal_id: str, request: GoalPatch) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if goal_id not in self._goals:
                raise not_found("Savings goal not found")
            self._goals[goal_id].update(request.model_dump(exclude_unset=True))
            return self._snapshot()

    def delete_goal(self, user_id: str, goal_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if self._goals.pop(goal_id, None) is None:
                raise not_found("Savings goal not found")
            return self._snapshot()

    def _move_into_goal(
        self,
        goal: dict[str, Any],
        amount_cents: int,
        from_account_id: str,
        source: Literal["you", "penny"],
    ) -> None:
        """Moves real money for a goal contribution: out of one account, into the goal's account.

        Total cash is unchanged, but the money is no longer available to spend.
        """
        source_account = self._accounts.get(from_account_id)
        if not source_account or source_account.account_type == "credit":
            raise invalid("Choose a chequing, savings, or cash account")
        if source_account.balance_cents < amount_cents:
            raise invalid(
                f"{source_account.name} only has {format_cad(source_account.balance_cents)}"
            )
        target_id = goal.get("account_id")
        if target_id != from_account_id:
            self._accounts[from_account_id] = source_account.model_copy(
                update={"balance_cents": source_account.balance_cents - amount_cents}
            )
            target = self._accounts.get(target_id) if target_id else None
            if target:
                self._accounts[target.id] = target.model_copy(
                    update={"balance_cents": target.balance_cents + amount_cents}
                )
        goal["current_cents"] += amount_cents
        if goal["current_cents"] >= goal["target_cents"]:
            goal["status"] = "completed"
        self._contributions.append(
            GoalContribution(
                id=f"{goal['id']}:{uuid4().hex[:8]}",
                amount_cents=amount_cents,
                from_account_id=from_account_id,
                to_account_id=target_id,
                occurred_on=self.today(),
                source=source,
            )
        )

    def contribute_to_goal(
        self, user_id: str, goal_id: str, amount_cents: int, from_account_id: str | None = None
    ) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            goal = self._goals.get(goal_id)
            if not goal:
                raise not_found("Savings goal not found")
            remaining = goal["target_cents"] - goal["current_cents"]
            if remaining <= 0:
                raise conflict("This goal has already been reached")
            if amount_cents > remaining:
                raise invalid("That is more than the amount left to reach this goal")
            self._move_into_goal(
                goal, amount_cents, from_account_id or self._default_source(), "you"
            )
            return self._snapshot()

    def apply_approved_goal_contribution(
        self, user_id: str, goal_id: str, expected_current_cents: int, contribution_cents: int
    ) -> DashboardResponse:
        """A contribution Penny AI proposed, once the user approves it. Refused if the goal
        changed after the proposal was made."""
        with self._lock:
            self.require_owner(user_id)
            goal = self._goals.get(goal_id)
            if not goal:
                raise not_found("Savings goal not found")
            if goal["current_cents"] != expected_current_cents:
                raise conflict("Savings goal changed after this proposal was created")
            if contribution_cents <= 0:
                raise invalid("Invalid contribution")
            amount = min(contribution_cents, goal["target_cents"] - goal["current_cents"])
            self._move_into_goal(goal, amount, self._default_source(), "penny")
            return self._snapshot()

    def complete_mission(self, user_id: str, mission_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            index = next(
                (i for i, item in enumerate(self._missions) if item.id == mission_id), None
            )
            if index is None:
                raise not_found("Mission not found")
            # Idempotent: completing twice never awards XP twice.
            self._missions[index] = self._missions[index].model_copy(update={"completed": True})
            return self._snapshot()
