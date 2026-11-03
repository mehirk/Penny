"""Read-only figures derived from the store's data: the pieces of a dashboard snapshot."""

import calendar
from collections.abc import Iterable
from datetime import date, timedelta
from typing import Any

from app.dashboard_models import (
    BudgetPlan,
    CardPayment,
    CashWarning,
    CreditSnapshot,
    FinancialHealth,
    FinancialHealthFactor,
    FixedCost,
    Goal,
    HomeSummary,
    MoneyCalendar,
    PayOverview,
    PaySource,
    Period,
    RecurringSummary,
    SplitActivity,
    SplitFriend,
    SplitGroupSummary,
    SplitsOverview,
    Transfer,
    UpcomingPay,
)
from app.domain.card_due import card_cycle
from app.domain.cash_check import Cash, Due, due_soon, shortfalls
from app.domain.finance import add_months, ceil_div, months_until
from app.domain.financial_health import METHODOLOGY, health_factors, health_score
from app.domain.money_days import DayScore
from app.domain.periods import describe_period
from app.domain.recurring import detect_fixed_series
from app.domain.splits import split_totals
from app.models import Account, Transaction
from app.store.sections import bill_due_dates, build_calendar, build_recurring, score_month
from app.store.state import StoreState, invalid, same_month

UNUSUAL_MULTIPLE = 3
# A friend's share of a purchase the user paid for, as noted before shares had their own kind.
SHARE_NOTE = "Their share: "
SPLIT_ACTIVITY_LIMIT = 200
UNUSUAL_MINIMUM_CENTS = 4_000


class StoreInsights(StoreState):
    def _goal(self, item: dict[str, Any]) -> Goal:
        target = item["target_date"]
        mine = [c for c in self._contributions if c.id.startswith(f"{item['id']}:")]
        this_month = sum(
            c.amount_cents for c in mine if same_month(c.occurred_on, self.active_month)
        )
        # The monthly need is fixed from where the goal stood when the month began, so adding
        # money this month counts toward it instead of shrinking it.
        remaining = max(0, item["target_cents"] - (item["current_cents"] - this_month))
        return Goal(
            **item,
            contributed_this_month_cents=this_month,
            recent_contributions=sorted(mine, key=lambda c: c.occurred_on, reverse=True)[:5],
            progress_basis_points=min(
                10_000, item["current_cents"] * 10_000 // item["target_cents"]
            ),
            monthly_needed_cents=(
                ceil_div(remaining, months_until(self.active_month, target))
                if target and item["status"] == "active"
                else None
            ),
        )

    def _flag_unusual(self, rows: list[Transaction]) -> list[Transaction]:
        """Marks everyday purchases at least 3x their category's average over the last 6 months.

        Bills and small amounts are never flagged, and a category needs a few purchases first.
        """
        since = add_months(self.active_month, -6)
        amounts: dict[str | None, dict[str, int]] = {}
        for t in self._transactions.values():
            if t.kind == "spending" and not t.bill_id and t.occurred_on >= since:
                amounts.setdefault(t.category_id, {})[t.id] = t.amount_cents
        flagged = []
        for t in rows:
            # Compare against the category's other purchases, so a big one can't hide itself.
            usual = [a for i, a in amounts.get(t.category_id, {}).items() if i != t.id]
            unusual = (
                t.kind == "spending"
                and not t.bill_id
                and t.amount_cents >= UNUSUAL_MINIMUM_CENTS
                and len(usual) >= 3
                and t.amount_cents * len(usual) >= UNUSUAL_MULTIPLE * sum(usual)
            )
            flagged.append(t.model_copy(update={"unusual": True}) if unusual else t)
        return flagged

    def _typical(self, month: date, field: str) -> int:
        """Average monthly income or cash flow over the three months before `month`."""
        totals = []
        for offset in range(1, 4):
            rows = self._monthly_transactions(add_months(month, -offset))
            if not rows:
                continue
            income = sum(t.amount_cents for t in rows if t.kind == "income")
            spending = sum(t.amount_cents for t in rows if t.kind == "spending")
            totals.append(income if field == "income" else income - spending)
        return sum(totals) // len(totals) if totals else 0

    def _financial_health(
        self, month: date, spending_cents: int, budget_cents: int, cash_flow_cents: int
    ) -> FinancialHealth:
        previous = self._monthly_transactions(add_months(month, -1))
        previous_income = sum(t.amount_cents for t in previous if t.kind == "income")
        previous_spending = sum(t.amount_cents for t in previous if t.kind == "spending")
        factors = health_factors(
            spending_cents=spending_cents,
            budget_cents=budget_cents,
            cash_flow_cents=cash_flow_cents,
            has_activity=bool(self._monthly_transactions(month)),
            previous_spending_cents=previous_spending,
            previous_cash_flow_cents=previous_income - previous_spending,
            goal_progress_basis_points=[
                self._goal(item).progress_basis_points
                for item in self._goals.values()
                if item["status"] == "active"
            ],
        )
        return FinancialHealth(
            score=health_score(factors),
            factors=[
                FinancialHealthFactor(
                    id=item.id,
                    label=item.label,
                    score=item.score,
                    max_score=item.max_score,
                    explanation=item.explanation,
                )
                for item in factors
            ],
            methodology=METHODOLOGY,
        )

    def _home(self) -> HomeSummary:
        """Spending money now, and month-to-date spending against last month's same days."""
        today = self.today()

        def spent_through(month: date) -> int:
            last = min(today.day, calendar.monthrange(month.year, month.month)[1])
            return sum(
                t.amount_cents
                for t in self._monthly_transactions(month)
                if t.kind == "spending" and t.occurred_on.day <= last
            )

        this_spend = spent_through(self.active_month)
        last_spend = spent_through(add_months(self.active_month, -1))
        return HomeSummary(
            available_cents=self._spendable_cents(),
            spending_change_basis_points=(
                (this_spend - last_spend) * 10_000 // last_spend if last_spend > 0 else None
            ),
        )

    def _pay_overview(self) -> PayOverview | None:
        if not self._pay_schedules:
            return None
        today = self.today()
        main = self._main_pay()
        ordered = sorted(
            self._pay_schedules.values(),
            key=lambda item: (item.id != (main.id if main else None), item.name, item.id),
        )
        sources = [
            PaySource(
                **schedule.model_dump(),
                monthly_cents=self._monthly_pay(schedule),
                upcoming=self._upcoming_paydays(schedule, today, today + timedelta(days=400))[:3],
            )
            for schedule in ordered
        ]
        upcoming = sorted(
            (
                UpcomingPay(
                    pay_id=schedule.id,
                    name=schedule.name,
                    on=day,
                    amount_cents=schedule.amount_cents,
                )
                for schedule in ordered
                for day in self._upcoming_paydays(schedule, today, today + timedelta(days=34))
            ),
            key=lambda item: (item.on, item.name),
        )
        return PayOverview(
            monthly_cents=sum(source.monthly_cents for source in sources),
            sources=sources,
            upcoming=upcoming,
        )

    def _recurring(self) -> RecurringSummary:
        return build_recurring(
            bills=list(self._bills.values()),
            transactions=list(self._transactions.values()),
            category_names={c.id: c.name for c in self._categories.values()},
            active_month=self.active_month,
            today=self.today(),
            typical_income_cents=self._typical(self.active_month, "income"),
        )

    def _scored_month(self, month: date) -> list[DayScore]:
        """Daily Money Scores for a month, through today when it is the current month."""
        # Category budgets are the flexible part of the plan; recurring bills sit outside them.
        budget = sum(item["limit_cents"] for item in self._monthly_budgets(month))
        if budget <= 0:
            # No flexible budget means nothing to pace against; an empty month isn't "green".
            return []
        days = calendar.monthrange(month.year, month.month)[1]
        through = self.today().day if month == self.active_month else days
        fixed = detect_fixed_series(self._transactions.values(), month)
        return score_month(month, self._monthly_transactions(month), fixed, budget, through)

    def _money_calendar(self, month: date) -> MoneyCalendar:
        scores = self._scored_month(month)
        earlier = [
            day for offset in (2, 1) for day in self._scored_month(add_months(month, -offset))
        ]
        return build_calendar(
            month=month,
            today=self.today() if month == self.active_month else None,
            scores=scores,
            history=earlier + scores,
            flexible_budget=sum(item["limit_cents"] for item in self._monthly_budgets(month)),
        )

    def _fixed_costs(
        self, start: date, end: date, rows: Iterable[Transaction], kinds: dict[str, str]
    ) -> list[FixedCost]:
        """Each recurring bill's share of the budget for start..end: payments toward it in the
        period, plus what's still due by `end` (overdue ones too). Past periods have nothing due."""
        today = self.today()
        paid: dict[str, int] = {}
        for item in rows:
            if self._is_bill_payment(item) and item.bill_id:
                paid[item.bill_id] = paid.get(item.bill_id, 0) + item.amount_cents
        lines = []
        for bill in self._bills.values():
            due_dates = (
                bill_due_dates(bill, start if start > today else date.min, end)
                if end >= today
                else []
            )
            due = bill.amount_cents * len(due_dates)
            if due or paid.get(bill.id):
                lines.append(
                    FixedCost(
                        bill_id=bill.id,
                        name=bill.name,
                        category_id=bill.category_id,
                        kind="subscription" if kinds.get(bill.id) == "subscription" else "bill",
                        amount_cents=paid.get(bill.id, 0) + due,
                        paid_cents=paid.get(bill.id, 0),
                        due_cents=due,
                        next_due_on=due_dates[0] if due_dates else None,
                    )
                )
        return sorted(lines, key=lambda line: (-line.amount_cents, line.name))

    @staticmethod
    def _budget_plan(fixed: list[FixedCost], variable_cents: int) -> BudgetPlan:
        fixed_cents = sum(line.amount_cents for line in fixed)
        return BudgetPlan(
            fixed_cents=fixed_cents,
            fixed_paid_cents=sum(line.paid_cents for line in fixed),
            variable_cents=variable_cents,
            total_cents=fixed_cents + variable_cents,
            fixed=fixed,
        )

    def _cash_warnings(self, recurring: RecurringSummary) -> list[CashWarning]:
        """Accounts short of the bills due from them within 3 days (overdue included)."""
        today = self.today()
        unpaid = [item for item in recurring.unpaid if due_soon(item.due_on, today)]
        bills = {
            item.bill_id: self._bills[item.bill_id]
            for item in unpaid
            if item.bill_id in self._bills
        }
        dues = [
            Due(bills[item.bill_id].account_id, item.amount_cents)
            for item in unpaid
            if item.bill_id in bills
        ]
        # A card payment due soon (and not paid yet this cycle) is usually paid from chequing.
        chequing = next(iter(self._accounts_of("chequing")), None)
        cards = [
            (payment.account_name, payment.due_on, payment.owed_cents)
            for payment in self._card_payments()
            if payment.owed_cents > 0
            and payment.paid_on is None
            and due_soon(payment.due_on, today)
        ]
        if chequing:
            dues += [Due(chequing.id, owed) for _, _, owed in cards]
        # Money a friend owes isn't there to move, so it's never suggested as cover.
        cash = [
            Cash(a.id, a.account_type, a.balance_cents)
            for a in self._accounts.values()
            if a.account_type != "person"
        ]
        warnings = []
        for short in shortfalls(cash, dues):
            mine = [
                (item.name, item.due_on)
                for item in unpaid
                if item.bill_id in bills and bills[item.bill_id].account_id == short.account_id
            ]
            if chequing and short.account_id == chequing.id:
                mine += [(f"{name} payment", due) for name, due, _ in cards]
            cover = self._accounts.get(short.cover_from) if short.cover_from else None
            warnings.append(
                CashWarning(
                    account_id=short.account_id,
                    account_name=self._accounts[short.account_id].name,
                    due_cents=short.due_cents,
                    balance_cents=short.balance_cents,
                    short_cents=short.short_cents,
                    bill_names=list(dict.fromkeys(name for name, _ in mine)),
                    first_due_on=min(due for _, due in mine),
                    cover_account_id=cover.id if cover else None,
                    cover_account_name=cover.name if cover else None,
                )
            )
        return warnings

    def _split_activity(self, friends: dict[str, Account]) -> list[SplitActivity]:
        """Everything that changed what friends and the user owe each other, newest first."""
        items: list[SplitActivity] = []
        for transfer in self._transfers.values():
            to_friend = friends.get(transfer.to_account_id)
            from_friend = friends.get(transfer.from_account_id)
            if bool(to_friend) == bool(from_friend):
                continue
            note = transfer.note or ""
            if to_friend:
                friend = to_friend
                lent = transfer.kind == "split" or note.startswith(SHARE_NOTE)
                kind = "lent" if lent else "you_paid_back"
                description = (
                    note.removeprefix(SHARE_NOTE)
                    if lent
                    else note or f"You paid {friend.name} back"
                )
            else:
                friend = from_friend  # type: ignore[assignment]
                kind = "paid_back"
                description = note or f"{friend.name} paid you back"
            items.append(
                SplitActivity(
                    id=transfer.id,
                    kind=kind,
                    friend_id=friend.id,
                    friend_name=friend.name,
                    description=description or "Shared purchase",
                    amount_cents=transfer.amount_cents,
                    occurred_on=transfer.occurred_on,
                    group_id=transfer.group_id,
                    transfer_id=transfer.id,
                )
            )
        for transaction in self._transactions.values():
            friend = friends.get(transaction.account_id)
            if friend and transaction.kind == "spending":
                items.append(
                    SplitActivity(
                        id=transaction.id,
                        kind="borrowed",
                        friend_id=friend.id,
                        friend_name=friend.name,
                        description=transaction.description,
                        amount_cents=transaction.amount_cents,
                        occurred_on=transaction.occurred_on,
                        group_id=transaction.group_id,
                        transaction_id=transaction.id,
                    )
                )
        # Newest first. On the same day, transfers recorded later come first, and so do purchases.
        items.reverse()
        items.sort(key=lambda item: item.occurred_on, reverse=True)
        return items

    def _splits_overview(self) -> SplitsOverview:
        friends = {
            account.id: account
            for account in self._accounts.values()
            if account.account_type == "person"
        }
        activity = self._split_activity(friends)
        last: dict[str, date] = {}
        for item in activity:
            last.setdefault(item.friend_id, item.occurred_on)
        totals = split_totals(account.balance_cents for account in friends.values())
        groups = []
        for group in self._split_groups.values():
            mine = [
                t
                for t in self._transactions.values()
                if t.group_id == group.id and t.kind == "spending"
            ]
            shares = [
                t for t in self._transfers.values() if t.group_id == group.id and t.kind == "split"
            ]
            purchases = {(t.occurred_on, t.description) for t in mine} | {
                (t.occurred_on, (t.note or "").removeprefix(SHARE_NOTE)) for t in shares
            }
            groups.append(
                SplitGroupSummary(
                    **group.model_dump(),
                    expense_count=len(purchases),
                    spent_cents=sum(t.amount_cents for t in mine)
                    + sum(t.amount_cents for t in shares),
                )
            )
        return SplitsOverview(
            owed_to_you_cents=totals.owed_to_you_cents,
            you_owe_cents=totals.you_owe_cents,
            net_cents=totals.net_cents,
            friends=sorted(
                (
                    SplitFriend(
                        account_id=account.id,
                        name=account.name,
                        balance_cents=account.balance_cents,
                        last_activity_on=last.get(account.id),
                    )
                    for account in friends.values()
                ),
                key=lambda friend: (-abs(friend.balance_cents), friend.name.casefold()),
            ),
            groups=groups,
            activity=activity[:SPLIT_ACTIVITY_LIMIT],
        )

    def _card_payments(self) -> list[CardPayment]:
        """Credit cards with a payment due day, soonest first. A card payment recorded since its
        previous due date pays the coming one, so the card shows the following month's."""
        today = self.today()
        payments: list[CardPayment] = []
        for account in self._accounts_of("credit"):
            if not account.payment_due_day:
                continue
            paid_dates = [
                t.occurred_on for t in self._transfers.values() if t.to_account_id == account.id
            ]
            if account.card_paid_on:
                paid_dates.append(account.card_paid_on)
            due, paid_on = card_cycle(today, account.payment_due_day, paid_dates)
            payments.append(
                CardPayment(
                    account_id=account.id,
                    account_name=account.name,
                    due_on=due,
                    days_until_due=(due - today).days,
                    owed_cents=account.balance_cents,
                    paid_on=paid_on,
                )
            )
        return sorted(payments, key=lambda item: (item.due_on, item.account_name))

    @staticmethod
    def _credit_snapshot(account: Account | None) -> CreditSnapshot | None:
        if not account or not account.credit_limit_cents:
            return None
        return CreditSnapshot(
            account_id=account.id,
            account_name=account.name,
            balance_cents=account.balance_cents,
            credit_limit_cents=account.credit_limit_cents,
            utilization_basis_points=account.balance_cents * 10_000 // account.credit_limit_cents,
        )

    def _transfers_between(self, start: date, end: date) -> list[Transfer]:
        return sorted(
            (t for t in self._transfers.values() if start <= t.occurred_on <= end),
            key=lambda t: (t.occurred_on, t.id),
            reverse=True,
        )

    def _period(self, start: date, end: date) -> Period:
        try:
            name = describe_period(start, end, self.active_month)
        except ValueError as error:
            raise invalid(str(error)) from error
        return Period(
            start=start,
            end=end,
            label=name.label,
            phrase=name.phrase,
            single_month=name.single_month,
            month_count=len(name.months),
        )
