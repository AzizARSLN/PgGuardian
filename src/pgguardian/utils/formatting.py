"""Human-friendly formatting helpers for sizes, durations and ratios."""

from __future__ import annotations

from datetime import datetime


def format_bytes(num_bytes: int | float | None) -> str:
    """Format a byte count as B/KB/MB/GB/TB with one decimal for units >= KB."""
    if num_bytes is None:
        return "n/a"
    try:
        value = float(num_bytes)
    except (TypeError, ValueError):
        return "n/a"
    if value < 0:
        return "n/a"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    size = value
    unit = units[0]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            break
        size /= 1024
    if unit == "B":
        return f"{int(size)} B"
    return f"{size:.1f} {unit}"


def format_duration(seconds: float | int | None) -> str:
    """Format a duration in seconds as ``1h 2m 3s`` / ``4m 5s`` / ``6.0s``."""
    if seconds is None:
        return "n/a"
    try:
        total = float(seconds)
    except (TypeError, ValueError):
        return "n/a"
    if total < 0:
        return "n/a"
    if total < 60:
        return f"{total:.1f}s"
    minutes, secs = divmod(int(total), 60)
    if minutes < 60:
        return f"{minutes}m {secs}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m {secs}s"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h {minutes}m"


def format_percent(value: float | int | None, decimals: int = 1) -> str:
    """Format a ratio as a percentage string."""
    if value is None:
        return "n/a"
    try:
        return f"{float(value):.{decimals}f}%"
    except (TypeError, ValueError):
        return "n/a"


def format_count(value: int | float | None) -> str:
    """Format a counter value, tolerating NULLs from the catalogs."""
    if value is None:
        return "n/a"
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return "n/a"


def format_timestamp(value: datetime | str | None) -> str:
    """Format a timestamp value compactly, tolerating NULLs."""
    if value is None:
        return "never"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value)


def truncate(text: str | None, max_length: int = 120) -> str:
    """Truncate long query text for table display."""
    if not text:
        return ""
    collapsed = " ".join(str(text).split())
    if len(collapsed) <= max_length:
        return collapsed
    return collapsed[: max_length - 1] + "…"


def to_int(value: object) -> int:
    """Best-effort int conversion for catalog values (NULL/Decimal/str safe)."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            return int(text)
        except ValueError:
            try:
                return int(float(text))
            except ValueError:
                return 0
    as_int = getattr(value, "__int__", None)
    if callable(as_int):
        try:
            converted = as_int()
        except (TypeError, ValueError, OverflowError):
            return 0
        return converted if isinstance(converted, int) else 0
    return 0


def to_float(value: object) -> float | None:
    """Best-effort float conversion for catalog values; NULL → None."""
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    as_float = getattr(value, "__float__", None)
    if callable(as_float):
        try:
            converted = as_float()
        except (TypeError, ValueError, OverflowError):
            return None
        return converted if isinstance(converted, float) else None
    return None
