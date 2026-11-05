"""Which paydays have a paycheque recorded for them.

A paycheque counts for the nearest payday within a few days of it (pay can land a day or two
early or late), and each one counts for one payday only. Nothing here reads a database or calls
a model.
"""

from collections.abc import Iterable
from datetime import date

PAY_MATCH_DAYS = 3


def received_paydays(
    paydays: Iterable[date], received: Iterable[date], window_days: int = PAY_MATCH_DAYS
) -> set[date]:
    """The paydays covered by the paycheques received on `received` dates.

    Each paycheque, earliest first, takes the closest payday still open within `window_days`
    (the earlier one on a tie). A paycheque with no payday that close covers none."""
    if window_days < 0:
        raise ValueError("window_days can't be negative")
    open_days = sorted(set(paydays))
    covered: set[date] = set()
    for day in sorted(received):
        candidates = [
            payday
            for payday in open_days
            if payday not in covered and abs((payday - day).days) <= window_days
        ]
        if candidates:
            covered.add(min(candidates, key=lambda payday: (abs((payday - day).days), payday)))
    return covered
