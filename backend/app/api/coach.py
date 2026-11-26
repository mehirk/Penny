"""Penny AI: the money coach, its approval step, and saved chats."""

from typing import Annotated

from fastapi import APIRouter, Path, status

from app import limits
from app.api.deps import AuthenticatedUser, spend_penny_ai_turn, user_store
from app.auth import CurrentUser
from app.coach.chats import Conversation, ConversationWrite, chat_store
from app.coach.coach import Coach
from app.coach.models import (
    ApprovalRequest,
    ApprovalResponse,
    BriefResponse,
    ChatRequest,
    ChatResponse,
    PennyAiAllowance,
)
from app.config import get_settings
from app.store import stores

router = APIRouter(prefix="/api/v1/coach", tags=["coach"])


def _coach(user: CurrentUser) -> Coach:
    return Coach(user_store(user), get_settings())


@router.get("/brief", response_model=BriefResponse)
def coach_brief(current_user: AuthenticatedUser) -> BriefResponse:
    """Deterministic check-in signals for the current month; no model call."""
    return _coach(current_user).brief(current_user.id)


@router.get("/allowance", response_model=PennyAiAllowance)
def penny_ai_allowance(current_user: AuthenticatedUser) -> PennyAiAllowance:
    """How many of today's Penny AI questions are left. Reading it uses none."""
    limit = limits.PENNY_AI_TURNS_PER_DAY
    if current_user.id == get_settings().demo_owner_user_id:
        return PennyAiAllowance(
            limit=limit, used=0, left=limit, frees_in_seconds=None, unlimited=True
        )
    used, frees_in = limits.penny_ai_allowance(current_user.id)
    return PennyAiAllowance(
        limit=limit, used=used, left=limit - used, frees_in_seconds=frees_in, unlimited=False
    )


@router.post("/chat", response_model=ChatResponse)
async def coach_chat(request: ChatRequest, current_user: AuthenticatedUser) -> ChatResponse:
    """Answer the latest question using the user's verified data and deterministic tools."""
    spend_penny_ai_turn(current_user)
    return await _coach(current_user).chat(request, current_user.id)


@router.post("/proposals/{proposal_id}/approve", response_model=ApprovalResponse)
def approve_coach_proposal(
    proposal_id: str, request: ApprovalRequest, current_user: AuthenticatedUser
) -> ApprovalResponse:
    """Apply a change Penny proposed, only after the user explicitly approves it."""
    return _coach(current_user).approve(current_user.id, proposal_id, request.version)


@router.get("/conversations", response_model=list[Conversation])
def list_conversations(current_user: AuthenticatedUser) -> list[Conversation]:
    """Saved Penny AI chats, most recent first."""
    user_store(current_user).require_owner(current_user.id)
    return chat_store.list(stores.data_owner(current_user.id))


@router.put("/conversations/{conversation_id}", response_model=Conversation)
def save_conversation(
    conversation_id: Annotated[str, Path(min_length=1, max_length=64)],
    request: ConversationWrite,
    current_user: AuthenticatedUser,
) -> Conversation:
    """Create or replace one chat (its title, messages, and proposal states)."""
    user_store(current_user).require_owner(current_user.id)
    return chat_store.save(stores.data_owner(current_user.id), conversation_id, request)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: str, current_user: AuthenticatedUser) -> None:
    user_store(current_user).require_owner(current_user.id)
    chat_store.delete(stores.data_owner(current_user.id), conversation_id)
