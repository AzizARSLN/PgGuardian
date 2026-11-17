"""Resolve the stored license into a gate-friendly state.

The signed key lives in pgGuardian's own metadata store. Every gated request
re-verifies it (a single SELECT plus an Ed25519 check), so removing, expiring or
tampering with a license takes effect immediately — there is no cache to go
stale.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pgguardian.licensing.keys import LicenseError, LicenseInfo, verify_license


@dataclass(frozen=True)
class LicenseState:
    """Whether the install is licensed, and whether that is enforced."""

    licensed: bool
    enforced: bool
    reason: str | None = None
    info: LicenseInfo | None = None


def resolve_license_state(store: Any, settings: Any) -> LicenseState:
    """Verify the stored license key against the configured public key."""
    enforced = bool(getattr(settings, "license_enforced", False))
    try:
        row = store.get_license()
    except Exception as err:  # metadata store unreachable — treat as unlicensed
        return LicenseState(licensed=False, enforced=enforced, reason=str(err))
    if row is None:
        return LicenseState(licensed=False, enforced=enforced, reason="No license activated.")
    try:
        info = verify_license(str(row["license_key"]), getattr(settings, "license_public_key", None))
    except LicenseError as err:
        return LicenseState(licensed=False, enforced=enforced, reason=str(err))
    return LicenseState(licensed=True, enforced=enforced, info=info)
