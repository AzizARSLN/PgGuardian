"""Health-score calculation.

Each non-OK check subtracts a penalty; the score is clamped to 0–100:

- CRITICAL: 25 points
- WARNING: 10 points
- UNKNOWN: 5 points
- INFO / OK: 0 points

Status labels: ``HEALTHY`` (>= 90), ``DEGRADED`` (>= 60),
``CRITICAL`` (< 60). An empty check list yields score 0 / UNKNOWN.
"""

from __future__ import annotations

from pgguardian.models.finding import Severity
from pgguardian.models.health import HealthCheck

PENALTY_CRITICAL = 25
PENALTY_WARNING = 10
PENALTY_UNKNOWN = 5

STATUS_HEALTHY = "HEALTHY"
STATUS_DEGRADED = "DEGRADED"
STATUS_CRITICAL = "CRITICAL"
STATUS_UNKNOWN = "UNKNOWN"


class HealthScoreCalculator:
    """Stateless calculator mapping checks to a 0–100 score plus a label."""

    def calculate(self, checks: list[HealthCheck]) -> tuple[int, str]:
        """Return ``(score, status_label)`` for the given checks."""
        if not checks:
            return 0, STATUS_UNKNOWN
        if all(check.severity == Severity.UNKNOWN for check in checks):
            # No signal at all — report UNKNOWN rather than a made-up score.
            return 0, STATUS_UNKNOWN
        penalty = 0
        has_critical = False
        for check in checks:
            severity = check.severity
            if severity == Severity.CRITICAL:
                penalty += PENALTY_CRITICAL
                has_critical = True
            elif severity == Severity.WARNING:
                penalty += PENALTY_WARNING
            elif severity == Severity.UNKNOWN:
                penalty += PENALTY_UNKNOWN
        score = max(0, min(100, 100 - penalty))
        if has_critical and score >= 60:
            # A critical finding always degrades below HEALTHY/upper DEGRADED.
            score = min(score, 59)
        if score >= 90:
            return score, STATUS_HEALTHY
        if score >= 60:
            return score, STATUS_DEGRADED
        if not checks:
            return score, STATUS_UNKNOWN
        return score, STATUS_CRITICAL

    def calculate_from_severities(self, severities: list[Severity]) -> tuple[int, str]:
        """Convenience wrapper for plain severity lists (used by tests)."""
        checks = [
            HealthCheck(name=f"check-{i}", status=sev, severity=sev)
            for i, sev in enumerate(severities)
        ]
        return self.calculate(checks)
