"""Money dates for the user's own calendar: bills, card payments, and paydays."""

from datetime import timedelta

from app.dashboard_models import CalendarExportWrite
from app.domain.calendar_file import CalendarEvent
from app.domain.card_due import next_card_due
from app.domain.finance import format_cad
from app.store.dashboard import DashboardViews
from app.store.sections import bill_due_dates

CALENDAR_DAYS = 183  # about six months ahead
MAX_CALENDAR_EVENTS = 500
_REFRESH = (
    "Added from Penny. If this changes in Penny, add your money dates to your calendar again."
)


class CalendarOps(DashboardViews):
    def calendar_events(self, user_id: str, request: CalendarExportWrite) -> list[CalendarEvent]:
        """The next six months of the money dates asked for, soonest first."""
        with self._lock:
            self.require_owner(user_id)
            today = self.today()
            end = today + timedelta(days=CALENDAR_DAYS)

            def amount(cents: int, prefix: str = "") -> str:
                return f" · {prefix}{format_cad(cents)}" if request.show_amounts else ""

            events: list[CalendarEvent] = []
            if request.bills:
                for bill in self._bills.values():
                    account = self._accounts.get(bill.account_id)
                    paid_from = f"Paid from {account.name}. " if account else ""
                    events += [
                        CalendarEvent(
                            uid=f"bill-{bill.id}-{day:%Y%m%d}@penny",
                            day=day,
                            title=f"{bill.name} due{amount(bill.amount_cents)}",
                            description=f"{paid_from}Check the account has enough. {_REFRESH}",
                        )
                        for day in bill_due_dates(bill, today, end)
                    ]
            if request.cards:
                for card in self._card_payments():
                    due_day = self._accounts[card.account_id].payment_due_day
                    day = card.due_on
                    first = True
                    while due_day and day <= end:
                        owed = (
                            f"Owed on {today:%b} {today.day}: {format_cad(card.owed_cents)}. "
                            if first and request.show_amounts
                            else ""
                        )
                        events.append(
                            CalendarEvent(
                                uid=f"card-{card.account_id}-{day:%Y%m%d}@penny",
                                day=day,
                                title=f"{card.account_name} payment due",
                                description=f"{owed}Pay at least the minimum. {_REFRESH}",
                            )
                        )
                        day = next_card_due(day + timedelta(days=1), due_day)
                        first = False
            if request.pay:
                for schedule in self._pay_schedules.values():
                    events += [
                        CalendarEvent(
                            uid=f"pay-{schedule.id}-{day:%Y%m%d}@penny",
                            day=day,
                            title=f"Payday: {schedule.name}"
                            + amount(schedule.amount_cents, "about "),
                            description=f"Tap “I got paid” in Penny when it lands. {_REFRESH}",
                        )
                        for day in self._upcoming_paydays(schedule, today, end)
                    ]
            events.sort(key=lambda item: (item.day, item.title, item.uid))
            return events[:MAX_CALENDAR_EVENTS]
