"""Offline Ed25519 licensing: sign/verify round-trips and the SQLite store."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from pgguardian.central.store import SqliteCentralStore
from pgguardian.licensing import (
    LicenseError,
    generate_keypair,
    sign_license,
    verify_license,
)


def test_sign_and_verify_roundtrip() -> None:
    private_key, public_key = generate_keypair()
    expires = (datetime.now(UTC) + timedelta(days=30)).replace(microsecond=0).isoformat()
    key = sign_license(private_key, email="user@example.com", plan="pro", expires_at=expires)

    info = verify_license(key, public_key)
    assert info.email == "user@example.com"
    assert info.plan == "pro"
    assert info.expires_at == expires
    assert info.is_expired is False


def test_perpetual_license_never_expires() -> None:
    private_key, public_key = generate_keypair()
    info = verify_license(sign_license(private_key, email="user@example.com"), public_key)
    assert info.is_expired is False


def test_tampered_payload_is_rejected() -> None:
    private_key, public_key = generate_keypair()
    key = sign_license(private_key, email="user@example.com", plan="pro")
    prefix, payload, signature = key.split(".")
    tampered = f"{prefix}.{payload[:-2]}AA.{signature}"
    with pytest.raises(LicenseError):
        verify_license(tampered, public_key)


def test_wrong_public_key_is_rejected() -> None:
    private_key, _ = generate_keypair()
    _, other_public = generate_keypair()
    key = sign_license(private_key, email="user@example.com")
    with pytest.raises(LicenseError):
        verify_license(key, other_public)


def test_expired_license_is_rejected() -> None:
    private_key, public_key = generate_keypair()
    past = (datetime.now(UTC) - timedelta(days=1)).replace(microsecond=0).isoformat()
    key = sign_license(private_key, email="user@example.com", expires_at=past)
    with pytest.raises(LicenseError):
        verify_license(key, public_key)


@pytest.mark.parametrize("key", ["", "not-a-license", "PGG1.only-two", "XXXX.a.b"])
def test_malformed_keys_are_rejected(key: str) -> None:
    _, public_key = generate_keypair()
    with pytest.raises(LicenseError):
        verify_license(key, public_key)


def test_sqlite_store_license_lifecycle(tmp_path) -> None:
    store = SqliteCentralStore(tmp_path / "central.db")
    assert store.get_license() is None

    store.set_license(
        license_key="PGG1.payload.sig",
        email="user@example.com",
        plan="pro",
        issued_at="2026-01-01T00:00:00+00:00",
        expires_at="2027-01-01T00:00:00+00:00",
    )
    row = store.get_license()
    assert row is not None
    assert row["plan"] == "pro"
    assert row["email"] == "user@example.com"
    assert row["activated_at"] is not None

    store.set_license(
        license_key="PGG1.payload2.sig",
        email="other@example.com",
        plan="team",
        issued_at=None,
        expires_at=None,
    )
    updated = store.get_license()
    assert updated is not None
    assert updated["plan"] == "team"

    store.delete_license()
    assert store.get_license() is None
