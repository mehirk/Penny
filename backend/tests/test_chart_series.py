from datetime import date

import pytest

from app.domain.chart_series import ChartTransaction, Filters, build_series

OCT, NOV, DEC = date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1)


def _t(
    day: str,
    cents: int,
    kind: str = "spending",
    account: str = "chq",
    category: str | None = "food",
    necessity: str | None = None,
) -> ChartTransaction:  # noqa: E501
    return ChartTransaction(date.fromisoformat(day), cents, kind, account, category, necessity)  # type: ignore[arg-type]


ROWS = [
    _t("2026-10-03", 100_000, "income", category="income"),
    _t("2026-10-05", 4_000, category="food", necessity="need"),
    _t("2026-10-09", 2_500, account="card", category="fun", necessity="want"),
    _t("2026-11-02", 6_000, category="food", necessity="need"),
    _t("2026-11-12", 1_000, category=None),
    _t("2026-09-30", 9_999),  # outside the range
]


def test_months_add_up_and_empty_months_are_zero() -> None:
    series = build_series(ROWS, [OCT, NOV, DEC], Filters())
    oct_, nov, dec = series.months
    assert (oct_.income_cents, oct_.spending_cents, oct_.net_cents) == (100_000, 6_500, 93_500)
    assert (oct_.needs_cents, oct_.wants_cents) == (4_000, 2_500)
    assert nov.by_category == {"food": 6_000, None: 1_000}
    assert (dec.income_cents, dec.spending_cents) == (0, 0)
    assert (series.income_cents, series.spending_cents) == (100_000, 13_500)


def test_average_counts_only_active_months() -> None:
    assert build_series(ROWS, [OCT, NOV, DEC], Filters()).average_spending_cents == 13_500 // 2


def test_categories_ranked_by_spend() -> None:
    series = build_series(ROWS, [OCT, NOV], Filters())
    assert series.categories == (("food", 10_000), ("fun", 2_500), (None, 1_000))


def test_account_filter() -> None:
    series = build_series(ROWS, [OCT, NOV], Filters(account_ids=frozenset({"card"})))
    assert (series.income_cents, series.spending_cents) == (0, 2_500)
    assert [(a.account_id, a.spending_cents) for a in series.accounts] == [("card", 2_500)]


def test_category_filter_including_uncategorized() -> None:
    series = build_series(
        ROWS, [OCT, NOV], Filters(category_ids=frozenset({"fun", "uncategorized"}))
    )
    assert series.spending_cents == 3_500
    assert series.income_cents == 0


def test_accounts_split_in_and_out() -> None:
    series = build_series(ROWS, [OCT, NOV], Filters())
    assert [(a.account_id, a.income_cents, a.spending_cents) for a in series.accounts] == [
        ("card", 0, 2_500),
        ("chq", 100_000, 11_000),
    ]


@pytest.mark.parametrize("months", [[date(2026, 10, 2)], [NOV, OCT], [OCT, OCT]])
def test_rejects_bad_months(months: list[date]) -> None:
    with pytest.raises(ValueError):
        build_series([], months, Filters())


def test_rejects_negative_amounts() -> None:
    with pytest.raises(ValueError):
        build_series([_t("2026-10-01", -1)], [OCT], Filters())
