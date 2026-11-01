from datetime import date

import pytest

from app.domain.runway import runway

TODAY = date(2026, 11, 1)
MONTH_END = date(2026, 11, 30)


def test_lasts_until_the_day_before_payday() -> None:
    result = runway(14_000, TODAY, date(2026, 11, 15), MONTH_END, 2_000)
    assert result.until == date(2026, 11, 14)
    assert result.until_payday is True
    assert result.days_left == 14
    assert result.per_day_cents == 1_000
    assert result.status == "on_track"


def test_without_a_pay_schedule_lasts_to_month_end() -> None:
    result = runway(3_000, TODAY, None, MONTH_END, 0)
    assert result.until == MONTH_END
    assert result.until_payday is False
    assert result.days_left == 30
    assert result.per_day_cents == 100


def test_payday_today_or_earlier_falls_back_to_month_end() -> None:
    assert runway(3_000, TODAY, TODAY, MONTH_END, 0).until == MONTH_END
    assert runway(3_000, TODAY, date(2026, 10, 25), MONTH_END, 0).until == MONTH_END


def test_payday_tomorrow_leaves_one_day() -> None:
    result = runway(999, TODAY, date(2026, 11, 2), MONTH_END, 500)
    assert (result.until, result.days_left, result.per_day_cents) == (TODAY, 1, 999)


def test_last_day_of_month_leaves_one_day() -> None:
    assert runway(500, MONTH_END, None, MONTH_END, 0).days_left == 1


def test_per_day_rounds_down_to_the_cent() -> None:
    assert runway(1_000, TODAY, date(2026, 11, 4), MONTH_END, 0).per_day_cents == 333


def test_nothing_safe_is_empty() -> None:
    result = runway(0, TODAY, date(2026, 11, 15), MONTH_END, 2_000)
    assert (result.per_day_cents, result.status) == (0, "empty")


def test_tight_below_half_the_daily_allowance() -> None:
    # 10 days: $9.99/day vs half of $20.00 → tight; exactly $10.00/day → on track.
    payday = date(2026, 11, 11)
    assert runway(9_990, TODAY, payday, MONTH_END, 2_000).status == "tight"
    assert runway(10_000, TODAY, payday, MONTH_END, 2_000).status == "on_track"


def test_no_allowance_is_on_track_when_money_is_left() -> None:
    assert runway(1, TODAY, None, MONTH_END, 0).status == "on_track"


@pytest.mark.parametrize(
    ("safe", "allowance", "end"),
    [(-1, 0, MONTH_END), (0, -1, MONTH_END), (0, 0, date(2026, 10, 31))],
)
def test_rejects_invalid_input(safe: int, allowance: int, end: date) -> None:
    with pytest.raises(ValueError):
        runway(safe, TODAY, None, end, allowance)
