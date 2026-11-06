"""Add to calendar: a short-lived link to an .ics file of the user's money dates.

Calendars open the file without the app's sign-in, so the signed-in request makes the file and
gets back an unguessable link that works for a few minutes. Files live in memory only.
"""

import secrets
import threading
import time
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import AuthenticatedUser, user_store
from app.dashboard_models import CalendarExport, CalendarExportWrite
from app.domain.calendar_file import calendar_file

router = APIRouter(prefix="/api/v1")

LINK_SECONDS = 600
MAX_FILES = 200
_files: dict[str, tuple[float, str]] = {}
_files_lock = threading.Lock()


@router.post("/calendar/exports", response_model=CalendarExport, tags=["calendar"])
def export_calendar(
    request: CalendarExportWrite, current_user: AuthenticatedUser
) -> CalendarExport:
    if not (request.bills or request.cards or request.pay):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick at least one kind of date")
    events = user_store(current_user).calendar_events(current_user.id, request)
    if not events:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Nothing to add yet. Add a bill, a card due date, or your pay first.",
        )
    text = calendar_file(events, datetime.now(UTC), request.reminder)
    token = secrets.token_urlsafe(24)
    now = time.monotonic()
    with _files_lock:
        for key in [key for key, (expires, _) in _files.items() if expires <= now]:
            del _files[key]
        while len(_files) >= MAX_FILES:
            del _files[next(iter(_files))]
        _files[token] = (now + LINK_SECONDS, text)
    return CalendarExport(
        path=f"/api/v1/calendar/files/{token}.ics",
        event_count=len(events),
        expires_in_seconds=LINK_SECONDS,
    )


@router.get("/calendar/files/{token}.ics", tags=["calendar"], include_in_schema=False)
def calendar_download(token: str) -> Response:
    with _files_lock:
        entry = _files.get(token)
    if not entry or entry[0] <= time.monotonic():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This link has expired. Add to calendar again in Penny."
        )
    return Response(
        entry[1],
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="penny-money-dates.ics"',
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
        },
    )
