"""Which Canadian benefits and credits a person may be missing: a screen, not a decision.

Each rule uses what Penny knows (age, whether they study, an estimate of yearly income from
their own records) to say a benefit is "likely" worth claiming or worth "check"ing. The CRA or
the student aid office decides eligibility; Penny only points the way, with the official source.
Amounts are the published 2026 maximums from the Money Guide (frontend guide-content.ts).

The income screen below is Penny's own cut-off for "lower income", not a government threshold.

Integer cents only. Nothing here reads a database or calls a model.
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

Status = Literal["likely", "check"]

# Penny's "lower income" screen for the income-tested benefits (not the CRA's own test).
LOW_INCOME_SCREEN_CENTS = 4_000_000
# The Canada Workers Benefit needs at least this much working income in the year.
CWB_MIN_WORKING_INCOME_CENTS = 300_000
CWB_MAX_SINGLE_CENTS = 166_500
STUDENT_GRANT_MAX_CENTS = 420_000
LEARNING_BOND_MAX_CENTS = 200_000
DENTAL_FAMILY_INCOME_LIMIT_CENTS = 9_000_000


@dataclass(frozen=True, slots=True)
class Profile:
    age: int | None
    student: bool
    # Estimated income over a year (all sources) and from work only, from the person's records.
    yearly_income_cents: int
    yearly_working_income_cents: int


@dataclass(frozen=True, slots=True)
class Match:
    id: str
    name: str
    status: Status
    why: str
    up_to_cents: int | None
    how: str
    guide_id: str
    source_url: str


CRA = "https://www.canada.ca/en/revenue-agency/services"


def tax_deadline(today: date) -> date:
    """The usual filing deadline (April 30) for last year's return, or next year's if it passed."""
    this_year = date(today.year, 4, 30)
    return this_year if today <= this_year else date(today.year + 1, 4, 30)


def screen(profile: Profile) -> list[Match]:
    """Benefits worth a look, most likely first. Filing a return comes first: it unlocks most."""
    low_income = profile.yearly_income_cents < LOW_INCOME_SCREEN_CENTS
    matches = [
        Match(
            id="file_return",
            name="File a tax return every year",
            status="likely",
            why="Filing is how the CRA pays most benefits, even with little or no income.",
            up_to_cents=None,
            how="File online with free certified software before the April 30 deadline.",
            guide_id="filing",
            source_url=f"{CRA}/tax/individuals/topics/about-your-tax-return.html",
        )
    ]
    if profile.age is None or profile.age >= 19:
        matches.append(
            Match(
                id="groceries_essentials",
                name="Canada Groceries and Essentials Benefit (formerly GST/HST credit)",
                status="likely" if low_income and profile.age is not None else "check",
                why="Quarterly tax-free payments for lower-income people 19 and over.",
                up_to_cents=None,
                how="Paid automatically once you file your return.",
                guide_id="benefits",
                source_url=f"{CRA}/child-family-benefits/goods-services-tax-harmonized-sales-tax-gst-hst-credit.html",
            )
        )
    if profile.yearly_working_income_cents >= CWB_MIN_WORKING_INCOME_CENTS:
        matches.append(
            Match(
                id="workers_benefit",
                name="Canada Workers Benefit",
                status="likely" if low_income else "check",
                why="A refundable credit for people who work and have a lower income.",
                up_to_cents=CWB_MAX_SINGLE_CENTS,
                how="Claimed on your tax return; part of it can be paid in advance.",
                guide_id="benefits",
                source_url=f"{CRA}/child-family-benefits/canada-workers-benefit.html",
            )
        )
    if profile.student:
        matches.extend(
            [
                Match(
                    id="student_grant",
                    name="Canada Student Grant",
                    status="likely",
                    why="Full-time students are assessed for it when they apply for student aid.",
                    up_to_cents=STUDENT_GRANT_MAX_CENTS,
                    how="Apply through your province's student aid office, every year.",
                    guide_id="student-loans",
                    source_url="https://www.canada.ca/en/services/benefits/education/student-aid/grants-loans.html",
                ),
                Match(
                    id="tuition_credit",
                    name="Tuition tax credit",
                    status="likely",
                    why="Tuition on your T2202 slip lowers tax now or carries forward.",
                    up_to_cents=None,
                    how="Download your T2202 from your school and claim it on your return.",
                    guide_id="filing",
                    source_url=f"{CRA}/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-32300-your-tuition-education-textbook-amounts.html",
                ),
            ]
        )
    if profile.age is not None and 18 <= profile.age <= 20:
        matches.append(
            Match(
                id="learning_bond",
                name="Canada Learning Bond",
                status="check",
                why="If you grew up in a lower-income family, money may be waiting for you.",
                up_to_cents=LEARNING_BOND_MAX_CENTS,
                how="You can apply for it yourself between ages 18 and 20.",
                guide_id="resp",
                source_url="https://www.canada.ca/en/services/benefits/education/education-savings/bond.html",
            )
        )
    if profile.yearly_income_cents < DENTAL_FAMILY_INCOME_LIMIT_CENTS:
        matches.append(
            Match(
                id="dental",
                name="Canada Dental Care Plan",
                status="check",
                why="For people without dental insurance and with family income under $90,000.",
                up_to_cents=None,
                how="Check whether your school or work plan already covers dental first.",
                guide_id="benefits",
                source_url="https://www.canada.ca/en/services/benefits/dental/dental-care-plan.html",
            )
        )
    order = {"likely": 0, "check": 1}
    return sorted(matches, key=lambda item: order[item.status])
