"""An agent asking the user a question mid-mission. The mission waits (one question at a time)
until the app sends the answer, or carries on with the agent's stated assumption when nobody
answers in time. Missions the user didn't start (Autopilot, Watch) never ask.
"""

import asyncio
import secrets

from app.agents.models import AgentId, AgentQuestion, MissionRun

# How long a mission waits for an answer before going with the agent's assumption.
ANSWER_TIMEOUT_SECONDS = 90.0
MAX_QUESTIONS = 2

# Questions waiting for an answer, by question id (missions run in this server process).
_waiting: dict[str, asyncio.Future[str]] = {}


class Asker:
    def __init__(self, run: MissionRun, enabled: bool) -> None:
        self.run = run
        self.enabled = enabled
        self._lock = asyncio.Lock()

    async def ask(
        self, agent: AgentId, question: str, why: str, choices: list[str], assumption: str
    ) -> AgentQuestion:
        """Shows the question and waits for the answer; `answer` stays None when nobody replied."""
        async with self._lock:
            asked = AgentQuestion(
                id=f"q-{secrets.token_urlsafe(6)}",
                agent=agent,
                question=question[:200],
                why=why[:200],
                choices=[choice[:60] for choice in choices[:4]],
                assumption=assumption[:200],
            )
            future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
            _waiting[asked.id] = future
            self.run.question = asked
            try:
                asked.answer = await asyncio.wait_for(future, ANSWER_TIMEOUT_SECONDS)
            except TimeoutError:
                asked.assumed = True
            finally:
                _waiting.pop(asked.id, None)
                self.run.question = None
                self.run.asked.append(asked)
            return asked

    def can_ask(self) -> bool:
        return self.enabled and len(self.run.asked) < MAX_QUESTIONS


def answer(question_id: str, text: str) -> bool:
    """Hands the user's answer to the waiting agent; False when nothing is waiting for it."""
    future = _waiting.get(question_id)
    if future is None or future.done():
        return False
    future.get_loop().call_soon_threadsafe(_resolve, future, text)
    return True


def _resolve(future: asyncio.Future[str], text: str) -> None:
    if not future.done():
        future.set_result(text)
