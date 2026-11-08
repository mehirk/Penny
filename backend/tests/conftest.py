import os

# Tests never use a real database or a real model, whatever backend/.env says: environment
# variables win over the .env file, and these are set before the app reads its settings.
os.environ["PENNY_DATABASE_URL"] = ""
os.environ["PENNY_OPENAI_API_KEY"] = ""

from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402

from app import limits  # noqa: E402
from app.config import get_settings  # noqa: E402

get_settings.cache_clear()
assert get_settings().database_url is None and not get_settings().openai_api_key


@pytest.fixture(autouse=True)
def _fresh_limits() -> Iterator[None]:
    """Request and AI limits are process-wide; each test starts with none used."""
    limits.reset_all()
    yield
    limits.reset_all()
