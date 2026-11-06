"""What money that just came in should do first: cover what's due before the next payday, then
a suggested saving, then the rest is the user's.

A paycheque well above the usual (or money that isn't pay at all, like a bonus or a gift) is a
windfall. Half of the extra is put to work: a credit card balance first, since card interest
costs more than savings earn, then savings. The other half is the user's to enjoy. These are
suggestions only; the user acts on each one. Nothing here reads a database or calls a model.
"""

from dataclasses import dataclass

# A windfall is at least $50 and at least 20% more than the usual paycheque.
WINDFALL_MIN_CENTS = 5_000
WINDFALL_MIN_BASIS_POINTS = 2_000
# Saving suggested from a usual paycheque.
SAVE_BASIS_POINTS = 1_000
# Share of a windfall's extra put toward a card balance or savings; the rest is the user's.
WINDFALL_WORK_BASIS_POINTS = 5_000


@dataclass(frozen=True, slots=True)
class PaydayPlan:
    # How much more than the usual paycheque came in (all of it when there's no usual).
    extra_cents: int
    windfall: bool
    # What's due before the next payday that spendable money doesn't cover.
    short_cents: int
    # Suggested amounts that together fit in spendable money after what's due: whole dollars,
    # except a whole card balance or what finishes a goal.
    card_cents: int
    save_cents: int
    yours_cents: int


def is_windfall(amount_cents: int, usual_cents: int) -> bool:
    extra = amount_cents - usual_cents
    return extra >= WINDFALL_MIN_CENTS and extra * 10_000 >= usual_cents * WINDFALL_MIN_BASIS_POINTS


def _whole_dollars(cents: int, exact: int | None = None) -> int:
    """Rounded down to whole dollars, unless it's exactly `exact` (a whole card balance or what
    finishes a goal), which is kept to the cent."""
    if exact is not None and cents == exact:
        return cents
    return max(0, cents) // 100 * 100


def plan_payday(
    amount_cents: int,
    usual_cents: int,
    spendable_cents: int,
    due_cents: int,
    card_owed_cents: int,
    goal_left_cents: int | None,
) -> PaydayPlan:
    """A plan for `amount_cents` that just came in.

    `usual_cents` is the usual paycheque (0 for money that isn't pay), `spendable_cents` is
    chequing and cash now (the money included), `due_cents` is bills and card payments due
    before the next payday, `card_owed_cents` is card balances not already in `due_cents`, and
    `goal_left_cents` is what's left to reach the goal savings would go to (None: no goal yet).
    """
    if amount_cents <= 0:
        raise ValueError("amount_cents must be positive")
    if min(usual_cents, due_cents, card_owed_cents) < 0:
        raise ValueError("usual_cents, due_cents and card_owed_cents can't be negative")
    if goal_left_cents is not None and goal_left_cents < 0:
        raise ValueError("goal_left_cents can't be negative")
    extra = max(0, amount_cents - usual_cents)
    windfall = is_windfall(amount_cents, usual_cents)
    room = max(0, spendable_cents - due_cents)
    short = max(0, due_cents - spendable_cents)

    usual_part = amount_cents - extra if windfall else amount_cents
    work = extra * WINDFALL_WORK_BASIS_POINTS // 10_000 if windfall else 0
    card = _whole_dollars(min(work, card_owed_cents, room), card_owed_cents)
    room -= card
    save_wanted = usual_part * SAVE_BASIS_POINTS // 10_000 + (work - card)
    if goal_left_cents is not None:
        save_wanted = min(save_wanted, goal_left_cents)
    save = _whole_dollars(min(save_wanted, room), goal_left_cents)
    room -= save
    yours = _whole_dollars(min(extra - work, room)) if windfall else 0
    return PaydayPlan(
        extra_cents=extra,
        windfall=windfall,
        short_cents=short,
        card_cents=card,
        save_cents=save,
        yours_cents=yours,
    )
