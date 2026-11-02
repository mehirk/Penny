import pytest

from app.domain.cash_check import Cash, Due, shortfalls

CHEQUING = Cash("chq", "chequing", 0)
SAVINGS = Cash("sav", "savings", 500_000)


def test_rent_from_an_empty_chequing_account_suggests_savings() -> None:
    [result] = shortfalls([CHEQUING, SAVINGS], [Due("chq", 61_100)])
    assert (result.account_id, result.short_cents, result.cover_from) == ("chq", 61_100, "sav")


def test_enough_money_means_no_warning() -> None:
    assert shortfalls([Cash("chq", "chequing", 70_000)], [Due("chq", 61_100)]) == []


def test_partly_covered_reports_only_the_gap() -> None:
    [result] = shortfalls([Cash("chq", "chequing", 50_000), SAVINGS], [Due("chq", 61_100)])
    assert result.short_cents == 11_100


def test_no_account_can_cover_it() -> None:
    [result] = shortfalls([CHEQUING, Cash("sav", "savings", 1_000)], [Due("chq", 61_100)])
    assert result.cover_from is None


def test_cards_are_left_out() -> None:
    assert shortfalls([Cash("card", "credit", 0)], [Due("card", 5_000)]) == []


def test_a_source_must_keep_enough_for_its_own_bills() -> None:
    other = Cash("chq2", "chequing", 70_000)
    result = shortfalls([CHEQUING, other], [Due("chq", 50_000), Due("chq2", 30_000)])
    assert result[0].cover_from is None


def test_negative_amounts_are_rejected() -> None:
    with pytest.raises(ValueError):
        shortfalls([CHEQUING], [Due("chq", -1)])
