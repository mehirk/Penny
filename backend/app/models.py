from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.finance import OVERDRAWABLE_TYPES


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(StrictModel):
    status: Literal["ok"]
    service: Literal["penny-api"]
    version: str


class CurrentUserResponse(StrictModel):
    user_id: str
    email: str | None
    auth_method: Literal["supabase", "demo"]
    has_demo_financial_data: bool


class DemoUser(StrictModel):
    """The person the data belongs to: the fictional demo student, or a fresh account's owner."""

    id: str
    display_name: str
    age: int | None = Field(default=None, ge=18)
    school: str | None = None
    city: str | None = None
    province: str | None = None
    # Which accounts count as spending money for Safe to spend.
    spending_from: Literal["chequing", "chequing_and_savings"] = "chequing"
    currency: Literal["CAD"]
    # True for the seeded demo data set; False for a fresh account the user fills in.
    is_fictional: bool


class Account(StrictModel):
    id: str
    name: str
    account_type: Literal["chequing", "savings", "credit", "cash", "investment", "other", "person"]
    # Negative only for an overdrawn chequing or cash account, or money owed to a friend.
    balance_cents: int
    credit_limit_cents: int | None = Field(default=None, ge=0)
    # Credit cards: the day of the month the payment is due.
    payment_due_day: int | None = Field(default=None, ge=1, le=31)
    # Credit cards: a payment the user made outside Penny (said in setup or "already paid"). It
    # counts like a recorded card payment for the cycle it falls in.
    card_paid_on: date | None = None

    @model_validator(mode="after")
    def _overdrawn_only_if_allowed(self) -> "Account":
        if self.balance_cents < 0 and self.account_type not in OVERDRAWABLE_TYPES:
            raise ValueError(f"A {self.account_type} account can't have a negative balance")
        return self


class Transaction(StrictModel):
    id: str
    description: str
    category: str
    account_id: str = "acct-chequing"
    category_id: str | None = None
    amount_cents: int = Field(ge=0)
    kind: Literal["income", "spending"]
    occurred_on: date
    # Filled in when a dashboard snapshot is built; never trusted from clients.
    necessity: Literal["need", "want"] | None = None
    auto_categorized: bool = False
    # Set when this is a payment of a recurring bill. How it was paid: True when Penny recorded
    # it on the due date, False when the user marked it paid, None for history or a manual entry.
    bill_id: str | None = None
    paid_automatically: bool | None = None
    # Far larger than this category's usual purchase (filled in when a snapshot is built).
    unusual: bool = False
    # Paid before the user told Penny, so the balance they entered already includes it: it's in
    # history, budgets, and charts, but never changes a balance (added, edited, or removed).
    history_only: bool = False
    # A purchase split in a friends' group (the user's share, or a friend paying for it).
    group_id: str | None = None


class Summary(StrictModel):
    income_cents: int
    spending_cents: int
    cash_flow_cents: int
    budget_remaining_cents: int
