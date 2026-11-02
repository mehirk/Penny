"""Monthly category budgets: the variable part of the plan (recurring bills are the fixed part)."""

from datetime import date

from app.dashboard_models import BudgetLimitChange, BudgetPatch, BudgetWrite, DashboardResponse
from app.store.dashboard import DashboardViews
from app.store.state import conflict, invalid, month_start, new_id, not_found


class BudgetOps(DashboardViews):
    def _add_budget(self, category_id: str, month: date, limit_cents: int) -> None:
        budget_id = new_id("budget")
        self._budgets[budget_id] = {
            "id": budget_id,
            "category_id": category_id,
            "month_start": month,
            "limit_cents": limit_cents,
        }

    def create_budget(self, user_id: str, request: BudgetWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            self._category(request.category_id)
            if request.month_start.day != 1:
                raise invalid("month_start must be the first of a month")
            if any(
                item["category_id"] == request.category_id
                and item["month_start"] == request.month_start
                for item in self._budgets.values()
            ):
                raise conflict("Budget already exists")
            self._add_budget(request.category_id, request.month_start, request.limit_cents)
            return self._snapshot()

    def update_budget(
        self, user_id: str, budget_id: str, request: BudgetPatch
    ) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if budget_id not in self._budgets:
                raise not_found("Budget not found")
            self._budgets[budget_id]["limit_cents"] = request.limit_cents
            return self._snapshot()

    def apply_budget_changes(
        self, user_id: str, changes: list[BudgetLimitChange]
    ) -> DashboardResponse:
        """Sets several budget limits at once (an approved rebalance): all or nothing."""
        with self._lock:
            self.require_owner(user_id)
            if len({change.budget_id for change in changes}) != len(changes):
                raise invalid("One change per budget")
            if any(change.budget_id not in self._budgets for change in changes):
                raise not_found("Budget not found")
            for change in changes:
                self._budgets[change.budget_id]["limit_cents"] = change.limit_cents
            return self._snapshot()

    def apply_approved_budget_limit(
        self, user_id: str, budget_id: str, expected_limit_cents: int, new_limit_cents: int
    ) -> DashboardResponse:
        """A limit Penny AI proposed, once the user approves it. Refused if the budget changed
        after the proposal was made."""
        with self._lock:
            self.require_owner(user_id)
            budget = self._budgets.get(budget_id)
            if not budget:
                raise not_found("Budget not found")
            if budget["limit_cents"] != expected_limit_cents:
                raise conflict("Budget changed after this proposal was created")
            if new_limit_cents < 0:
                raise invalid("Invalid budget limit")
            budget["limit_cents"] = new_limit_cents
            return self._snapshot()

    def delete_budget(self, user_id: str, budget_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if self._budgets.pop(budget_id, None) is None:
                raise not_found("Budget not found")
            return self._snapshot()

    def copy_budgets(self, user_id: str, from_month: date, to_month: date) -> DashboardResponse:
        """Copies one month's limits into another, skipping categories already budgeted there."""
        with self._lock:
            self.require_owner(user_id)
            from_month, to_month = month_start(from_month), month_start(to_month)
            if from_month == to_month:
                raise invalid("Choose a different month")
            existing = {item["category_id"] for item in self._monthly_budgets(to_month)}
            source = [
                item
                for item in self._monthly_budgets(from_month)
                if item["category_id"] not in existing
            ]
            if not source:
                raise conflict("There are no new budgets to copy from that month")
            for item in source:
                self._add_budget(item["category_id"], to_month, item["limit_cents"])
            return self._snapshot(to_month)
