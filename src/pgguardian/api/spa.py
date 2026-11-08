"""Serve the compiled frontend from the bundled FastAPI app (desktop build).

The desktop shell ships the Next.js *static export* (``frontend/out``) inside the
backend bundle and serves it on the same loopback origin as ``/api/v1``, so the
refresh cookie and the client-side session restore keep working.

Static export cannot prerender unbounded dynamic params, so each dynamic detail
segment is exported once under a ``_`` placeholder (see ``app/*/[param]/layout.tsx``).
Any concrete id is answered with that placeholder and the client router reads the
real value from the URL.
"""

from __future__ import annotations

import sys
from importlib import resources
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

# Path prefixes owned by the API (or docs); these must never fall back to HTML.
_API_PREFIXES = frozenset({"api", "ws", "docs", "redoc", "openapi.json", "reference", "healthz"})

# Dynamic segments and how many path levels below them are placeholders.
_DYNAMIC_DEPTH = {
    "statements": 1,
    "pgbadger": 1,
    "roles": 1,
    "schema-browser": 2,
}


def resolve_frontend_dir(settings: Any) -> Path | None:
    """Locate the compiled frontend (explicit setting, bundle, or source checkout)."""
    candidates: list[Path] = []

    configured = getattr(settings, "web_dir", None)
    if configured:
        candidates.append(Path(configured))

    try:
        packaged = resources.files("pgguardian").joinpath("web")
        if packaged.is_dir():
            candidates.append(Path(str(packaged)))
    except (FileNotFoundError, ModuleNotFoundError, TypeError, ValueError):
        pass

    # PyInstaller onefile/onedir extraction directory.
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / "pgguardian" / "web")

    # src/pgguardian/api/spa.py -> parents[3] == repository root
    candidates.append(Path(__file__).resolve().parents[3] / "frontend" / "out")

    for candidate in candidates:
        if candidate.is_dir() and (candidate / "index.html").is_file():
            return candidate
    return None


class SpaStaticFiles(StaticFiles):
    """``StaticFiles`` with a Next.js static-export fallback."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        # StaticFiles hands us an OS-specific path (backslashes on Windows).
        normalized = path.replace("\\", "/").strip("/")
        if normalized.split("/", 1)[0] in _API_PREFIXES:
            # Keep API/docs 404s as JSON instead of the SPA fallback.
            raise HTTPException(status_code=404)

        # Starlette's HTML mode answers a directory route ("/login") with a 307
        # redirect to its trailing-slash form ("/login/"). The Next.js static
        # export uses extensionless routes and the client router matches on
        # them, so "/login/" is not recognised as the public login page and the
        # client bounces back to "/login" forever. Serve the page in place.
        if normalized and "." not in normalized.rsplit("/", 1)[-1]:
            page = Path(self.directory) / normalized / "index.html"
            if page.is_file():
                return await super().get_response(f"{normalized}/index.html", scope)

        not_found = False
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            not_found = True
            response = None

        # Next.js also emits 404.html, which StaticFiles returns as a normal
        # (status 404) response instead of raising — treat it as a miss too.
        if not not_found and response is not None and response.status_code != 404:
            return response

        fallback = self._fallback(normalized)
        if fallback is None:
            if response is not None:
                return response
            raise HTTPException(status_code=404)
        return await super().get_response(fallback, scope)

    @staticmethod
    def _fallback(clean: str) -> str | None:
        if not clean:
            return None

        # Which shell payload was requested: the page or its RSC data?
        if clean.endswith("/index.txt"):
            base, suffix = clean[: -len("/index.txt")], "index.txt"
        elif clean.endswith(".txt"):
            base, suffix = clean[: -len(".txt")], "index.txt"
        elif clean.endswith("/index.html"):
            base, suffix = clean[: -len("/index.html")], "index.html"
        elif "." not in clean.rsplit("/", 1)[-1]:
            base, suffix = clean, "index.html"
        else:
            return None  # a real static asset that is genuinely missing

        parts = base.split("/")
        depth = _DYNAMIC_DEPTH.get(parts[0])
        if depth is None or len(parts) <= depth:
            return None
        shell = "/".join([parts[0], *["_"] * depth])
        return f"{shell}/{suffix}"


def mount_frontend(app: FastAPI, directory: Path) -> bool:
    """Serve ``directory`` at ``/`` with a static-export fallback. No-op if absent."""
    if not directory.is_dir() or not (directory / "index.html").is_file():
        return False
    app.mount("/", SpaStaticFiles(directory=str(directory), html=True), name="frontend")
    return True
