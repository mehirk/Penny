"""The Learn game: lessons, challenges, XP, and badges (rules in app.learning.engine)."""

from datetime import date

from app.learning import practice, quests, skills, sorting
from app.learning.content import LESSONS_BY_ID, TOPICS, LessonContent
from app.learning.engine import AnswerError, LessonResult
from app.learning.models import (
    AnswerResult,
    AnswerWrite,
    ArcadeView,
    AreaView,
    AttemptResult,
    AttemptView,
    ChestOutcome,
    LearnProfile,
    LearnProfileWrite,
    LearnState,
    LessonDetail,
    PlanStep,
    PracticeChoice,
    PracticeDay,
    PracticeOutcome,
    PracticeView,
    PracticeWrite,
    QuestView,
    SkillCheckResult,
    SkillCheckView,
    SkillCheckWrite,
    SkillMarkView,
    SkillOption,
    SkillQuestionView,
    SortCard,
    SortOutcome,
    SortView,
    SortWrite,
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
                if attempt.status == "passed":
                    self._quest_done("lesson", today)
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

    # ---------------------------------------------------------------- games and quests

    def _keep_best(self, result_id: str, stars: int, xp: int, today: date) -> int:
        """Keeps a game's best result, like a lesson's, and returns the XP newly earned."""
        previous = self._learner.results.get(result_id)
        awarded = max(0, xp - (previous.xp_earned if previous else 0))
        if stars:
            self._learner.results[result_id] = LessonResult(
                stars=max(stars, previous.stars if previous else 0),
                xp_earned=max(xp, previous.xp_earned if previous else 0),
                first_passed=previous.first_passed if previous else today,
            )
            self._learner.activity_days.add(today)
        return awarded

    def _quest_done(self, quest: quests.QuestKind, today: date) -> None:
        marker = quests.marker_id(today, quest)
        if marker not in self._learner.results:
            self._learner.results[marker] = LessonResult(stars=0, xp_earned=0, first_passed=today)

    def _featured(self) -> practice.Scenario:
        return practice.scenario_for(self._profile.persona)

    def _story_view(self, scenario: practice.Scenario) -> PracticeView:
        best = self._learner.results.get(scenario.result_id)
        return PracticeView(
            id=scenario.id,
            persona=scenario.persona,
            title=scenario.title,
            emoji=scenario.emoji,
            blurb=scenario.blurb,
            start_cents=scenario.start_cents,
            goal_cents=scenario.goal_cents,
            goal_name=scenario.goal_name,
            treats_for_three=scenario.treats_for_three,
            days=[
                PracticeDay(
                    id=day.id,
                    name=day.name,
                    situation=day.situation,
                    choices=[
                        PracticeChoice(
                            id=c.id,
                            label=c.label,
                            emoji=c.emoji,
                            cost_cents=c.cost_cents,
                            treat=c.treat,
                        )
                        for c in day.choices
                    ],
                )
                for day in scenario.days
            ],
            best_stars=best.stars if best else 0,
        )

    def _arcade(self, today: date) -> ArcadeView:
        featured = self._featured()
        # The persona's game first, then the others.
        stories = sorted(practice.SCENARIOS.values(), key=lambda s: s.id != featured.id)
        sort_best = self._learner.results.get(sorting.SORT_ID)
        return ArcadeView(
            featured=featured.id,
            stories=[self._story_view(scenario) for scenario in stories],
            sort=SortView(
                cards=[
                    SortCard(id=c.id, label=c.label, emoji=c.emoji, kind=c.kind, why=c.why)
                    for c in sorting.CARDS
                ],
                seconds=sorting.SECONDS,
                best_stars=sort_best.stars if sort_best else 0,
            ),
            quests=[
                QuestView(
                    id=quest.id,
                    label=quest.label,
                    emoji=quest.emoji,
                    done=quests.marker_id(today, quest.id) in self._learner.results,
                )
                for quest in quests.quests(featured.title)
            ],
            chest_xp=quests.CHEST_XP,
            chest_claimed=quests.chest_id(today) in self._learner.results,
        )

    def arcade(self, user_id: str) -> ArcadeView:
        with self._lock:
            self.require_owner(user_id)
            return self._arcade(self.today())

    def practice_view(
        self, user_id: str, scenario_id: str = practice.POCKET_MONEY.id
    ) -> PracticeView:
        with self._lock:
            self.require_owner(user_id)
            scenario = practice.SCENARIOS.get(scenario_id)
            if scenario is None:
                raise not_found("Game not found")
            return self._story_view(scenario)

    def play_practice(self, user_id: str, request: PracticeWrite) -> PracticeOutcome:
        """Scores a story game. The best result is kept and earns XP, like a lesson."""
        with self._lock:
            self.require_owner(user_id)
            scenario = practice.SCENARIOS.get(request.scenario)
            if scenario is None:
                raise not_found("Game not found")
            try:
                result = practice.play(request.choices, scenario)
            except ValueError as error:
                raise invalid(str(error)) from error
            today = self.today()
            awarded = self._keep_best(scenario.result_id, result.stars, result.xp, today)
            if scenario.id == self._featured().id:
                self._quest_done("story", today)
            return PracticeOutcome(
                left_cents=result.left_cents,
                spent_cents=result.spent_cents,
                treats=result.treats,
                reached_goal=result.reached_goal,
                stars=result.stars,
                xp_awarded=awarded,
                lessons=list(result.lessons),
            )

    def play_sort(self, user_id: str, request: SortWrite) -> SortOutcome:
        """Scores a round of Needs or wants; the best result earns XP."""
        with self._lock:
            self.require_owner(user_id)
            try:
                result = sorting.score(request.answers)
            except ValueError as error:
                raise invalid(str(error)) from error
            today = self.today()
            awarded = self._keep_best(sorting.SORT_ID, result.stars, result.xp, today)
            if result.stars >= 2:
                self._quest_done("sort", today)
            return SortOutcome(
                correct=result.correct,
                answered=result.answered,
                stars=result.stars,
                xp_awarded=awarded,
            )

    def open_chest(self, user_id: str) -> ChestOutcome:
        """Today's bonus XP, once all three quests are done."""
        with self._lock:
            self.require_owner(user_id)
            today = self.today()
            arcade = self._arcade(today)
            if arcade.chest_claimed:
                raise conflict("Today's chest is already open")
            if not all(quest.done for quest in arcade.quests):
                raise conflict("Finish today's three quests to open the chest")
            before = self._learner.state(self._mission_xp(), today).level
            self._learner.results[quests.chest_id(today)] = LessonResult(
                stars=0, xp_earned=quests.CHEST_XP, first_passed=today
            )
            after = self._learner.state(self._mission_xp(), today).level
            return ChestOutcome(
                xp_awarded=quests.CHEST_XP,
                level_before=before,
                level_after=after,
                arcade=self._arcade(today),
            )

    # ------------------------------------------------------------------ Money IQ and the coach plan

    def skill_check_view(self, user_id: str) -> SkillCheckView:
        with self._lock:
            self.require_owner(user_id)
            return SkillCheckView(
                questions=[
                    SkillQuestionView(
                        id=q.id,
                        area=q.area,
                        prompt=q.prompt,
                        options=[SkillOption(id=i, text=t) for i, t in q.options],
                    )
                    for q in skills.QUESTIONS
                ],
                xp=skills.SKILL_XP,
            )

    def _area_stars(self) -> dict[skills.Area, tuple[int, int]]:
        """Stars earned and possible in each area's lessons, for the learner's country."""
        state = self._learner.state(self._mission_xp(), self.today())
        by_topic = {topic.id: topic.lessons for topic in state.topics}
        out: dict[skills.Area, tuple[int, int]] = {}
        for area in skills.AREAS:
            lessons = [lesson for topic in area.topics for lesson in by_topic.get(topic, [])]
            out[area.id] = (sum(lesson.stars for lesson in lessons), 3 * len(lessons))
        return out

    def _saved_check(self) -> dict[skills.Area, int] | None:
        rows = {area.id: self._learner.results.get(f"skill:{area.id}") for area in skills.AREAS}
        if any(row is None for row in rows.values()):
            return None
        return {area: row.stars for area, row in rows.items() if row is not None}

    def _areas(self, right: dict[skills.Area, int]) -> list[skills.AreaMastery]:
        return skills.mastery(right, self._area_stars())

    @staticmethod
    def area_views(areas: list[skills.AreaMastery]) -> list[AreaView]:
        return [
            AreaView(
                id=item.area.id,
                label=item.area.label,
                emoji=item.area.emoji,
                check_pct=item.check_pct,
                lesson_pct=item.lesson_pct,
                mastery_pct=item.mastery_pct,
            )
            for item in areas
        ]

    def submit_skill_check(self, user_id: str, request: SkillCheckWrite) -> SkillCheckResult:
        """Grades Money IQ and keeps the latest scores (beside lesson results). XP once."""
        with self._lock:
            self.require_owner(user_id)
            try:
                right, marks = skills.grade(request.answers)
            except ValueError as error:
                raise invalid(str(error)) from error
            today = self.today()
            for area, count in right.items():
                self._learner.results[f"skill:{area}"] = LessonResult(
                    stars=count, xp_earned=0, first_passed=today
                )
            awarded = self._keep_best("skill-check", 1, skills.SKILL_XP, today)
            return SkillCheckResult(
                marks=[
                    SkillMarkView(
                        question_id=m.question_id,
                        correct=m.correct,
                        answer=m.answer,
                        explanation=m.explanation,
                    )
                    for m in marks
                ],
                areas=self.area_views(self._areas(right)),
                xp_awarded=awarded,
            )

    def coach_plan_inputs(
        self, user_id: str
    ) -> tuple[list[skills.AreaMastery], list[PlanStep], str | None] | None:
        """The weakest areas and the next steps for each (deterministic), and the persona.
        None before the first skill check."""
        with self._lock:
            self.require_owner(user_id)
            right = self._saved_check()
            if right is None:
                return None
            areas = self._areas(right)
            state = self._learner.state(self._mission_xp(), self.today())
            lessons = {topic.id: topic.lessons for topic in state.topics}
            featured = self._featured()
            steps: list[PlanStep] = []
            for item in [a for a in areas if a.mastery_pct < 100][:3]:
                candidates = [lesson for t in item.area.topics for lesson in lessons.get(t, [])]
                lesson = next(
                    (c for c in candidates if not c.locked and not c.passed), None
                ) or next((c for c in candidates if not c.locked and c.stars < 3), None)
                if lesson:
                    steps.append(
                        PlanStep(
                            kind="lesson",
                            area=item.area.id,
                            title=lesson.title,
                            lesson_id=lesson.id,
                        )
                    )
                steps.append(
                    PlanStep(kind="guide", area=item.area.id, title=f"{item.area.label} guides")
                )
                if item.area.id == "grow":
                    steps.append(
                        PlanStep(
                            kind="game", area="grow", title=featured.title, game_id=featured.id
                        )
                    )
                elif item.area.id in ("banking", "credit"):
                    steps.append(
                        PlanStep(
                            kind="game", area=item.area.id, title="Needs or wants", game_id="sort"
                        )
                    )
            return areas, steps, self._profile.persona

    def skill_checked_on(self, user_id: str) -> date | None:
        with self._lock:
            self.require_owner(user_id)
            row = self._learner.results.get(f"skill:{skills.AREAS[0].id}")
            return row.first_passed if row else None
