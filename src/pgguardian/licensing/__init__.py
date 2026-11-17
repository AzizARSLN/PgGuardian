"""Offline license handling for pgGuardian.

Licences are signed Ed25519 keys. The application only ever carries the public
key, so activation works without any server — see ``pgguardian.licensing.keys``.
"""

from pgguardian.licensing.keys import (
    DEFAULT_PUBLIC_KEY,
    LicenseError,
    LicenseInfo,
    generate_keypair,
    sign_license,
    verify_license,
)
from pgguardian.licensing.state import LicenseState, resolve_license_state

__all__ = [
    "DEFAULT_PUBLIC_KEY",
    "LicenseError",
    "LicenseInfo",
    "LicenseState",
    "generate_keypair",
    "resolve_license_state",
    "sign_license",
    "verify_license",
]
