"""Transactions: recording, editing, importing reviewed statement rows, and categorizing."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.api.deps import AuthenticatedUser, ViewMonth, in_view, user_store
from app.assist.quick_add import pick_category
from app.config import get_settings
from app.dashboard_models import (
    CategorySuggestion,
    DashboardResponse,
    ImportResult,
    ImportRowsRequest,
    SharedPurchaseWrite,
    SplitTransactionWrite,
    TransactionPatch,
    TransactionWrite,
)
from app.domain.categorize import categorize, necessity

router = APIRouter(prefix="/api/v1", tags=["transactions"])


@router.post("/transactions", response_model=DashboardResponse)
def create_transaction(
    request: TransactionWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).create_transaction(current_user.id, request), current_user, month
    )


@router.post("/transactions/split", response_model=DashboardResponse)
def create_split_transaction(
    request: SplitTransactionWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    """Record one purchase or deposit across several accounts (one transaction each)."""
    return in_view(
        user_store(current_user).create_split_transaction(current_user.id, request),
        current_user,
        month,
    )


@router.post("/transactions/shared", response_model=DashboardResponse)
def create_shared_purchase(
    request: SharedPurchaseWrite, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    """Record a purchase split with friends: your share is spending, the rest is owed."""
    return in_view(
        user_store(current_user).create_shared_purchase(current_user.id, request),
        current_user,
        month,
    )


@router.patch("/transactions/{transaction_id}", response_model=DashboardResponse)
def update_transaction(
    transaction_id: str,
    request: TransactionPatch,
    current_user: AuthenticatedUser,
    month: ViewMonth = None,
) -> DashboardResponse:
    return in_view(
        user_store(current_user).update_transaction(current_user.id, transaction_id, request),
        current_user,
        month,
    )


@router.delete("/transactions/{transaction_id}", response_model=DashboardResponse)
def delete_transaction(
    transaction_id: str, current_user: AuthenticatedUser, month: ViewMonth = None
) -> DashboardResponse:
    return in_view(
        user_store(current_user).delete_transaction(current_user.id, transaction_id),
        current_user,
        month,
    )


@router.post("/transactions/import-rows", response_model=ImportResult)
def import_rows(request: ImportRowsRequest, current_user: AuthenticatedUser) -> ImportResult:
    """Add statement rows the user reviewed. Imported rows don't change account balances."""
    store = user_store(current_user)
    imported, errors = store.import_rows(current_user.id, request.rows, request.account_id)
    return ImportResult(
        imported=imported,
        skipped=len(errors),
        errors=errors[:20],
        dashboard=store.dashboard_for_user(current_user.id),
    )


@router.get("/categorize", response_model=CategorySuggestion)
async def suggest_category(
    current_user: AuthenticatedUser,
    description: Annotated[str, Query(min_length=1, max_length=160)],
    kind: Annotated[Literal["income", "spending"], Query()] = "spending",
) -> CategorySuggestion:
    """Keyword rules first; when they don't recognise the merchant, the model picks a category."""
    store = user_store(current_user)
    store.require_owner(current_user.id)
    categories = store.dashboard_for_user(current_user.id).categories
    result = categorize(description, kind)
    category_id, source = result.category_id, "rules" if result.category_id else None
    if category_id is None:
        category_id = await pick_category(get_settings(), description, kind, categories)
        source = "ai" if category_id else None
    names = {c.id: c.name for c in categories}
    return CategorySuggestion(
        category_id=category_id,
        category_name=names.get(category_id) if category_id else None,
        necessity=necessity(description, category_id) if kind == "spending" else None,
        matched=result.matched,
        source=source,
    )
