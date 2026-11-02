"""The Learn game: lessons, challenges, XP, and badges (rules in app.learning.engine)."""

from app.learning.content import LESSONS_BY_ID, TOPICS, LessonContent
from app.learning.engine import AnswerError
from app.learning.models import (
    AnswerResult,
    AnswerWrite,
    AttemptResult,
    AttemptView,
    LearnProfile,
    LearnProfileWrite,
    LearnState,
    LessonDetail,
)
from app.store.dashboard import DashboardViews
from app.store.state import conflict, invalid, not_found


class LearningOps(DashboardViews):
    def learn_state(self, user_id: str) -> LearnState:
        with self._lock:
            self.require_owner(user_id)
            return self._learner.state(self._mission_xp(), self.today())

    def set_learn_profile(self, user_id: str, request: LearnProfileWrite) -> LearnState:
        """Country, chosen topics, and starting level. Progress is kept."""
        with self._lock:
            self.require_owner(user_id)
            topics = [topic for topic, _, _ in TOPICS if topic in set(request.topics)]
            self._learner.set_profile(
                LearnProfile(country=request.country, topics=topics, start_tier=request.start_tier)
            )
            return self._learner.state(self._mission_xp(), self.today())

    def _open_lesson(self, lesson_id: str) -> LessonContent:
        lesson = LESSONS_BY_ID.get(lesson_id)
        if lesson is None or lesson.country not in (None, self._learner.country):
            raise not_found("Lesson not found")
        if not self._learner.is_unlocked(lesson):
            raise conflict("Pass the previous level to unlock this")
        return lesson

    def lesson_detail(self, user_id: str, lesson_id: str) -> LessonDetail:
        with self._lock:
            self.require_owner(user_id)
            return self._learner.detail(self._open_lesson(lesson_id))

    def start_attempt(self, user_id: str, lesson_id: str) -> AttemptView:
        with self._lock:
            self.require_owner(user_id)
            return self._learner.start(self._open_lesson(lesson_id))

    def answer_question(self, user_id: str, attempt_id: str, request: AnswerWrite) -> AnswerResult:
        """Grades one answer, once. XP is awarded only when the attempt is passed."""
        with self._lock:
            self.require_owner(user_id)
            attempt = self._learner.attempts.get(attempt_id)
            if attempt is None:
                raise not_found("Attempt not found")
            today = self.today()
            before = self._learner.state(self._mission_xp(), today)
            try:
                question, correct = self._learner.answer(attempt, request)
            except AnswerError as error:
                raise invalid(str(error)) from error
            result = None
            if attempt.status != "active":
                stars, awarded = (
                    self._learner.record_pass(attempt, today)
                    if attempt.status == "passed"
                    else (0, 0)
                )
                after = self._learner.state(self._mission_xp(), today)
                had = {badge.id for badge in before.badges if badge.earned}
                result = AttemptResult(
                    passed=attempt.status == "passed",
                    stars=stars,
                    mistakes=attempt.mistakes,
                    xp_awarded=awarded,
                    level_before=before.level,
                    level_after=after.level,
                    new_badges=[b for b in after.badges if b.earned and b.id not in had],
                )
                del self._learner.attempts[attempt.id]
            return AnswerResult(
                correct=correct,
                explanation=question.explanation,
                correct_choices=list(question.answer),
                correct_value=question.number,
                hearts_left=attempt.hearts_left,
                status=attempt.status,
                result=result,
                dashboard=self._snapshot() if result else None,
            )
