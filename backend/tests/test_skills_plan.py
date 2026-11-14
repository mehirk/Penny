"""Money IQ grading, mastery and gaps, and the coach plan (built-in note without a model)."""

import asyncio

import pytest
from fastapi import HTTPException

from app.assist.learning_plan import coach_plan
from app.config import Settings
from app.learning import skills
from app.learning.models import SkillCheckWrite
from app.store import fresh_store

USER = "user-skills"
OFFLINE = Settings(openai_api_key="", database_url=None)


def answers(wrong_areas: tuple[str, ...] = ()) -> dict[str, str]:
    """Right answers, except one wrong option in each named area."""
    picks = {}
    for question in skills.QUESTIONS:
        if question.area in wrong_areas:
            picks[question.id] = next(i for i, _ in question.options if i != question.answer)
        else:
            picks[question.id] = question.answer
    return picks


def test_grading_counts_right_answers_per_area() -> None:
    right, marks = skills.grade(answers(wrong_areas=("credit",)))
    assert right["credit"] == 0 and right["tax"] == skills.PER_AREA
    assert sum(mark.correct for mark in marks) == len(skills.QUESTIONS) - skills.PER_AREA
    with pytest.raises(ValueError):
        skills.grade({"bank-1": "b"})


def test_mastery_blends_check_and_lessons_weakest_first() -> None:
    right = {area.id: skills.PER_AREA for area in skills.AREAS} | {"tax": 1}
    stars = {area.id: (9, 9) for area in skills.AREAS} | {"tax": (0, 9), "protect": (0, 0)}
    areas = skills.mastery(right, stars)
    # Tax: 50% check, 0% lessons → 30%. No lessons in an area: the check counts for both.
    assert (areas[0].area.id, areas[0].check_pct, areas[0].lesson_pct, areas[0].mastery_pct) == (
        "tax",
        50,
        0,
        30,
    )
    assert next(a for a in areas if a.area.id == "protect").mastery_pct == 100


def test_plan_needs_a_check_then_targets_the_weakest_area() -> None:
    store = fresh_store(USER, None)
    assert not asyncio.run(coach_plan(OFFLINE, store, USER)).checked

    result = store.submit_skill_check(
        USER, SkillCheckWrite(answers=answers(wrong_areas=("credit",)))
    )
    assert result.xp_awarded == skills.SKILL_XP
    assert result.areas[0].id == "credit" and result.areas[0].check_pct == 0
    # XP only once.
    again = store.submit_skill_check(USER, SkillCheckWrite(answers=answers()))
    assert again.xp_awarded == 0

    store.submit_skill_check(USER, SkillCheckWrite(answers=answers(wrong_areas=("credit",))))
    plan = asyncio.run(coach_plan(OFFLINE, store, USER))
    assert plan.checked and plan.areas[0].id == "credit"
    assert (
        plan.steps[0].area == "credit"
        and plan.steps[0].kind == "lesson"
        and plan.steps[0].lesson_id
    )
    assert {step.kind for step in plan.steps} >= {"lesson", "guide"}
    assert plan.note and plan.note.source == "built_in"
    assert "Credit & debt" in plan.note.items[0]


def test_incomplete_check_is_refused() -> None:
    store = fresh_store(USER, None)
    with pytest.raises(HTTPException) as refused:
        store.submit_skill_check(USER, SkillCheckWrite(answers={"bank-1": "b"}))
    assert refused.value.status_code == 422
