"""The Learn game. Grading, hearts, and XP live here; answers arrive only after answering."""

from fastapi import APIRouter

from app.api.deps import AuthenticatedUser, user_store
from app.assist.learning_plan import CoachPlanOut, coach_plan
from app.config import get_settings
from app.learning.models import (
    AnswerResult,
    AnswerWrite,
    ArcadeView,
    AttemptView,
    ChestOutcome,
    LearnProfileWrite,
    LearnState,
    LessonDetail,
    PracticeOutcome,
    PracticeView,
    PracticeWrite,
    SkillCheckResult,
    SkillCheckView,
    SkillCheckWrite,
    SortOutcome,
    SortWrite,
)

router = APIRouter(prefix="/api/v1/learn", tags=["learning"])


@router.get("", response_model=LearnState)
def learn_state(current_user: AuthenticatedUser) -> LearnState:
    """The learning game: profile, topic paths with locks and stars, XP, streak, and badges."""
    return user_store(current_user).learn_state(current_user.id)


@router.put("/profile", response_model=LearnState)
def set_learn_profile(request: LearnProfileWrite, current_user: AuthenticatedUser) -> LearnState:
    """Country (Canada or the US), chosen topics, and starting level. Progress is kept."""
    return user_store(current_user).set_learn_profile(current_user.id, request)


@router.get("/lessons/{lesson_id}", response_model=LessonDetail)
def lesson_detail(lesson_id: str, current_user: AuthenticatedUser) -> LessonDetail:
    """A lesson's reading cards. Locked lessons return 409."""
    return user_store(current_user).lesson_detail(current_user.id, lesson_id)


@router.post("/lessons/{lesson_id}/attempts", response_model=AttemptView)
def start_attempt(lesson_id: str, current_user: AuthenticatedUser) -> AttemptView:
    """Start a challenge: questions without answers, options shuffled, hearts full."""
    return user_store(current_user).start_attempt(current_user.id, lesson_id)


@router.post("/attempts/{attempt_id}/answers", response_model=AnswerResult)
def answer_question(
    attempt_id: str, request: AnswerWrite, current_user: AuthenticatedUser
) -> AnswerResult:
    """Grade one answer, once. XP is awarded only when the attempt is passed."""
    return user_store(current_user).answer_question(current_user.id, attempt_id, request)


@router.get("/arcade", response_model=ArcadeView)
def arcade(current_user: AuthenticatedUser) -> ArcadeView:
    """The games (the persona's story game first, Needs or wants) and today's quests."""
    return user_store(current_user).arcade(current_user.id)


@router.get("/practice", response_model=PracticeView)
def practice_view(current_user: AuthenticatedUser, scenario: str = "pocket-money") -> PracticeView:
    """A story game: pretend money, a choice each round, a savings goal."""
    return user_store(current_user).practice_view(current_user.id, scenario)


@router.post("/practice", response_model=PracticeOutcome)
def play_practice(request: PracticeWrite, current_user: AuthenticatedUser) -> PracticeOutcome:
    """Score a story game's choices; the best result earns XP."""
    return user_store(current_user).play_practice(current_user.id, request)


@router.post("/sort", response_model=SortOutcome)
def play_sort(request: SortWrite, current_user: AuthenticatedUser) -> SortOutcome:
    """Score a round of Needs or wants; the best result earns XP."""
    return user_store(current_user).play_sort(current_user.id, request)


@router.post("/chest", response_model=ChestOutcome)
def open_chest(current_user: AuthenticatedUser) -> ChestOutcome:
    """Open today's chest of bonus XP once the three quests are done."""
    return user_store(current_user).open_chest(current_user.id)


@router.get("/skill-check", response_model=SkillCheckView)
def skill_check(current_user: AuthenticatedUser) -> SkillCheckView:
    """Money IQ: twelve questions across six areas. Answers come back only with the results."""
    return user_store(current_user).skill_check_view(current_user.id)


@router.post("/skill-check", response_model=SkillCheckResult)
def submit_skill_check(
    request: SkillCheckWrite, current_user: AuthenticatedUser
) -> SkillCheckResult:
    """Grade Money IQ; mastery per area blends it with lesson stars."""
    return user_store(current_user).submit_skill_check(current_user.id, request)


@router.get("/coach-plan", response_model=CoachPlanOut)
async def learning_plan(current_user: AuthenticatedUser) -> CoachPlanOut:
    """Knowledge gaps, weakest first, the next lessons, guides, and games, and Penny's note."""
    return await coach_plan(get_settings(), user_store(current_user), current_user.id)
