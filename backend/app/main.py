"""The Penny API: app setup, the per-request save, CORS, and the routers (app/api)."""

import asyncio
import logging
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


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    pool.close()


app = FastAPI(title="Penny API", version="0.1.0", docs_url="/docs", lifespan=lifespan)


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
    calendar,
    splits,
    assist,
    learning,
    coach,
):
    app.include_router(module.router)
