"""Guardrails on the text that goes into and comes out of Penny's AI, in deterministic code:
instructions smuggled into a question or a web page, personal identifiers that should never
reach the model provider or the database, and investment picks Penny must not make.
"""

import re
from collections.abc import Callable

from fastapi import HTTPException, status
from pydantic import AfterValidator

_INJECTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"ignore\s+(all\s+)?(the\s+)?(previous|prior|above|system|developer)\s+instructions?",
        r"disregard\s+(all\s+)?(the\s+)?(previous|prior|above|system)\s+(instructions?|rules)",
        r"reveal\s+(the\s+|your\s+)?(system|developer|hidden)\s+(prompt|message|instructions)",
        r"override\s+(the\s+)?(rules|tools|policy)",
        r"pretend\s+you\s+are\s+(the\s+)?system",
        r"you\s+are\s+now\s+(in\s+)?(developer|dan|unrestricted)\s*(mode)?",
        r"call\s+(an?\s+)?unlisted\s+tool",
        r"exfiltrate|jailbreak|prompt\s+injection",
    )
]


def looks_like_injection(text: str) -> bool:
    """Whether the text tries to give Penny's AI new instructions."""
    normalized = " ".join(text.split())
    return any(pattern.search(normalized) for pattern in _INJECTION_PATTERNS)


def validate_user_question(question: str) -> str:
    normalized = " ".join(question.split())
    if looks_like_injection(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The question contains instructions that Penny can’t follow",
        )
    return normalized


def _luhn(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2:
            value = value * 2 - 9 if value > 4 else value * 2
        total += value
    return total % 10 == 0


# A card number (13 to 19 digits, spaces or dashes allowed) and a Social Insurance Number
# (9 digits, 3-3-3) both carry a Luhn check digit, so ordinary numbers aren't mistaken for them.
_CARD = re.compile(r"(?<![\d$.,])(?:\d[ -]?){12,18}\d(?![\d,])")
_SIN = re.compile(r"(?<![\d$.,])\d{3}[ -]?\d{3}[ -]?\d{3}(?![\d,])")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\d$])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)")


def _replace_if_luhn(label: str) -> Callable[[re.Match[str]], str]:
    def replace(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group())
        return f"[{label} removed]" if _luhn(digits) else match.group()

    return replace


def redact_personal(text: str) -> str:
    """The text without card numbers, SINs, email addresses, or phone numbers. Penny never
    needs them, so they're removed before anything is stored or sent to the model."""
    text = _CARD.sub(_replace_if_luhn("card number"), text)
    text = _SIN.sub(_replace_if_luhn("SIN"), text)
    text = _EMAIL.sub("[email removed]", text)
    return _PHONE.sub("[phone removed]", text)


# On a model field that holds the user's own words.
Redacted = AfterValidator(redact_personal)


def web_url(url: str) -> str:
    """A link Penny shows: http or https only, so a page can't hand over a javascript: link."""
    if not re.match(r"https?://[^\s/]", url, re.IGNORECASE):
        raise ValueError("Only http and https links")
    return url


_INVESTMENT_PICKS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(buy|sell|short)\s+(\w+\s+){0,2}(shares?|stocks?|etfs?|index\s+funds?|bitcoin|"
        r"crypto\w*|ethereum|options)\b",
        r"\b(invest|put)\s+(\w+\s+){0,3}in(to)?\s+(\w+\s+){0,2}(stocks?|shares?|etfs?|"
        r"index\s+funds?|bitcoin|crypto\w*|ethereum|the\s+(stock\s+)?market)\b",
        r"\b(NYSE|NASDAQ|TSX)\s*:\s*[A-Z]{1,5}\b",
    )
]


def picks_investments(text: str) -> bool:
    """Whether the text recommends buying or selling an investment, which Penny never does."""
    return any(pattern.search(text) for pattern in _INVESTMENT_PICKS)
