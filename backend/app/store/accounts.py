"""Accounts, categories, and money moved between the user's own accounts."""

from datetime import date

from app.dashboard_models import (
    AccountPatch,
    AccountWrite,
    Category,
    CategoryWrite,
    DashboardResponse,
    Transfer,
    TransferWrite,
)
from app.domain.card_due import due_day_from
from app.domain.transfers import move, undo
from app.models import Account
from app.store.dashboard import DashboardViews
from app.store.state import conflict, invalid, new_id, not_found


def require_card_for_due_day(account_type: str, due_day: int | None) -> None:
    if due_day is not None and account_type != "credit":
        raise invalid("Only credit cards have a payment due day")


def due_from_next_payment(
    account_type: str, due_day: int | None, next_due: date | None, today: date
) -> tuple[int | None, bool]:
    """The card's due day and whether this month's payment is already paid, from either the
    due day or the next payment's date (one, not both)."""
    require_card_for_due_day(account_type, due_day)
    if next_due is None:
        return due_day, False
    if account_type != "credit":
        raise invalid("Only credit cards have a payment due date")
    if due_day is not None:
        raise invalid("Send the due day or the next payment date, not both")
    try:
        return due_day_from(today, next_due)
    except ValueError as error:
        raise invalid(str(error)) from error


class AccountOps(DashboardViews):
    # ------------------------------------------------------------------ accounts

    def create_account(self, user_id: str, request: AccountWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if (request.account_type == "credit") != (request.credit_limit_cents is not None):
                raise invalid("Credit accounts need a credit limit; other accounts can't have one")
            due_day, paid = due_from_next_payment(
                request.account_type,
                request.payment_due_day,
                request.payment_next_due,
                self.today(),
            )
            account = Account(
                id=new_id("acct", 10),
                **request.model_dump(exclude={"payment_due_day", "payment_next_due"}),
                payment_due_day=due_day,
                card_paid_on=self.today() if paid else None,
            )
            self._accounts[account.id] = account
            return self._snapshot()

    def update_account(
        self, user_id: str, account_id: str, request: AccountPatch
    ) -> DashboardResponse:
        """A new balance is the user correcting it to match their real account."""
        with self._lock:
            self.require_owner(user_id)
            account = self._accounts.get(account_id)
            if not account:
                raise not_found("Account not found")
            changes = request.model_dump(exclude_none=True)
            if "name" in changes:
                changes["name"] = changes["name"].strip()
            if "credit_limit_cents" in changes and account.account_type != "credit":
                raise invalid("Only credit cards have a limit")
            next_due = changes.pop("payment_next_due", None)
            due_day, paid = due_from_next_payment(
                account.account_type, changes.get("payment_due_day"), next_due, self.today()
            )
            if next_due is not None:
                if "card_paid_on" in changes:
                    raise invalid("Send the next payment date or a payment, not both")
                # The date says it all: next month's means this month's is paid; this cycle's
                # means it isn't (yet).
                changes["payment_due_day"] = due_day
                changes["card_paid_on"] = self.today() if paid else None
            paid_on = changes.get("card_paid_on")
            if paid_on and account.account_type != "credit":
                raise invalid("Only credit cards can be marked paid")
            if paid_on and paid_on > self.today():
                raise invalid("That payment date is in the future")
            self._accounts[account_id] = account.model_copy(update=changes)
            return self._snapshot()

    def delete_account(self, user_id: str, account_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if account_id not in self._accounts:
                raise not_found("Account not found")
            in_use = (
                any(t.account_id == account_id for t in self._transactions.values())
                or any(b.account_id == account_id for b in self._bills.values())
                or any(p.account_id == account_id for p in self._pay_schedules.values())
                or any(
                    account_id in (t.from_account_id, t.to_account_id)
                    for t in self._transfers.values()
                )
            )
            if in_use:
                raise conflict(
                    "This account has transactions, bills, or your paycheque. Move them first."
                )
            del self._accounts[account_id]
            # A friend leaves their groups; a group with nobody left goes too.
            for group in list(self._split_groups.values()):
                if account_id in group.member_ids:
                    members = [m for m in group.member_ids if m != account_id]
                    if members:
                        self._split_groups[group.id] = group.model_copy(
                            update={"member_ids": members}
                        )
                    else:
                        del self._split_groups[group.id]
            return self._snapshot()

    def set_spending_from(self, user_id: str, value: str) -> DashboardResponse:
        """Which accounts count as spending money for Safe to spend."""
        with self._lock:
            self.require_owner(user_id)
            self._profile = self._profile.model_copy(update={"spending_from": value})
            return self._snapshot()

    # ------------------------------------------------------------------ categories

    def create_category(self, user_id: str, request: CategoryWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            name = request.name.strip()
            if any(
                c.kind == request.kind and c.name.casefold() == name.casefold()
                for c in self._categories.values()
            ):
                raise conflict("That category already exists")
            if request.parent_id:
                parent = self._category(request.parent_id)
                if parent.parent_id or parent.kind != request.kind:
                    raise invalid("A subcategory needs a top-level parent of the same type")
            category = Category(
                id=new_id("cat", 10),
                name=name,
                colour_token="slate" if request.kind == "spending" else "emerald",
                kind=request.kind,
                parent_id=request.parent_id,
                custom=True,
            )
            self._categories[category.id] = category
            return self._snapshot()

    def delete_category(self, user_id: str, category_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            self._category(category_id)
            in_use = (
                any(t.category_id == category_id for t in self._transactions.values())
                or any(b["category_id"] == category_id for b in self._budgets.values())
                or any(b.category_id == category_id for b in self._bills.values())
                or any(c.parent_id == category_id for c in self._categories.values())
            )
            if in_use:
                raise conflict(
                    "This category is in use. Move its transactions, budgets, bills, and "
                    "subcategories first."
                )
            del self._categories[category_id]
            return self._snapshot()

    # ------------------------------------------------------------------ transfers

    def _move(self, transfer: TransferWrite, *, reverse: bool) -> None:
        source = self._accounts[transfer.from_account_id]
        target = self._accounts[transfer.to_account_id]
        try:
            new_from, new_to = (undo if reverse else move)(
                source.account_type,
                source.balance_cents,
                target.account_type,
                target.balance_cents,
                transfer.amount_cents,
            )
        except ValueError as error:
            raise invalid(str(error)) from error
        self._accounts[source.id] = source.model_copy(update={"balance_cents": new_from})
        self._accounts[target.id] = target.model_copy(update={"balance_cents": new_to})

    def add_transfer(self, user_id: str, request: TransferWrite) -> DashboardResponse:
        """Records money moved between the user's own accounts (or a card payment). Balances
        change; budgets and Safe to spend don't (app.domain.transfers)."""
        with self._lock:
            self.require_owner(user_id)
            self._require_account(request.from_account_id)
            to_account = self._require_account(request.to_account_id)
            if request.from_account_id == request.to_account_id:
                raise invalid("Pick two different accounts")
            if request.occurred_on > self.today():
                raise invalid("Record a transfer once it's made")
            self._move(request, reverse=False)
            transfer = Transfer(
                id=new_id("transfer", 10),
                kind="card_payment" if to_account.account_type == "credit" else "transfer",
                **request.model_dump(),
            )
            self._transfers[transfer.id] = transfer
            return self._snapshot()

    def delete_transfer(self, user_id: str, transfer_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            transfer = self._transfers.get(transfer_id)
            if transfer is None:
                raise not_found("Transfer not found")
            if {transfer.from_account_id, transfer.to_account_id} - set(self._accounts):
                raise conflict("One of its accounts was deleted")
            self._move(transfer, reverse=True)
            del self._transfers[transfer_id]
            return self._snapshot()
