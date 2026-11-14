"""Totals for costs shared with friends. A friend's balance is positive when they owe the user
and negative when the user owes them. Nothing here reads a database or calls a model."""

from collections.abc import Iterable
from typing import NamedTuple


class SplitTotals(NamedTuple):
    owed_to_you_cents: int
    you_owe_cents: int
    # What's owed to the user minus what they owe: positive, they're owed overall.
    net_cents: int


def split_totals(balances: Iterable[int]) -> SplitTotals:
    owed = owe = 0
    for cents in balances:
        if cents > 0:
            owed += cents
        else:
            owe -= cents
    return SplitTotals(owed, owe, owed - owe)


class EvenSplit(NamedTuple):
    mine_cents: int
    each_cents: int


def even_split(total_cents: int, people: int) -> EvenSplit:
    """A total shared evenly by `people` (the user included). Each friend's share is floored to
    the cent, so the user's share takes the odd cents: $100 by 3 is $33.34 mine, $33.33 each."""
    if total_cents <= 0:
        raise ValueError("The total must be more than $0")
    if not 2 <= people <= 50:
        raise ValueError("Split between 2 and 50 people")
    each = total_cents // people
    if each <= 0:
        raise ValueError("Each share comes to less than a cent")
    return EvenSplit(total_cents - each * (people - 1), each)
