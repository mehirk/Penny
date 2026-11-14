"""A receipt's printed lines, grouped into one purchase per category.

A photo of a receipt from a store that sells groceries and fuel becomes two purchases, Groceries
and Transportation, instead of one lump or a row per item. The model only copies each printed
line; the adding happens here, in integer cents. Tax goes with the largest group, and a discount
comes off its own category (or the largest group when its category had no items). Nothing here
reads a database or calls a model.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ReceiptLine:
    amount_cents: int  # as printed, always positive
    category_id: str | None
    is_tax: bool = False
    is_discount: bool = False


@dataclass(frozen=True, slots=True)
class ReceiptGroup:
    category_id: str | None
    amount_cents: int
    lines: int


def group_receipt(lines: list[ReceiptLine]) -> list[ReceiptGroup]:
    """One group per category, in the order the categories first appear on the receipt."""
    if any(line.amount_cents <= 0 for line in lines):
        raise ValueError("Receipt amounts must be positive")
    totals: dict[str | None, int] = {}
    counts: dict[str | None, int] = {}
    for line in lines:
        if not line.is_tax and not line.is_discount:
            totals[line.category_id] = totals.get(line.category_id, 0) + line.amount_cents
            counts[line.category_id] = counts.get(line.category_id, 0) + 1
    if not totals:
        raise ValueError("A receipt needs at least one item")

    def largest() -> str | None:
        # Ties go to the category listed first on the receipt.
        return max(totals, key=lambda key: totals[key])

    for line in lines:
        if line.is_discount:
            key = line.category_id if line.category_id in totals else largest()
            totals[key] -= line.amount_cents
            counts[key] += 1
    for line in lines:
        if line.is_tax:
            key = largest()
            totals[key] += line.amount_cents
            counts[key] += 1
    groups = [ReceiptGroup(key, totals[key], counts[key]) for key in totals]
    if any(group.amount_cents <= 0 for group in groups):
        raise ValueError("Discounts can't be more than what they're taken off")
    return groups
