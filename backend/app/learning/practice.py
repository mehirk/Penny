"""Story games: a stretch of life played with pretend money, one choice per round.

Each scenario fits a persona: a pocket-money week (just learning), a month of student life
(student), and the first month on a paycheque (working). The player starts with some money and
wants a goal amount left at the end. The best result isn't spending nothing: it's reaching the
goal while still enjoying something, so three stars need both. Nothing here reads a database or
calls a model.
"""

from dataclasses import dataclass
from typing import Literal

Persona = Literal["student", "working", "learner"]

XP_PER_STAR = 10


@dataclass(frozen=True, slots=True)
class Choice:
    id: str
    label: str
    emoji: str
    cost_cents: int
    treat: bool


@dataclass(frozen=True, slots=True)
class Day:
    id: str
    name: str
    situation: str
    choices: tuple[Choice, ...]


@dataclass(frozen=True, slots=True)
class Scenario:
    id: str
    persona: Persona
    title: str
    emoji: str
    blurb: str
    start_cents: int
    goal_cents: int
    goal_name: str
    # Treats needed (with the goal) for three stars.
    treats_for_three: int
    days: tuple[Day, ...]
    # What the result teaches: (goal and fun, goal only, short of the goal, money ran out).
    lessons: tuple[tuple[str, str], tuple[str, str], tuple[str, str], tuple[str, str]]

    @property
    def result_id(self) -> str:
        """Where the best result is kept, beside lesson results."""
        return f"practice-{self.id}"


POCKET_MONEY = Scenario(
    id="pocket-money",
    persona="learner",
    title="Pocket money challenge",
    emoji="🍬",
    blurb="$20 of pretend money for a week. Keep $10 for a new book and still have fun.",
    start_cents=2_000,
    goal_cents=1_000,
    goal_name="a new book",
    treats_for_three=2,
    days=(
        Day(
            "mon",
            "Monday",
            "The corner store has your favourite candy.",
            (
                Choice("candy", "Buy the candy", "🍬", 300, True),
                Choice("skip", "Save it for later", "🪙", 0, False),
            ),
        ),
        Day(
            "tue",
            "Tuesday",
            "Your friends are getting bubble tea after class.",
            (
                Choice("bubble-tea", "Get a bubble tea", "🧋", 600, True),
                Choice("water", "Bring water from home", "💧", 0, False),
            ),
        ),
        Day(
            "wed",
            "Wednesday",
            "A game skin you like is on sale.",
            (
                Choice("skin", "Buy the skin", "🎮", 800, True),
                Choice("play", "Play with what you have", "🕹️", 0, False),
            ),
        ),
        Day(
            "thu",
            "Thursday",
            "It's raining and it's a 40-minute walk to school.",
            (
                Choice("bus", "Take the bus", "🚌", 200, False),
                Choice("walk", "Walk in the rain", "🌧️", 0, False),
            ),
        ),
        Day(
            "fri",
            "Friday",
            "Your friends are going to the movies.",
            (
                Choice("movie", "Buy a movie ticket", "🎬", 1_000, True),
                Choice("home", "Movie night at a friend's place", "🏠", 0, True),
            ),
        ),
    ),
    lessons=(
        (
            "You reached your goal and still had fun. That's what a good budget does.",
            "Free swaps (water from home, a movie at a friend's) kept your treats and your goal.",
        ),
        (
            "You reached your goal. Saving everything works, but a budget can include fun too.",
            "Try again and see how many treats still fit your goal.",
        ),
        (
            "Small treats add up: a few of them used the money for the book.",
            "Deciding your goal first, then what's left for fun, makes the choices easier.",
        ),
        (
            "The pocket money ran out before Friday, so there was nothing left for the book.",
            "Needs like the bus come first. Then the goal. Then treats from what's left.",
        ),
    ),
)

SEMESTER = Scenario(
    id="semester",
    persona="student",
    title="Semester survival",
    emoji="🎓",
    blurb="$900 left after rent for the month. Keep a $250 cushion and still enjoy student life.",
    start_cents=90_000,
    goal_cents=25_000,
    goal_name="your emergency cushion",
    treats_for_three=2,
    days=(
        Day(
            "week-1",
            "Week 1",
            "Classes start, and the bookstore wants $280 for your textbooks.",
            (
                Choice("new-books", "Buy them new", "📚", 28_000, False),
                Choice("used-books", "Buy used online", "📦", 9_000, False),
                Choice("library", "Borrow the library copy", "🏛️", 0, False),
            ),
        ),
        Day(
            "week-2",
            "Week 2",
            "Midterm prep. Takeout every night sounds easier than cooking.",
            (
                Choice("takeout", "Takeout all week", "🍕", 12_000, True),
                Choice("cook", "Cook with roommates", "🍝", 4_500, False),
            ),
        ),
        Day(
            "week-3",
            "Week 3",
            "Your friends have tickets to a concert downtown.",
            (
                Choice("concert", "Go to the concert", "🎤", 15_000, True),
                Choice("campus", "Free campus show instead", "🎸", 0, True),
            ),
        ),
        Day(
            "week-4",
            "Week 4",
            "Your phone screen cracks.",
            (
                Choice("repair", "Get it repaired now", "📱", 18_000, False),
                Choice("protector", "Screen protector and wait", "🩹", 1_500, False),
            ),
        ),
        Day(
            "reading-week",
            "Reading week",
            "Everyone is planning a trip.",
            (
                Choice("trip", "Weekend trip with friends", "🧳", 40_000, True),
                Choice("day-trip", "A day trip by train", "🚆", 6_000, True),
            ),
        ),
    ),
    lessons=(
        (
            "Cushion kept and a great month. Cheaper choices paid for the fun.",
            "A cushion means a cracked phone is an annoyance, not a crisis.",
        ),
        (
            "Cushion kept. Remember a student budget can include the fun parts of school too.",
            "Try again and see which treats still fit.",
        ),
        (
            "Extras ate into your cushion. Textbooks and takeout are easy places to save.",
            "Decide the cushion first, then spend what's left.",
        ),
        (
            "The money ran out before the month did, with nothing left for emergencies.",
            "Needs first, then the cushion, then treats from what's left.",
        ),
    ),
)

FIRST_PAYCHEQUE = Scenario(
    id="first-paycheque",
    persona="working",
    title="First paycheque",
    emoji="💼",
    blurb="$1,000 left after rent and bills from your first paycheque. Save $300 of it.",
    start_cents=100_000,
    goal_cents=30_000,
    goal_name="savings",
    treats_for_three=3,
    days=(
        Day(
            "lunch",
            "Monday",
            "Everyone at work goes out for lunch.",
            (
                Choice("buy-lunch", "Buy lunch every day", "🥡", 22_000, True),
                Choice("pack-lunch", "Pack lunch most days", "🥪", 7_000, False),
            ),
        ),
        Day(
            "commute",
            "Getting to work",
            "It's a 30-minute commute.",
            (
                Choice("rideshare", "Rideshare every day", "🚗", 16_000, True),
                Choice("transit", "Monthly transit pass", "🚇", 12_800, False),
            ),
        ),
        Day(
            "team-dinner",
            "Friday night",
            "Your team is going out for dinner.",
            (
                Choice("dinner", "Go for dinner", "🍽️", 6_500, True),
                Choice("dessert", "Join for dessert only", "🍰", 2_000, True),
            ),
        ),
        Day(
            "streaming",
            "Subscriptions",
            "You're paying for four streaming apps.",
            (
                Choice("keep-all", "Keep all four", "📺", 6_000, True),
                Choice("keep-one", "Keep your favourite", "🍿", 1_500, True),
            ),
        ),
        Day(
            "headphones",
            "Big sale",
            "The headphones you want are on sale for $250.",
            (
                Choice("buy-now", "Buy them now", "🎧", 25_000, True),
                Choice("wait", "Wait and save up", "⏳", 0, False),
            ),
        ),
    ),
    lessons=(
        (
            "Savings hit, and you enjoyed your money. Pay yourself first, then enjoy the rest.",
            "Small daily costs (lunch, rides) were the easiest places to find room.",
        ),
        (
            "Savings hit. A paycheque budget can include more fun than that.",
            "Try again and see how many treats still fit.",
        ),
        (
            "Daily costs and one big buy took part of your savings.",
            "Move the savings out on payday, then spend what's left.",
        ),
        (
            "The paycheque ran out before the month did.",
            "Bills first, then savings, then wants from what's left.",
        ),
    ),
)

SCENARIOS: dict[str, Scenario] = {s.id: s for s in (POCKET_MONEY, SEMESTER, FIRST_PAYCHEQUE)}

# Kept for the original pocket-money week's callers.
POCKET_MONEY_CENTS = POCKET_MONEY.start_cents
GOAL_CENTS = POCKET_MONEY.goal_cents
GOAL_NAME = POCKET_MONEY.goal_name
PRACTICE_ID = POCKET_MONEY.result_id
WEEK = POCKET_MONEY.days


def scenario_for(persona: Persona | None) -> Scenario:
    """The story game made for this persona (pocket money when there's none yet)."""
    return next((s for s in SCENARIOS.values() if s.persona == persona), POCKET_MONEY)


@dataclass(frozen=True, slots=True)
class PracticeResult:
    left_cents: int
    spent_cents: int
    treats: int
    reached_goal: bool
    stars: int
    xp: int
    lessons: tuple[str, ...]


def play(choices: dict[str, str], scenario: Scenario = POCKET_MONEY) -> PracticeResult:
    """Scores one run: `choices` maps each round's id to the choice id picked. Raises ValueError
    for a missing round, an unknown choice, or spending money that's already gone."""
    if set(choices) != {day.id for day in scenario.days}:
        raise ValueError("Pick something for every round")
    left = scenario.start_cents
    treats = 0
    for day in scenario.days:
        choice = next((c for c in day.choices if c.id == choices[day.id]), None)
        if choice is None:
            raise ValueError(f"Unknown choice for {day.name}")
        if choice.cost_cents > left:
            raise ValueError(f"Not enough money left for {day.name}")
        left -= choice.cost_cents
        treats += choice.treat
    reached = left >= scenario.goal_cents
    best = reached and treats >= scenario.treats_for_three
    stars = 3 if best else 2 if reached else 1 if left > 0 else 0
    outcome = 0 if best else 1 if reached else 2 if left > 0 else 3
    return PracticeResult(
        left_cents=left,
        spent_cents=scenario.start_cents - left,
        treats=treats,
        reached_goal=reached,
        stars=stars,
        xp=stars * XP_PER_STAR,
        lessons=scenario.lessons[outcome],
    )
