#!/usr/bin/env python3
"""Vendor-side license tool for pgGuardian.

This is the *producer* side of the offline Ed25519 licensing scheme: it mints
keypairs and signs license keys. It is NOT shipped inside the application —
the app only carries the public key (``pgguardian.licensing``).

Usage::

    python tools/license_keygen.py keygen
    python tools/license_keygen.py issue --private-key <b64> \
        --email admin@example.com --plan pro --days 365

Run with the project interpreter, e.g.
``.venv/Scripts/python.exe tools/license_keygen.py ...``.
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pgguardian.licensing import generate_keypair, sign_license  # noqa: E402


def _cmd_keygen(_: argparse.Namespace) -> int:
    private_key, public_key = generate_keypair()
    print("Private key (KEEP SECRET — signs licenses):")
    print(f"  {private_key}")
    print()
    print("Public key (ship inside the app / set PGGUARDIAN_LICENSE_PUBLIC_KEY):")
    print(f"  {public_key}")
    return 0


def _cmd_issue(args: argparse.Namespace) -> int:
    issued_at = datetime.now(UTC).replace(microsecond=0)
    expires_at = None
    if args.days and args.days > 0:
        expires_at = issued_at + timedelta(days=args.days)
    key = sign_license(
        args.private_key,
        email=args.email,
        plan=args.plan,
        issued_at=issued_at.isoformat(),
        expires_at=expires_at.isoformat() if expires_at else None,
    )
    print(key)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="pgGuardian license key generator.")
    sub = parser.add_subparsers(dest="command", required=True)

    keygen = sub.add_parser("keygen", help="Generate a new Ed25519 keypair.")
    keygen.set_defaults(func=_cmd_keygen)

    issue = sub.add_parser("issue", help="Sign a license key with the private key.")
    issue.add_argument("--private-key", required=True, help="base64url private key from 'keygen'.")
    issue.add_argument("--email", default=None, help="Licensee email (optional).")
    issue.add_argument("--plan", default=None, help="Plan name, e.g. 'pro' (optional).")
    issue.add_argument(
        "--days",
        type=int,
        default=0,
        help="Validity in days from now; 0 or omitted means a perpetual license.",
    )
    issue.set_defaults(func=_cmd_issue)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
