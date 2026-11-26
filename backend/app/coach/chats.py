"""Saved Penny AI chats, so they follow the user across devices. Kept in Postgres
(coach_conversations, coach_messages) when a database is configured, otherwise in memory.

The app saves a whole conversation after each change. Replies are stored for display only:
approving a proposal still goes through the server-side, single-use proposal record.
"""

import json
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Literal

from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.pool import connection, database_enabled

MAX_CONVERSATIONS = 50
MAX_REPLY_BYTES = 64_000


class ChatModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnswerRating(ChatModel):
    helpful: bool = Field(strict=True)
    reason: Literal["wrong_numbers", "unclear", "not_what_i_asked", "other"] | None = None


class ChatMessage(ChatModel):
    id: str = Field(min_length=1, max_length=64)
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)
    # Penny's full reply (facts, tools, proposal) for assistant messages.
    reply: dict[str, Any] | None = None

    @field_validator("reply")
    @classmethod
    def _small(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and len(json.dumps(value)) > MAX_REPLY_BYTES:
            raise ValueError("Reply is too large to save")
        if value is not None and "feedback" in value:
            # "Was this helpful?" is kept with the reply; only the one-tap shape is accepted.
            value["feedback"] = AnswerRating.model_validate(value["feedback"]).model_dump()
        return value


ProposalState = Literal["approving", "approved", "dismissed"]


class ConversationWrite(ChatModel):
    title: str = Field(min_length=1, max_length=120)
    messages: list[ChatMessage] = Field(max_length=200)
    proposals: dict[str, ProposalState] = Field(default_factory=dict, max_length=100)


class Conversation(ConversationWrite):
    id: str
    updated_at: datetime


class ChatStore:
    def __init__(self) -> None:
        self._memory: dict[str, dict[str, Conversation]] = {}
        self._lock = Lock()

    def list(self, owner: str) -> list[Conversation]:
        """Most recent first."""
        if not database_enabled():
            with self._lock:
                items = list(self._memory.get(owner, {}).values())
            return sorted(items, key=lambda item: item.updated_at, reverse=True)
        with connection() as conn:
            rows = conn.execute(
                "select c.id, c.title, c.proposals, c.updated_at, coalesce((select"
                " jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content,"
                " 'reply', m.reply) order by m.position) from public.coach_messages m"
                " where m.user_id = c.user_id and m.conversation_id = c.id), '[]'::jsonb)"
                " as messages from public.coach_conversations c where c.user_id = %s"
                " order by c.updated_at desc limit %s",
                (owner, MAX_CONVERSATIONS),
            ).fetchall()
        return [Conversation.model_validate(row) for row in rows]

    def save(self, owner: str, conversation_id: str, body: ConversationWrite) -> Conversation:
        saved = Conversation(id=conversation_id, updated_at=datetime.now(UTC), **body.model_dump())
        if not database_enabled():
            with self._lock:
                mine = self._memory.setdefault(owner, {})
                mine[conversation_id] = saved
                for old in sorted(mine.values(), key=lambda c: c.updated_at)[:-MAX_CONVERSATIONS]:
                    del mine[old.id]
            return saved
        with connection() as conn, conn.transaction():
            conn.execute(
                "insert into public.coach_conversations (user_id, id, title, proposals,"
                " updated_at) values (%s, %s, %s, %s, %s) on conflict (user_id, id) do update"
                " set title = excluded.title, proposals = excluded.proposals,"
                " updated_at = excluded.updated_at",
                (owner, conversation_id, saved.title, Jsonb(saved.proposals), saved.updated_at),
            )
            conn.execute(
                "delete from public.coach_messages where user_id = %s and conversation_id = %s",
                (owner, conversation_id),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into public.coach_messages (user_id, conversation_id, position, id,"
                    " role, content, reply) values (%s, %s, %s, %s, %s, %s, %s)",
                    [
                        (
                            owner,
                            conversation_id,
                            position,
                            m.id,
                            m.role,
                            m.content,
                            Jsonb(m.reply) if m.reply is not None else None,
                        )
                        for position, m in enumerate(saved.messages)
                    ],
                )
            conn.execute(
                "delete from public.coach_conversations where user_id = %s and id not in"
                " (select id from public.coach_conversations where user_id = %s"
                " order by updated_at desc limit %s)",
                (owner, owner, MAX_CONVERSATIONS),
            )
        return saved

    def delete_all(self, owner: str) -> None:
        if not database_enabled():
            with self._lock:
                self._memory.pop(owner, None)
            return
        with connection() as conn:
            conn.execute("delete from public.coach_conversations where user_id = %s", (owner,))

    def delete(self, owner: str, conversation_id: str) -> None:
        if not database_enabled():
            with self._lock:
                self._memory.get(owner, {}).pop(conversation_id, None)
            return
        with connection() as conn:
            conn.execute(
                "delete from public.coach_conversations where user_id = %s and id = %s",
                (owner, conversation_id),
            )


chat_store = ChatStore()
