"""Applying a plan the user approved from Penny's agent (app.assist.agent): all or nothing,
through the same store operations the app's own forms use, so every rule still applies."""

from collections import Counter
from datetime import date, timedelta

from fastapi import HTTPException
from pydantic import ValidationError

from app.agent_models import (
    AccountNewAction,
    AccountUpdateAction,
    AgentAction,
    BillNewAction,
    BillPaidAction,
    BillUpdateAction,
    BudgetAction,
    CategoryNewAction,
    DeleteAction,
    ExpenseAction,
    GoalAddAction,
    GoalNewAction,
    GoalUpdateAction,
    GroupNewAction,
    IncomeAction,
    PayNewAction,
    PayReceivedAction,
    PersonaAction,
    SplitAction,
    TransactionUpdateAction,
    TransferAction,
    UsualItem,
)
from app.dashboard_models import (
    AccountPatch,
    AccountWrite,
    BillPatch,
    BillWrite,
    BudgetPatch,
    BudgetWrite,
    CategoryWrite,
    DashboardResponse,
    GoalPatch,
    GoalWrite,
    PayReceivedWrite,
    PayScheduleWrite,
    SharedPurchaseWrite,
    SplitGroupWrite,
    TransactionPatch,
    TransactionRepeat,
    TransactionSplit,
    TransactionWrite,
    TransferWrite,
)
from app.domain.finance import format_cad
from app.domain.splits import even_split
from app.domain.transfers import FRIEND
from app.models import Transaction
from app.store.accounts import AccountOps
from app.store.bills import BillOps
from app.store.goals import GoalOps
from app.store.pay import PayOps
from app.store.planning import PlanningOps
from app.store.splits import SplitOps
from app.store.state import StoreSnapshot, invalid, month_start, not_found
from app.store.transactions import TransactionOps

USUALS_DAYS = 120


class AgentOps(TransactionOps, PlanningOps, GoalOps, BillOps, AccountOps, SplitOps, PayOps):
    def apply_agent_actions(
        self, user_id: str, actions: list[AgentAction]
    ) -> tuple[DashboardResponse, list[str], StoreSnapshot]:
        """Runs each action in order. If any fails, everything goes back as it was. Returns the
        new snapshot, a line per action, and the data from before (for undo)."""
        with self._lock:
            self.require_owner(user_id)
            before = self.snapshot()
            try:
                done = [self._run_agent_action(user_id, action) for action in actions]
            except ValidationError as error:
                self._load(before, self._owner_user_ids)
                raise invalid(error.errors()[0]["msg"].removeprefix("Value error, ")) from error
            except (HTTPException, ValueError):
                self._load(before, self._owner_user_ids)
                raise
            return self._snapshot(), done, before

    def usual_transactions(self, user_id: str, limit: int = 6) -> list[UsualItem]:
        """What the user records most in the last few months, most often first (ties: most
        recent). Bills and paycheques are left out: those record themselves. The amount is
        the one they pay most often there (ties: the latest)."""
        with self._lock:
            self.require_owner(user_id)
            since = self.today() - timedelta(days=USUALS_DAYS)
            groups: dict[tuple[str, str], list[Transaction]] = {}
            for item in self._transactions.values():
                if item.bill_id or item.pay_id:
                    continue
                if not since <= item.occurred_on <= self.today():
                    continue
                groups.setdefault((item.description.strip().casefold(), item.kind), []).append(item)
            ranked = sorted(
                groups.values(),
                key=lambda items: (len(items), max(i.occurred_on for i in items)),
                reverse=True,
            )
            usuals = []
            for items in ranked[:limit]:
                latest = max(items, key=lambda i: i.occurred_on)
                amounts = Counter(i.amount_cents for i in items)
                top = max(amounts.values())
                amount = next(
                    i.amount_cents
                    for i in sorted(items, key=lambda i: i.occurred_on, reverse=True)
                    if amounts[i.amount_cents] == top
                )
                usuals.append(
                    UsualItem(
                        text=f"{latest.description} {format_cad(amount)}",
                        description=latest.description,
                        amount_cents=amount,
                        kind=latest.kind,
                        category_id=latest.category_id,
                        count=len(items),
                    )
                )
            return usuals

    def learned_categories(self) -> dict[tuple[str, str], str]:
        """The category the user last gave each place, by (description, kind): Penny files a
        repeat purchase the way they did before."""
        with self._lock:
            learned: dict[tuple[str, str], tuple[date, str]] = {}
            for item in self._transactions.values():
                if not item.category_id:
                    continue
                key = (item.description.strip().casefold(), item.kind)
                if key not in learned or item.occurred_on >= learned[key][0]:
                    learned[key] = (item.occurred_on, item.category_id)
            return {key: value[1] for key, value in learned.items()}

    def restore(self, user_id: str, snapshot: StoreSnapshot) -> DashboardResponse:
        """Puts back data saved earlier (an undo). The caller checks nothing changed since."""
        with self._lock:
            self.require_owner(user_id)
            self._load(snapshot, self._owner_user_ids)
            return self._snapshot()

    def _run_agent_action(self, user_id: str, action: AgentAction) -> str:
        if isinstance(action, ExpenseAction | IncomeAction):
            spending = isinstance(action, ExpenseAction)
            repeat = action.repeat if isinstance(action, ExpenseAction) else None
            self.create_transaction(
                user_id,
                TransactionWrite(
                    description=action.description,
                    account_id=action.account_id,
                    category_id=action.category_id,
                    amount_cents=action.amount_cents,
                    kind="spending" if spending else "income",
                    occurred_on=action.occurred_on,
                    repeat=TransactionRepeat(frequency=repeat) if repeat else None,
                ),
            )
            verb = "Added" if spending else "Added income:"
            return f"{verb} {action.description} ({format_cad(action.amount_cents)})"
        if isinstance(action, SplitAction):
            return self._run_split(user_id, action)
        if isinstance(action, BudgetAction):
            if action.category_id is None:
                assert action.new_category is not None
                action = action.model_copy(
                    update={
                        "category_id": self._spending_category_named(user_id, action.new_category)
                    }
                )
            assert action.category_id is not None
            self._spending_category(action.category_id)
            month = month_start(self.today())
            existing = next(
                (
                    budget
                    for budget in self._budgets.values()
                    if budget["category_id"] == action.category_id
                    and budget["month_start"] == month
                ),
                None,
            )
            if existing:
                self.update_budget(
                    user_id, str(existing["id"]), BudgetPatch(limit_cents=action.limit_cents)
                )
            else:
                self.create_budget(
                    user_id,
                    BudgetWrite(
                        category_id=action.category_id,
                        month_start=month,
                        limit_cents=action.limit_cents,
                    ),
                )
            name = self._category_name(action.category_id)
            return f"{name} budget set to {format_cad(action.limit_cents)}"
        if isinstance(action, GoalAddAction):
            goal = self._goals.get(action.goal_id)
            if not goal:
                raise not_found("Savings goal not found")
            self.contribute_to_goal(user_id, action.goal_id, action.amount_cents, action.account_id)
            return f"Moved {format_cad(action.amount_cents)} to {goal['name']}"
        if isinstance(action, GoalNewAction):
            self.create_goal(
                user_id,
                GoalWrite(
                    name=action.name,
                    target_cents=action.target_cents,
                    current_cents=0,
                    target_date=action.target_date,
                ),
            )
            return f"Started a goal: {action.name} ({format_cad(action.target_cents)})"
        return self._run_more(user_id, action)

    def _spending_category_named(self, user_id: str, name: str) -> str:
        """A spending category by name, added if there isn't one yet."""
        wanted = name.strip()
        for category in self._categories.values():
            if category.kind == "spending" and category.name.casefold() == wanted.casefold():
                return category.id
        before = set(self._categories)
        self.create_category(user_id, CategoryWrite(name=wanted[:40], kind="spending"))
        return next(iter(set(self._categories) - before))

    def _friend_id(self, user_id: str, name: str) -> str:
        """A friend by name, added to Penny if they aren't there yet."""
        wanted = name.strip()
        for account in self._accounts_of(FRIEND):
            if account.name.casefold() == wanted.casefold():
                return account.id
        before = set(self._accounts)
        self.create_account(user_id, AccountWrite(name=wanted, account_type=FRIEND))
        return next(iter(set(self._accounts) - before))

    def _run_split(self, user_id: str, action: SplitAction) -> str:
        if not action.friends:
            raise invalid("Pick who you split it with")
        ids = []
        for friend in action.friends:
            if friend.id:
                if self._require_account(friend.id).account_type != FRIEND:
                    raise invalid("Only friends can share a purchase")
                ids.append(friend.id)
            else:
                ids.append(self._friend_id(user_id, friend.name))
        if len(set(ids)) != len(ids):
            raise invalid("Each friend can appear only once")
        mine, each = even_split(action.total_cents, len(ids) + 1)
        if action.paid_by is None:
            request = SharedPurchaseWrite(
                description=action.description,
                category_id=action.category_id,
                occurred_on=action.occurred_on,
                paid_from=action.account_id,
                my_share_cents=mine,
                owed_by=[TransactionSplit(account_id=fid, amount_cents=each) for fid in ids],
                group_id=action.group_id,
            )
            names = [friend.name for friend in action.friends]
            who = (
                f"{names[0]} owes you {format_cad(each)}"
                if len(names) == 1
                else f"{', '.join(names[:-1])} and {names[-1]} owe you {format_cad(each)} each"
            )
            line = f"Split {action.description}: {who}"
        else:
            # A friend paid: the user owes them an even share; what others owe them isn't ours.
            request = SharedPurchaseWrite(
                description=action.description,
                category_id=action.category_id,
                occurred_on=action.occurred_on,
                paid_from=ids[action.paid_by],
                my_share_cents=each,
                group_id=action.group_id,
            )
            payer = action.friends[action.paid_by].name
            line = f"Split {action.description}: you owe {payer} {format_cad(each)}"
        self.create_shared_purchase(user_id, request)
        return line

    def _run_more(self, user_id: str, action: AgentAction) -> str:
        if isinstance(action, GoalUpdateAction):
            goal = self._goals.get(action.goal_id)
            if not goal:
                raise not_found("Savings goal not found")
            changes = action.model_dump(exclude={"kind", "goal_id"}, exclude_none=True)
            if not changes:
                raise invalid("Say what to change about the goal")
            self.update_goal(user_id, action.goal_id, GoalPatch(**changes))
            if action.status == "paused":
                return f"Paused {goal['name']}"
            if action.status == "active":
                return f"Resumed {goal['name']}"
            return f"Updated {action.name or goal['name']}"
        if isinstance(action, TransferAction):
            source = self._require_account(action.from_account_id)
            target = self._require_account(action.to_account_id)
            self.add_transfer(
                user_id,
                TransferWrite(
                    from_account_id=action.from_account_id,
                    to_account_id=action.to_account_id,
                    amount_cents=action.amount_cents,
                    occurred_on=action.occurred_on,
                    note=action.note,
                ),
            )
            amount = format_cad(action.amount_cents)
            if source.account_type == FRIEND:
                return f"{source.name} paid you back {amount}"
            if target.account_type == FRIEND:
                return f"You paid {target.name} back {amount}"
            if target.account_type == "credit":
                return f"Paid {amount} to {target.name}"
            return f"Moved {amount} from {source.name} to {target.name}"
        if isinstance(action, BillNewAction):
            self.create_bill(
                user_id, BillWrite(**action.model_dump(exclude={"kind"}), auto_record=True)
            )
            return (
                f"Added bill: {action.name} ({format_cad(action.amount_cents)} {action.frequency})"
            )
        if isinstance(action, BillPaidAction):
            name = self._bill(action.bill_id).name
            self.mark_bill_paid(user_id, action.bill_id)
            return f"Marked {name} paid"
        if isinstance(action, BillUpdateAction):
            name = self._bill(action.bill_id).name
            changes = action.model_dump(exclude={"kind", "bill_id"}, exclude_none=True)
            if not changes:
                raise invalid("Say what to change about the bill")
            self.update_bill(user_id, action.bill_id, BillPatch(**changes))
            return f"Updated {name}"
        if isinstance(action, TransactionUpdateAction):
            name = self._transaction(action.transaction_id).description
            changes = action.model_dump(exclude={"kind", "transaction_id"}, exclude_none=True)
            if not changes:
                raise invalid("Say what to change about the transaction")
            self.update_transaction(user_id, action.transaction_id, TransactionPatch(**changes))
            return f"Updated {name}"
        if isinstance(action, AccountNewAction):
            self.create_account(user_id, AccountWrite(**action.model_dump(exclude={"kind"})))
            return f"Added account: {action.name}"
        if isinstance(action, AccountUpdateAction):
            name = self._require_account(action.account_id).name
            changes = action.model_dump(exclude={"kind", "account_id"}, exclude_none=True)
            if not changes:
                raise invalid("Say what to change about the account")
            self.update_account(user_id, action.account_id, AccountPatch(**changes))
            return f"Updated {action.name or name}"
        if isinstance(action, CategoryNewAction):
            self.create_category(
                user_id,
                CategoryWrite(
                    name=action.name, kind=action.category_kind, parent_id=action.parent_id
                ),
            )
            return f"Added category: {action.name}"
        if isinstance(action, PayNewAction):
            self.add_pay_schedule(user_id, PayScheduleWrite(**action.model_dump(exclude={"kind"})))
            return (
                f"Added pay: {action.name} ({format_cad(action.amount_cents)} {action.frequency})"
            )
        if isinstance(action, PayReceivedAction):
            name = next((p.name for p in self._pay_schedules.values() if p.id == action.pay_id), "")
            self.record_pay(
                user_id,
                action.pay_id,
                PayReceivedWrite(occurred_on=action.occurred_on, amount_cents=action.amount_cents),
            )
            return f"Recorded pay: {name or 'paycheque'} ({format_cad(action.amount_cents)})"
        if isinstance(action, GroupNewAction):
            ids = []
            for friend in action.friends:
                if friend.id and self._require_account(friend.id).account_type == FRIEND:
                    ids.append(friend.id)
                else:
                    ids.append(self._friend_id(user_id, friend.name))
            self.create_split_group(
                user_id, SplitGroupWrite(name=action.name, member_ids=list(dict.fromkeys(ids)))
            )
            return f"Made a group: {action.name}"
        if isinstance(action, PersonaAction):
            self.set_persona(user_id, action.persona)
            labels = {"student": "a student", "working": "working", "learner": "learning first"}
            return f"Penny now coaches you as {labels[action.persona]}"
        if isinstance(action, DeleteAction):
            delete = {
                "transaction": self.delete_transaction,
                "bill": self.delete_bill,
                "goal": self.delete_goal,
                "budget": self.delete_budget,
                "account": self.delete_account,
                "category": self.delete_category,
                "transfer": self.delete_transfer,
                "pay": self.delete_pay_schedule,
                "group": self.delete_split_group,
            }[action.target]
            delete(user_id, action.target_id)
            return f"Deleted {action.label or action.target}"
        raise invalid("Unknown action")
