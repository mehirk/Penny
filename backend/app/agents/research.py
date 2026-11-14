"""Web research for the agents: one question answered from the web with sources, through the
OpenAI web search tool. Figures it quotes are registered as web figures (labelled, with their
sources) so an agent can use them, like a new city's typical rent; any math on them still goes
through Penny's tools. A few searches per mission at most.
"""

import re
import time
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from openai import AsyncOpenAI, OpenAIError

from app.agents.models import WebSource
from app.coach.facts import FactBook
from app.coach.llm import ModelUnavailable, cache_options
from app.config import Settings

if TYPE_CHECKING:
    from app.agents.runtime import Budget

MAX_SEARCHES = 3
MAX_SOURCES = 4
MAX_ANSWER_CHARS = 900
# Answers are kept this long and reused for the same question (prices and deadlines don't
# change by the hour), so a repeated search costs nothing.
CACHE_SECONDS = 12 * 60 * 60
MAX_CACHED = 300
_cache: dict[str, tuple[float, dict[str, Any], list[WebSource]]] = {}


def _cache_key(question: str) -> str:
    return re.sub(r"[^a-z0-9$.]+", " ", question.casefold()).strip()


_INSTRUCTIONS = (
    "Answer for a student or young adult in Canada, in two or three plain sentences. Give "
    "concrete, current figures in Canadian dollars written like $2,450 when the question asks "
    "for one. Prefer official and well-known sources. No investment, tax, or legal advice."
)


class Researcher:
    def __init__(self, settings: Settings, budget: "Budget") -> None:
        self._settings = settings
        self._budget = budget
        self.used = 0

    @property
    def available(self) -> bool:
        return bool(self._settings.web_research and self._settings.openai_api_key)

    async def search(
        self, question: str, facts: FactBook
    ) -> tuple[dict[str, Any], list[WebSource]]:
        """The answer for the agent, and the pages it came from."""
        question = question.strip()[:300]
        if not question:
            return {"error": "question is required"}, []
        if not self.available:
            return {"error": "Web research is off; work from Penny's tools instead."}, []
        key = _cache_key(question)
        cached = _cache.get(key)
        if cached and cached[0] > time.monotonic():
            _, result, sources = cached
            facts.web_amounts(result["answer"])
            self._budget.tokens.reused += 1
            return {**result, "note": result["note"] + " (Reused from an earlier search.)"}, sources
        if self.used >= MAX_SEARCHES:
            return {"error": "This mission's web searches are used up; use what you found."}, []
        try:
            self._budget.charge()
        except ModelUnavailable:
            return {"error": "No AI calls left for this mission."}, []
        self.used += 1
        client = AsyncOpenAI(
            api_key=self._settings.openai_api_key,
            timeout=self._settings.coach_timeout_seconds,
            max_retries=1,
        )
        try:
            response = await client.responses.create(
                model=self._settings.openai_model,
                instructions=_INSTRUCTIONS,
                input=question,
                tools=[{"type": "web_search"}],  # type: ignore[list-item]
                max_output_tokens=1_200,
                reasoning={"effort": "low"},
                store=False,
                **cache_options(self._settings, "penny-research"),
            )
        except OpenAIError as error:
            return {"error": f"Web search failed: {type(error).__name__}"}, []
        if response.usage:
            self._budget.record(response.usage)
        text = (response.output_text or "").strip()[:MAX_ANSWER_CHARS]
        if not text:
            return {"error": "The search found nothing useful."}, []
        sources = sources_in(response)
        facts.web_amounts(text)
        result = {
            "answer": text,
            "sources": [source.url for source in sources],
            "note": "From the web: an estimate to check against the sources, not a quote.",
        }
        if len(_cache) >= MAX_CACHED:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (time.monotonic() + CACHE_SECONDS, result, sources)
        return result, sources


def _clean(url: str) -> str:
    """Without tracking parameters (the search tool adds utm_source)."""
    parts = urlsplit(url)
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if not k.startswith("utm_")])
    return urlunsplit(parts._replace(query=query))


def sources_in(response: Any) -> list[WebSource]:
    """The cited pages in a Responses API reply, without duplicates."""
    found: dict[str, WebSource] = {}
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) != "message":
            continue
        for part in getattr(item, "content", None) or []:
            for note in getattr(part, "annotations", None) or []:
                url = getattr(note, "url", None)
                url = url and _clean(url)
                if getattr(note, "type", None) == "url_citation" and url and url not in found:
                    title = (getattr(note, "title", None) or url)[:120]
                    found[url] = WebSource(title=title, url=url)
    return list(found.values())[:MAX_SOURCES]
