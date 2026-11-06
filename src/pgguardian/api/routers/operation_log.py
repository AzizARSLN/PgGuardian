"""Operation log endpoint: read the recorded expert-action history.

The rows live in pgGuardian's own database (see ``api.operation_log``); this
router only exposes them, newest first, for the UI history view.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from pgguardian.api.deps import get_api_settings, mapped_errors
from pgguardian.api.operation_log import OperationLogEntry, list_operations
from pgguardian.api.settings import ApiSettings

router = APIRouter(prefix="/api/v1/operation-log", tags=["operation-log"])


@router.get("", response_model=list[OperationLogEntry])
def read_operation_log(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, pattern="^(ok|failed|cancelled)$"),
    settings: ApiSettings = Depends(get_api_settings),
) -> list[OperationLogEntry]:
    """Return the most recent expert-action log rows (newest first)."""
    with mapped_errors(settings):
        return list_operations(settings, limit=limit, offset=offset, action=action, status=status)
