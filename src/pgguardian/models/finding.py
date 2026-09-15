"""Shared severity levels and exit-code mapping."""

from __future__ import annotations

from enum import StrEnum


class Severity(StrEnum):
    """Diagnostic severity."""

    OK = "OK"
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


EXIT_OK = 0
EXIT_WARNING = 1
EXIT_CRITICAL = 2
EXIT_ERROR = 3


def exit_code_for(severity: Severity) -> int:
    """Map the worst severity to a process exit code."""
    if severity == Severity.CRITICAL:
        return EXIT_CRITICAL
    if severity == Severity.WARNING:
        return EXIT_WARNING
    if severity == Severity.UNKNOWN:
        return EXIT_WARNING
    if severity == Severity.INFO:
        return EXIT_OK
    return EXIT_OK


def worst_severity(severities: list[Severity]) -> Severity:
    """Return the most severe entry (CRITICAL > UNKNOWN > WARNING > INFO > OK)."""
    if not severities:
        return Severity.UNKNOWN
    if Severity.CRITICAL in severities:
        return Severity.CRITICAL
    if Severity.UNKNOWN in severities:
        return Severity.UNKNOWN
    if Severity.WARNING in severities:
        return Severity.WARNING
    if Severity.INFO in severities:
        return Severity.INFO
    return Severity.OK
