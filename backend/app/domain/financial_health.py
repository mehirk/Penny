"""The monthly financial health score: an educational, behaviour-based indicator (not a credit
score). Each factor is scored only when there is data for it, and the total is the share of the
available points earned. Lower income is never penalized.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.finance import BASIS_POINTS

METHODOLOGY = (
    "A behaviour-based score from budget adherence, positive cash flow, goal progress, "
    "and month-to-month spending stability. Lower income is never penalized."
)
BUDGET_POINTS = 35
SAVINGS_POINTS = 30
GOAL_POINTS = 20
STABILITY_POINTS = 15


@dataclass(frozen=True, slots=True)
class HealthFactor:
    id: str
    label: str
    score: int
    max_score: int
    explanation: str


def health_factors(
    *,
    spending_cents: int,
    budget_cents: int,
    cash_flow_cents: int,
    has_activity: bool,
    previous_spending_cents: int,
    previous_cash_flow_cents: int,
    goal_progress_basis_points: Sequence[int],
) -> list[HealthFactor]:
    """The factors that have data this month. `goal_progress_basis_points` has one entry per
    active goal (capped at 10,000 each)."""
    if spending_cents < 0 or budget_cents < 0 or previous_spending_cents < 0:
        raise ValueError("spending and budget amounts must not be negative")
    factors: list[HealthFactor] = []
    if budget_cents:
        over = max(0, spending_cents - budget_cents)
        factors.append(
            HealthFactor(
                id="budget",
                label="Budget adherence",
                score=BUDGET_POINTS - min(BUDGET_POINTS, over * BUDGET_POINTS // budget_cents),
                max_score=BUDGET_POINTS,
                explanation=(
                    "Full points because spending is within the monthly plan."
                    if over == 0
                    else "Reduced only for the share spent above the monthly plan."
                ),
            )
        )
    if has_activity:
        positive_now = cash_flow_cents > 0
        factors.append(
            HealthFactor(
                id="savings",
                label="Savings consistency",
                score=(
                    SAVINGS_POINTS
                    if positive_now and previous_cash_flow_cents > 0
                    else 20
                    if positive_now
                    else 0
                ),
                max_score=SAVINGS_POINTS,
                explanation=(
                    "Uses positive monthly cash flow in this month and the previous month; "
                    "income level itself is not scored."
                ),
            )
        )
    if goal_progress_basis_points:
        progress = [min(BASIS_POINTS, max(0, item)) for item in goal_progress_basis_points]
        average = sum(progress) // len(progress)
        factors.append(
            HealthFactor(
                id="goals",
                label="Goal progress",
                score=average * GOAL_POINTS // BASIS_POINTS,
                max_score=GOAL_POINTS,
                explanation="Uses the average progress of active fictional savings goals.",
            )
        )
    if previous_spending_cents:
        change = (
            abs(spending_cents - previous_spending_cents) * BASIS_POINTS // previous_spending_cents
        )
        factors.append(
            HealthFactor(
                id="stability",
                label="Spending stability",
                score=STABILITY_POINTS if change <= 1_000 else 10 if change <= 2_500 else 5,
                max_score=STABILITY_POINTS,
                explanation="Based on how sharply total spending changed from the prior month.",
            )
        )
    return factors


def health_score(factors: Sequence[HealthFactor]) -> int:
    """Points earned as a share of the points available, 0-100 (0 with no factors)."""
    available = sum(item.max_score for item in factors)
    return sum(item.score for item in factors) * 100 // available if available else 0
