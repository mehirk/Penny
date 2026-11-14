"""Voice notes to Penny's agent: the recording is turned into text, and the text is read like
anything typed. The recording isn't kept."""

import base64
import binascii

from fastapi import HTTPException, status
from openai import AsyncOpenAI

from app import limits
from app.agent_models import AgentUpload, Transcript
from app.assist.common import logger
from app.config import Settings

MAX_AUDIO_BYTES = 8 * 1024 * 1024
TRANSCRIBE_TIMEOUT_SECONDS = 30.0
_AUDIO_TYPES = {
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
}
# Helps the model spell money words and amounts the way Penny reads them.
_HINT = "A note about money in Canada: $14.50 at Tim Hortons, split 3 ways, e-Transfer, TFSA."


def _decode(upload: AgentUpload) -> tuple[bytes, str]:
    name = upload.filename.casefold()
    suffix = name[name.rfind(".") :] if "." in name else ""
    if suffix not in _AUDIO_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Send a voice recording")
    try:
        data = base64.b64decode(upload.data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That recording couldn't be read"
        ) from error
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That recording is empty")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, "Keep voice notes under about a minute"
        )
    return data, _AUDIO_TYPES[suffix]


async def transcribe(settings: Settings, upload: AgentUpload) -> Transcript:
    data, media_type = _decode(upload)
    if not settings.openai_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Voice needs Penny AI. Type it instead."
        )
    if not limits.spend_ai_call():
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "You've used Penny AI a lot today. Type it instead."
        )
    client = AsyncOpenAI(
        api_key=settings.openai_api_key, timeout=TRANSCRIBE_TIMEOUT_SECONDS, max_retries=1
    )
    try:
        result = await client.audio.transcriptions.create(
            model=settings.openai_transcribe_model,
            file=(f"note{upload.filename[upload.filename.rfind('.') :]}", data, media_type),
            prompt=_HINT,
        )
    except Exception as error:
        logger.exception("Transcription failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Penny couldn't hear that. Try again or type it."
        ) from error
    text = (result.text or "").strip()[:1000]
    if not text:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Penny didn't hear anything. Try again?"
        )
    return Transcript(text=text)
