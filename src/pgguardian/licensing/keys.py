"""Ed25519 offline license keys.

pgGuardian ships only the *public* key. Licenses are minted by the vendor with
the matching private key (``tools/license_keygen.py``); nothing is ever sent to
a server, so activation works on an air-gapped desktop install.

Key format: ``PGG1.<base64url(payload_json)>.<base64url(signature)>`` where the
signature covers the canonical (sorted, compact) JSON payload.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

PREFIX = "PGG1"

# Vendor public key baked into the build (base64url of the 32 raw key bytes).
# It is public by design and safe to commit; the matching private key stays with
# the vendor. Overridable at runtime with ``PGGUARDIAN_LICENSE_PUBLIC_KEY`` for
# local/testing keys.
DEFAULT_PUBLIC_KEY = "QS6k5oo-sXoaZcbdH5NNzrmahx_3sP0krJHXot8OWbA"


class LicenseError(ValueError):
    """A license key is malformed, not signed by us, or expired."""


@dataclass(frozen=True)
class LicenseInfo:
    """The signed fields a valid license carries."""

    email: str | None
    plan: str | None
    issued_at: str | None
    expires_at: str | None

    @property
    def is_expired(self) -> bool:
        return _is_past(self.expires_at)


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.b64decode(text + pad, altchars=b"-_", validate=True)


def _now() -> datetime:
    return datetime.now(UTC)


def _is_past(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed < _now()


def canonical_payload(fields: dict[str, Any]) -> bytes:
    """Canonical JSON bytes that the signature covers."""
    return json.dumps(fields, separators=(",", ":"), sort_keys=True).encode("utf-8")


def generate_keypair() -> tuple[str, str]:
    """Return ``(private_key_b64, public_key_b64)`` for a fresh Ed25519 pair."""
    private = Ed25519PrivateKey.generate()
    private_raw = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return _b64e(private_raw), _b64e(public_raw)


def sign_license(private_key_b64: str, **fields: str | None) -> str:
    """Mint a license key string from the given ``email``/``plan``/date fields."""
    payload = canonical_payload({key: value for key, value in fields.items() if value is not None})
    private = Ed25519PrivateKey.from_private_bytes(_b64d(private_key_b64))
    return f"{PREFIX}.{_b64e(payload)}.{_b64e(private.sign(payload))}"


def _public_key_from(override: str | None) -> Ed25519PublicKey:
    raw_b64 = (override or DEFAULT_PUBLIC_KEY).strip()
    if not raw_b64:
        raise LicenseError("No license public key is configured.")
    try:
        return Ed25519PublicKey.from_public_bytes(_b64d(raw_b64))
    except Exception as err:
        raise LicenseError("License public key is invalid.") from err


def verify_license(key: str, public_key_b64: str | None = None) -> LicenseInfo:
    """Verify signature and expiry; raise ``LicenseError`` when unacceptable."""
    parts = (key or "").strip().split(".")
    if len(parts) != 3 or parts[0] != PREFIX:
        raise LicenseError("License key format is invalid.")
    try:
        payload = _b64d(parts[1])
        signature = _b64d(parts[2])
    except Exception as err:
        raise LicenseError("License key is not decodable.") from err
    try:
        _public_key_from(public_key_b64).verify(signature, payload)
    except InvalidSignature as err:
        raise LicenseError("License signature is invalid.") from err
    try:
        fields = json.loads(payload.decode("utf-8"))
    except Exception as err:
        raise LicenseError("License payload is invalid.") from err
    if not isinstance(fields, dict):
        raise LicenseError("License payload is invalid.")
    info = LicenseInfo(
        email=fields.get("email"),
        plan=fields.get("plan"),
        issued_at=fields.get("issued_at"),
        expires_at=fields.get("expires_at"),
    )
    if info.is_expired:
        raise LicenseError("License has expired.")
    return info
