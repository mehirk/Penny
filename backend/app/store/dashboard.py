"""The dashboard snapshot: everything the app shows for one month or a custom period."""

from collections.abc import Iterable
from dataclasses import asdict
from datetime import date, timedelta
from typing import Any

from app.dashboard_models import (
    DashboardResponse,
    DashboardTotals,
    MonthlyBudget,
    SafeToSpendBreakdown,
    SpendingClassification,
    SpendingRunway,
)
from app.domain.finance import (
    TransactionAmount,
    TransactionKind,
    add_months,
    build_summary,
    share_basis_points,
)
from app.domain.periods import month_end, months_between
from app.domain.runway import runway, safe_to_spend
from app.models import Transaction
from app.store.insights import StoreInsights
from app.store.sections import build_accounts_overview
from app.store.state import invalid, month_start


def _amounts(rows: list[Transaction]) -> list[TransactionAmount]:
    return [TransactionAmount(t.amount_cents, TransactionKind(t.kind)) for t in rows]


def _classification(rows: list[Transaction]) -> SpendingClassification:
    needs = sum(t.amount_cents for t in rows if t.necessity == "need")
    wants = sum(t.amount_cents for t in rows if t.necessity == "want")
    return SpendingClassification(
        needs_cents=needs,
        wants_cents=wants,
        needs_basis_points=share_basis_points(needs, needs + wants),
        wants_basis_points=share_basis_points(wants, needs + wants),
    )


def _newest_first(rows: Iterable[Transaction]) -> list[Transaction]:
    """Newest date first; on the same day, the one recorded last first. The store keeps
    transactions in the order they were recorded, and the sort keeps ties in input order."""
    return sorted(reversed(list(rows)), key=lambda item: item.occurred_on, reverse=True)


def _savings_rate(cash_flow_cents: int, income_cents: int) -> int:
    return cash_flow_cents * 10_000 // income_cents if income_cents else 0


class DashboardViews(StoreInsights):
    def dashboard_for_user(self, user_id: str, month: date | None = None) -> DashboardResponse:
        self.require_owner(user_id)
        with self._lock:
            self._auto_record_due_bills()
        if month and month_start(month) > self.active_month:
            raise invalid("That month is in the future")
        return self._snapshot(month)

    def dashboard_for_range(self, user_id: str, start: date, end: date) -> DashboardResponse:
        """A snapshot whose spending figures cover [start, end]; balances stay as of today."""
        period = self._period(start, end)
        if end > month_end(self.active_month):
            raise invalid("That period is in the future")
        if period.single_month:
            return self.dashboard_for_user(user_id, start)
        base = self.dashboard_for_user(user_id, month_start(end))
        with self._lock:
            rows = self._flag_unusual(
                _newest_first(
                    self._with_necessity(t)
                    for t in self._transactions.values()
                    if start <= t.occurred_on <= end
                )
            )
            # A month only partly inside the period counts for its share of days (floored).
            month_budgets = [
                {**b, "limit_cents": b["limit_cents"] * overlap // month_end(m).day}
                for m in months_between(start, end)
                for b in self._monthly_budgets(m)
                if (overlap := (min(end, month_end(m)) - max(start, m)).days + 1)
            ]
            variable_rows = [t for t in rows if not self._is_bill_payment(t)]
            plan = self._budget_plan(
                self._fixed_costs(
                    start, end, rows, {item.id: item.kind for item in base.recurring.items}
                ),
                sum(item["limit_cents"] for item in month_budgets),
            )
            summary = build_summary(_amounts(rows), plan.total_cents)
            _, breakdown = self._category_breakdown(rows)
            spending_by_category, _ = self._category_breakdown(variable_rows)
            length = (end - start).days + 1
            previous_spending = sum(
                t.amount_cents
                for t in self._transactions.values()
                if t.kind == "spending" and start - timedelta(days=length) <= t.occurred_on < start
            )
            return base.model_copy(
                update={
                    "period": period,
                    "transactions": rows,
                    "budgets": self._combined_budgets(
                        month_budgets, variable_rows, spending_by_category, start
                    ),
                    "budget_plan": plan,
                    "category_spending": breakdown,
                    "spending_classification": _classification(rows),
                    "totals": DashboardTotals(
                        **asdict(summary),
                        total_budget_cents=plan.total_cents,
                        savings_rate_basis_points=_savings_rate(
                            summary.cash_flow_cents, summary.income_cents
                        ),
                    ),
                    "home": base.home.model_copy(
                        update={
                            "spending_change_basis_points": (
                                (summary.spending_cents - previous_spending)
                                * 10_000
                                // previous_spending
                                if previous_spending
                                else None
                            ),
                        }
                    ),
                }
            )

    def _snapshot(self, month: date | None = None) -> DashboardResponse:
        with self._lock:
            month = month_start(month or self.active_month)
            today = self.today()
            monthly = _newest_first(self._monthly_transactions(month))
            # Category budgets are the variable part; recurring bills are measured separately.
            variable_rows = [item for item in monthly if not self._is_bill_payment(item)]
            _, breakdown = self._category_breakdown(monthly)
            spending_by_category, _ = self._category_breakdown(variable_rows)
            exact: dict[str | None, int] = {}
            for item in variable_rows:
                if item.kind == "spending":
                    exact[item.category_id] = exact.get(item.category_id, 0) + item.amount_cents
            monthly_budgets, carried = self._budgets_shown(month)
            recurring = self._recurring()
            fixed_costs = self._fixed_costs(
                month, month_end(month), monthly, {item.id: item.kind for item in recurring.items}
            )
            plan = self._budget_plan(
                fixed_costs, sum(item["limit_cents"] for item in monthly_budgets)
            )
            summary = build_summary(_amounts(monthly), plan.total_cents)
            budgets = []
            for item in monthly_budgets:
                category = self._categories[item["category_id"]]
                # A parent budget covers its subcategories; a subcategory budget only itself.
                spent = (
                    exact.get(category.id, 0)
                    if category.parent_id
                    else spending_by_category.get(category.id, 0)
                )
                budgets.append(
                    MonthlyBudget(
                        **item,
                        category_name=category.name,
                        spent_cents=spent,
                        remaining_cents=item["limit_cents"] - spent,
                        usage_basis_points=(spent * 10_000 // item["limit_cents"])
                        if item["limit_cents"]
                        else 0,
                        carried_over=carried,
                    )
                )
            goals = [self._goal(item) for item in self._goals.values()]
            monthly = self._flag_unusual([self._with_necessity(item) for item in monthly])
            previous = self._monthly_transactions(add_months(month, -1))
            calendar_view = self._money_calendar(month)
            safe = safe_to_spend(
                plan.fixed_cents,
                plan.variable_cents,
                summary.spending_cents,
                sum(line.due_cents for line in fixed_costs),
            )
            return DashboardResponse(
                active_month=month,
                period=self._period(month, month_end(month)),
                current_month=self.active_month,
                data_months=self._data_months(),
                profile=self._profile,
                accounts=list(self._accounts.values()),
                categories=list(self._categories.values()),
                transactions=monthly,
                budgets=sorted(budgets, key=lambda item: item.category_name),
                savings_goals=goals,
                missions=self._missions,
                xp_total=self._mission_xp() + self._learner.lesson_xp(),
                category_spending=breakdown,
                credit=self._credit_snapshot(next(iter(self._accounts_of("credit")), None)),
                financial_health=self._financial_health(
                    month, summary.spending_cents, plan.total_cents, summary.cash_flow_cents
                ),
                money_calendar=calendar_view,
                recurring=recurring,
                spending_classification=_classification(monthly),
                bills=sorted(self._bills.values(), key=lambda item: item.next_due),
                pay=self._pay_overview(),
                home=self._home(),
                accounts_overview=build_accounts_overview(
                    list(self._accounts.values()),
                    goals,
                    self._transactions.values(),
                    self.active_month,
                    today,
                ),
                previous_month_cash_flow_cents=(
                    sum(t.amount_cents if t.kind == "income" else -t.amount_cents for t in previous)
                    if previous
                    else None
                ),
                spending_power_cents=safe.safe_cents,
                safe_to_spend=SafeToSpendBreakdown(**asdict(safe), has_budget=plan.total_cents > 0),
                card_payments=self._card_payments(),
                budget_plan=plan,
                cash_warnings=self._cash_warnings(recurring) if month == month_start(today) else [],
                transfers=self._transfers_between(month, month_end(month)),
                needs_onboarding=self._needs_onboarding(),
                spending_runway=(
                    SpendingRunway(
                        **asdict(
                            runway(
                                safe.safe_cents,
                                today,
                                None,  # a monthly budget lasts until month end, not payday
                                month_end(month),
                                calendar_view.daily_allowance_cents,
                            )
                        )
                    )
                    if month <= today <= month_end(month)
                    else None
                ),
                totals=DashboardTotals(
                    **asdict(summary),
                    total_budget_cents=plan.total_cents,
                    savings_rate_basis_points=_savings_rate(
                        summary.cash_flow_cents, summary.income_cents
                    ),
                ),
            )

    def _budgets_shown(self, month: date) -> tuple[list[dict[str, Any]], bool]:
        """The month's budgets, and whether they're carried over: the current month shows last
        budgeted month's limits until it has budgets of its own."""
        budgets = self._monthly_budgets(month)
        if budgets or month != self.active_month:
            return budgets, False
        previous = max(
            (b["month_start"] for b in self._budgets.values() if b["month_start"] < month),
            default=None,
        )
        carried = [
            {**item, "id": f"carry-{item['id']}", "month_start": month}
            for item in (self._monthly_budgets(previous) if previous else [])
        ]
        return carried, True

    def _combined_budgets(
        self,
        month_budgets: list[dict[str, Any]],
        rows: list[Transaction],
        spending_by_category: dict[str | None, int],
        start: date,
    ) -> list[MonthlyBudget]:
        """One row per category, limits summed across the months in the period."""
        limits: dict[str, int] = {}
        for item in month_budgets:
            limits[item["category_id"]] = limits.get(item["category_id"], 0) + item["limit_cents"]
        combined = []
        for category_id, limit in limits.items():
            category = self._categories[category_id]
            spent = (
                sum(
                    t.amount_cents
                    for t in rows
                    if t.kind == "spending" and t.category_id == category_id
                )
                if category.parent_id
                else spending_by_category.get(category_id, 0)
            )
            combined.append(
                MonthlyBudget(
                    id=f"period-{category_id}",
                    category_id=category_id,
                    category_name=category.name,
                    month_start=start.replace(day=1),
                    limit_cents=limit,
                    spent_cents=spent,
                    remaining_cents=limit - spent,
                    usage_basis_points=spent * 10_000 // limit if limit else 0,
                )
            )
        return sorted(combined, key=lambda item: item.category_name)
