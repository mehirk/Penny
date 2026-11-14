"""Personas, the pocket-money practice week, and receipts read into purchases."""

import asyncio
import base64
from datetime import date
from typing import Any

import pytest
from fastapi import HTTPException

from app.assist import statements
from app.assist.statements import StatementUpload, read_statement, sample_receipt
from app.coach.context import build_snapshot, load_context
from app.config import Settings
from app.db.rows import profile_row
from app.domain.receipt import ReceiptLine, group_receipt
from app.learning import practice
from app.learning.models import PracticeWrite
from app.store import fresh_store
from app.store.seed import starter_categories

USER = "user-1"
TODAY = date(2026, 11, 13)


# ------------------------------------------------------------------ personas


def test_persona_is_saved_and_reaches_penny_ai() -> None:
    store = fresh_store(USER, None)
    assert store.dashboard_for_user(USER).profile.persona is None
    store.set_persona(USER, "working")
    assert store.dashboard_for_user(USER).profile.persona == "working"
    person = build_snapshot(load_context(store, USER))["person"]
    assert "salary" in person["situation"]  # type: ignore[index]


def test_an_unpicked_persona_isnt_written_to_the_database() -> None:
    store = fresh_store(USER, None)
    assert "persona" not in profile_row(store.snapshot().profile)
    store.set_persona(USER, "learner")
    assert profile_row(store.snapshot().profile)["persona"] == "learner"


# ------------------------------------------------------------------ practice


def week(**overrides: str) -> dict[str, str]:
    picks = {"mon": "skip", "tue": "water", "wed": "play", "thu": "bus", "fri": "home"}
    picks.update(overrides)
    return picks


def test_goal_plus_fun_earns_three_stars() -> None:
    result = practice.play(week(mon="candy"))  # candy $3, bus $2, a free movie night
    assert (result.left_cents, result.treats, result.reached_goal, result.stars) == (
        1_500,
        2,
        True,
        3,
    )
    assert result.xp == 30


def test_saving_everything_reaches_the_goal_with_two_stars() -> None:
    result = practice.play(week(thu="walk"))  # nothing spent; the free movie night is one treat
    assert (result.left_cents, result.treats, result.stars) == (2_000, 1, 2)


def test_too_many_treats_miss_the_goal() -> None:
    result = practice.play(week(tue="bubble-tea", wed="skin"))  # $6 + $8 + $2 bus
    assert (result.left_cents, result.reached_goal, result.stars) == (400, False, 1)


def test_money_runs_out() -> None:
    with pytest.raises(ValueError, match="Not enough"):
        practice.play(week(tue="bubble-tea", wed="skin", thu="bus", fri="movie"))


@pytest.mark.parametrize("picks", [{"mon": "skip"}, week(mon="lottery")])
def test_practice_checks_its_input(picks: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        practice.play(picks)


def test_best_practice_result_earns_xp_once() -> None:
    store = fresh_store(USER, None)
    before = store.learn_state(USER).xp_total
    first = store.play_practice(USER, PracticeWrite(choices=week(tue="bubble-tea", wed="skin")))
    assert (first.stars, first.xp_awarded) == (1, 10)
    best = store.play_practice(USER, PracticeWrite(choices=week(mon="candy")))
    assert (best.stars, best.xp_awarded) == (3, 20)  # only the gain over the earlier result
    again = store.play_practice(USER, PracticeWrite(choices=week(mon="candy")))
    assert again.xp_awarded == 0
    assert store.learn_state(USER).xp_total == before + 30
    assert store.practice_view(USER).best_stars == 3
    assert all(not badge.earned for badge in store.learn_state(USER).badges)  # lessons only


def test_a_bad_practice_week_is_refused() -> None:
    store = fresh_store(USER, None)
    with pytest.raises(HTTPException):
        store.play_practice(USER, PracticeWrite(choices={"mon": "skip"}))


# ------------------------------------------------------------------ receipts


def test_lines_group_by_category_with_tax_on_the_largest() -> None:
    groups = group_receipt(
        [
            ReceiptLine(549, "groceries"),
            ReceiptLine(4_500, "fuel"),
            ReceiptLine(399, "groceries"),
            ReceiptLine(135, None, is_tax=True),
        ]
    )
    assert [(g.category_id, g.amount_cents, g.lines) for g in groups] == [
        ("groceries", 948, 2),
        ("fuel", 4_635, 2),
    ]


def test_a_discount_comes_off_its_category() -> None:
    groups = group_receipt(
        [
            ReceiptLine(1_000, "groceries"),
            ReceiptLine(500, "health"),
            ReceiptLine(200, "health", is_discount=True),
            ReceiptLine(100, "other", is_discount=True),  # no items there: the largest group
        ]
    )
    assert [(g.category_id, g.amount_cents) for g in groups] == [
        ("groceries", 900),
        ("health", 300),
    ]


@pytest.mark.parametrize(
    "lines",
    [
        [],
        [ReceiptLine(100, None, is_tax=True)],
        [ReceiptLine(0, "groceries")],
        [ReceiptLine(100, "groceries"), ReceiptLine(200, "groceries", is_discount=True)],
    ],
)
def test_receipt_grouping_checks_its_input(lines: list[ReceiptLine]) -> None:
    with pytest.raises(ValueError):
        group_receipt(lines)


def test_sample_receipt_adds_up_to_its_printed_total() -> None:
    draft = sample_receipt(TODAY, starter_categories())
    assert (draft.source, draft.document, draft.model) == ("sample", "receipt", None)
    assert [(row.description, row.amount_cents) for row in draft.rows] == [
        ("Harbourside Market & Gas · Groceries", 1_166),
        ("Harbourside Market & Gas · Health", 899),
        ("Harbourside Market & Gas · Transportation", 4_635),
    ]
    assert draft.balance_difference_cents == 0
    assert all(row.occurred_on == TODAY and row.kind == "spending" for row in draft.rows)


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def upload(name: str, data: bytes) -> StatementUpload:
    return StatementUpload(filename=name, data_base64=base64.b64encode(data).decode())


def test_a_receipt_photo_is_read_and_grouped(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, Any] = {}

    async def fake_model(settings: Settings, *args: Any, **kwargs: Any) -> dict[str, Any]:
        sent.update(kwargs)
        line = {"direction": "out", "transfer": False, "date": "2026-11-12"}
        return {
            "document": "receipt",
            "institution": "Corner Store",
            "closing_balance": "10.35",
            "transactions": [
                {
                    **line,
                    "description": "Chips",
                    "amount": "4.00",
                    "is_tax": False,
                    "category_id": "cat-groceries",
                },
                {
                    **line,
                    "description": "Pop",
                    "amount": "5.00",
                    "is_tax": False,
                    "category_id": "cat-groceries",
                },
                {
                    **line,
                    "description": "HST",
                    "amount": "1.35",
                    "is_tax": True,
                    "category_id": None,
                },
            ],
        }

    monkeypatch.setattr(statements, "ask_json", fake_model)
    draft = asyncio.run(
        read_statement(Settings(), upload("receipt.png", PNG), TODAY, starter_categories(), [])
    )
    assert sent["attachment"]["type"] == "input_image"
    assert sent["attachment"]["image_url"].startswith("data:image/png;base64,")
    assert (draft.document, draft.file_kind, draft.balance_difference_cents) == (
        "receipt",
        "image",
        0,
    )
    assert [(row.description, row.amount_cents) for row in draft.rows] == [("Corner Store", 1_035)]


@pytest.mark.parametrize(
    ("name", "data"), [("receipt.jpg", PNG), ("receipt.png", b"not an image at all")]
)
def test_a_renamed_or_broken_image_is_refused(name: str, data: bytes) -> None:
    with pytest.raises(HTTPException):
        asyncio.run(read_statement(Settings(), upload(name, data), TODAY, starter_categories(), []))


def test_chat_tiles_start_with_the_nearest_goal_and_fit_the_persona() -> None:
    from app.coach.coach import Coach
    from app.dashboard_models import GoalWrite

    store = fresh_store(USER, None)
    store.set_persona(USER, "working")
    store.create_goal(USER, GoalWrite(name="Home deposit", target_cents=500_000, current_cents=0))
    questions = Coach(store, Settings()).brief(USER).suggested_questions
    assert questions[0] == "Am I on track for my Home deposit?"
    assert "How much of my pay should I be saving?" in questions
    assert len(questions) <= 4 and len(set(questions)) == len(questions)
