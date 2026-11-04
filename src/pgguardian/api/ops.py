"""Running expert-operation identity.

Long-running expert operations (VACUUM, REINDEX, SQL editor runs, ...) tag
their database connection with ``application_name = 'pgguardian-op:<id>'``.
The client sends the same id as ``?op_id=`` so a later request can locate the
live backend in ``pg_stat_activity`` and cancel it with ``pg_cancel_backend``
— with no server-side registry to keep in sync.
"""

from __future__ import annotations

import re

from fastapi import HTTPException

OP_APP_PREFIX = "pgguardian-op:"
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
