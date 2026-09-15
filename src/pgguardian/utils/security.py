"""Secret masking helpers.

Passwords and connection strings must never appear in terminal output,
logs, reports or exception messages.
"""

from __future__ import annotations

import re
import urllib.parse

_PASSWORD_KEYS = ("password", "passwd", "pwd", "secret", "token")
_CONNINFO_PASSWORD_RE = re.compile(r"(password\s*=\s*)('[^']*'|\S+)", re.IGNORECASE)
_URL_PASSWORD_RE = re.compile(r"(://[^:/\s]+:)([^@/\s]+)(@)")


def mask_secret(value: str | None) -> str:
    """Return a masked placeholder for any secret value."""
    if value is None or value == "":
        return "***"
    return "***"


def contains_secret_key(name: str) -> bool:
    """Check whether a key/field name looks like it holds a secret."""
    lowered = name.lower()
    return any(key in lowered for key in _PASSWORD_KEYS)


def mask_connection_string(conninfo: str) -> str:
    """Mask the password inside a libpq conninfo string or URL.

    Handles both ``postgresql://user:pass@host/db`` and
    ``host=.. password=..`` keyword/value formats.
    """
    if not conninfo:
        return ""
    masked = _CONNINFO_PASSWORD_RE.sub(r"\1'***'", conninfo)
    masked = _URL_PASSWORD_RE.sub(r"\1***\3", masked)
    # Catch password query params such as ?password=hunter2
    try:
        if "://" in masked:
            parts = urllib.parse.urlsplit(masked)
            query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if any(contains_secret_key(k) for k, _ in query):
                query = [(k, "***") if contains_secret_key(k) else (k, v) for k, v in query]
                masked = urllib.parse.urlunsplit(
                    (
                        parts.scheme,
                        parts.netloc,
                        parts.path,
                        urllib.parse.urlencode(query),
                        parts.fragment,
                    )
                )
    except ValueError:
        pass
    return masked


def sanitize_text(text: str, secrets: list[str] | None = None) -> str:
    """Remove secret material from an arbitrary message.

    Applies connection-string masking first, then replaces any literal
    secret values that were explicitly provided.
    """
    cleaned = mask_connection_string(text)
    for secret in secrets or []:
        if secret:
            cleaned = cleaned.replace(secret, "***")
    return cleaned


def sanitize_error(exc: BaseException, secrets: list[str] | None = None) -> str:
    """Convert an exception to a user-facing message without secrets."""
    message = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
    return sanitize_text(message, secrets)
