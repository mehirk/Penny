"""Recording, editing, and importing transactions."""

from datetime import date
from typing import Literal

from fastapi import HTTPException

from app.dashboard_models import (
    Bill,
    DashboardResponse,
    ImportRow,
    SharedPurchaseWrite,
    SplitTransactionWrite,
    TransactionPatch,
    TransactionRepeat,
    TransactionWrite,
    Transfer,
)
from app.domain.categorize import categorize
from app.domain.transfers import FRIEND
from app.models import Transaction
from app.store.dashboard import DashboardViews
from app.store.sections import next_due_after
from app.store.state import invalid, new_id


class TransactionOps(DashboardViews):
    def _new_transaction(
        self,
        description: str,
        category_id: str | None,
        account_id: str,
        amount_cents: int,
        kind: Literal["income", "spending"],
        occurred_on: date,
    ) -> Transaction:
        """A validated, not-yet-saved transaction; picks a category when none is given."""
        self._validate_transaction_references(account_id, category_id, kind)
        auto = category_id is None
        if auto:
            category_id = categorize(description, kind).category_id
        return Transaction(
            id=new_id("tx"),
            description=description,
            category=self._category_name(category_id),
            account_id=account_id,
            category_id=category_id,
            auto_categorized=auto and category_id is not None,
            amount_cents=amount_cents,
            kind=kind,
            occurred_on=occurred_on,
        )

    def _bill_from(self, transaction: Transaction, repeat: TransactionRepeat) -> Bill:
        """A recurring bill that starts with this transaction as its first payment."""
        if transaction.kind != "spending":
            raise invalid("Only money out can repeat. Set up your paycheque in Settings.")
        next_due = repeat.next_due or next_due_after(transaction.occurred_on, repeat.frequency)
        if next_due <= transaction.occurred_on:
            raise invalid("The next payment must be after this one")
        return Bill(
            id=new_id("bill", 10),
            name=transaction.description,
            amount_cents=transaction.amount_cents,
            category_id=transaction.category_id,
            account_id=transaction.account_id,
            frequency=repeat.frequency,
            next_due=next_due,
            auto_record=repeat.auto_record,
            last_paid_on=transaction.occurred_on,
            # Paid on the 31st with no next date given: keep the 31st, not November's 30th.
            due_day=None if repeat.next_due else transaction.occurred_on.day,
        )

    def create_transaction(self, user_id: str, request: TransactionWrite) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            transaction = self._new_transaction(
                request.description,
                request.category_id,
                request.account_id,
                request.amount_cents,
                request.kind,
                request.occurred_on,
            )
            bill = self._bill_from(transaction, request.repeat) if request.repeat else None
            self._apply_account_effect(transaction, 1, allow_overdraft=True)
            if bill:
                self._bills[bill.id] = bill
                transaction = transaction.model_copy(update={"bill_id": bill.id})
            self._transactions[transaction.id] = transaction
            return self._snapshot()

    def create_split_transaction(
        self, user_id: str, request: SplitTransactionWrite
    ) -> DashboardResponse:
        """Saves one transaction per account, all or nothing."""
        with self._lock:
            self.require_owner(user_id)
            transactions = [
                self._new_transaction(
                    request.description,
                    request.category_id,
                    split.account_id,
                    split.amount_cents,
                    request.kind,
                    request.occurred_on,
                )
                for split in request.splits
            ]
            accounts_before = self._accounts.copy()
            try:
                for transaction in transactions:
                    self._apply_account_effect(transaction, 1, allow_overdraft=True)
            except HTTPException:
                self._accounts = accounts_before
                raise
            self._transactions.update({item.id: item for item in transactions})
            return self._snapshot()

    def create_shared_purchase(
        self, user_id: str, request: SharedPurchaseWrite
    ) -> DashboardResponse:
        """A purchase split with friends, all or nothing. The user's share is their spending.
        If a friend paid, the user now owes them that share; if the user paid, each friend's
        share left the user's account and that friend now owes it (a transfer to the friend,
        which can be removed like any other)."""
        with self._lock:
            self.require_owner(user_id)
            payer = self._require_account(request.paid_from)
            friends = [self._require_account(share.account_id) for share in request.owed_by]
            if any(friend.account_type != FRIEND for friend in friends):
                raise invalid("Only friends can owe you a share")
            if payer.account_type == FRIEND and friends:
                raise invalid("When a friend paid, record just your share")
            if payer.account_type != FRIEND and not friends:
                raise invalid("Pick who you split it with")
            transaction = self._new_transaction(
                request.description,
                request.category_id,
                payer.id,
                request.my_share_cents,
                "spending",
                request.occurred_on,
            )
            accounts_before = self._accounts.copy()
            try:
                self._apply_account_effect(transaction, 1, allow_overdraft=True)
                lent = []
                for share in request.owed_by:
                    self._change_balance(payer.id, -share.amount_cents, allow_overdraft=True)
                    self._change_balance(share.account_id, share.amount_cents)
                    lent.append(
                        Transfer(
                            id=new_id("transfer", 10),
                            kind="transfer",
                            from_account_id=payer.id,
                            to_account_id=share.account_id,
                            amount_cents=share.amount_cents,
                            occurred_on=request.occurred_on,
                            note=f"Their share: {request.description}"[:120],
                        )
                    )
            except HTTPException:
                self._accounts = accounts_before
                raise
            self._transactions[transaction.id] = transaction
            self._transfers.update({item.id: item for item in lent})
            return self._snapshot()

    def update_transaction(
        self, user_id: str, transaction_id: str, request: TransactionPatch
    ) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            existing = self._transaction(transaction_id)
            values = request.model_dump(exclude_unset=True)
            category_id = values.get("category_id", existing.category_id)
            self._validate_transaction_references(
                values.get("account_id", existing.account_id),
                category_id,
                values.get("kind", existing.kind),
            )
            accounts_before = self._accounts.copy()
            try:
                self._apply_account_effect(existing, -1, allow_overdraft=True)
                updated = existing.model_copy(
                    update={**values, "category": self._category_name(category_id)}
                )
                self._apply_account_effect(updated, 1, allow_overdraft=True)
            except HTTPException:
                self._accounts = accounts_before
                raise
            self._transactions[transaction_id] = updated
            return self._snapshot()

    def delete_transaction(self, user_id: str, transaction_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            existing = self._transaction(transaction_id)
            self._apply_account_effect(existing, -1, allow_overdraft=True)
            del self._transactions[transaction_id]
            return self._snapshot()

    def import_rows(
        self, user_id: str, rows: list[ImportRow], account_id: str
    ) -> tuple[int, list[str]]:
        """Adds reviewed statement rows as history. Balances don't change, and a row matching
        an existing transaction (date, description, amount, kind) is skipped."""
        with self._lock:
            self.require_owner(user_id)
            self._require_account(account_id)
            existing = {
                (t.occurred_on, t.description.casefold(), t.amount_cents, t.kind)
                for t in self._transactions.values()
            }
            errors: list[str] = []
            imported = 0
            for line, row in enumerate(rows, start=1):
                key = (row.occurred_on, row.description.casefold(), row.amount_cents, row.kind)
                if key in existing:
                    errors.append(f"Row {line}: already in Penny")
                    continue
                if row.occurred_on > self.today():
                    errors.append(f"Row {line}: date is in the future")
                    continue
                category = self._categories.get(row.category_id) if row.category_id else None
                if category and category.kind != row.kind:
                    category = None
                category_id = (
                    category.id if category else categorize(row.description, row.kind).category_id
                )
                item_id = new_id("tx")
                self._transactions[item_id] = Transaction(
                    id=item_id,
                    description=row.description,
                    category=self._category_name(category_id),
                    account_id=account_id,
                    category_id=category_id,
                    amount_cents=row.amount_cents,
                    kind=row.kind,
                    occurred_on=row.occurred_on,
                    auto_categorized=category is None and category_id is not None,
                )
                existing.add(key)
                imported += 1
            return imported, errors
