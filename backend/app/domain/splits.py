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
