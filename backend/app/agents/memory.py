"""Penny's memory, built from the user's saved missions: what they approved (checked again
against today's numbers) and what they turned down (not suggested again for a while). It
follows the user across devices because the missions do.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.agent_models import AgentAction
from app.agents.models import MemoryNote, MissionRun
from app.coach.facts import FactBook
from app.dashboard_models import DashboardResponse

# A step the user turned down isn't suggested again for this long.
DECLINE_DAYS = 30
MAX_NOTES = 3


def action_key(action: AgentAction) -> tuple[Any, ...]:
    """What makes two drafts the same suggestion (the amount may differ)."""
    return (
        action.kind,
        getattr(action, "category_id", None),
        getattr(action, "goal_id", None),
        getattr(action, "to_account_id", None),
        (getattr(action, "name", None) or "").casefold() or None,
    )


@dataclass
class Memory:
    notes: list[MemoryNote] = field(default_factory=list)
    # Suggestions the user turned down: key → (title, when).
    declined: dict[tuple[Any, ...], tuple[str, date]] = field(default_factory=dict)

    def prompt(self) -> str:
        """What the agents are told Penny remembers."""
        lines = [f"- {note.title}: {note.detail}" for note in self.notes]
        lines += [
            f"- The user turned down “{title}” on {when:%b} {when.day}; don't suggest it again."
            for title, when in self.declined.values()
        ]
        return "\n".join(lines)


def _day(when: date) -> str:
    return f"{when:%b} {when.day}"


def _check(
    action: AgentAction, title: str, on: date, d: DashboardResponse, f: FactBook
) -> MemoryNote | None:
    """An approved step, checked against today's numbers."""
    when = f"You approved “{title}” on {_day(on)}."
    if action.kind in ("goal_new", "goal_add"):
        goal = next(
            (
                g
                for g in d.savings_goals
                if g.id == getattr(action, "goal_id", None)
                or g.name.casefold() == (getattr(action, "name", "") or "").casefold()
            ),
            None,
        )
        if goal is None:
            return None
        saved = f.money(f"{goal.name} saved", goal.current_cents, "goals")
        target = f.money(f"{goal.name} target", goal.target_cents, "goals")
        if goal.status == "completed" or goal.current_cents >= goal.target_cents:
            return MemoryNote(
                tone="good", title=f"{goal.name} is fully funded", detail=when, from_on=on
            )
        needed = goal.monthly_needed_cents or 0
        if needed and goal.contributed_this_month_cents >= needed:
            return MemoryNote(
                tone="good",
                title=f"{goal.name} is on track",
                detail=f"{when} {saved} of {target} saved, and this month's share is in.",
                from_on=on,
            )
        if needed:
            share = f.money(f"{goal.name} monthly share", needed, "goals")
            return MemoryNote(
                tone="watch",
                title=f"{goal.name} needs {share} this month",
                detail=f"{when} {saved} of {target} saved so far.",
                from_on=on,
            )
        return MemoryNote(
            tone="info", title=f"{goal.name}: {saved} of {target}", detail=when, from_on=on
        )
    if action.kind == "budget":
        budget = next(
            (b for b in d.budgets if b.category_id == getattr(action, "category_id", None)), None
        )
        if budget is None or budget.carried_over:
            return None
        limit = f.money(f"{budget.category_name} budget", budget.limit_cents, "budgets")
        if budget.remaining_cents < 0:
            over = f.money(f"{budget.category_name} over", -budget.remaining_cents, "budgets")
            return MemoryNote(
                tone="alert",
                title=f"{budget.category_name} is {over} over",
                detail=f"{when} The limit is {limit}.",
                from_on=on,
            )
        left = f.money(f"{budget.category_name} left", budget.remaining_cents, "budgets")
        return MemoryNote(
            tone="good",
            title=f"{budget.category_name}: {left} left",
            detail=f"{when} The limit is {limit}.",
            from_on=on,
        )
    if action.kind == "transfer" and d.credit and action.to_account_id == d.credit.account_id:
        if d.credit.balance_cents <= 0:
            return MemoryNote(
                tone="good",
                title=f"{d.credit.account_name} is still paid off",
                detail=when,
                from_on=on,
            )
        owed = f.money("Card balance owed", d.credit.balance_cents, "accounts")
        return MemoryNote(
            tone="info",
            title=f"{d.credit.account_name} is back to {owed}",
            detail=f"{when} New spending since then.",
            from_on=on,
        )
    return None


def recall(runs: list[MissionRun], d: DashboardResponse, f: FactBook, today: date) -> Memory:
    """`runs` most recent first, as the run store lists them."""
    memory = Memory()
    seen: set[tuple[Any, ...]] = set()
    for run in runs:
        on = run.started_at.date()
        steps = {step.id: step for step in run.steps}
        for step_id in run.declined:
            step = steps.get(step_id)
            if step and today - on <= timedelta(days=DECLINE_DAYS):
                memory.declined.setdefault(action_key(step.action), (step.title, on))
        for step_id in run.approved:
            step = steps.get(step_id)
            if step is None or len(memory.notes) >= MAX_NOTES:
                continue
            key = action_key(step.action)
            if key in seen:
                continue
            seen.add(key)
            note = _check(step.action, step.title, on, d, f)
            if note:
                memory.notes.append(note)
    # Approving something later outweighs an earlier "not now".
    for key in seen:
        memory.declined.pop(key, None)
    return memory
