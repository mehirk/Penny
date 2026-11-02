"""Moving money between someone's own accounts, and paying a credit card.

Penny only records a transfer the person made in their bank; it never moves real money. A
transfer isn't spending or income, so budgets and Safe to spend don't change: the money is still
theirs. Paying a card isn't spending either, because the purchases already counted when they
were made.

Balances: chequing, savings, and cash hold money (a transfer out lowers them, in raises them);
a credit card's balance is what's owed (a payment lowers it). Money can't come from a card (no
cash advances), no balance can go below zero, and a card can't be paid more than is owed.

Integer cents only. Nothing here reads a database or calls a model.
"""


def move(
    from_type: str, from_cents: int, to_type: str, to_cents: int, amount_cents: int
) -> tuple[int, int]:
    """The two balances after moving `amount_cents`. Raises ValueError with a readable reason."""
    if amount_cents <= 0:
        raise ValueError("Enter an amount above $0")
    if from_type == "credit":
        raise ValueError("Move money from a chequing, savings, or cash account")
    new_from = from_cents - amount_cents
    if new_from < 0:
        raise ValueError("There isn't enough in that account")
    if to_type == "credit":
        new_to = to_cents - amount_cents
        if new_to < 0:
            raise ValueError("That's more than you owe on the card")
    else:
        new_to = to_cents + amount_cents
    return new_from, new_to


def undo(
    from_type: str, from_cents: int, to_type: str, to_cents: int, amount_cents: int
) -> tuple[int, int]:
    """The two balances after removing a recorded transfer (the reverse of `move`)."""
    if amount_cents <= 0:
        raise ValueError("Enter an amount above $0")
    if from_type == "credit":
        raise ValueError("Move money from a chequing, savings, or cash account")
    new_to = to_cents + amount_cents if to_type == "credit" else to_cents - amount_cents
    if new_to < 0:
        raise ValueError("Removing it would make an account balance negative")
    return from_cents + amount_cents, new_to
