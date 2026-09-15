"""Server configuration endpoints: inspect always, change guarded."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg.sql import SQL, Literal
from pydantic import BaseModel, ConfigDict

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    require_confirm,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient

router = APIRouter(prefix="/api/v1/config", tags=["config"])


class SettingInfo(BaseModel):
    """One pg_settings row."""

    model_config = ConfigDict(frozen=True)

    name: str
    setting: str
    unit: str | None = None
    category: str | None = None
    context: str | None = None
    source: str | None = None
    pending_restart: bool = False


class SettingChange(MutationRequest):
    """ALTER SYSTEM SET (DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    value: str


_SETTINGS_SQL = (
    "SELECT name, setting, unit, category, context, source, pending_restart FROM pg_settings"
)


def _map_setting(row: dict) -> SettingInfo:
    return SettingInfo(
        name=str(row.get("name")),
        setting=str(row.get("setting")),
        unit=str(row.get("unit")) if row.get("unit") else None,
        category=str(row.get("category")) if row.get("category") else None,
        context=str(row.get("context")) if row.get("context") else None,
        source=str(row.get("source")) if row.get("source") else None,
        pending_restart=bool(row.get("pending_restart", False)),
    )


@router.get("", response_model=list[SettingInfo])
def list_settings(
    pattern: str | None = None, client: DbClient = Depends(resolve_client)
) -> list[SettingInfo]:
    """pg_settings, optionally filtered (read-only)."""
    with mapped_errors(client.settings):
        client.ping()
        if pattern:
            rows = client.fetch_all(
                _SETTINGS_SQL + " WHERE name ILIKE %s ORDER BY 1", (f"%{pattern}%",)
            )
        else:
            rows = client.fetch_all(_SETTINGS_SQL + " ORDER BY 1")
    return [_map_setting(dict(row)) for row in rows]


@router.get("/{name}", response_model=SettingInfo)
def get_setting(name: str, client: DbClient = Depends(resolve_client)) -> SettingInfo:
    """One setting by exact name (read-only)."""
    with mapped_errors(client.settings):
        client.ping()
        row = client.fetch_one(_SETTINGS_SQL + " WHERE name = %s", (name,))
    if not row:
        raise HTTPException(status_code=404, detail=f"Setting '{name}' not found.")
    return _map_setting(dict(row))


@router.patch("/{name}", response_model=DryRunResult | SettingInfo)
def change_setting(
    name: str,
    body: SettingChange,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | SettingInfo:
    """ALTER SYSTEM SET + report pending_restart (DANGEROUS)."""
    ensure_dangerous_allowed(settings, "config.change")
    query = SQL("ALTER SYSTEM SET {} = {}").format(SQL(name), Literal(body.value))
    if body.dry_run:
        return DryRunResult(
            action="config.change",
            risk=RiskLevel.DANGEROUS,
            sql=[f"ALTER SYSTEM SET {name} = '<value>'"],
            target=name,
        )
    require_confirm(body, "config.change")
    with mapped_errors(settings):
        client.ping()
        current = client.fetch_one(_SETTINGS_SQL + " WHERE name = %s", (name,))
        if not current:
            raise HTTPException(status_code=404, detail=f"Setting '{name}' not found.")
        client.execute_raw(query)
        updated = client.fetch_one(_SETTINGS_SQL + " WHERE name = %s", (name,))
    audit("config.change", name, RiskLevel.DANGEROUS, settings)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Setting '{name}' not found.")
    return _map_setting(dict(updated))


@router.post("/reload", response_model=DryRunResult | dict)
def reload_config(
    body: MutationRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """pg_reload_conf() — apply sighup settings (DANGEROUS)."""
    ensure_dangerous_allowed(settings, "config.reload")
    if body.dry_run:
        return DryRunResult(
            action="config.reload", risk=RiskLevel.DANGEROUS, sql=["SELECT pg_reload_conf()"]
        )
    require_confirm(body, "config.reload")
    with mapped_errors(settings):
        client.ping()
        row = client.fetch_one("SELECT pg_reload_conf() AS reloaded")
    reloaded = bool((row or {}).get("reloaded", False))
    audit("config.reload", None, RiskLevel.DANGEROUS, settings)
    return {"reloaded": reloaded}
