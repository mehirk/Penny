"""Sources of pay, and where spendable money is heading before the next payday."""

from dataclasses import dataclass
from datetime import date, timedelta

from app.dashboard_models import (
    DashboardResponse,
    PaydayPlanView,
    PayReceivedWrite,
    PaySchedule,
    PayScheduleWrite,
    PlanCard,
    PlanDue,
    PlanSave,
)
from app.domain.finance import format_cad
from app.domain.pay_cycle import DayBalance, Event, cycles_around, forecast
from app.domain.payday_plan import (
    SAVE_BASIS_POINTS,
    WINDFALL_MIN_BASIS_POINTS,
    WINDFALL_MIN_CENTS,
    WINDFALL_WORK_BASIS_POINTS,
    plan_payday,
)
from app.models import Transaction
from app.store.dashboard import DashboardViews
from app.store.sections import SPENDABLE_TYPES, bill_due_dates
from app.store.state import conflict, invalid, new_id, not_found

MAX_PAY_SCHEDULES = 8
# Without a pay schedule, the payday check-in looks this far ahead.
PLAN_DAYS_WITHOUT_PAY = 30


@dataclass(frozen=True, slots=True)
class PayCycleOutlook:
    """Spendable balances over one pay cycle, with paydays added and bills taken off."""

    days: list[DayBalance]
    next_payday: date
    days_until_payday: int
    starting_cents: int
    ending_cents: int
    lowest_day: date
    lowest_cents: int


class PayOps(DashboardViews):
    def _check_pay(self, request: PayScheduleWrite) -> None:
        self._require_account(request.account_id)
        if (request.frequency == "custom") != (request.interval_days is not None):
            raise invalid("Set interval_days only for a custom pay schedule")

    def add_pay_schedule(self, user_id: str, request: PayScheduleWrite) -> DashboardResponse:
        """Adds a source of pay (a job, a scholarship, an allowance); people can have several."""
        with self._lock:
            self.require_owner(user_id)
            self._check_pay(request)
            if len(self._pay_schedules) >= MAX_PAY_SCHEDULES:
                raise invalid(f"You can add up to {MAX_PAY_SCHEDULES} sources of pay")
            schedule = PaySchedule(id=new_id("pay", 10), **request.model_dump())
            self._pay_schedules[schedule.id] = schedule
            return self._snapshot()

    def update_pay_schedule(
        self, user_id: str, pay_id: str, request: PayScheduleWrite
    ) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if pay_id not in self._pay_schedules:
                raise not_found("Pay not found")
            self._check_pay(request)
            self._pay_schedules[pay_id] = PaySchedule(id=pay_id, **request.model_dump())
            return self._snapshot()

    def delete_pay_schedule(self, user_id: str, pay_id: str) -> DashboardResponse:
        with self._lock:
            self.require_owner(user_id)
            if self._pay_schedules.pop(pay_id, None) is None:
                raise not_found("Pay not found")
            return self._snapshot()

    def record_pay(self, user_id: str, pay_id: str, request: PayReceivedWrite) -> DashboardResponse:
        """ "I got paid": the paycheque goes in as income on the account the pay lands in,
        linked to its source so that payday shows as received."""
        with self._lock:
            self.require_owner(user_id)
            schedule = self._pay_schedules.get(pay_id)
            if not schedule:
                raise not_found("Pay not found")
            if request.occurred_on > self.today():
                raise invalid("You can only mark pay you've already received")
            category_id = next(
                (
                    c.id
                    for c in self._categories.values()
                    if c.kind == "income" and c.name.casefold() == "paycheque"
                ),
                None,
            )
            transaction = Transaction(
                id=new_id("tx"),
                description=schedule.name,
                category=self._category_name(category_id),
                account_id=schedule.account_id,
                category_id=category_id,
                amount_cents=request.amount_cents,
                kind="income",
                occurred_on=request.occurred_on,
                pay_id=schedule.id,
                history_only=not request.affect_balance,
            )
            self._apply_account_effect(transaction, 1, allow_overdraft=True)
            self._transactions[transaction.id] = transaction
            return self._snapshot()

    def _due_before_next_payday(self) -> tuple[date | None, date, list[PlanDue]]:
        """The main pay's next payday (None without pay), the day the window ends (that payday,
        or 30 days out), and the bills on chequing or cash and card payments due before it,
        overdue ones included, soonest first."""
        today = self.today()
        main = self._main_pay()
        next_payday = (
            next(
                iter(
                    self._upcoming_paydays(
                        main, today + timedelta(days=1), today + timedelta(days=400)
                    )
                ),
                None,
            )
            if main
            else None
        )
        until = next_payday or today + timedelta(days=PLAN_DAYS_WITHOUT_PAY)
        last_day = until - timedelta(days=1)
        spendable = {item.id for item in self._accounts_of(*SPENDABLE_TYPES)}
        due = [
            PlanDue(name=bill.name, due_on=day, amount_cents=bill.amount_cents, kind="bill")
            for bill in self._bills.values()
            if bill.account_id in spendable
            for day in bill_due_dates(bill, bill.next_due, last_day)
        ]
        due += [
            PlanDue(
                name=f"{card.account_name} payment",
                due_on=card.due_on,
                amount_cents=card.owed_cents,
                kind="card",
            )
            for card in self._card_payments()
            if card.due_on <= last_day and card.owed_cents > 0
        ]
        due.sort(key=lambda item: (item.due_on, item.name))
        return next_payday, until, due

    def due_before_next_payday(self, user_id: str) -> list[PlanDue]:
        """What Penny AI counts as "bills before payday" (the same as the payday check-in)."""
        with self._lock:
            self.require_owner(user_id)
            return self._due_before_next_payday()[2]

    def payday_plan(self, user_id: str, amount_cents: int, pay_id: str | None) -> PaydayPlanView:
        """The payday check-in for money that just came in: a paycheque from `pay_id`, or money
        that isn't pay (a bonus, a gift) when it's None. Suggestions only; nothing changes."""
        with self._lock:
            self.require_owner(user_id)
            schedule = self._pay_schedules.get(pay_id) if pay_id else None
            if pay_id and not schedule:
                raise not_found("Pay not found")
            next_payday, until, due = self._due_before_next_payday()
            last_day = until - timedelta(days=1)
            spendable = {item.id for item in self._accounts_of(*SPENDABLE_TYPES)}
            due_cards = {
                card.account_id for card in self._card_payments() if card.due_on <= last_day
            }
            card = max(
                (
                    account
                    for account in self._accounts_of("credit")
                    if account.balance_cents > 0 and account.id not in due_cards
                ),
                key=lambda account: (account.balance_cents, account.name),
                default=None,
            )
            goal = min(
                (
                    item
                    for item in self._goals.values()
                    if item["status"] == "active" and item["current_cents"] < item["target_cents"]
                ),
                key=lambda item: (
                    item["target_date"] is None,
                    item["target_date"] or date.max,
                    item["name"],
                ),
                default=None,
            )
            source_id = (
                schedule.account_id
                if schedule and schedule.account_id in spendable
                else self._default_source()
            )
            usual = schedule.amount_cents if schedule else 0
            spendable_cents = self._spendable_cents()
            due_cents = sum(item.amount_cents for item in due)
            plan = plan_payday(
                amount_cents=amount_cents,
                usual_cents=usual,
                spendable_cents=spendable_cents,
                due_cents=due_cents,
                card_owed_cents=card.balance_cents if card else 0,
                goal_left_cents=goal["target_cents"] - goal["current_cents"] if goal else None,
            )
            return PaydayPlanView(
                amount_cents=amount_cents,
                usual_cents=usual,
                extra_cents=plan.extra_cents,
                windfall=plan.windfall,
                next_payday=next_payday,
                until=until,
                from_account_id=source_id,
                from_account_name=self._accounts[source_id].name,
                spendable_cents=spendable_cents,
                due=due,
                due_cents=due_cents,
                short_cents=plan.short_cents,
                card=(
                    PlanCard(
                        account_id=card.id,
                        account_name=card.name,
                        owed_cents=card.balance_cents,
                        amount_cents=plan.card_cents,
                    )
                    if card and plan.card_cents
                    else None
                ),
                save=(
                    PlanSave(
                        goal_id=goal["id"] if goal else None,
                        goal_name=goal["name"] if goal else None,
                        amount_cents=plan.save_cents,
                    )
                    if plan.save_cents
                    else None
                ),
                yours_cents=plan.yours_cents,
                methodology=(
                    "First, everything due before your next payday stays put: bills and card "
                    "payments paid from chequing or cash. From what's left, Penny suggests "
                    f"saving {SAVE_BASIS_POINTS // 100}% of a usual paycheque. Money at least "
                    f"{format_cad(WINDFALL_MIN_CENTS)} and {WINDFALL_MIN_BASIS_POINTS // 100}% "
                    "above the usual is a windfall: "
                    f"{WINDFALL_WORK_BASIS_POINTS // 100}% of the extra goes to a card balance "
                    "first (card interest costs more than savings earn), then savings, and the "
                    "rest is yours. Educational guidance, not financial advice."
                ),
            )

    def pay_cycle_outlook(self, user_id: str, offset: int = 0) -> PayCycleOutlook:
        """Chequing and cash day by day over a pay cycle (0 is the current one, 1 the next).
        Cycles follow the main pay; every source's paydays are projected. Bills only: everyday
        spending isn't projected."""
        with self._lock:
            self.require_owner(user_id)
            schedule = self._main_pay()
            if not schedule:
                raise conflict("Set up your pay schedule first")
            today = self.today()
            cycles = cycles_around(
                schedule.frequency, schedule.next_payday, today, 1, 2, schedule.interval_days
            )
            cycle = next((item for item in cycles if item.offset == offset), None)
            if not cycle:
                raise invalid("Unknown pay cycle")
            spendable = {item.id for item in self._accounts_of(*SPENDABLE_TYPES)}
            actual = [
                Event(
                    t.occurred_on,
                    t.description,
                    t.amount_cents if t.kind == "income" else -t.amount_cents,
                    t.kind,
                    False,
                )
                for t in self._transactions.values()
                if t.account_id in spendable and t.occurred_on <= today
            ]
            horizon = cycles[-1].end
            recorded_today = any(e.day == today and e.kind == "income" for e in actual)
            projected = [
                Event(day, source.name, source.amount_cents, "income", True)
                for source in self._pay_schedules.values()
                for day in self._upcoming_paydays(source, today, horizon)
                if day > today or not recorded_today
            ]
            projected += [
                Event(day, bill.name, -bill.amount_cents, "bill", True)
                for bill in self._bills.values()
                if bill.account_id in spendable
                for day in bill_due_dates(bill, today, horizon)
            ]
            cycle_paydays = {
                day
                for source in self._pay_schedules.values()
                for day in self._upcoming_paydays(source, cycle.start, cycle.end)
            }
            days = forecast(cycle, today, self._spendable_cents(), actual, projected, cycle_paydays)
            lowest = min(days, key=lambda item: item.end_cents)
            current = next(item for item in cycles if item.offset == 0)
            next_payday = current.end + timedelta(days=1)
            return PayCycleOutlook(
                days=days,
                next_payday=next_payday,
                days_until_payday=(next_payday - today).days,
                starting_cents=days[0].start_cents,
                ending_cents=days[-1].end_cents,
                lowest_day=lowest.day,
                lowest_cents=lowest.end_cents,
            )
