"""What Penny's agent proposes and what the user approves.

The agent (app.assist.agent) reads a sentence, a voice note, or a receipt photo into a plan of
typed actions. Nothing is saved until the user taps "Do it", which sends the actions they kept
to `/agent/apply`; app.store.agent then runs them through the same validated store operations
as the app's own forms, all or nothing.
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.dashboard_models import BillFrequency, DashboardModel, DashboardResponse


class ExpenseAction(DashboardModel):
    kind: Literal["expense"] = "expense"
    description: str = Field(min_length=1, max_length=160)
    amount_cents: int = Field(gt=0)
    category_id: str | None = None
    account_id: str
    occurred_on: date
    # Also set it up as a recurring bill.
    repeat: BillFrequency | None = None


class IncomeAction(DashboardModel):
    kind: Literal["income"] = "income"
    description: str = Field(min_length=1, max_length=160)
    amount_cents: int = Field(gt=0)
    category_id: str | None = None
    account_id: str
    occurred_on: date


class FriendRef(DashboardModel):
    """A friend already in Penny (`id`), or someone new to add by name (`id` is None)."""

    id: str | None = None
    name: str = Field(min_length=1, max_length=60)


class SplitAction(DashboardModel):
    """A purchase shared evenly with friends. Shares are worked out when it's applied
    (app.domain.splits.even_split), never taken from the model."""

    kind: Literal["split"] = "split"
    description: str = Field(min_length=1, max_length=160)
    total_cents: int = Field(gt=0)
    category_id: str | None = None
    occurred_on: date
    # The user's account, used when they paid.
    account_id: str
    friends: list[FriendRef] = Field(default_factory=list, max_length=20)
    # Index in `friends` of the friend who paid; None when the user paid.
    paid_by: int | None = None
    group_id: str | None = None

    @model_validator(mode="after")
    def _payer_and_names(self) -> "SplitAction":
        if self.paid_by is not None and not 0 <= self.paid_by < len(self.friends):
            raise ValueError("The friend who paid must be one of the friends")
        names = [friend.id or friend.name.strip().casefold() for friend in self.friends]
        if len(set(names)) != len(names):
            raise ValueError("Each friend can appear only once")
        return self


class BudgetAction(DashboardModel):
    """This month's limit for a spending category: changed if it has one, otherwise added."""

    kind: Literal["budget"] = "budget"
    # An existing spending category, or None with `new_category` to add one first.
    category_id: str | None = None
    new_category: str | None = Field(default=None, min_length=1, max_length=40)
    limit_cents: int = Field(ge=0)

    @model_validator(mode="after")
    def _one_category(self) -> "BudgetAction":
        if (self.category_id is None) == (self.new_category is None):
            raise ValueError("Pick a category for the budget")
        return self


class GoalAddAction(DashboardModel):
    kind: Literal["goal_add"] = "goal_add"
    goal_id: str
    amount_cents: int = Field(gt=0)
    account_id: str


class GoalNewAction(DashboardModel):
    kind: Literal["goal_new"] = "goal_new"
    name: str = Field(min_length=1, max_length=100)
    target_cents: int = Field(gt=0)
    target_date: date | None = None


class GoalUpdateAction(DashboardModel):
    kind: Literal["goal_update"] = "goal_update"
    goal_id: str
    name: str | None = Field(default=None, min_length=1, max_length=100)
    target_cents: int | None = Field(default=None, gt=0)
    target_date: date | None = None
    status: Literal["active", "paused", "completed"] | None = None


class TransferAction(DashboardModel):
    """Money moved between the user's accounts, a card payment, or settling up with a friend
    (from the friend: they paid the user back; to the friend: the user paid them back)."""

    kind: Literal["transfer"] = "transfer"
    from_account_id: str
    to_account_id: str
    amount_cents: int = Field(gt=0)
    occurred_on: date
    note: str | None = Field(default=None, max_length=120)


class BillNewAction(DashboardModel):
    kind: Literal["bill_new"] = "bill_new"
    name: str = Field(min_length=1, max_length=80)
    amount_cents: int = Field(gt=0)
    category_id: str | None = None
    account_id: str
    frequency: BillFrequency = "monthly"
    next_due: date


class BillPaidAction(DashboardModel):
    kind: Literal["bill_paid"] = "bill_paid"
    bill_id: str


class BillUpdateAction(DashboardModel):
    kind: Literal["bill_update"] = "bill_update"
    bill_id: str
    amount_cents: int | None = Field(default=None, gt=0)
    next_due: date | None = None
    frequency: BillFrequency | None = None


class TransactionUpdateAction(DashboardModel):
    kind: Literal["transaction_update"] = "transaction_update"
    transaction_id: str
    description: str | None = Field(default=None, min_length=1, max_length=160)
    amount_cents: int | None = Field(default=None, gt=0)
    category_id: str | None = None
    occurred_on: date | None = None


class AccountNewAction(DashboardModel):
    kind: Literal["account_new"] = "account_new"
    name: str = Field(min_length=1, max_length=60)
    account_type: Literal["chequing", "savings", "cash", "credit", "investment", "other"]
    balance_cents: int = Field(default=0, ge=0)
    credit_limit_cents: int | None = Field(default=None, gt=0)


class AccountUpdateAction(DashboardModel):
    kind: Literal["account_update"] = "account_update"
    account_id: str
    name: str | None = Field(default=None, min_length=1, max_length=60)
    balance_cents: int | None = Field(default=None, ge=0)


class CategoryNewAction(DashboardModel):
    kind: Literal["category_new"] = "category_new"
    name: str = Field(min_length=1, max_length=40)
    category_kind: Literal["income", "spending"] = "spending"
    parent_id: str | None = None


class PayNewAction(DashboardModel):
    kind: Literal["pay_new"] = "pay_new"
    name: str = Field(min_length=1, max_length=80)
    amount_cents: int = Field(gt=0)
    account_id: str
    frequency: Literal["weekly", "biweekly", "semimonthly", "monthly"] = "biweekly"
    next_payday: date


class PayReceivedAction(DashboardModel):
    kind: Literal["pay_received"] = "pay_received"
    pay_id: str
    amount_cents: int = Field(gt=0)
    occurred_on: date


class GroupNewAction(DashboardModel):
    kind: Literal["group_new"] = "group_new"
    name: str = Field(min_length=1, max_length=60)
    friends: list[FriendRef] = Field(min_length=1, max_length=20)


class PersonaAction(DashboardModel):
    kind: Literal["persona"] = "persona"
    persona: Literal["student", "working", "learner"]


DeleteTarget = Literal[
    "transaction", "bill", "goal", "budget", "account", "category", "transfer", "pay", "group"
]


class DeleteAction(DashboardModel):
    kind: Literal["delete"] = "delete"
    target: DeleteTarget
    target_id: str
    # What it is, for the confirmation line ("Coffee $4.50").
    label: str = Field(default="", max_length=160)


AgentAction = Annotated[
    ExpenseAction
    | IncomeAction
    | SplitAction
    | BudgetAction
    | GoalAddAction
    | GoalNewAction
    | GoalUpdateAction
    | TransferAction
    | BillNewAction
    | BillPaidAction
    | BillUpdateAction
    | TransactionUpdateAction
    | AccountNewAction
    | AccountUpdateAction
    | CategoryNewAction
    | PayNewAction
    | PayReceivedAction
    | GroupNewAction
    | PersonaAction
    | DeleteAction,
    Field(discriminator="kind"),
]

AppKind = Literal["navigate", "theme", "palette", "surface", "hide_amounts", "sound", "ask"]


class AppStep(DashboardModel):
    """Something the app does on this device, with nothing saved on the server: open a page,
    change how Penny looks, or hand a question to Penny AI. Runs without a money approval."""

    kind: AppKind
    # The page, theme, palette, or surface; "on"/"off"; or the question for Penny AI.
    value: str = Field(min_length=1, max_length=300)
    title: str
    emoji: str


class AgentStep(DashboardModel):
    """One action in the plan, with how Penny describes it. Every figure in `title` and `lines`
    comes from deterministic code."""

    id: str
    emoji: str
    title: str
    lines: list[str]
    action: AgentAction
    # A split said to be "by 3" with no names: how many friends the user still needs to pick.
    needs_friends: int = Field(default=0, ge=0)


class ReceiptItem(DashboardModel):
    """A purchase read from a receipt photo, kept so a follow-up ("split it with Sam") can build
    on it without reading the photo again."""

    description: str = Field(min_length=1, max_length=160)
    amount_cents: int = Field(gt=0)
    category_id: str | None = None
    occurred_on: date


class AgentUpload(DashboardModel):
    filename: str = Field(min_length=1, max_length=200)
    data_base64: str = Field(min_length=1, max_length=11_500_000)


class AgentRequest(DashboardModel):
    text: str = Field(default="", max_length=1000)
    image: AgentUpload | None = None
    receipt: list[ReceiptItem] = Field(default_factory=list, max_length=30)
    # The last few chat turns, so "it was $45" or "split it with Sam too" make sense.
    context: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def _something(self) -> "AgentRequest":
        if not self.text.strip() and self.image is None and not self.receipt:
            raise ValueError("Say, type, or snap something first")
        return self


class AgentPlan(DashboardModel):
    # What Penny read: the user's words, or "Receipt from <store>".
    heard: str
    steps: list[AgentStep]
    app: list[AppStep] = Field(default_factory=list)
    # Asked instead of guessing when something needed is missing (usually the amount).
    question: str | None
    # Quick answers to the question, shown as chips ("Food", "Fun", "Transportation").
    choices: list[str] = Field(default_factory=list)
    receipt: list[ReceiptItem]
    source: Literal["ai", "built_in"]
    model: str | None


class AgentApply(DashboardModel):
    actions: list[AgentAction] = Field(min_length=1, max_length=20)


class AgentApplied(DashboardModel):
    dashboard: DashboardResponse
    done: list[str]
    # Pass back to `/agent/undo` to reverse everything, while nothing else has changed.
    undo_id: str


class AgentUndo(DashboardModel):
    undo_id: str = Field(min_length=1, max_length=80)


class Transcript(DashboardModel):
    text: str
