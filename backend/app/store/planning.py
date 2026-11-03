"""Budget plans: the smart budget from everything known, and the first-run setup."""

from datetime import date
from typing import Literal

from app.dashboard_models import (
    Bill,
    DashboardResponse,
    OnboardingAnswers,
    OnboardingApply,
    PaySchedule,
)
from app.domain.card_due import due_day_from
from app.domain.finance import add_months
from app.domain.smart_budget import CategoryBase, SmartPlan, smart_budget
from app.domain.starter_budget import StarterPlan, monthly_income_cents, starter_plan
from app.models import Account
from app.store.budgets import BudgetOps
from app.store.sections import following_due, monthly_equivalent_cents
from app.store.state import conflict, invalid, new_id

IncomeSource = Literal["stated", "pay", "history", "none"]
# Smart budgets trim these first when money is tight (app.domain.smart_budget).
WANT_CATEGORIES = frozenset({"cat-fun", "cat-eating-out"})
# Typical monthly student amounts, used when there's no spending history yet (as in setup).
TYPICAL_EVERYDAY_CENTS = {
    "cat-groceries": 25_000,
    "cat-eating-out": 10_000,
    "cat-transport": 4_000,
    "cat-fun": 8_000,
    "cat-health": 3_000,
    "cat-school": 2_000,
}


class PlanningOps(BudgetOps):
    def everyday_averages(self, month: date) -> tuple[dict[str, int], int]:
        """Average monthly everyday spending per top-level category over the 3 months before
        `month` that have activity (bill payments left out: they're the fixed budget), and
        how many months that was."""
        totals: dict[str, int] = {}
        months = 0
        for offset in range(1, 4):
            rows = self._monthly_transactions(add_months(month, -offset))
            if not rows:
                continue
            months += 1
            for t in rows:
                key = self._top_level(t.category_id)
                if t.kind == "spending" and not t.bill_id and key:
                    totals[key] = totals.get(key, 0) + t.amount_cents
        return ({key: value // months for key, value in totals.items()} if months else {}), months

    def smart_budget_plan(
        self, user_id: str, stated_income_cents: int | None = None
    ) -> tuple[SmartPlan, IncomeSource]:
        """A suggested budget from everything known (app.domain.smart_budget), and where the
        income figure came from: "stated" (given in chat), "pay" (every source of pay, even
        before any has arrived), "history" (what came in over recent months), or "none"."""
        with self._lock:
            self.require_owner(user_id)
            month = self.active_month
            pay = self._pay_overview()
            source: IncomeSource
            if stated_income_cents is not None:
                income, source = stated_income_cents, "stated"
            elif pay and pay.monthly_cents:
                income, source = pay.monthly_cents, "pay"
            elif typical := self._typical(month, "income"):
                income, source = typical, "history"
            else:
                income, source = 0, "none"
            averages, months = self.everyday_averages(month)
            spending_ids = {c.id for c in self._categories.values() if c.kind == "spending"}
            if months:
                bases = [
                    CategoryBase(key, cents, key in WANT_CATEGORIES, "history")
                    for key, cents in sorted(averages.items())
                    if key in spending_ids
                ]
            else:
                bases = [
                    CategoryBase(key, cents, key in WANT_CATEGORIES, "typical")
                    for key, cents in TYPICAL_EVERYDAY_CENTS.items()
                    if key in spending_ids
                ]
            goals_need = sum(
                goal.monthly_needed_cents or 0
                for goal in (self._goal(item) for item in self._goals.values())
                if goal.status == "active"
            )
            plan = smart_budget(income, self._recurring().fixed_monthly_cents, goals_need, bases)
            return plan, source

    # ------------------------------------------------------------------ first-run setup

    def _starter_plan(self, answers: OnboardingAnswers) -> StarterPlan:
        income = answers.income
        try:
            monthly = (
                monthly_income_cents(income.amount_cents, income.frequency, income.interval_days)
                if income
                else answers.monthly_money_cents or 0
            )
        except ValueError as error:
            raise invalid(str(error)) from error
        fixed: dict[str, int] = {}
        for bill in answers.bills:
            self._spending_category(bill.category_id)
            fixed[bill.category_id] = fixed.get(bill.category_id, 0) + monthly_equivalent_cents(
                bill.amount_cents, bill.frequency
            )
        for category_id in answers.everyday:
            self._spending_category(category_id)
        everyday = {key: value for key, value in answers.everyday.items() if value > 0}
        return starter_plan(monthly, fixed, everyday, answers.savings_basis_points)

    def starter_plan_for(self, user_id: str, answers: OnboardingAnswers) -> StarterPlan:
        """The proposed plan only; nothing is saved."""
        with self._lock:
            self.require_owner(user_id)
            return self._starter_plan(answers)

    def _check_onboarding(self, request: OnboardingApply) -> None:
        answers = request.answers
        for category_id in request.everyday_limits:
            self._spending_category(category_id)
        used = {item.account_id for item in self._transactions.values()}
        for account_id in answers.opening_balances:
            account = self._require_account(account_id)
            if account_id in used:
                raise invalid(
                    f"{account.name} already has transactions, so its balance comes from them"
                )
        for new in answers.new_accounts:
            if (new.account_type == "credit") != (new.credit_limit_cents is not None):
                raise invalid("Credit cards need a limit; other accounts can't have one")
            if new.payment_next_due and new.account_type != "credit":
                raise invalid("Only credit cards have a payment due date")
            if new.payment_next_due:
                try:
                    due_day_from(self.today(), new.payment_next_due)
                except ValueError as error:
                    raise invalid(f"{new.name}: {error}") from error
        income = answers.income
        if income and (income.frequency == "custom") != (income.interval_days is not None):
            raise invalid("Set the days between paydays only for a custom schedule")

    def apply_onboarding(self, user_id: str, request: OnboardingApply) -> DashboardResponse:
        """Saves the approved setup: balances, accounts, pay, bills, and this month's budgets."""
        with self._lock:
            self.require_owner(user_id)
            if not self._needs_onboarding():
                raise conflict("Your plan is already set up. Change it from Budgets and Settings.")
            answers = request.answers
            plan = self._starter_plan(answers)
            self._check_onboarding(request)

            self._profile = self._profile.model_copy(
                update={"spending_from": answers.spending_from}
            )
            for account_id, cents in answers.opening_balances.items():
                self._accounts[account_id] = self._accounts[account_id].model_copy(
                    update={"balance_cents": cents}
                )
            for new in answers.new_accounts:
                due_day, paid = (
                    due_day_from(self.today(), new.payment_next_due)
                    if new.payment_next_due
                    else (None, False)
                )
                account = Account(
                    id=new_id("acct", 10),
                    **new.model_dump(exclude={"payment_next_due"}),
                    payment_due_day=due_day,
                    card_paid_on=self.today() if paid else None,
                )
                self._accounts[account.id] = account
            # Pay and bills go to the first everyday account there is.
            home = next(
                (
                    account
                    for kind in ("chequing", "cash", "savings", "other", "investment")
                    for account in self._accounts.values()
                    if account.account_type == kind
                ),
                None,
            )
            income = answers.income
            if home is None and (income or answers.bills):
                raise invalid("Add a chequing or cash account for your pay and bills")
            if income and home:
                self._pay_schedules["pay-main"] = PaySchedule(
                    id="pay-main",
                    name="Paycheque",
                    amount_cents=income.amount_cents,
                    account_id=home.id,
                    frequency=income.frequency,
                    next_payday=income.next_payday,
                    interval_days=income.interval_days,
                )
            for item in answers.bills:
                if home:
                    bill = Bill(
                        id=new_id("bill", 10),
                        account_id=home.id,
                        auto_record=True,
                        **item.model_dump(exclude={"already_paid"}),
                    )
                    if item.already_paid and bill.next_due <= self.today():
                        # Setup's balances already include it: start from the next payment.
                        bill = self._caught_up(bill)
                        bill = bill.model_copy(
                            update={"last_paid_on": bill.next_due, "next_due": following_due(bill)}
                        )
                    self._bills[bill.id] = bill
            # Bills are the fixed part of the budget on their own; category budgets are only the
            # everyday (variable) amounts.
            for line in plan.lines:
                limit = request.everyday_limits.get(line.category_id, line.flexible_cents)
                if limit > 0:
                    self._add_budget(line.category_id, self.active_month, limit)
            return self._snapshot()
