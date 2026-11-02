"""Builders for sections of the dashboard snapshot. Pure functions over plain store data."""

import calendar
from collections.abc import Callable, Iterable, Sequence
from datetime import date, timedelta

from app.dashboard_models import (
    AccountBalance,
    AccountGoal,
    AccountsOverview,
    Bill,
    Goal,
    MoneyCalendar,
    MoneyStreaks,
    RecurringExpense,
    RecurringMonth,
    RecurringPayment,
    RecurringSuggestion,
    RecurringSummary,
    UpcomingPayment,
)
from app.domain.categorize import necessity
from app.domain.money_days import DayInput, DayScore, daily_allowance_cents, score_days, streaks
from app.domain.recurring import RecurringSeries, detect_fixed_series, next_due, series_key
from app.models import Account, Transaction

# ------------------------------------------------------------------ recurring expenses

_SUBSCRIPTION_WORDS = ("subscription", "streaming", "netflix", "spotify", "disney", "membership")


def monthly_equivalent_cents(amount_cents: int, frequency: str) -> int:
    """What a bill costs per month on average, floored to the cent."""
    per_year = {"weekly": 52, "biweekly": 26, "monthly": 12, "yearly": 1}[frequency]
    return amount_cents * per_year // 12


def next_due_after(due: date, frequency: str, day: int | None = None) -> date:
    """The payment after one due on `due`. Monthly and yearly bills land on `day` (default:
    the same day), or the month's last day when it's shorter."""
    if frequency == "weekly":
        return due + timedelta(days=7)
    if frequency == "biweekly":
        return due + timedelta(days=14)
    months = 12 if frequency == "yearly" else 1
    index = due.year * 12 + due.month - 1 + months
    year, month = index // 12, index % 12 + 1
    return date(year, month, min(day or due.day, calendar.monthrange(year, month)[1]))


def following_due(bill: Bill) -> date:
    """When the payment after the next one is due. A payment moved just this once doesn't move
    the schedule: it carries on from the date it would usually have been due."""
    return next_due_after(bill.usual_due or bill.next_due, bill.frequency, bill.due_day)


def bill_due_dates(bill: Bill, start: date, end: date) -> list[date]:
    """Due dates of an unpaid bill from its next due date through `end`."""
    dates = []
    due = bill.next_due
    usual = bill.usual_due or bill.next_due
    while due <= end:
        if due >= start:
            dates.append(due)
        usual = next_due_after(usual, bill.frequency, bill.due_day)
        due = usual
    return dates


UPCOMING_DAYS = 30
RECENT_PAYMENTS = 10


def build_recurring(
    bills: Sequence[Bill],
    transactions: Sequence[Transaction],
    category_names: dict[str, str],
    active_month: date,
    today: date,
    typical_income_cents: int,
) -> RecurringSummary:
    items = []
    paid: dict[str, list[Transaction]] = {}
    for transaction in transactions:
        if transaction.bill_id and transaction.occurred_on <= today:
            paid.setdefault(transaction.bill_id, []).append(transaction)
    in_month = lambda day: (day.year, day.month) == (active_month.year, active_month.month)  # noqa: E731
    month_end = active_month.replace(
        day=calendar.monthrange(active_month.year, active_month.month)[1]
    )
    for bill in bills:
        history = sorted(paid.get(bill.id, []), key=lambda t: t.occurred_on)
        last = history[-1] if history else None
        days = (bill.next_due - today).days
        # Non-essential repeating charges (streaming, memberships) read as subscriptions.
        is_subscription = necessity(bill.name, bill.category_id) == "want" or any(
            word in bill.name.casefold() for word in _SUBSCRIPTION_WORDS
        )
        items.append(
            RecurringExpense(
                id=bill.id,
                name=bill.name,
                category_name=category_names.get(bill.category_id) if bill.category_id else None,
                amount_cents=bill.amount_cents,
                monthly_cents=monthly_equivalent_cents(bill.amount_cents, bill.frequency),
                frequency=bill.frequency,
                next_due=bill.next_due,
                days_until_due=days,
                kind="subscription" if is_subscription else "bill",
                auto_record=bill.auto_record,
                last_paid_on=last.occurred_on if last else bill.last_paid_on,
                payment_count=len(history),
                total_paid_cents=sum(t.amount_cents for t in history),
                paid_this_month=any(in_month(t.occurred_on) for t in history),
                status="overdue" if days < 0 else "due_soon" if days <= 7 else "later",
            )
        )
    items.sort(key=lambda item: item.next_due)
    known = {series_key(bill.name) for bill in bills}
    known_amounts = {bill.amount_cents for bill in bills}
    suggestions = [
        RecurringSuggestion(
            name=series.name,
            category_id=series.category_id,
            amount_cents=series.amount_cents,
            next_due=next_due(series, today),
        )
        for series in detect_fixed_series(transactions, active_month)
        if series.key not in known and series.amount_cents not in known_amounts
    ]
    kinds = {item.id: item.kind for item in items}

    def due_dates(start: Callable[[Bill], date], end: date) -> list[UpcomingPayment]:
        """Every due date of every bill from `start(bill)` through `end`, soonest first."""
        return sorted(
            (
                UpcomingPayment(
                    bill_id=bill.id,
                    name=bill.name,
                    due_on=due,
                    days_until_due=(due - today).days,
                    amount_cents=bill.amount_cents,
                    auto_record=bill.auto_record,
                    kind=kinds[bill.id],
                )
                for bill in bills
                for due in bill_due_dates(bill, start(bill), end)
            ),
            key=lambda item: (item.due_on, item.name),
        )

    upcoming = due_dates(lambda _: today, today + timedelta(days=UPCOMING_DAYS))
    month_payments = [t for rows in paid.values() for t in rows if in_month(t.occurred_on)]
    left = [(bill, due) for bill in bills for due in bill_due_dates(bill, today, month_end)]
    overdue = [bill for bill in bills if bill.next_due < today]
    recent = sorted(
        (t for rows in paid.values() for t in rows), key=lambda t: t.occurred_on, reverse=True
    )[:RECENT_PAYMENTS]
    names = {bill.id: bill.name for bill in bills}
    fixed = sum(item.monthly_cents for item in items)
    subscriptions = sum(item.monthly_cents for item in items if item.kind == "subscription")
    # Unpaid bills (overdue ones too) through the end of this month: the month's budget has to
    # cover them. A paid bill has moved on to its next due date, so it isn't counted again.
    reserve_end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    unpaid = due_dates(lambda bill: bill.next_due, reserve_end)
    return RecurringSummary(
        items=items,
        bill_count=sum(1 for item in items if item.kind == "bill"),
        subscription_count=sum(1 for item in items if item.kind == "subscription"),
        this_month=RecurringMonth(
            paid_count=len(month_payments),
            paid_cents=sum(t.amount_cents for t in month_payments),
            left_count=len(left),
            left_cents=sum(bill.amount_cents for bill, _ in left),
            overdue_count=len(overdue),
            overdue_cents=sum(bill.amount_cents for bill in overdue),
        ),
        upcoming=upcoming,
        recent_payments=[
            RecurringPayment(
                bill_id=t.bill_id or "",
                name=names.get(t.bill_id or "", t.description),
                occurred_on=t.occurred_on,
                amount_cents=t.amount_cents,
                paid_automatically=t.paid_automatically,
            )
            for t in recent
        ],
        suggestions=suggestions,
        fixed_monthly_cents=fixed,
        subscriptions_monthly_cents=subscriptions,
        unpaid_bills_cents=sum(item.amount_cents for item in unpaid),
        unpaid=unpaid,
        share_of_income_basis_points=(
            fixed * 10_000 // typical_income_cents if typical_income_cents > 0 else None
        ),
        methodology=(
            "Your fixed monthly total adds up every scheduled bill at its monthly cost (weekly "
            "bills × 52 ÷ 12, yearly ÷ 12). Suggestions come from charges that repeated in at "
            "least 3 of the last 4 months at the same amount."
        ),
    )


# ------------------------------------------------------------------ daily money score

MONEY_SCORE_METHODOLOGY = (
    "Each day scores 0-100 from flexible spending only; fixed bills are excluded. Up to 60 points "
    "for month-to-date pace against your flexible budget (full points at or under 90% of pace), "
    "and up to 40 for the day itself (40 for a no-spend day, falling as spending passes 1x, 2x, "
    "and 3x your daily allowance). Green is 67+, yellow 34-66, red 33 or less."
)


def score_month(
    month: date,
    transactions: Sequence[Transaction],
    fixed: Sequence[RecurringSeries],
    flexible_budget: int,
    through_day: int,
) -> list[DayScore]:
    fixed_keys = {item.key for item in fixed}
    days_in_month = calendar.monthrange(month.year, month.month)[1]
    inputs = []
    for day in range(1, through_day + 1):
        on_day = [t for t in transactions if t.occurred_on == month.replace(day=day)]
        spending = [t for t in on_day if t.kind == "spending"]
        flexible = [t for t in spending if series_key(t.description) not in fixed_keys]
        inputs.append(
            DayInput(
                day=day,
                flexible_spent_cents=sum(t.amount_cents for t in flexible),
                total_spent_cents=sum(t.amount_cents for t in spending),
                income_cents=sum(t.amount_cents for t in on_day if t.kind == "income"),
            )
        )
    return score_days(inputs, flexible_budget, days_in_month)


def build_calendar(
    month: date,
    today: date | None,
    scores: Sequence[DayScore],
    history: Sequence[DayScore],
    flexible_budget: int,
) -> MoneyCalendar:
    """Today's Money Score and the streaks; `history` adds the months before for streaks."""
    days_in_month = calendar.monthrange(month.year, month.month)[1]
    latest = scores[-1] if scores and today else None
    summary = streaks(history, scores)
    return MoneyCalendar(
        today=today,
        today_score=latest.score if latest else None,
        today_zone=latest.zone if latest else None,
        daily_allowance_cents=daily_allowance_cents(flexible_budget, days_in_month),
        streaks=MoneyStreaks(
            current_green=summary.current_green,
            best_green=summary.best_green,
            no_spend_days=summary.no_spend_days,
            green_days=summary.green_days,
            scored_days=summary.scored_days,
        ),
        methodology=MONEY_SCORE_METHODOLOGY,
    )


# ------------------------------------------------------------------ accounts

# Account types whose balance is money you can spend day to day.
SPENDABLE_TYPES = ("chequing", "cash")


def build_accounts_overview(
    accounts: Sequence[Account],
    goals: Sequence[Goal],
    transactions: Iterable[Transaction],
    month: date,
    today: date,
) -> AccountsOverview:
    """Each account's balance, goal money, and this month's flow, plus the totals they add to.

    Net worth = everything in non-credit accounts − what's owed on credit cards.
    """
    flows: dict[str, list[int]] = {account.id: [0, 0] for account in accounts}
    last: dict[str, date] = {}
    for item in transactions:
        if item.account_id not in flows or item.occurred_on > today:
            continue
        if (item.occurred_on.year, item.occurred_on.month) == (month.year, month.month):
            flows[item.account_id][0 if item.kind == "income" else 1] += item.amount_cents
        if item.account_id not in last or item.occurred_on > last[item.account_id]:
            last[item.account_id] = item.occurred_on
    rows = []
    shortfall = 0
    for account in accounts:
        credit = account.account_type == "credit"
        held = [g for g in goals if g.account_id == account.id and g.current_cents > 0]
        claimed = sum(g.current_cents for g in held)
        goal_cents = 0 if credit else min(claimed, max(0, account.balance_cents))
        shortfall += 0 if credit else claimed - goal_cents
        limit = account.credit_limit_cents if credit else None
        rows.append(
            AccountBalance(
                id=account.id,
                name=account.name,
                account_type=account.account_type,
                balance_cents=account.balance_cents,
                net_cents=-account.balance_cents if credit else account.balance_cents,
                credit_limit_cents=limit,
                available_credit_cents=max(0, limit - account.balance_cents) if limit else None,
                utilization_basis_points=(
                    account.balance_cents * 10_000 // limit if limit else None
                ),
                goals=[
                    AccountGoal(id=g.id, name=g.name, current_cents=g.current_cents) for g in held
                ],
                goal_cents=goal_cents,
                free_cents=None if credit else account.balance_cents - goal_cents,
                money_in_cents=flows[account.id][0],
                money_out_cents=flows[account.id][1],
                last_activity_on=last.get(account.id),
            )
        )

    def total(*types: str) -> int:
        return sum(a.balance_cents for a in accounts if a.account_type in types)

    assets = sum(a.balance_cents for a in accounts if a.account_type != "credit")
    owed = total("credit")
    return AccountsOverview(
        accounts=rows,
        spending_cents=total(*SPENDABLE_TYPES),
        savings_cents=total("savings"),
        assets_cents=assets,
        owed_cents=owed,
        net_worth_cents=assets - owed,
        goal_cents=sum(row.goal_cents for row in rows),
        goal_shortfall_cents=shortfall,
    )
