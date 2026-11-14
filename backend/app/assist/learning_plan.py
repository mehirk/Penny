"""Penny's learning plan: the knowledge gaps from Money IQ and lesson stars, and what to do next.

The gaps and steps are worked out in the store (app.learning.skills); the model only writes a
short coaching note about them, and every percentage in it must match the computed scores.
"""

from datetime import date

from app.assist.common import AssistModel, AssistText, phrase
from app.coach.facts import FactBook
from app.config import Settings
from app.learning.models import AreaView, PlanStep
from app.store import DashboardStore

NOTE_TIMEOUT_SECONDS = 8.0

PERSONA_ANGLE = {
    "student": "a student juggling rent, tuition, and a part-time income",
    "working": "someone starting out with a regular paycheque",
    "learner": "a beginner learning money basics with no real accounts yet",
}


class CoachPlanOut(AssistModel):
    checked: bool
    checked_on: date | None
    areas: list[AreaView]  # weakest first
    steps: list[PlanStep]
    note: AssistText | None


async def coach_plan(settings: Settings, store: DashboardStore, user_id: str) -> CoachPlanOut:
    inputs = store.coach_plan_inputs(user_id)
    if inputs is None:
        return CoachPlanOut(checked=False, checked_on=None, areas=[], steps=[], note=None)
    areas, steps, persona = inputs
    views = DashboardStore.area_views(areas)
    checked_on = store.skill_checked_on(user_id)
    gaps = [item for item in areas if item.mastery_pct < 100][:3]
    strongest = areas[-1]
    f = FactBook()
    facts = {
        item.area.id: f.percent(item.area.label, item.mastery_pct * 100, "skills") for item in areas
    }

    if not gaps:
        fallback = [
            "Every area is at 100%. Replay lessons for 3 stars or explore the Money Guide for more."
        ]
    else:
        weakest = gaps[0]
        first = next((step for step in steps if step.area == weakest.area.id), None)
        fallback = [
            f"Your biggest gap is {weakest.area.label} at {facts[weakest.area.id]}. "
            + (f"Start with {first.title}, then work down the list." if first else "Start there.")
            + f" Your strongest area is {strongest.area.label} at {facts[strongest.area.id]}."
        ]
    note = await phrase(
        settings,
        f,
        "Write one or two encouraging sentences (max 50 words) as Penny, a money coach, telling "
        "the learner their biggest knowledge gap, why it matters for them, and what to start "
        "with from the steps given. Educational only; no investment, tax, or credit advice.",
        f"LEARNER: {PERSONA_ANGLE.get(persona or '', 'a young adult in Canada')}. "
        "MASTERY (weakest first): "
        + ", ".join(f"{item.area.label} {facts[item.area.id]}" for item in areas)
        + ". NEXT STEPS: "
        + "; ".join(f"{step.kind}: {step.title}" for step in steps[:4]),
        fallback,
        1,
        max_chars=320,
        timeout_seconds=NOTE_TIMEOUT_SECONDS,
    )
    return CoachPlanOut(checked=True, checked_on=checked_on, areas=views, steps=steps, note=note)
