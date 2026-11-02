"""DashboardStore: one person's data and every operation on it, assembled from the modules
in this package (each adds one area: transactions, budgets, goals, bills, and so on)."""

from app.dashboard_models import DashboardResponse
from app.store.accounts import AccountOps
from app.store.bills import BillOps
from app.store.goals import GoalOps
from app.store.learning import LearningOps
from app.store.pay import PayOps
from app.store.planning import PlanningOps
from app.store.reports import ReportViews
from app.store.seed import demo_snapshot, empty_snapshot
from app.store.transactions import TransactionOps


class DashboardStore(
    TransactionOps,
    PlanningOps,
    GoalOps,
    BillOps,
    AccountOps,
    PayOps,
    LearningOps,
    ReportViews,
):
    """Thread-safe store of one person's data. Every change returns a fresh snapshot."""

    def reset(self, user_id: str) -> DashboardResponse:
        """Erases this person's data: transactions, budgets, bills, goals, accounts (back to one
        $0 chequing account), custom categories, pay, and Learn progress. The name stays, and
        first-run setup shows again. The fictional demo goes back to its starting data instead."""
        with self._lock:
            self.require_owner(user_id)
            start = demo_snapshot() if self._profile.is_fictional else empty_snapshot(self._profile)
            self._load(start, self._owner_user_ids)
            return self._snapshot()
