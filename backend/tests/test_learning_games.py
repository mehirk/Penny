"""Story games for each persona, Needs or wants, daily quests, and the chest."""

import itertools

import pytest
from fastapi import HTTPException

from app.db.rows import from_rows, profile_row, to_rows
from app.learning import practice, quests, sorting
from app.learning.content import LESSONS_BY_ID
from app.learning.models import AnswerWrite, PracticeWrite, SortWrite
from app.store import fresh_store

USER = "user-games"


def cheapest(scenario: practice.Scenario) -> dict[str, str]:
    return {
        day.id: min(day.choices, key=lambda choice: choice.cost_cents).id for day in scenario.days
    }


@pytest.mark.parametrize("scenario", list(practice.SCENARIOS.values()), ids=lambda s: s.id)
def test_every_story_game_can_earn_three_stars_but_not_by_spending_everything(
    scenario: practice.Scenario,
) -> None:
    # The cheapest path reaches the goal; it earns three stars only with enough treats in it.
    frugal = practice.play(cheapest(scenario), scenario)
    assert frugal.reached_goal
    # The priciest path that's still affordable misses the goal.
    picks: dict[str, str] = {}
    left = scenario.start_cents
    for day in scenario.days:
        choice = max((c for c in day.choices if c.cost_cents <= left), key=lambda c: c.cost_cents)
        picks[day.id] = choice.id
        left -= choice.cost_cents
    assert not practice.play(picks, scenario).reached_goal
    # Some mix of choices earns three stars.
    best = max(
        practice.play(dict(zip([d.id for d in scenario.days], combo, strict=True)), scenario).stars
        for combo in itertools.product(*[[c.id for c in d.choices] for d in scenario.days])
        if sum(
            next(c.cost_cents for c in d.choices if c.id == pick)
            for d, pick in zip(scenario.days, combo, strict=True)
        )
        <= scenario.start_cents
    )
    assert best == 3


def test_semester_three_stars_needs_the_cushion_and_two_treats() -> None:
    result = practice.play(
        {
            "week-1": "used-books",  # $90
            "week-2": "cook",  # $45
            "week-3": "campus",  # free, a treat
            "week-4": "protector",  # $15
            "reading-week": "day-trip",  # $60, a treat
        },
        practice.SEMESTER,
    )
    assert (result.left_cents, result.treats, result.stars, result.xp) == (69_000, 2, 3, 30)


def test_persona_picks_its_story_game() -> None:
    assert practice.scenario_for("student") is practice.SEMESTER
    assert practice.scenario_for("working") is practice.FIRST_PAYCHEQUE
    assert practice.scenario_for("learner") is practice.POCKET_MONEY
    assert practice.scenario_for(None) is practice.POCKET_MONEY


def test_sorting_scores_stars_by_correct_answers_and_accuracy() -> None:
    right = {card.id: card.kind for card in sorting.CARDS}
    perfect = sorting.score(right)
    assert (perfect.correct, perfect.answered, perfect.stars, perfect.xp) == (18, 18, 3, 30)
    # 10 right out of 12 (83%): two stars.
    some = dict(list(right.items())[:12])
    for card_id in list(some)[:2]:
        some[card_id] = "want" if some[card_id] == "need" else "need"
    assert sorting.score(some).stars == 2
    assert sorting.score({}).stars == 0
    with pytest.raises(ValueError):
        sorting.score({"lottery": "want"})


def pass_first_lesson(store, user: str = USER) -> None:  # type: ignore[no-untyped-def]
    lesson_id = store.learn_state(user).topics[0].lessons[0].id
    attempt = store.start_attempt(user, lesson_id)
    for question in LESSONS_BY_ID[lesson_id].questions:
        store.answer_question(
            user,
            attempt.id,
            AnswerWrite(
                question_id=question.id, choices=list(question.answer), value=question.number
            ),
        )


def test_quests_then_chest_once_a_day() -> None:
    store = fresh_store(USER, None)
    store.set_persona(USER, "student")
    arcade = store.arcade(USER)
    assert arcade.featured == "semester" and arcade.stories[0].id == "semester"
    assert [q.done for q in arcade.quests] == [False, False, False]
    with pytest.raises(HTTPException) as early:
        store.open_chest(USER)
    assert early.value.status_code == 409

    xp_before = store.learn_state(USER).xp_total
    pass_first_lesson(store)
    # Another persona's game doesn't count for the story quest.
    store.play_practice(
        USER, PracticeWrite(scenario="pocket-money", choices=cheapest(practice.POCKET_MONEY))
    )
    assert [q.done for q in store.arcade(USER).quests] == [True, False, False]
    store.play_practice(
        USER, PracticeWrite(scenario="semester", choices=cheapest(practice.SEMESTER))
    )
    store.play_sort(USER, SortWrite(answers={card.id: card.kind for card in sorting.CARDS}))
    assert all(q.done for q in store.arcade(USER).quests)

    xp_games = store.learn_state(USER).xp_total
    opened = store.open_chest(USER)
    assert opened.xp_awarded == quests.CHEST_XP and opened.arcade.chest_claimed
    assert store.learn_state(USER).xp_total == xp_games + quests.CHEST_XP > xp_before
    with pytest.raises(HTTPException):
        store.open_chest(USER)

    # Markers and the chest survive a save and load, and never count as lessons for badges.
    snapshot = store.snapshot()
    reloaded = from_rows(USER, *_profile_and_tables(snapshot))
    assert quests.chest_id(store.today()) in reloaded.learner.results
    assert [b.id for b in store.learn_state(USER).badges if b.earned] == ["first-steps", "flawless"]


def _profile_and_tables(snapshot):  # type: ignore[no-untyped-def]
    tables = {table: list(rows.values()) for table, rows in to_rows(snapshot).items()}
    return profile_row(snapshot.profile), tables


def test_unknown_story_game_is_not_found() -> None:
    store = fresh_store(USER, None)
    with pytest.raises(HTTPException) as missing:
        store.play_practice(USER, PracticeWrite(scenario="lottery", choices={}))
    assert missing.value.status_code == 404
