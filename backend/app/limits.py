"""Abuse limits per signed-in person: API requests a minute, and Penny AI calls a minute and a
day (each call costs money). Kept in memory, which fits the single server process; a restart
resets them.

The person behind a request is noted when they sign in (`note_request`), so a model call deep in
the code can be charged to them (`spend_ai_call`) without passing their id everywhere.
"""

import math
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from contextvars import ContextVar

REQUESTS_PER_MINUTE = 120
AI_CALLS_PER_MINUTE = 12
AI_CALLS_PER_DAY = 200
# People tracked at once per limit; the least recently seen are forgotten first.
MAX_TRACKED = 20_000

_DAY = 24 * 60 * 60


class RateLimiter:
    """At most `limit` events per key in any `window_seconds` (a sliding window)."""

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = MAX_TRACKED,
    ) -> None:
        if limit < 1 or window_seconds <= 0 or max_keys < 1:
            raise ValueError("limit, window_seconds and max_keys must be positive")
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._max_keys = max_keys
        self._events: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int | None:
        """Records an event and returns None, or, over the limit, records nothing and returns
        the whole seconds until one is allowed again."""
        now = self._clock()
        with self._lock:
            events = self._events.pop(key, None) or deque()
            while events and events[0] <= now - self._window:
                events.popleft()
            self._events[key] = events  # most recently seen last
            if len(events) >= self._limit:
                return max(1, math.ceil(events[0] + self._window - now))
            events.append(now)
            while len(self._events) > self._max_keys:
                self._events.popitem(last=False)
            return None

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


requests = RateLimiter(REQUESTS_PER_MINUTE, 60)
ai_per_minute = RateLimiter(AI_CALLS_PER_MINUTE, 60)
ai_per_day = RateLimiter(AI_CALLS_PER_DAY, _DAY)

_current_user: ContextVar[str | None] = ContextVar("penny_limits_user", default=None)


def note_request(user_id: str) -> int | None:
    """Counts one API request for this person and remembers them for AI charges. Returns the
    seconds to wait when they're over the limit."""
    _current_user.set(user_id)
    return requests.retry_after(user_id)


def spend_ai_call() -> bool:
    """Charges one model call to the person making this request; False when they're over the
    minute or day limit (the caller then uses its built-in answer). Calls outside a signed-in
    request (tests, scripts) are not limited."""
    user_id = _current_user.get()
    if user_id is None:
        return True
    if ai_per_minute.retry_after(user_id) is not None:
        return False
    return ai_per_day.retry_after(user_id) is None


def reset_all() -> None:
    for limiter in (requests, ai_per_minute, ai_per_day):
        limiter.reset()
