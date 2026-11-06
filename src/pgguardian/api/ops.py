"""Running expert-operation identity.

Long-running expert operations (VACUUM, REINDEX, SQL editor runs, ...) tag
their database connection with ``application_name = 'pgGuardian-op:<id>'``.
The client sends the same id as ``?op_id=`` so a later request can locate the
live backend in ``pg_stat_activity`` and cancel it with ``pg_cancel_backend``
— with no server-side registry to keep in sync.
"""

from __future__ import annotations

import re

from fastapi import HTTPException

from pgguardian.database.connection import APPLICATION_NAME

OP_APP_PREFIX = f"{APPLICATION_NAME}-op:"
_OP_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def op_application_name(op_id: str) -> str:
    """The ``application_name`` that marks a connection as running ``op_id``."""
    return f"{OP_APP_PREFIX}{op_id}"


def validate_op_id(op_id: str) -> str:
    """Reject ids that are not safe to embed in ``application_name`` (400)."""
    if not _OP_ID_PATTERN.match(op_id or ""):
        raise HTTPException(
            status_code=400,
            detail="Invalid operation id: use 1-64 chars of letters, digits, '-' or '_'.",
        )
    return op_id


# ``pg_cancel_backend`` only cancels a *running* query, so a cancel that lands
# while an operation waits between attempts (e.g. a lock-timeout retry) would be
# lost. Such requests are remembered here and honoured before the next statement.
_cancel_requested: set[str] = set()
_CANCEL_FLAG_LIMIT = 256


def request_op_cancel(op_id: str) -> None:
    """Record that ``op_id`` must stop before its next statement."""
    if len(_cancel_requested) >= _CANCEL_FLAG_LIMIT:
        _cancel_requested.clear()
    _cancel_requested.add(op_id)


def op_cancel_requested(op_id: str) -> bool:
    """Whether a cancel was requested for ``op_id``."""
    return op_id in _cancel_requested


def clear_op_cancel(op_id: str) -> None:
    """Forget a pending cancel request (called before an operation starts)."""
    _cancel_requested.discard(op_id)
