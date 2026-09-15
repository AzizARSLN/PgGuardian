"""Diagnostic finding model shared by the diagnose/report commands."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from pgguardian.models.finding import Severity


class DiagnosticFinding(BaseModel):
    """A single aggregated problem with a remediation recommendation."""

    model_config = ConfigDict(frozen=True)

    code: str = Field(description="Stable machine-readable code, e.g. LONG_RUNNING_QUERY.")
    severity: Severity
    title: str
    description: str
    value: str | None = None
    recommendation: str | None = None
