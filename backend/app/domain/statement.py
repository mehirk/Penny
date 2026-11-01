"""Checks on transactions read from an uploaded bank or card statement.

The model only reads the document: dates, descriptions, amounts as printed, and which way the
money went. Everything here is deterministic: amounts become integer cents, impossible rows are
dropped with a reason, duplicates inside the file are removed, and when the statement prints an
opening and closing balance, the rows are checked against them so a misread amount shows up.

Integer cents only. Nothing here calls a model.
"""

import csv
import io
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

Direction = Literal["in", "out"]
AccountType = Literal["chequing", "savings", "credit"]
MAX_ROWS = 600
OLDEST_DAYS = 3 * 366

_AMOUNT = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?")
# Signs, brackets, and markers that say which way money went; the direction is read separately.
_MARKS = ("CAD", "CR", "DR", "$", " ", "+", "-", "(", ")")


def amount_cents(text: str) -> int | None:
    """ "1,299.99", "$45", "(12.00)", "-3.5", "45.00 CR" → cents (always positive), else None."""
    cleaned = text.strip().upper()
    for mark in _MARKS:
        cleaned = cleaned.replace(mark, "")
    match = _AMOUNT.fullmatch(cleaned)
    if not match:
        return None
    dollars, fraction = match.groups()
    return int(dollars.replace(",", "")) * 100 + int((fraction or "0").ljust(2, "0"))


@dataclass(frozen=True, slots=True)
class RawRow:
    """One row as the model read it, before any checks."""

    date: str
    description: str
    amount: str
    direction: str
    transfer: bool


@dataclass(frozen=True, slots=True)
class StatementRow:
    occurred_on: date
    description: str
    amount_cents: int
    direction: Direction
    # Moving money between the person's own accounts (e.g. paying the card): not income or
    # spending, so it's left out of the import by default but still counts in the balance check.
    transfer: bool
    index: int  # position in the rows as read (0-based), to match details back to it


def clean_rows(raw: Iterable[RawRow], today: date) -> tuple[list[StatementRow], list[str]]:
    """Valid rows in statement order, plus a reason for each row that was dropped."""
    rows: list[StatementRow] = []
    problems: list[str] = []
    seen: set[tuple[date, str, int, str]] = set()
    for position, item in enumerate(raw):
        index = position + 1
        if len(rows) >= MAX_ROWS:
            problems.append(f"Stopped after {MAX_ROWS} rows")
            break
        description = " ".join(item.description.split())[:160]
        try:
            occurred = date.fromisoformat(item.date.strip())
        except ValueError:
            problems.append(f"Row {index}: couldn't read the date “{item.date[:20]}”")
            continue
        if occurred > today or occurred < today - timedelta(days=OLDEST_DAYS):
            problems.append(f"Row {index}: date {occurred.isoformat()} is out of range")
            continue
        cents = amount_cents(item.amount)
        if cents is None or cents == 0:
            problems.append(f"Row {index}: couldn't read the amount “{item.amount[:20]}”")
            continue
        if item.direction not in ("in", "out"):
            problems.append(f"Row {index}: unclear whether money went in or out")
            continue
        if not description:
            problems.append(f"Row {index}: no description")
            continue
        key = (occurred, description.casefold(), cents, item.direction)
        if key in seen:
            problems.append(f"Row {index}: appears twice in the file")
            continue
        seen.add(key)
        rows.append(
            StatementRow(
                occurred,
                description,
                cents,
                item.direction,  # type: ignore[arg-type]
                item.transfer,
                position,
            )
        )
    return rows, problems


def balance_difference_cents(
    account_type: AccountType | None,
    opening_cents: int | None,
    closing_cents: int | None,
    rows: Sequence[StatementRow],
) -> int | None:
    """Closing balance the rows imply minus the closing balance printed on the statement.

    0 means every amount adds up. None when the statement doesn't print both balances. On a
    card the balance is what's owed, so purchases raise it and payments lower it.
    """
    if opening_cents is None or closing_cents is None:
        return None
    money_in = sum(row.amount_cents for row in rows if row.direction == "in")
    money_out = sum(row.amount_cents for row in rows if row.direction == "out")
    if account_type == "credit":
        implied = opening_cents + money_out - money_in
    else:
        implied = opening_cents + money_in - money_out
    return implied - closing_cents


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def xlsx_to_csv(data: bytes, max_rows: int = MAX_ROWS + 40) -> str:
    """Every non-empty row of every sheet as CSV text, for the model to read."""
    from openpyxl import load_workbook  # imported here so the rest works without it

    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = io.StringIO()
    writer = csv.writer(out)
    written = 0
    try:
        for sheet in workbook.worksheets:
            if len(workbook.worksheets) > 1:
                writer.writerow([f"# Sheet: {sheet.title}"])
            for values in sheet.iter_rows(values_only=True):
                cells = [_cell(value) for value in values]
                while cells and not cells[-1]:
                    cells.pop()
                if not any(cells):
                    continue
                writer.writerow(cells)
                written += 1
                if written >= max_rows:
                    return out.getvalue()
    finally:
        workbook.close()
    return out.getvalue()
