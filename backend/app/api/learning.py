"""The Learn game. Grading, hearts, and XP live here; answers arrive only after answering."""

from fastapi import APIRouter

from app.api.deps import AuthenticatedUser, user_store
from app.learning.models import (
    AnswerResult,
    AnswerWrite,
    AttemptView,
    LearnProfileWrite,
    LearnState,
    LessonDetail,
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
