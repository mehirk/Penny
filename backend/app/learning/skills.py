"""Money IQ: a 12-question skill check across six areas, and the knowledge gaps it shows.

The check is graded here, so the scores are trustworthy. Mastery in each area blends the check
(60%) with stars earned in that area's lessons (40%), in whole percent with integer arithmetic.
The weakest areas become the gaps the coach plan works on; the model only words the plan.
"""

from dataclasses import dataclass
from typing import Literal

Area = Literal["banking", "registered", "credit", "tax", "grow", "protect"]

SKILL_XP = 20
QUIZ_WEIGHT = 60  # percent of mastery from the check; the rest comes from lessons


@dataclass(frozen=True, slots=True)
class AreaInfo:
    id: Area
    label: str
    emoji: str
    # Lesson topics (app.learning.content) that teach this area.
    topics: tuple[str, ...]


AREAS: tuple[AreaInfo, ...] = (
    AreaInfo("banking", "Banking basics", "🏦", ("saving", "rules")),
    AreaInfo("registered", "Government accounts", "🍁", ("saving", "investing")),
    AreaInfo("credit", "Credit & debt", "💳", ("credit",)),
    AreaInfo("tax", "Taxes & benefits", "🧾", ("tax",)),
    AreaInfo("grow", "Save & grow", "🌱", ("budgeting", "investing")),
    AreaInfo("protect", "Protect yourself", "🛡️", ("rules",)),
)
AREAS_BY_ID = {area.id: area for area in AREAS}


@dataclass(frozen=True, slots=True)
class SkillQuestion:
    id: str
    area: Area
    prompt: str
    options: tuple[tuple[str, str], ...]  # (option id, text)
    answer: str
    explanation: str


QUESTIONS: tuple[SkillQuestion, ...] = (
    SkillQuestion(
        "bank-1",
        "banking",
        "Your bank fails. How much of your savings account does CDIC protect?",
        (
            ("a", "Nothing, banks don't fail"),
            ("b", "Up to $100,000"),
            ("c", "Everything, no limit"),
        ),
        "b",
        "CDIC covers eligible deposits up to $100,000 per category at each member bank.",
    ),
    SkillQuestion(
        "bank-2",
        "banking",
        "Which is NOT covered by CDIC deposit insurance?",
        (("a", "A GIC"), ("b", "A chequing account"), ("c", "Stocks and ETFs")),
        "c",
        "Stocks, ETFs, and mutual funds aren't deposits, so CDIC doesn't cover them.",
    ),
    SkillQuestion(
        "reg-1",
        "registered",
        "You take $1,000 out of your TFSA in March. When does that room come back?",
        (("a", "Right away"), ("b", "Next January 1"), ("c", "Never")),
        "b",
        "TFSA withdrawals are added back to your room on January 1 of the next year.",
    ),
    SkillQuestion(
        "reg-2",
        "registered",
        "Which account gives a tax deduction AND tax-free withdrawals for a first home?",
        (("a", "FHSA"), ("b", "TFSA"), ("c", "Chequing")),
        "a",
        "The FHSA is deductible going in and tax-free coming out for a qualifying first home.",
    ),
    SkillQuestion(
        "credit-1",
        "credit",
        "You pay your full card balance by the due date. What interest do new purchases cost?",
        (("a", "None"), ("b", "About 20% a year"), ("c", "Only the minimum's interest")),
        "a",
        "Paying in full keeps the interest-free grace period, which is at least 21 days.",
    ),
    SkillQuestion(
        "credit-2",
        "credit",
        "What matters most for your credit score?",
        (("a", "How much you earn"), ("b", "Paying on time"), ("c", "Which bank you use")),
        "b",
        "Payment history is the biggest factor. Income isn't part of your credit score.",
    ),
    SkillQuestion(
        "tax-1",
        "tax",
        "A raise moves you into a higher tax bracket. What happens?",
        (
            ("a", "All your income is taxed at the higher rate"),
            ("b", "Only the income above the line is taxed higher"),
            ("c", "You take home less than before"),
        ),
        "b",
        "Brackets are marginal: only the part above each threshold gets the higher rate.",
    ),
    SkillQuestion(
        "tax-2",
        "tax",
        "You earned very little this year. Why file a tax return anyway?",
        (
            ("a", "There's no reason to"),
            ("b", "To get benefits and refunds"),
            ("c", "To raise your credit score"),
        ),
        "b",
        "Filing is how benefits like the Groceries and Essentials Benefit and refunds are paid.",
    ),
    SkillQuestion(
        "grow-1",
        "grow",
        "In the 50/30/20 rule, what is the 20 for?",
        (("a", "Rent"), ("b", "Fun"), ("c", "Savings and paying debt")),
        "c",
        "About 20% of take-home pay for savings and debt payments is the usual rule of thumb.",
    ),
    SkillQuestion(
        "grow-2",
        "grow",
        "How big is an emergency fund usually meant to be?",
        (
            ("a", "One week of spending"),
            ("b", "3 to 6 months of essentials"),
            ("c", "A full year's pay"),
        ),
        "b",
        "A common target is 3 to 6 months of essential expenses, built up a little at a time.",
    ),
    SkillQuestion(
        "protect-1",
        "protect",
        "A caller says they're the CRA and you must pay a debt in gift cards today. What is it?",
        (("a", "A scam"), ("b", "Normal CRA practice"), ("c", "Only real if they know your SIN")),
        "a",
        "The CRA never asks for gift cards, crypto, or e-Transfers. Hang up and report it.",
    ),
    SkillQuestion(
        "protect-2",
        "protect",
        "Your bank hasn't answered your complaint after 56 days. What can you do?",
        (("a", "Nothing"), ("b", "Take it to OBSI for free"), ("c", "Sue right away")),
        "b",
        "After 56 days you can take it to the Ombudsman for Banking Services and Investments.",
    ),
)
QUESTIONS_BY_ID = {question.id: question for question in QUESTIONS}
PER_AREA = 2


@dataclass(frozen=True, slots=True)
class SkillMark:
    question_id: str
    correct: bool
    answer: str
    explanation: str


def grade(answers: dict[str, str]) -> tuple[dict[Area, int], tuple[SkillMark, ...]]:
    """Right answers per area, and a mark per question. Every question needs an answer."""
    if set(answers) != set(QUESTIONS_BY_ID):
        raise ValueError("Answer every question")
    right: dict[Area, int] = {area.id: 0 for area in AREAS}
    marks = []
    for question in QUESTIONS:
        correct = answers[question.id] == question.answer
        right[question.area] += correct
        marks.append(SkillMark(question.id, correct, question.answer, question.explanation))
    return right, tuple(marks)


@dataclass(frozen=True, slots=True)
class AreaMastery:
    area: AreaInfo
    check_pct: int
    lesson_pct: int
    mastery_pct: int


def mastery(right: dict[Area, int], stars: dict[Area, tuple[int, int]]) -> list[AreaMastery]:
    """Each area's mastery, weakest first. `stars` maps an area to (stars earned, stars possible)
    in its lessons; an area with no lessons counts only the check."""
    out = []
    for area in AREAS:
        check = right.get(area.id, 0) * 100 // PER_AREA
        earned, possible = stars.get(area.id, (0, 0))
        lesson = earned * 100 // possible if possible else check
        blended = (check * QUIZ_WEIGHT + lesson * (100 - QUIZ_WEIGHT)) // 100
        out.append(AreaMastery(area, check, lesson, blended))
    # Weakest first; ties keep the AREAS order so the plan is stable.
    return sorted(out, key=lambda item: item.mastery_pct)
