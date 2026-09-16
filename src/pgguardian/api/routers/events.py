"""Server-Sent Events and WebSocket streaming bus.

A singleton in-process ``EventBus`` fans events out to async subscribers (SSE
clients and WebSocket peers). Each subscriber is an ``asyncio.Queue`` bound to
a filtered set of channels.

Channels (default all): health, queries, locks, storage, replication, backups,
snapshots, diagnostics, config.
"""

from __future__ import annotations

import asyncio
import json
import secrets
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from sse_starlette.sse import EventSourceResponse

from pgguardian.api.deps import get_jwt_settings, verify_token_OR_jwt

router = APIRouter(prefix="/api/v1/events", tags=["events"])

DEFAULT_CHANNELS = (
    "health",
    "queries",
    "locks",
    "storage",
    "replication",
    "backups",
    "snapshots",
    "diagnostics",
    "config",
)


@dataclass
class EventBus:
    """Per-process pub/sub with per-channel filtering."""

    subscribers: dict[str, tuple[asyncio.Queue[dict], set[str]]] = field(default_factory=dict)

    def subscribe(self, channels: set[str]) -> tuple[str, asyncio.Queue[dict]]:
        sub_id = secrets.token_urlsafe(12)
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=256)
        self.subscribers[sub_id] = (queue, channels)
        return sub_id, queue

    def unsubscribe(self, sub_id: str) -> None:
        self.subscribers.pop(sub_id, None)

    async def publish(self, channel: str, data: Any) -> None:
        payload = {"channel": channel, "data": data, "event": channel}
        dead: list[str] = []
        for sub_id, (queue, channels) in self.subscribers.items():
            if channel not in channels:
                continue
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(sub_id)
        for sub_id in dead:
            self.subscribers.pop(sub_id, None)


_BUS = EventBus()


def get_bus() -> EventBus:
    """Return the process-level event bus singleton."""
    return _BUS


def _parse_channels(raw: str | list[str] | None) -> set[str]:
    if not raw:
        return set(DEFAULT_CHANNELS)
    if isinstance(raw, str):
        tokens = [c.strip() for c in raw.split(",") if c.strip()]
    else:
        tokens = [c.strip() for c in raw if c and c.strip()]
    allowed = set(DEFAULT_CHANNELS)
    chosen = {t for t in tokens if t in allowed}
    return chosen or allowed


@router.get("/stream")
async def sse_stream(
    request: Request,
    channels: list[str] | None = Query(default=None),
    channels_csv: str | None = Query(default=None, alias="channels"),
    bus: EventBus = Depends(get_bus),
    _auth: Any = Depends(verify_token_OR_jwt),
) -> EventSourceResponse:
    """Server-Sent Event stream filtered by channels. Defaults to all channels."""
    chosen = _parse_channels(channels_csv if channels_csv else channels)

    async def _event_generator() -> AsyncIterator[dict[str, Any]]:
        sub_id, queue = bus.subscribe(chosen)
        try:
            yield {"event": "hello", "data": json.dumps({"channels": sorted(chosen), "sub_id": sub_id})}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": json.dumps({"t": "keepalive"})}
                    continue
                yield {"event": payload.get("event", "message"), "data": json.dumps(payload)}
        finally:
            bus.unsubscribe(sub_id)

    return EventSourceResponse(_event_generator())


def _auth_ws(
    token: str | None,
    jwt_secret: str,
    api_token: str | None,
) -> bool:
    """Lightweight auth check for WebSocket query-string tokens.

    Returns True if either the legacy API token matches, or the provided token
    is a valid JWT. If neither PGGUARDIAN_API_TOKEN nor a token are set, we
    allow the connection (dev mode, matching verify_token_OR_jwt semantics).
    """
    if api_token:
        return bool(token) and token == api_token
    if not token:
        return True
    try:
        import jwt as pyjwt

        pyjwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            options={"require": ["exp"], "verify_signature": True},
        )
        return True
    except Exception:
        return False


@router.websocket("/ws")
async def websocket_stream(
    websocket: WebSocket,
    token: str | None = Query(default=None),
    channels_csv: str | None = Query(default=None, alias="channels"),
    bus: EventBus = Depends(get_bus),
) -> None:
    """WebSocket endpoint with the same channel filter as SSE /stream.

    Auth token is passed via ``?token=`` query param because WebSocket clients
    typically cannot set ``Authorization`` headers.
    """
    from pgguardian.api.deps import get_api_settings

    settings = get_api_settings()
    jwt_secret = get_jwt_settings(settings)
    if not _auth_ws(token, jwt_secret, settings.api_token):
        await websocket.close(code=1008)
        return

    chosen = _parse_channels(channels_csv)
    await websocket.accept()
    sub_id, queue = bus.subscribe(chosen)
    try:
        await websocket.send_json(
            {"event": "hello", "data": {"channels": sorted(chosen), "sub_id": sub_id}}
        )
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "ping", "data": {"t": "keepalive"}})
                continue
            except asyncio.CancelledError:
                break
            try:
                await websocket.send_json(payload)
            except WebSocketDisconnect:
                break
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(sub_id)
