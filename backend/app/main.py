"""The Penny API: app setup, the per-request save, CORS, and the routers (app/api)."""

import asyncio
import logging
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    accounts,
    assist,
    bills,
    budgets,
    calendar,
    coach,
    dashboard,
    goals,
    learning,
    splits,
    transactions,
)
from app.config import get_settings
from app.db import pool
from app.db.repository import StaleDataError
from app.db.unit import unit_scope
from app.models import HealthResponse

logger = logging.getLogger(__name__)


# Largest request body: a statement upload (8 MB file, sent as base64) with room to spare.
MAX_BODY_BYTES = 12 * 1024 * 1024
_DOCS_PATHS = ("/docs", "/openapi.json")
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}
_PRODUCTION = get_settings().environment == "production"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if os.environ.get("RENDER") and not _PRODUCTION:
        # Development mode on a public server leaves the API docs open and would accept a
        # demo token if one were set.
        logger.error("Running on Render without PENNY_ENVIRONMENT=production")
    yield
    pool.close()


# The API docs list every route, so they're off in production.
app = FastAPI(
    title="Penny API",
    version="0.1.0",
    docs_url=None if _PRODUCTION else "/docs",
    redoc_url=None,
    openapi_url=None if _PRODUCTION else "/openapi.json",
    lifespan=lifespan,
)


@app.middleware("http")
async def save_changes(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """With a database: each person's data is loaded the first time this request needs it, and
    whatever changed is saved once the request succeeds. If someone else saved first, an edit
    is refused; a read that recorded the same automatic change (a bill due today) still answers.
    Added before CORS so CORS headers wrap its responses too."""
    if not pool.database_enabled():
        return await call_next(request)
    async with unit_scope(commit=False) as unit:
        response = await call_next(request)
        if response.status_code < 400:
            try:
                await asyncio.to_thread(unit.commit)
            except StaleDataError:
                if request.method != "GET":
                    detail = "Your data changed in another tab or device. Refresh and try again."
                    return JSONResponse({"detail": detail}, status_code=status.HTTP_409_CONFLICT)
                logger.info("Skipped saving a read that raced another save")
        return response


@app.middleware("http")
async def guard(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Refuses oversized bodies before they're read, and adds security headers to every
    response: no sniffing, no framing, no referrer, and nothing cached (it's financial data)."""
    length = request.headers.get("content-length")
    if request.headers.get("transfer-encoding", "").lower() == "chunked" and length is None:
        return JSONResponse(
            {"detail": "Send the request with a Content-Length"},
            status_code=status.HTTP_411_LENGTH_REQUIRED,
        )
    if length is not None and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
        return JSONResponse(
            {"detail": "That request is too large"},
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        )
    response = await call_next(request)
    for name, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if not request.url.path.startswith(_DOCS_PATHS):
        response.headers.setdefault(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
        )
    response.headers.setdefault("Cache-Control", "no-store")
    if _PRODUCTION:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="penny-api", version=app.version)


for module in (
    dashboard,
    transactions,
    budgets,
    goals,
    bills,
    calendar,
    accounts,
    splits,
    assist,
    learning,
    coach,
):
    app.include_router(module.router)
