"""Planning a move within Canada: where to, every cost a move brings (including the ones people
forget to ask about), the paperwork and when to do it, and how the monthly costs compare with
today's. Deterministic: amounts in integer cents, dates counted from the move date.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.domain.sales_tax import RATES

# Cities people move to, by province or territory (the profile's own city is matched too).
CITIES: dict[str, str] = {
    "toronto": "ON",
    "ottawa": "ON",
    "mississauga": "ON",
    "brampton": "ON",
    "hamilton": "ON",
    "london": "ON",
    "kitchener": "ON",
    "waterloo": "ON",
    "guelph": "ON",
    "kingston": "ON",
    "windsor": "ON",
    "sudbury": "ON",
    "thunder bay": "ON",
    "oshawa": "ON",
    "montreal": "QC",
    "montréal": "QC",
    "quebec city": "QC",
    "québec city": "QC",
    "gatineau": "QC",
    "sherbrooke": "QC",
    "vancouver": "BC",
    "victoria": "BC",
    "burnaby": "BC",
    "surrey": "BC",
    "kelowna": "BC",
    "calgary": "AB",
    "edmonton": "AB",
    "lethbridge": "AB",
    "winnipeg": "MB",
    "saskatoon": "SK",
    "regina": "SK",
    "halifax": "NS",
    "dartmouth": "NS",
    "sydney": "NS",
    "wolfville": "NS",
    "antigonish": "NS",
    "fredericton": "NB",
    "moncton": "NB",
    "saint john": "NB",
    "st. john's": "NL",
    "st john's": "NL",
    "charlottetown": "PE",
    "whitehorse": "YT",
    "yellowknife": "NT",
    "iqaluit": "NU",
}
PROVINCE_NAMES = {
    "AB": "Alberta",
    "BC": "British Columbia",
    "MB": "Manitoba",
    "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador",
    "NS": "Nova Scotia",
    "NT": "the Northwest Territories",
    "NU": "Nunavut",
    "ON": "Ontario",
    "PE": "Prince Edward Island",
    "QC": "Quebec",
    "SK": "Saskatchewan",
    "YT": "Yukon",
}
HEALTH_PLANS = {
    "AB": "Alberta Health Care (AHCIP)",
    "BC": "BC's Medical Services Plan (MSP)",
    "MB": "Manitoba Health",
    "NB": "New Brunswick Medicare",
    "NL": "Newfoundland and Labrador's MCP",
    "NS": "Nova Scotia's MSI",
    "NT": "the NWT Health Care Plan",
    "NU": "the Nunavut Health Care Plan",
    "ON": "OHIP",
    "PE": "PEI's Health Card",
    "QC": "Quebec's RAMQ",
    "SK": "Saskatchewan Health",
    "YT": "Yukon's YHCIP",
}
assert set(PROVINCE_NAMES) == set(RATES) == set(HEALTH_PLANS)

_MOVE_WORDS = re.compile(
    r"\b(mov(e|ing|ed)|relocat\w*|new city|transfer(ring)? to"
    r"|start(ing)? (school|work|a job) in)\b",
    re.IGNORECASE,
)
_MONTHS = {
    name: number
    for number, names in enumerate(
        (
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sept", "sep"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ),
        start=1,
    )
    for name in names
}


def is_move(text: str) -> bool:
    """Whether the user is talking about moving somewhere."""
    return bool(_MOVE_WORDS.search(text))


@dataclass(frozen=True)
class Place:
    city: str
    province: str | None  # None for a city Penny doesn't know


def _title(city: str) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in city.split())


def city_of(text: str) -> Place | None:
    """A known Canadian city in `text`, or None."""
    lowered = text.casefold()
    for city in sorted(CITIES, key=len, reverse=True):
        if re.search(rf"(?<![\w']){re.escape(city)}(?![\w'])", lowered):
            return Place(_title(city), CITIES[city])
    return None


def destination(text: str) -> Place | None:
    """Where the user is moving: the city after "to", else after "in", else any city they
    name ("I live in Halifax and I'm moving to Toronto" is Toronto)."""
    for word in ("to", "in"):
        for found in re.finditer(rf"\b{word}\s+([A-Za-zÀ-ÿ.' ]{{3,30}})", text):
            place = city_of(found.group(1))
            if place:
                return place
    known = city_of(text)
    if known:
        return known
    named = re.search(r"\bto\s+([A-Z][a-zÀ-ÿ]+(?:\s[A-Z][a-zÀ-ÿ]+)?)", text)
    return Place(named.group(1), None) if named else None


def move_date(text: str, today: date) -> date | None:
    """The first of the month the user names ("in May", "next month", "in 3 months"); a month
    already past this year means next year's."""
    lowered = text.casefold()
    ahead = re.search(r"\bin\s+(\d{1,2}|a|one|two|three|four|six)\s+months?\b", lowered)
    if ahead:
        words = {"a": 1, "one": 1, "two": 2, "three": 3, "four": 4, "six": 6}
        count = words.get(ahead.group(1)) or int(ahead.group(1))
        return first_of_month(today, count)
    if re.search(r"\bnext month\b", lowered):
        return first_of_month(today, 1)
    for word in re.findall(r"[a-z]+", lowered):
        month = _MONTHS.get(word)
        # "may" is a month only after "in" or "by" ("I may move" isn't May).
        if month and (word != "may" or re.search(r"\b(in|by|this|next)\s+may\b", lowered)):
            year = today.year + (1 if month <= today.month else 0)
            return date(year, month, 1)
    return None


def first_of_month(today: date, months_ahead: int) -> date:
    index = today.month - 1 + months_ahead
    return date(today.year + index // 12, index % 12 + 1, 1)


# ------------------------------------------------------------------ costs


@dataclass(frozen=True)
class CostLine:
    id: str
    label: str
    monthly: bool
    # Words that mean the user asked about it.
    words: tuple[str, ...]


# A word ending in * matches any ending ("grocer*": grocery, groceries); others are whole
# words, so "rent" isn't found in "current" or "van" in "Vancouver".
COSTS: tuple[CostLine, ...] = (
    CostLine(
        "travel",
        "Getting there",
        False,
        ("flight*", "fly", "flying", "plane", "train", "ticket*", "travel*", "drive", "driving"),
    ),
    CostLine(
        "deposit",
        "First and last month's rent",
        False,
        ("deposit*", "first and last", "first month", "last month"),
    ),
    CostLine(
        "movers",
        "Movers or shipping",
        False,
        ("mover*", "packer*", "truck*", "u-haul", "uhaul", "van", "shipping", "boxes"),
    ),
    CostLine(
        "setup",
        "Furniture and setting up",
        False,
        ("furniture", "bed", "mattress*", "setup", "set up", "kitchen"),
    ),
    CostLine("rent", "Rent", True, ("rent", "rental")),
    CostLine(
        "transit",
        "Transit",
        True,
        (
            "transit",
            "bus",
            "buses",
            "subway",
            "ttc",
            "presto",
            "commut*",
            "metro",
            "skytrain",
            "go train",
        ),
    ),
    CostLine("groceries", "Groceries", True, ("grocer*", "food")),
    CostLine(
        "phone",
        "Phone and internet",
        True,
        ("phone*", "cell*", "internet", "wifi", "wi-fi", "data plan"),
    ),
    CostLine("utilities", "Utilities", True, ("utilit*", "hydro", "electric*", "heat*")),
    CostLine("insurance", "Tenant insurance", True, ("insurance",)),
)
COST_IDS = tuple(line.id for line in COSTS)


def _mentions(text: str, word: str) -> bool:
    stem = re.escape(word.rstrip("*"))
    return bool(re.search(rf"\b{stem}" + (r"\w*" if word.endswith("*") else r"s?\b"), text))


def asked_about(text: str) -> tuple[list[CostLine], list[CostLine]]:
    """The cost lines the user asked about, and the ones a move needs that they didn't."""
    lowered = text.casefold()
    asked = [line for line in COSTS if any(_mentions(lowered, word) for word in line.words)]
    return asked, [line for line in COSTS if line not in asked]


Basis = Literal["you", "web", "now", "rent", "to_price"]


@dataclass(frozen=True)
class Line:
    id: str
    label: str
    monthly: bool
    cents: int | None
    # Where the amount is from: the user, the web, what they spend now, from the rent, or not
    # priced yet (no figure is ever made up).
    basis: Basis


@dataclass(frozen=True)
class MoveCosts:
    upfront: list[Line]
    monthly: list[Line]
    upfront_cents: int
    monthly_cents: int
    # The same monthly lines as they cost today (what the user spends on them now).
    monthly_now_cents: int
    monthly_change_cents: int
    to_price: list[str]


def costs(amounts: dict[str, tuple[int, Basis]], now: dict[str, int]) -> MoveCosts:
    """Totals the move from the amounts known so far. `amounts` maps cost ids to (cents,
    basis); the deposit defaults to two months of the rent. `now` maps monthly cost ids to what
    they cost today."""
    for key, (cents, _) in amounts.items():
        if key not in COST_IDS or cents < 0:
            raise ValueError(f"Unknown or negative cost: {key}")
    amounts = dict(amounts)
    if "deposit" not in amounts and "rent" in amounts:
        amounts["deposit"] = (amounts["rent"][0] * 2, "rent")
    lines = [Line(c.id, c.label, c.monthly, *amounts.get(c.id, (None, "to_price"))) for c in COSTS]
    upfront = [line for line in lines if not line.monthly]
    monthly = [line for line in lines if line.monthly]
    priced = [line for line in monthly if line.cents is not None]
    monthly_cents = sum(line.cents or 0 for line in priced)
    now_cents = sum(now.get(line.id, 0) for line in priced)
    return MoveCosts(
        upfront=upfront,
        monthly=monthly,
        upfront_cents=sum(line.cents or 0 for line in upfront),
        monthly_cents=monthly_cents,
        monthly_now_cents=now_cents,
        monthly_change_cents=monthly_cents - now_cents,
        to_price=[line.label for line in lines if line.cents is None],
    )


def months_to_save(total_cents: int, monthly_cents: int) -> int | None:
    """Whole months to save `total_cents` at `monthly_cents` a month; None if nothing's saved."""
    if monthly_cents <= 0:
        return None
    return max(1, -(-total_cents // monthly_cents))


# ------------------------------------------------------------------ checklist

Stage = Literal["before", "moving", "after"]


@dataclass(frozen=True)
class Task:
    id: str
    title: str
    detail: str
    due_on: date
    stage: Stage


def checklist(move_on: date, today: date, origin: str | None, to: str | None) -> list[Task]:
    """What to do and when, for a move on `move_on` from province `origin` to province `to`.
    Moving to another province adds the health card and the driver's licence."""

    def task(key: str, days: int, stage: Stage, title: str, detail: str) -> Task:
        return Task(key, title, detail, max(today, move_on + timedelta(days=days)), stage)

    tasks = [
        task(
            "notice",
            -60,
            "before",
            "Give your landlord notice",
            "Check your lease and your province's rules for how much written notice you owe.",
        ),
        task(
            "movers",
            -45,
            "before",
            "Get 2 or 3 quotes for movers or a van",
            "Or price shipping a few boxes if you're flying: it's often cheaper than movers.",
        ),
        task(
            "travel",
            -42,
            "before",
            "Book your flight, train, or bus",
            "Fares usually climb in the last few weeks before you go.",
        ),
        task(
            "insurance",
            -28,
            "before",
            "Get tenant insurance for the new place",
            "Many landlords ask for proof of it before you get the keys.",
        ),
        task(
            "mail",
            -14,
            "before",
            "Forward your mail with Canada Post",
            "So nothing gets lost while you update your address everywhere.",
        ),
        task(
            "services",
            -14,
            "before",
            "Cancel or move internet, hydro, and your phone plan",
            "Ask about cancellation fees, and book internet at the new place now.",
        ),
        task(
            "address",
            0,
            "moving",
            "Update your address: CRA, bank, school, employer",
            "Change it in CRA My Account so benefit payments and tax mail follow you.",
        ),
    ]
    if to and origin and to != origin:
        new_plan, old_plan = HEALTH_PLANS[to], HEALTH_PLANS[origin]
        where = PROVINCE_NAMES[to]
        tasks += [
            task(
                "health",
                1,
                "after",
                f"Apply for {new_plan}",
                f"Apply as soon as you arrive and tell {old_plan} you've moved. Ask whether "
                "there's a waiting period, and stay covered in between.",
            ),
            task(
                "licence",
                7,
                "after",
                f"Switch your driver's licence to {where}",
                "New residents get a limited time to exchange it. Bring your current licence.",
            ),
        ]
    tasks.append(
        task(
            "receipts",
            14,
            "after",
            "Keep your moving receipts",
            "If you move 40 km or more closer to school or work, the CRA lets you claim some "
            "moving costs. Worth checking at tax time.",
        )
    )
    return sorted(tasks, key=lambda t: t.due_on)
