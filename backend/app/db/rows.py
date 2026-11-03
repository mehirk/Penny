"""Converts a store snapshot to table rows and back. Pure: no database access.

Rows are compared to find what changed, so each table's rows are keyed by their primary key
(without user_id) and hold plain Python values the database driver understands.
"""

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.dashboard_models import (
    Bill,
    Category,
    GoalContribution,
    Mission,
    PaySchedule,
    SplitGroup,
    Transfer,
)
from app.learning.engine import Attempt, Learner, LessonResult
from app.learning.models import AttemptView, LearnProfile
from app.models import Account, DemoUser, Transaction
from app.store.state import StoreSnapshot

Row = dict[str, Any]
TableRows = dict[tuple[Any, ...], Row]
Rows = dict[str, TableRows]

# Child tables and their primary key columns after user_id. `seq` (creation order) is set by
# the database and isn't part of a row.
TABLE_KEYS: dict[str, tuple[str, ...]] = {
    "accounts": ("id",),
    "categories": ("id",),
    "transactions": ("id",),
    "budgets": ("id",),
    "savings_goals": ("id",),
    "goal_contributions": ("id",),
    "bills": ("id",),
    "missions": ("id",),
    "pay_schedules": ("id",),
    "transfers": ("id",),
    "split_groups": ("id",),
    "learn_profiles": (),
    "learn_results": ("lesson_id",),
    "learn_activity": ("day",),
    "learn_attempts": ("id",),
}
# Columns stored as jsonb.
JSON_COLUMNS: dict[str, frozenset[str]] = {"learn_attempts": frozenset({"view"})}
ORDERED_TABLES = frozenset(TABLE_KEYS) - {
    "pay_schedules",
    "learn_profiles",
    "learn_results",
    "learn_activity",
    "learn_attempts",
}

PROFILE_COLUMNS = (
    "display_name",
    "age",
    "school",
    "city",
    "province",
    "currency",
    "is_fictional",
    "spending_from",
)


class _BudgetRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    category_id: str
    month_start: date
    limit_cents: int


class _GoalRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    target_cents: int
    current_cents: int
    target_date: date | None
    status: str
    account_id: str | None


def _keyed(table: str, rows: list[Row]) -> TableRows:
    keys = TABLE_KEYS[table]
    return {tuple(row[key] for key in keys): row for row in rows}


def profile_row(profile: DemoUser) -> Row:
    return {column: getattr(profile, column) for column in PROFILE_COLUMNS}


def to_rows(snapshot: StoreSnapshot) -> Rows:
    learner = snapshot.learner
    tables: dict[str, list[Row]] = {
        "accounts": [item.model_dump() for item in snapshot.accounts],
        "categories": [item.model_dump() for item in snapshot.categories],
        "transactions": [item.model_dump() for item in snapshot.transactions],
        "budgets": [_BudgetRow.model_validate(item).model_dump() for item in snapshot.budgets],
        "savings_goals": [_GoalRow.model_validate(item).model_dump() for item in snapshot.goals],
        "goal_contributions": [item.model_dump() for item in snapshot.contributions],
        "bills": [item.model_dump() for item in snapshot.bills],
        "missions": [item.model_dump() for item in snapshot.missions],
        "pay_schedules": [item.model_dump() for item in snapshot.pay_schedules],
        "transfers": [item.model_dump() for item in snapshot.transfers],
        "split_groups": [item.model_dump() for item in snapshot.split_groups],
        "learn_profiles": [learner.profile.model_dump()],
        "learn_results": [
            {
                "lesson_id": lesson_id,
                "stars": result.stars,
                "xp_earned": result.xp_earned,
                "first_passed": result.first_passed,
            }
            for lesson_id, result in learner.results.items()
        ],
        "learn_activity": [{"day": day} for day in sorted(learner.activity_days)],
        "learn_attempts": [
            {
                "id": attempt.id,
                "lesson_id": attempt.lesson_id,
                "hearts_left": attempt.hearts_left,
                "view": attempt.view.model_dump(mode="json"),
                "answered": sorted(attempt.answered),
                "mistakes": attempt.mistakes,
                "status": attempt.status,
            }
            for attempt in learner.attempts.values()
        ],
    }
    return {table: _keyed(table, rows) for table, rows in tables.items()}


def from_rows(user_id: str, profile: Row, tables: dict[str, list[Row]]) -> StoreSnapshot:
    """Rebuilds a snapshot from loaded rows (lists already in creation order)."""
    learner = Learner()
    learn_profile = tables.get("learn_profiles") or []
    if learn_profile:
        learner.profile = LearnProfile.model_validate(learn_profile[0])
    for row in tables.get("learn_results", []):
        learner.results[row["lesson_id"]] = LessonResult(
            stars=row["stars"], xp_earned=row["xp_earned"], first_passed=_date(row["first_passed"])
        )
    learner.activity_days = {_date(row["day"]) for row in tables.get("learn_activity", [])}
    for row in tables.get("learn_attempts", []):
        learner.attempts[row["id"]] = Attempt(
            id=row["id"],
            lesson_id=row["lesson_id"],
            hearts_left=row["hearts_left"],
            view=AttemptView.model_validate(row["view"]),
            answered=set(row["answered"]),
            mistakes=row["mistakes"],
            status=row["status"],
        )
    pay = tables.get("pay_schedules") or []
    return StoreSnapshot(
        profile=DemoUser.model_validate(
            {"id": user_id, **{c: profile[c] for c in PROFILE_COLUMNS}}
        ),
        accounts=[Account.model_validate(row) for row in tables.get("accounts", [])],
        categories=[Category.model_validate(row) for row in tables.get("categories", [])],
        transactions=[Transaction.model_validate(row) for row in tables.get("transactions", [])],
        budgets=[_BudgetRow.model_validate(row).model_dump() for row in tables.get("budgets", [])],
        goals=[
            _GoalRow.model_validate(row).model_dump() for row in tables.get("savings_goals", [])
        ],
        contributions=[
            GoalContribution.model_validate(row) for row in tables.get("goal_contributions", [])
        ],
        missions=[Mission.model_validate(row) for row in tables.get("missions", [])],
        bills=[Bill.model_validate(row) for row in tables.get("bills", [])],
        transfers=[Transfer.model_validate(row) for row in tables.get("transfers", [])],
        split_groups=[SplitGroup.model_validate(row) for row in tables.get("split_groups", [])],
        pay_schedules=sorted(
            (PaySchedule.model_validate(row) for row in pay), key=lambda item: item.id
        ),
        learner=learner,
    )


def _date(value: date | str) -> date:
    return value if isinstance(value, date) else date.fromisoformat(value)


def diff(
    before: Rows, after: Rows
) -> tuple[dict[str, list[Row]], dict[str, list[tuple[Any, ...]]]]:
    """Rows to insert or update, and keys to delete, per table. Upserts keep `after`'s order."""
    upserts: dict[str, list[Row]] = {}
    deletes: dict[str, list[tuple[Any, ...]]] = {}
    for table in TABLE_KEYS:
        old, new = before.get(table, {}), after.get(table, {})
        changed = [row for key, row in new.items() if old.get(key) != row]
        removed = [key for key in old if key not in new]
        if changed:
            upserts[table] = changed
        if removed:
            deletes[table] = removed
    return upserts, deletes
