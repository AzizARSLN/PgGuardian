"""Health models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from pgguardian.models.finding import Severity


class HealthCheck(BaseModel):
    """One named health check with an evaluated status."""

    model_config = ConfigDict(frozen=True)

    name: str
    status: Severity
    value: str | None = None
    threshold: str | None = None
    severity: Severity = Severity.OK
    description: str = ""


class HealthReport(BaseModel):
    """Aggregated health result for an instance/database."""

    model_config = ConfigDict(frozen=True)

    server_version: str = "unknown"
    database: str = "unknown"
    uptime_seconds: int | None = None
    checks: list[HealthCheck] = Field(default_factory=list)
    score: int = 0
    status: str = "UNKNOWN"
    generated_at: datetime = Field(default_factory=datetime.utcnow)

    def worst_severity(self) -> Severity:
        from pgguardian.models.finding import worst_severity as _worst

        return _worst([check.severity for check in self.checks])
