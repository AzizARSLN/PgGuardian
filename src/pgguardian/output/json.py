"""JSON renderer: machine-readable serialization of Pydantic models."""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel


def to_dict(payload: BaseModel | dict[str, Any] | list[Any]) -> dict[str, Any] | list[Any]:
    """Convert models to plain JSON-compatible structures."""
    if isinstance(payload, BaseModel):
        return payload.model_dump(mode="json")
    if isinstance(payload, list):
        return [to_dict(item) for item in payload]  # type: ignore[misc]
    if isinstance(payload, dict):
        return {str(key): to_dict(value) for key, value in payload.items()}  # type: ignore[misc]
    return payload  # type: ignore[return-value]


def dumps(payload: BaseModel | dict[str, Any] | list[Any], *, indent: int = 2) -> str:
    """Serialize a payload to a JSON string."""
    return json.dumps(to_dict(payload), indent=indent, default=str)


class JsonRenderer:
    """Renderer honoring the OutputRenderer protocol for JSON output."""

    def render(self, payload: BaseModel | dict[str, Any] | list[Any]) -> str:
        """Return the JSON document as a string."""
        return dumps(payload)
