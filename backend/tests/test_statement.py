from datetime import date

import pytest

from app.domain.runway import safe_to_spend
from app.domain.statement import (
    RawRow,
    amount_cents,
    balance_difference_cents,
    clean_rows,
)

TODAY = date(2026, 11, 1)


def _row(day: str, text: str, amount: str, direction: str, transfer: bool = False) -> RawRow:
    return RawRow(day, text, amount, direction, transfer)


@pytest.mark.parametrize(
    ("text", "cents"),
    [("1,299.99", 129_999), ("$45", 4_500), ("(12.00)", 1_200), ("-3.5", 350), ("45.00 CR", 4_500)],
)
def test_amounts_as_printed(text: str, cents: int) -> None:
    assert amount_cents(text) == cents


@pytest.mark.parametrize("text", ["", "abc", "1.234", "12,34", "1e5"])
def test_unreadable_amounts(text: str) -> None:
    assert amount_cents(text) is None


def test_clean_rows_drops_bad_and_duplicate_rows_with_reasons() -> None:
    rows, problems = clean_rows(
        [
            _row("2026-10-03", "Loblaws", "48.20", "out"),
            _row("2026-10-03", "Loblaws", "48.20", "out"),
            _row("2026-13-01", "Bad date", "1.00", "out"),
            _row("2026-12-01", "Future", "1.00", "out"),
            _row("2026-10-04", "No amount", "n/a", "out"),
            _row("2026-10-05", "Which way", "5.00", "sideways"),
            _row("2026-10-15", "Payroll", "1,200.00", "in"),
        ],
        TODAY,
    )
    assert [(r.description, r.amount_cents, r.direction, r.index) for r in rows] == [
        ("Loblaws", 4_820, "out", 0),
        ("Payroll", 120_000, "in", 6),
    ]
    assert len(problems) == 5


def test_balances_check_out_for_a_bank_account() -> None:
    rows, _ = clean_rows(
        [_row("2026-10-03", "Rent", "825.00", "out"), _row("2026-10-15", "Pay", "1,200", "in")],
        TODAY,
    )
    assert balance_difference_cents("chequing", 50_000, 87_500, rows) == 0
    # A misread amount shows up as a difference.
    assert balance_difference_cents("chequing", 50_000, 88_000, rows) == -500


def test_on_a_card_purchases_raise_what_is_owed() -> None:
    rows, _ = clean_rows(
        [
            _row("2026-10-03", "Uber", "20.00", "out"),
            _row("2026-10-20", "Payment - thank you", "100.00", "in", transfer=True),
        ],
        TODAY,
    )
    assert balance_difference_cents("credit", 30_000, 22_000, rows) == 0


def test_no_printed_balances_means_no_check() -> None:
    assert balance_difference_cents("chequing", None, 1_000, []) is None


def test_shortfall_when_bills_exceed_money() -> None:
    result = safe_to_spend(30_000, 50_000, set_aside_cents=5_000)
    assert (result.safe_cents, result.short_cents) == (0, 25_000)
