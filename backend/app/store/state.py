"""The data one person's store holds, and the lookups and checks every operation shares."""

import calendar
import copy
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from threading import RLock
from typing import Any, Literal
from uuid import uuid4

from fastapi import HTTPException, status

from app.dashboard_models import (
    Bill,
    Category,
    CategorySpending,
    GoalContribution,
    Mission,
    PaySchedule,
    Transfer,
)
from app.domain.categorize import necessity
from app.domain.finance import OVERDRAWABLE_TYPES, share_basis_points
from app.domain.pay_cycle import paydays
from app.domain.starter_budget import monthly_income_cents
from app.learning.engine import Learner
from app.models import Account, DemoUser, Transaction
from app.store.sections import SPENDABLE_TYPES, following_due

# The fictional demo's current month. Past months come from the demo history.
DEMO_MONTH = date(2026, 10, 1)


def month_start(value: date) -> date:
    return value.replace(day=1)


def same_month(value: date, month: date) -> bool:
    return value.year == month.year and value.month == month.month


def clamped_today(month: date) -> date:
    """The real date, kept inside `month` (so the demo's "today" stays in its own month)."""
    last = calendar.monthrange(month.year, month.month)[1]
    return min(max(date.today(), month), month.replace(day=last))


def new_id(prefix: str, length: int = 12) -> str:
    return f"{prefix}-{uuid4().hex[:length]}"


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def not_found(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail)


@dataclass
class StoreSnapshot:
    """Everything one person's store holds, in creation order, for saving and loading (app/db).
    Budgets and goals are the store's own dicts; see `budgets` and `savings_goals` tables."""

    profile: DemoUser
    accounts: list[Account]
    categories: list[Category]
    transactions: list[Transaction]
    budgets: list[dict[str, Any]]
    goals: list[dict[str, Any]]
    contributions: list[GoalContribution]
    missions: list[Mission]
    bills: list[Bill]
    pay_schedules: list[PaySchedule]
    learner: Learner
    transfers: list[Transfer] = field(default_factory=list)


class StoreState:
    """One person's data. Public methods check the caller owns it and hold the lock."""

    def __init__(self, snapshot: StoreSnapshot, owner_user_ids: Iterable[str] = ()) -> None:
        self._lock = RLock()
        self._load(snapshot, owner_user_ids)

    def _load(self, snapshot: StoreSnapshot, owner_user_ids: Iterable[str]) -> None:
        # The fictional data set stays in its own month; a real account follows the calendar.
        self.active_month = (
            DEMO_MONTH if snapshot.profile.is_fictional else month_start(date.today())
        )
        self._profile = snapshot.profile
        # The data's own profile plus any explicitly configured Supabase user ids.
        self._owner_user_ids = frozenset({snapshot.profile.id, *owner_user_ids})
        self._accounts = {item.id: item for item in snapshot.accounts}
        self._categories = {item.id: item for item in snapshot.categories}
        self._transactions = {item.id: item for item in snapshot.transactions}
        self._budgets = {str(item["id"]): dict(item) for item in snapshot.budgets}
        self._goals = {str(item["id"]): dict(item) for item in snapshot.goals}
        self._contributions = list(snapshot.contributions)
        self._missions = list(snapshot.missions)
        self._bills = {item.id: item for item in snapshot.bills}
        self._pay_schedules = {item.id: item for item in snapshot.pay_schedules}
        self._transfers = {item.id: item for item in snapshot.transfers}
        self._learner = copy.deepcopy(snapshot.learner)

    def snapshot(self) -> StoreSnapshot:
        """A copy of everything this store holds; later changes to the store don't affect it."""
        with self._lock:
            return StoreSnapshot(
                profile=self._profile,
                accounts=list(self._accounts.values()),
                categories=list(self._categories.values()),
                transactions=list(self._transactions.values()),
                budgets=[dict(item) for item in self._budgets.values()],
                goals=[dict(item) for item in self._goals.values()],
                contributions=list(self._contributions),
                missions=list(self._missions),
                bills=list(self._bills.values()),
                pay_schedules=list(self._pay_schedules.values()),
                learner=copy.deepcopy(self._learner),
                transfers=list(self._transfers.values()),
            )

    def today(self) -> date:
        """The app's "today": the real date, kept inside the store's current month."""
        return clamped_today(self.active_month)

    # ------------------------------------------------------------------ ownership

    @property
    def owner_user_ids(self) -> frozenset[str]:
        return self._owner_user_ids

    def is_owner(self, user_id: str) -> bool:
        return user_id in self._owner_user_ids

    def require_owner(self, user_id: str) -> None:
        if not self.is_owner(user_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Financial context is not available")

    # ------------------------------------------------------------------ lookups

    def _accounts_of(self, *types: str) -> list[Account]:
        return [item for item in self._accounts.values() if item.account_type in types]

    def _spendable_cents(self) -> int:
        """Money available for day-to-day spending: chequing and cash accounts."""
        return sum(item.balance_cents for item in self._accounts_of(*SPENDABLE_TYPES))

    def _require_account(self, account_id: str) -> Account:
        account = self._accounts.get(account_id)
        if account is None:
            raise invalid("Unknown account")
        return account

    def _default_source(self) -> str:
        """Where money comes from when the user doesn't say: chequing, else any cash account."""
        account = next(iter(self._accounts_of("chequing")), None) or next(
            iter(self._accounts_of(*SPENDABLE_TYPES)), None
        )
        if not account:
            raise invalid("Add a chequing account first")
        return account.id

    def _category(self, category_id: str) -> Category:
        category = self._categories.get(category_id)
        if not category:
            raise invalid("Unknown category")
        return category

    def _category_name(self, category_id: str | None) -> str:
        return self._category(category_id).name if category_id else "Uncategorized"

    def _spending_category(self, category_id: str) -> Category:
        category = self._category(category_id)
        if category.kind != "spending":
            raise invalid(f"{category.name} isn't a spending category")
        return category

    def _top_level(self, category_id: str | None) -> str | None:
        category = self._categories.get(category_id) if category_id else None
        return category.parent_id or category.id if category else None

    def _transaction(self, transaction_id: str) -> Transaction:
        transaction = self._transactions.get(transaction_id)
        if not transaction:
            raise not_found("Transaction not found")
        return transaction

    def _monthly_transactions(self, month: date) -> list[Transaction]:
        return [item for item in self._transactions.values() if same_month(item.occurred_on, month)]

    def _monthly_budgets(self, month: date) -> list[dict[str, Any]]:
        return [item for item in self._budgets.values() if item["month_start"] == month]

    def _is_bill_payment(self, item: Transaction) -> bool:
        """A payment toward a recurring bill: it counts against the fixed budget, not a category."""
        return item.kind == "spending" and item.bill_id in self._bills

    def _data_months(self) -> list[date]:
        months = {month_start(item.occurred_on) for item in self._transactions.values()}
        months.update(item["month_start"] for item in self._budgets.values())
        months.add(self.active_month)
        return sorted(month for month in months if month <= self.active_month)

    @staticmethod
    def _with_necessity(item: Transaction) -> Transaction:
        if item.kind != "spending":
            return item
        return item.model_copy(update={"necessity": necessity(item.description, item.category_id)})

    def _category_breakdown(
        self, transactions: Iterable[Transaction]
    ) -> tuple[dict[str | None, int], list[CategorySpending]]:
        """Spending per top-level category (subcategories roll up into their parent)."""
        spending_by_category: dict[str | None, int] = {}
        for item in transactions:
            if item.kind == "spending":
                key = self._top_level(item.category_id)
                spending_by_category[key] = spending_by_category.get(key, 0) + item.amount_cents
        total = sum(spending_by_category.values())
        breakdown = []
        for category_id, spent in sorted(
            spending_by_category.items(), key=lambda pair: pair[1], reverse=True
        ):
            category = self._categories.get(category_id) if category_id else None
            breakdown.append(
                CategorySpending(
                    category_id=category_id,
                    category_name=category.name if category else "Uncategorized",
                    colour_token=category.colour_token if category else "slate",
                    spent_cents=spent,
                    share_basis_points=share_basis_points(spent, total),
                )
            )
        return spending_by_category, breakdown

    def _mission_xp(self) -> int:
        return sum(item.xp_reward for item in self._missions if item.completed)

    def _needs_onboarding(self) -> bool:
        """A real account with no budget, bills, or pay yet: offer the first-run setup."""
        return (
            not self._profile.is_fictional
            and not self._budgets
            and not self._bills
            and not self._pay_schedules
        )

    # ------------------------------------------------------------------ pay

    def _upcoming_paydays(self, schedule: PaySchedule, start: date, end: date) -> list[date]:
        return paydays(schedule.frequency, schedule.next_payday, start, end, schedule.interval_days)

    @staticmethod
    def _monthly_pay(schedule: PaySchedule) -> int:
        return monthly_income_cents(
            schedule.amount_cents, schedule.frequency, schedule.interval_days
        )

    def _main_pay(self) -> PaySchedule | None:
        """The largest pay a month (earliest payday on a tie): it sets the pay cycles."""
        return min(
            self._pay_schedules.values(),
            key=lambda item: (-self._monthly_pay(item), item.next_payday, item.id),
            default=None,
        )

    # ------------------------------------------------------------------ validation and balances

    def _validate_transaction_references(
        self, account_id: str, category_id: str | None, kind: str | None = None
    ) -> None:
        self._require_account(account_id)
        if category_id:
            category = self._category(category_id)
            if kind and category.kind != kind:
                raise invalid(f"“{category.name}” is a {category.kind} category")

    def _apply_account_effect(
        self, transaction: Transaction, multiplier: Literal[1, -1], *, allow_overdraft: bool = False
    ) -> None:
        """Applies (1) or reverses (-1) a transaction on its account's balance.

        Something the user recorded already happened, so with `allow_overdraft` chequing and cash
        may go below $0 (Penny's balance is behind theirs). Payments Penny records for a bill
        don't, so the app can offer to move money in first."""
        signed = (
            transaction.amount_cents if transaction.kind == "income" else -transaction.amount_cents
        )
        self._change_balance(
            transaction.account_id, signed * multiplier, allow_overdraft=allow_overdraft
        )

    def _change_balance(
        self, account_id: str, money_in_cents: int, *, allow_overdraft: bool = False
    ) -> None:
        """Adds money to an account, or takes it out when negative. On a card, money spent with
        it raises what's owed. Only chequing, cash, and friends may go below $0, and only with
        `allow_overdraft`."""
        account = self._accounts[account_id]
        delta = -money_in_cents if account.account_type == "credit" else money_in_cents
        new_balance = account.balance_cents + delta
        overdraft_ok = allow_overdraft and account.account_type in OVERDRAWABLE_TYPES
        if new_balance < 0 and not overdraft_ok:
            raise invalid("Transaction would make the account balance negative")
        self._accounts[account_id] = account.model_copy(update={"balance_cents": new_balance})

    # ------------------------------------------------------------------ bills paid on their own

    def _record_bill(
        self,
        bill: Bill,
        on: date,
        automatically: bool,
        account_id: str | None = None,
        *,
        affect_balance: bool = True,
        allow_overdraft: bool = False,
    ) -> None:
        """Record one payment of a bill as a transaction and move it to its next due date.

        Without `affect_balance` it goes into history only: the user paid it before telling
        Penny, and the balance they entered already reflects it."""
        transaction = Transaction(
            id=new_id("tx"),
            description=bill.name,
            category=self._category_name(bill.category_id),
            account_id=account_id or bill.account_id,
            category_id=bill.category_id,
            amount_cents=bill.amount_cents,
            kind="spending",
            occurred_on=on,
            bill_id=bill.id,
            paid_automatically=automatically,
        )
        if affect_balance:
            self._apply_account_effect(transaction, 1, allow_overdraft=allow_overdraft)
        self._transactions[transaction.id] = transaction
        self._bills[bill.id] = bill.model_copy(
            update={"last_paid_on": on, "next_due": following_due(bill), "usual_due": None}
        )

    def _caught_up(self, bill: Bill) -> Bill:
        """The bill moved on to its latest due date that's today or earlier (for a bill the user
        has already paid; earlier missed dates aren't recorded)."""
        today = self.today()
        while (after := following_due(bill)) <= today:
            bill = bill.model_copy(update={"next_due": after, "usual_due": None})
        return bill

    def _auto_record_due_bills(self) -> None:
        """Auto-record bills are paid on their due date without the user having to tap."""
        today = self.today()
        for bill_id in list(self._bills):
            while (bill := self._bills[bill_id]).auto_record and bill.next_due <= today:
                try:
                    self._record_bill(bill, bill.next_due, automatically=True)
                except HTTPException:
                    break  # Not enough money in the account: leave it for the user.
