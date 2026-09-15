"""Unit tests for HealthScoreCalculator and threshold evaluation."""

from __future__ import annotations

from pgguardian.diagnostics.health import evaluate_threshold
from pgguardian.models.finding import Severity
from pgguardian.scoring.health_score import HealthScoreCalculator


def test_all_healthy_scores_100() -> None:
    calculator = HealthScoreCalculator()
    score, status = calculator.calculate_from_severities([Severity.OK, Severity.OK, Severity.INFO])
    assert score == 100
    assert status == "HEALTHY"


def test_empty_checks_unknown() -> None:
    calculator = HealthScoreCalculator()
    score, status = calculator.calculate_from_severities([])
    assert score == 0
    assert status == "UNKNOWN"


def test_single_warning_penalty() -> None:
    calculator = HealthScoreCalculator()
    score, status = calculator.calculate_from_severities([Severity.OK, Severity.WARNING])
    assert score == 90
    assert status == "HEALTHY"


def test_multiple_warnings_degraded() -> None:
    calculator = HealthScoreCalculator()
    score, status = calculator.calculate_from_severities(
        [Severity.WARNING, Severity.WARNING, Severity.WARNING]
    )
    assert score == 70
    assert status == "DEGRADED"


def test_critical_always_below_degraded() -> None:
    calculator = HealthScoreCalculator()
    score, status = calculator.calculate_from_severities([Severity.OK, Severity.CRITICAL])
    assert status == "CRITICAL"
    assert score < 60


def test_many_criticals_clamp_at_zero() -> None:
    calculator = HealthScoreCalculator()
    score, status = calculator.calculate_from_severities([Severity.CRITICAL] * 10)
    assert score == 0
    assert status == "CRITICAL"


def test_unknown_penalty() -> None:
    calculator = HealthScoreCalculator()
    score, _ = calculator.calculate_from_severities([Severity.OK, Severity.UNKNOWN])
    assert score == 95


def test_evaluate_threshold_higher_is_worse() -> None:
    assert evaluate_threshold(50, warning=80, critical=95) == Severity.OK
    assert evaluate_threshold(85, warning=80, critical=95) == Severity.WARNING
    assert evaluate_threshold(97, warning=80, critical=95) == Severity.CRITICAL


def test_evaluate_threshold_lower_is_worse() -> None:
    assert (
        evaluate_threshold(99.0, warning=95.0, critical=90.0, higher_is_worse=False) == Severity.OK
    )
    assert (
        evaluate_threshold(93.0, warning=95.0, critical=90.0, higher_is_worse=False)
        == Severity.WARNING
    )
    assert (
        evaluate_threshold(80.0, warning=95.0, critical=90.0, higher_is_worse=False)
        == Severity.CRITICAL
    )


def test_evaluate_threshold_none_is_unknown() -> None:
    assert evaluate_threshold(None, warning=80, critical=95) == Severity.UNKNOWN
    assert evaluate_threshold("not-a-number", warning=80, critical=95) == Severity.UNKNOWN  # type: ignore[arg-type]
