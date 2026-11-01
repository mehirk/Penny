from datetime import date

import pytest

from app.domain.card_due import next_card_due


@pytest.mark.parametrize(
    ("today", "day", "expected"),
    [
        (date(2026, 11, 1), 20, date(2026, 11, 20)),  # later this month
        (date(2026, 11, 20), 20, date(2026, 11, 20)),  # due today
        (date(2026, 11, 21), 20, date(2026, 12, 20)),  # passed: next month
        (date(2026, 12, 25), 5, date(2027, 1, 5)),  # across the year
        (date(2027, 2, 1), 31, date(2027, 2, 28)),  # short month: last day
        (date(2028, 2, 1), 30, date(2028, 2, 29)),  # leap year
        (date(2026, 11, 30), 31, date(2026, 11, 30)),  # 31st in a 30-day month is today
    ],
)
def test_next_card_due(today: date, day: int, expected: date) -> None:
    assert next_card_due(today, day) == expected


@pytest.mark.parametrize("day", [0, 32, -1])
def test_rejects_impossible_days(day: int) -> None:
    with pytest.raises(ValueError):
        next_card_due(date(2026, 11, 1), day)
