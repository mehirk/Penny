"""Daily quests: three small goals a day, and a chest of bonus XP for finishing all three.

Progress is kept beside lesson results as marker rows ("quest:2026-11-14:lesson"), so it
needs no table of its own; markers earn no XP and never count toward badges. The chest is
a result row too, holding its XP.
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

QuestKind = Literal["lesson", "story", "sort"]

CHEST_XP = 25
QUEST_IDS: tuple[QuestKind, ...] = ("lesson", "story", "sort")


@dataclass(frozen=True, slots=True)
class Quest:
    id: QuestKind
    label: str
    emoji: str


def quests(story_title: str) -> tuple[Quest, ...]:
    """Today's quests; the story game is the one made for the player's persona."""
    return (
        Quest("lesson", "Pass a lesson", "📘"),
        Quest("story", f"Play {story_title}", "🎲"),
        Quest("sort", "Get 2 stars in Needs or wants", "⚡"),
    )


def marker_id(day: date, quest: QuestKind) -> str:
    return f"quest:{day.isoformat()}:{quest}"


def chest_id(day: date) -> str:
    return f"chest:{day.isoformat()}"


def is_marker(result_id: str) -> bool:
    return result_id.startswith(("quest:", "chest:"))
