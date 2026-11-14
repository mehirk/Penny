"""What makes Penny start her agents by herself: a new purchase that pushes a budget over its
limit, or takes safe-to-spend below zero. Decided by deterministic code from the dashboard the
purchase produced; the Watch mission itself runs like any other and changes nothing without
the user's approval.
"""

from app.dashboard_models import DashboardResponse, TransactionWrite
from app.domain.finance import format_cad


def noticed(purchase: TransactionWrite, after: DashboardResponse) -> str | None:
    """What this purchase just tipped over, in words, or None."""
    if purchase.kind != "spending" or purchase.history_only:
        return None
    month = after.budgets[0].month_start if after.budgets else None
    if month and (purchase.occurred_on.year, purchase.occurred_on.month) != (
        month.year,
        month.month,
    ):
        return None
    paid = purchase.amount_cents
    budget = next(
        (b for b in after.budgets if b.category_id == purchase.category_id and not b.carried_over),
        None,
    )
    if budget and budget.remaining_cents < 0 <= budget.remaining_cents + paid:
        return (
            f"{budget.category_name} just went {format_cad(-budget.remaining_cents)} over "
            f"budget after {purchase.description[:40]}"
        )
    if after.spending_power_cents < 0 <= after.spending_power_cents + paid:
        return f"Safe to spend dropped below zero after {purchase.description[:40]}"
    return None
