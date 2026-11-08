"""License router: report status, activate an offline key, remove it.

License keys are Ed25519-signed and verified locally — see
``pgguardian.licensing``. The activated key is stored in pgGuardian's own
metadata store, so the same code path serves the web (PostgreSQL) and the
self-contained desktop (SQLite) builds.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from pgguardian.api.deps import get_api_settings, get_central_store_dep, require_role
from pgguardian.api.settings import ApiSettings
from pgguardian.central.store import CentralStore
from pgguardian.licensing import LicenseError, verify_license

router = APIRouter(prefix="/api/v1/license", tags=["license"])


class LicenseStatus(BaseModel):
    licensed: bool
    enforced: bool
    plan: str | None = None
    email: str | None = None
    issued_at: str | None = None
    expires_at: str | None = None
    activated_at: Any = None
    message: str | None = None


class ActivateRequest(BaseModel):
    license_key: str


def _status(store: CentralStore, settings: ApiSettings) -> LicenseStatus:
    row = store.get_license()
    enforced = bool(settings.license_enforced)
    if row is None:
        return LicenseStatus(
            licensed=False,
            enforced=enforced,
            message=None if enforced else "No license activated.",
        )
    base = {
        "enforced": enforced,
        "plan": row.get("plan"),
        "email": row.get("email"),
        "issued_at": row.get("issued_at"),
        "expires_at": row.get("expires_at"),
        "activated_at": row.get("activated_at"),
    }
    try:
        verify_license(str(row["license_key"]), settings.license_public_key)
    except LicenseError as err:
        return LicenseStatus(licensed=False, message=str(err), **base)
    return LicenseStatus(licensed=True, **base)


@router.get("", response_model=LicenseStatus)
def get_license_status(
    settings: ApiSettings = Depends(get_api_settings),
    store: CentralStore = Depends(get_central_store_dep),
    _: dict[str, Any] = Depends(require_role({"Admin", "DBA", "Viewer"})),
) -> LicenseStatus:
    """Current license state, re-verifying the stored key's signature."""
    return _status(store, settings)


@router.post("", response_model=LicenseStatus)
def activate_license(
    body: ActivateRequest,
    settings: ApiSettings = Depends(get_api_settings),
    store: CentralStore = Depends(get_central_store_dep),
    _: dict[str, Any] = Depends(require_role({"Admin"})),
) -> LicenseStatus:
    """Verify and store an offline license key (Admin-only)."""
    try:
        info = verify_license(body.license_key.strip(), settings.license_public_key)
    except LicenseError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    store.set_license(
        license_key=body.license_key.strip(),
        email=info.email,
        plan=info.plan,
        issued_at=info.issued_at,
        expires_at=info.expires_at,
    )
    return _status(store, settings)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_license(
    store: CentralStore = Depends(get_central_store_dep),
    _: dict[str, Any] = Depends(require_role({"Admin"})),
) -> None:
    """Remove the stored license (Admin-only)."""
    store.delete_license()
