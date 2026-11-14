"""Needs or wants: a quick sorting game. Each card is something people spend on; the player
says whether it's a need or a want before the clock runs out.

The answers are general rules of thumb for students and young workers, and each comes with a
short reason. Scoring is here; the clock is the app's (a slow player just sorts fewer cards).
"""

from dataclasses import dataclass
from typing import Literal

Kind = Literal["need", "want"]

SORT_ID = "game-needs-or-wants"
XP_PER_STAR = 10
SECONDS = 45


@dataclass(frozen=True, slots=True)
class Card:
    id: str
    label: str
    emoji: str
    kind: Kind
    why: str


CARDS: tuple[Card, ...] = (
    Card("rent", "Rent", "🏠", "need", "A place to live comes first."),
    Card("groceries", "Groceries", "🥦", "need", "Food you cook at home is a need."),
    Card("takeout", "Takeout delivery", "🛵", "want", "Food is a need; delivery is a want."),
    Card("bus-pass", "Bus pass to school", "🚌", "need", "Getting to class or work is a need."),
    Card("tuition", "Tuition", "🎓", "need", "Required to stay in school."),
    Card("textbooks", "Textbooks for class", "📚", "need", "Needed for your courses."),
    Card("concert", "Concert tickets", "🎤", "want", "Worth budgeting for, but a want."),
    Card("phone-plan", "Basic phone plan", "📶", "need", "Hard to work or study without one."),
    Card("new-phone", "Latest phone upgrade", "📱", "want", "Your current phone still works."),
    Card("winter-boots", "Winter boots", "🥾", "need", "Canadian winters make these a need."),
    Card("sneakers", "Third pair of sneakers", "👟", "want", "You already have shoes."),
    Card("medicine", "Prescription medicine", "💊", "need", "Health comes first."),
    Card("streaming", "Streaming subscriptions", "📺", "want", "Entertainment is a want."),
    Card("internet", "Home internet", "🌐", "need", "Needed for school and work."),
    Card("latte", "Coffee shop latte", "☕", "want", "A treat, not a need."),
    Card("console", "New gaming console", "🎮", "want", "Fun, but not essential."),
    Card("insurance", "Renter's insurance", "🛡️", "need", "Protects what you own; often required."),
    Card("hoodie", "Designer hoodie", "🧥", "want", "A warm coat is a need; a brand is a want."),
)

CARDS_BY_ID = {card.id: card for card in CARDS}


@dataclass(frozen=True, slots=True)
class SortResult:
    correct: int
    answered: int
    stars: int
    xp: int
    # (card id, the right answer, the player was right)
    marks: tuple[tuple[str, Kind, bool], ...]


def score(answers: dict[str, Kind]) -> SortResult:
    """Scores the cards sorted before time ran out. Raises ValueError for an unknown card."""
    unknown = set(answers) - set(CARDS_BY_ID)
    if unknown:
        raise ValueError("Unknown card")
    marks = tuple(
        (card_id, CARDS_BY_ID[card_id].kind, CARDS_BY_ID[card_id].kind == kind)
        for card_id, kind in answers.items()
    )
    correct = sum(right for _, _, right in marks)
    answered = len(marks)
    # Accuracy in whole percent, rounded down (integers only).
    accuracy = correct * 100 // answered if answered else 0
    stars = (
        3
        if correct >= 12 and accuracy >= 90
        else 2
        if correct >= 8 and accuracy >= 75
        else 1
        if correct >= 4
        else 0
    )
    return SortResult(correct, answered, stars, stars * XP_PER_STAR, marks)
