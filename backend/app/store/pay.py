"""Sources of pay, and where spendable money is heading before the next payday."""

from dataclasses import dataclass
from datetime import date, timedelta

from app.dashboard_models import (
    DashboardResponse,
    PayReceivedWrite,
    PaySchedule,
    PayScheduleWrite,
)
from app.domain.pay_cycle import DayBalance, Event, cycles_around, forecast
from app.models import Transaction
from app.store.dashboard import DashboardViews
from app.store.sections import SPENDABLE_TYPES, bill_due_dates
from app.store.state import conflict, invalid, new_id, not_found

MAX_PAY_SCHEDULES = 8


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
