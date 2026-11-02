"""Recurring bills and subscriptions, and the payments recorded against them."""

from app.dashboard_models import Bill, BillHistory, BillPatch, BillWrite, DashboardResponse
from app.domain.categorize import categorize
from app.domain.finance import average_cents
from app.store.dashboard import DashboardViews
from app.store.state import invalid, new_id, not_found


class BillOps(DashboardViews):
    def _bill(self, bill_id: str) -> Bill:
        bill = self._bills.get(bill_id)
        if not bill:
            raise not_found("Bill not found")
        return bill

    def _validate_bill(self, account_id: str, category_id: str | None) -> None:
        self._require_account(account_id)
        if category_id and self._category(category_id).kind != "spending":
            raise invalid("Bills need a spending category")

    def create_bill(self, user_id: str, request: BillWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            self._validate_bill(request.account_id, request.category_id)
            category_id = request.category_id or categorize(request.name, "spending").category_id
            bill = Bill(
                id=new_id("bill", 10), **{**request.model_dump(), "category_id": category_id}
            )
            self._bills[bill.id] = bill
            return self._snapshot()

    def update_bill(self, user_id: str, bill_id: str, request: BillPatch) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            updated = self._bill(bill_id).model_copy(update=request.model_dump(exclude_unset=True))
            self._validate_bill(updated.account_id, updated.category_id)
            self._bills[bill_id] = updated
            return self._snapshot()

    def delete_bill(self, user_id: str, bill_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if self._bills.pop(bill_id, None) is None:
                raise not_found("Bill not found")
            return self._snapshot()

    def mark_bill_paid(
        self, user_id: str, bill_id: str, account_id: str | None = None
    ) -> DashboardResponse:
        """Records this payment. `account_id` pays it from another account this time (the bill
        keeps its usual account)."""
        with self._lock:
            self.require_owner(user_id)
            bill = self._bill(bill_id)
            if account_id is not None:
                self._require_account(account_id)
            self._record_bill(
                bill, min(self.today(), bill.next_due), automatically=False, account_id=account_id
            )
            return self._snapshot()

    def bill_history(self, user_id: str, bill_id: str) -> BillHistory:
        """Every recorded payment of a bill, newest first, with totals."""
        with self._lock:
            self.require_owner(user_id)
            bill = self._bill(bill_id)
            payments = sorted(
                (t for t in self._transactions.values() if t.bill_id == bill_id),
                key=lambda item: item.occurred_on,
                reverse=True,
            )
            total = sum(t.amount_cents for t in payments)
            year = self.today().year
            return BillHistory(
                bill=bill,
                payments=payments,
                payment_count=len(payments),
                total_paid_cents=total,
                paid_this_year_cents=sum(
                    t.amount_cents for t in payments if t.occurred_on.year == year
                ),
                average_cents=average_cents(total, len(payments)),
            )
