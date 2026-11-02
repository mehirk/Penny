"""Month-by-month reports over a range: the Charts tab and the history Penny AI compares against."""

from datetime import date

from app.dashboard_models import (
    ChartAccount,
    ChartCategory,
    ChartCategoryAmount,
    ChartMonth,
    ChartsResponse,
    HistoryMonth,
    HistoryResponse,
    HistoryTotals,
)
from app.domain.chart_series import AccountTotals, ChartTransaction, build_series
from app.domain.chart_series import Filters as ChartFilters
from app.domain.finance import (
    TransactionAmount,
    TransactionKind,
    add_months,
    average_cents,
    build_summary,
)
from app.models import Transaction
from app.store.state import StoreState, invalid, month_start

MAX_HISTORY_MONTHS = 24


def _months(start: date, end: date, too_long: str) -> list[date]:
    """The first of every month from start to end, at most MAX_HISTORY_MONTHS."""
    start, end = month_start(start), month_start(end)
    if start > end:
        raise invalid("start must not be after end")
    months = [start]
    while months[-1] < end:
        months.append(add_months(months[-1], 1))
        if len(months) > MAX_HISTORY_MONTHS:
            raise invalid(too_long)
    return months


class ReportViews(StoreState):
    def charts_for_user(
        self,
        user_id: str,
        start: date,
        end: date,
        account_ids: frozenset[str] = frozenset(),
        category_ids: frozenset[str] = frozenset(),
    ) -> ChartsResponse:
        """Month-by-month figures for the Charts tab (app.domain.chart_series), filtered."""
        self.require_owner(user_id)
        months = _months(start, end, f"Charts cover up to {MAX_HISTORY_MONTHS} months at a time")
        start, end = months[0], months[-1]
        with self._lock:
            series = build_series(
                (
                    ChartTransaction(
                        occurred_on=item.occurred_on,
                        amount_cents=item.amount_cents,
                        kind=item.kind,
                        account_id=item.account_id,
                        category_id=self._top_level(item.category_id),
                        necessity=self._with_necessity(item).necessity,
                    )
                    for item in self._transactions.values()
                    if start <= month_start(item.occurred_on) <= end
                ),
                months,
                ChartFilters(account_ids=account_ids, category_ids=category_ids),
            )

            def budget(month: date) -> int:
                return sum(
                    item["limit_cents"]
                    for item in self._monthly_budgets(month)
                    if not category_ids or self._top_level(item["category_id"]) in category_ids
                )

            names = {c.id: c.name for c in self._categories.values()}
            total = series.spending_cents
            chart_months = [
                ChartMonth(
                    month=row.month,
                    income_cents=row.income_cents,
                    spending_cents=row.spending_cents,
                    net_cents=row.net_cents,
                    budget_cents=budget(row.month),
                    needs_cents=row.needs_cents,
                    wants_cents=row.wants_cents,
                    categories=[
                        ChartCategoryAmount(category_id=key, spent_cents=cents)
                        for key, cents in row.by_category.items()
                    ],
                )
                for row in series.months
            ]
            return ChartsResponse(
                start=start,
                end=end,
                months=chart_months,
                categories=[
                    ChartCategory(
                        category_id=key,
                        category_name=names.get(key, "Uncategorized") if key else "Uncategorized",
                        spent_cents=cents,
                        share_basis_points=cents * 10_000 // total if total else 0,
                    )
                    for key, cents in series.categories
                ],
                accounts=[self._chart_account(item) for item in series.accounts],
                income_cents=series.income_cents,
                spending_cents=series.spending_cents,
                net_cents=series.income_cents - series.spending_cents,
                budget_cents=sum(m.budget_cents for m in chart_months),
                average_spending_cents=series.average_spending_cents,
                data_months=self._data_months(),
            )

    def _chart_account(self, item: AccountTotals) -> ChartAccount:
        account = self._accounts.get(item.account_id)
        return ChartAccount(
            account_id=item.account_id,
            account_name=account.name if account else "Removed account",
            account_type=account.account_type if account else "other",
            income_cents=item.income_cents,
            spending_cents=item.spending_cents,
        )

    def history_for_user(self, user_id: str, start: date, end: date) -> HistoryResponse:
        """Monthly totals and category spending for a range of months."""
        self.require_owner(user_id)
        months = _months(
            start, end, f"History is limited to {MAX_HISTORY_MONTHS} months per request"
        )
        with self._lock:
            rows = []
            in_range: list[Transaction] = []
            for month in months:
                monthly = self._monthly_transactions(month)
                in_range.extend(monthly)
                summary = build_summary(
                    [TransactionAmount(t.amount_cents, TransactionKind(t.kind)) for t in monthly], 0
                )
                rows.append(
                    HistoryMonth(
                        month=month,
                        income_cents=summary.income_cents,
                        spending_cents=summary.spending_cents,
                        cash_flow_cents=summary.cash_flow_cents,
                        budget_cents=sum(
                            item["limit_cents"] for item in self._monthly_budgets(month)
                        ),
                        transaction_count=len(monthly),
                    )
                )
            _, categories = self._category_breakdown(in_range)
            income = sum(row.income_cents for row in rows)
            spending = sum(row.spending_cents for row in rows)
            active = sum(1 for row in rows if row.transaction_count)
            return HistoryResponse(
                start=months[0],
                end=months[-1],
                months=rows,
                totals=HistoryTotals(
                    income_cents=income,
                    spending_cents=spending,
                    cash_flow_cents=income - spending,
                    months_with_activity=active,
                    average_spending_cents=average_cents(spending, active),
                ),
                categories=categories,
                data_months=self._data_months(),
            )
