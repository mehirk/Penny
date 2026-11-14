"""API shapes for the learning game. Answer keys never appear in anything sent before an answer."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.dashboard_models import DashboardResponse
from app.learning.content import Country, QuestionKind, Tier, Topic, Unit


class LearnModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LearnProfile(LearnModel):
    country: Country | None  # None until the learner finishes onboarding
    topics: list[Topic]
    start_tier: Tier


class LearnProfileWrite(LearnModel):
    country: Country
    topics: list[Topic] = Field(min_length=1, max_length=6)
    start_tier: Tier = "easy"


class LessonCard(LearnModel):
    id: str
    topic: Topic
    tier: Tier
    title: str
    summary: str
    locked: bool
    passed: bool
    stars: int = Field(ge=0, le=3)
    xp_earned: int = Field(ge=0)
    xp_max: int = Field(gt=0)
    hearts: int = Field(gt=0)
    question_count: int = Field(gt=0)


class TopicPath(LearnModel):
    id: Topic
    label: str
    blurb: str
    selected: bool
    lessons: list[LessonCard]


class Badge(LearnModel):
    id: str
    title: str
    description: str
    earned: bool


class LearnState(LearnModel):
    profile: LearnProfile
    xp_total: int = Field(ge=0)
    level: int = Field(ge=1)
    level_xp: int = Field(ge=0)
    level_size_xp: int = Field(gt=0)
    streak_days: int = Field(ge=0)
    completed_today: bool
    topics: list[TopicPath]
    badges: list[Badge]


class LessonTask(LearnModel):
    label: str
    view: Literal["spending", "budgets", "goals", "ai", "settings"]
    prompt: str | None


class LessonDetail(LearnModel):
    card: LessonCard
    cards: list[str]
    task: LessonTask | None


class QuestionOption(LearnModel):
    id: str
    text: str


class QuestionView(LearnModel):
    id: str
    kind: QuestionKind
    prompt: str
    options: list[QuestionOption]  # shuffled per attempt; empty for number questions
    unit: Unit


class AttemptView(LearnModel):
    id: str
    lesson_id: str
    hearts_total: int
    hearts_left: int
    questions: list[QuestionView]


class AnswerWrite(LearnModel):
    question_id: str = Field(min_length=1, max_length=40)
    # Option ids for choice (one), multi (any number), and order (every id, in order);
    # a single typed value such as "1,040" or "14.4" for number questions.
    choices: list[str] = Field(default_factory=list, max_length=10)
    value: str | None = Field(default=None, max_length=20)


class AttemptResult(LearnModel):
    passed: bool
    stars: int = Field(ge=0, le=3)
    mistakes: int = Field(ge=0)
    xp_awarded: int = Field(ge=0)
    level_before: int
    level_after: int
    new_badges: list[Badge]


class AnswerResult(LearnModel):
    correct: bool
    explanation: str
    # The right option ids (in order for order questions), or the expected number as text.
    correct_choices: list[str]
    correct_value: str | None
    hearts_left: int
    status: Literal["active", "passed", "failed"]
    result: AttemptResult | None = None
    # A fresh snapshot once the attempt ends, so XP and streaks update everywhere.
    dashboard: DashboardResponse | None = None


class PracticeChoice(LearnModel):
    id: str
    label: str
    emoji: str
    cost_cents: int = Field(ge=0)
    treat: bool


class PracticeDay(LearnModel):
    id: str
    name: str
    situation: str
    choices: list[PracticeChoice]


class PracticeView(LearnModel):
    """A story game (app.learning.practice), with pretend money, and the best result."""

    id: str
    persona: Literal["student", "working", "learner"]
    title: str
    emoji: str
    blurb: str
    start_cents: int = Field(gt=0)
    goal_cents: int = Field(gt=0)
    goal_name: str
    treats_for_three: int = Field(ge=0)
    days: list[PracticeDay]
    best_stars: int = Field(ge=0, le=3)


class PracticeWrite(LearnModel):
    scenario: str = Field(default="pocket-money", max_length=40)
    # Round id → choice id, one per round.
    choices: dict[str, str] = Field(max_length=10)


class PracticeOutcome(LearnModel):
    left_cents: int = Field(ge=0)
    spent_cents: int = Field(ge=0)
    treats: int = Field(ge=0)
    reached_goal: bool
    stars: int = Field(ge=0, le=3)
    # XP newly earned: replays only add the gain over the best result, like lessons.
    xp_awarded: int = Field(ge=0)
    lessons: list[str]


SortKind = Literal["need", "want"]


class SortCard(LearnModel):
    id: str
    label: str
    emoji: str
    # Sent up front so each card can show right or wrong at once; the score is still the API's.
    kind: SortKind
    why: str


class SortView(LearnModel):
    """Needs or wants (app.learning.sorting): the cards, the clock, and the best result."""

    cards: list[SortCard]
    seconds: int = Field(gt=0)
    best_stars: int = Field(ge=0, le=3)


class SortWrite(LearnModel):
    # Card id → the player's answer, for the cards sorted before time ran out.
    answers: dict[str, SortKind] = Field(max_length=40)


class SortOutcome(LearnModel):
    correct: int = Field(ge=0)
    answered: int = Field(ge=0)
    stars: int = Field(ge=0, le=3)
    xp_awarded: int = Field(ge=0)


class QuestView(LearnModel):
    id: Literal["lesson", "story", "sort"]
    label: str
    emoji: str
    done: bool


class ArcadeView(LearnModel):
    """Learn's games and today's quests. `featured` is the story game made for the persona."""

    featured: str
    stories: list[PracticeView]
    sort: SortView
    quests: list[QuestView]
    chest_xp: int = Field(ge=0)
    chest_claimed: bool


class ChestOutcome(LearnModel):
    xp_awarded: int = Field(ge=0)
    level_before: int = Field(ge=1)
    level_after: int = Field(ge=1)
    arcade: ArcadeView


class SkillOption(LearnModel):
    id: str
    text: str


class SkillQuestionView(LearnModel):
    """A Money IQ question; the answer arrives only with the results."""

    id: str
    area: str
    prompt: str
    options: list[SkillOption]


class SkillCheckView(LearnModel):
    questions: list[SkillQuestionView]
    xp: int = Field(ge=0)


class SkillCheckWrite(LearnModel):
    # Question id → option id, for every question.
    answers: dict[str, str] = Field(max_length=30)


class SkillMarkView(LearnModel):
    question_id: str
    correct: bool
    answer: str
    explanation: str


class AreaView(LearnModel):
    id: str
    label: str
    emoji: str
    check_pct: int = Field(ge=0, le=100)
    lesson_pct: int = Field(ge=0, le=100)
    mastery_pct: int = Field(ge=0, le=100)


class SkillCheckResult(LearnModel):
    marks: list[SkillMarkView]
    areas: list[AreaView]  # weakest first
    xp_awarded: int = Field(ge=0)


class PlanStep(LearnModel):
    """One thing to do next. `lesson_id` for a lesson, `game_id` for a game; a guide step names
    only its area (the app picks guides the person hasn't read)."""

    kind: Literal["lesson", "guide", "game"]
    area: str
    title: str
    lesson_id: str | None = None
    game_id: str | None = None
