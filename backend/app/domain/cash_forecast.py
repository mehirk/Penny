"""Day by day, will chequing stay above zero until the money coming in arrives?

Starting from today's balance, every scheduled bill comes out and every expected paycheque comes
in on its date. Money out is counted before money in on the same day, because a bill can be
taken before a paycheque lands. The result is the lowest point, when it happens, and the first
day the balance would go below zero (with how much it would take to stay at or above zero).

Integer cents only. Nothing here reads a database or calls a model.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True, slots=True)
class Flow:
    on: date
    label: str
    cents: int  # positive: money in; negative: money out


@dataclass(frozen=True, slots=True)
class Forecast:
    start_cents: int
    end_cents: int
    lowest_cents: int
    lowest_on: date | None
    # The first day the balance goes below zero, and the most it ever falls short by.
    first_short_on: date | None
    shortfall_cents: int
    flows: tuple[Flow, ...]


def forecast(start_cents: int, flows: Iterable[Flow]) -> Forecast:
    ordered = tuple(sorted(flows, key=lambda flow: (flow.on, flow.cents >= 0)))
    balance = lowest = start_cents
    lowest_on: date | None = None
    first_short_on: date | None = None
    for flow in ordered:
        balance += flow.cents
        if balance < lowest:
            lowest, lowest_on = balance, flow.on
        if balance < 0 and first_short_on is None:
            first_short_on = flow.on
    return Forecast(
        start_cents=start_cents,
        end_cents=balance,
        lowest_cents=lowest,
        lowest_on=lowest_on,
        first_short_on=first_short_on,
        shortfall_cents=max(0, -lowest),
        flows=ordered,
    )


def round_up(cents: int, step_cents: int = 1_000) -> int:
    """`cents` rounded up to a whole `step_cents` (a transfer of $37.40 becomes $40.00)."""
    if cents <= 0:
        return 0
    return -(-cents // step_cents) * step_cents
