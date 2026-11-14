"""Sales tax on a purchase in Canada, by province or territory: GST, HST, or GST plus the
provincial tax. Rates in thousandths of a percent (13% = 13_000, Quebec's 9.975% = 9_975), so
the maths stays in integers. Rates as published by the CRA and the provinces; Nova Scotia's HST
is 14% since April 1, 2025. Check them again if a province changes its rate.
"""

from dataclasses import dataclass

# (name, rate in thousandths of a percent)
RATES: dict[str, tuple[str, int]] = {
    "AB": ("GST 5%", 5_000),
    "BC": ("GST 5% + PST 7%", 12_000),
    "MB": ("GST 5% + RST 7%", 12_000),
    "NB": ("HST 15%", 15_000),
    "NL": ("HST 15%", 15_000),
    "NS": ("HST 14%", 14_000),
    "NT": ("GST 5%", 5_000),
    "NU": ("GST 5%", 5_000),
    "ON": ("HST 13%", 13_000),
    "PE": ("HST 15%", 15_000),
    "QC": ("GST 5% + QST 9.975%", 14_975),
    "SK": ("GST 5% + PST 6%", 11_000),
    "YT": ("GST 5%", 5_000),
}
NAMES = {
    "alberta": "AB",
    "british columbia": "BC",
    "manitoba": "MB",
    "new brunswick": "NB",
    "newfoundland and labrador": "NL",
    "newfoundland": "NL",
    "nova scotia": "NS",
    "northwest territories": "NT",
    "nunavut": "NU",
    "ontario": "ON",
    "prince edward island": "PE",
    "quebec": "QC",
    "québec": "QC",
    "saskatchewan": "SK",
    "yukon": "YT",
}


@dataclass(frozen=True)
class WithTax:
    province: str
    tax_name: str
    tax_cents: int
    total_cents: int


def province_code(value: str | None) -> str | None:
    """The two-letter code for "NS", "ns", or "Nova Scotia"; None for anything else."""
    if not value:
        return None
    clean = value.strip()
    if clean.upper() in RATES:
        return clean.upper()
    return NAMES.get(clean.casefold())


def with_tax(price_cents: int, province: str) -> WithTax:
    """The price plus sales tax, rounded half up to the cent."""
    if price_cents <= 0:
        raise ValueError("price must be more than zero")
    code = province_code(province)
    if code is None:
        raise ValueError(f"Unknown province or territory: {province}")
    name, rate = RATES[code]
    tax = (price_cents * rate + 50_000) // 100_000
    return WithTax(code, name, tax, price_cents + tax)
