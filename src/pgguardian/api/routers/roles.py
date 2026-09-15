"""Role and grant management endpoints (list always; changes guarded)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from psycopg.sql import SQL, Composed, Identifier, Literal
from pydantic import BaseModel, ConfigDict, Field

from pgguardian.api.deps import get_api_settings, mapped_errors, resolve_client
from pgguardian.api.safety import (
    DryRunResult,
    MutationRequest,
    RiskLevel,
    audit,
    ensure_dangerous_allowed,
    ensure_writes_allowed,
    require_confirm,
    validate_identifier,
    validate_new_role_name,
)
from pgguardian.api.settings import ApiSettings
from pgguardian.database.connection import DbClient
from pgguardian.utils.formatting import to_int

router = APIRouter(prefix="/api/v1/roles", tags=["roles"])


class RoleInfo(BaseModel):
    """One role from pg_roles."""

    model_config = ConfigDict(frozen=True)

    name: str
    superuser: bool = False
    createdb: bool = False
    createrole: bool = False
    can_login: bool = False
    connection_limit: int = -1
    valid_until: str | None = None


class RoleCreate(MutationRequest):
    """Create a role (MAINTENANCE; superuser flag escalates to DANGEROUS)."""

    model_config = ConfigDict(frozen=True)

    name: str
    login: bool = False
    password: str | None = None
    superuser: bool = False
    createdb: bool = False
    createrole: bool = False
    connection_limit: int | None = Field(default=None, ge=-1)


class RoleAlter(MutationRequest):
    """Alter password / connection limit / validity (MAINTENANCE)."""

    model_config = ConfigDict(frozen=True)

    password: str | None = None
    connection_limit: int | None = Field(default=None, ge=-1)
    valid_until: date | None = None


class GrantChange(MutationRequest):
    """Grant or revoke a privilege (MAINTENANCE)."""

    model_config = ConfigDict(frozen=True)

    role: str
    privilege: str = Field(description="SELECT, INSERT, UPDATE, DELETE, CREATE, ...")
    object_type: str = Field(description="table, schema or database")
    schema_name: str | None = None
    object_name: str | None = None


class GrantMembershipRequest(MutationRequest):
    """Add/remove a member to/from a role (MAINTENANCE)."""

    model_config = ConfigDict(frozen=True)

    member: str = Field(description="Role to add as member")


_ALLOWED_PRIVILEGES = frozenset(
    {
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "CREATE",
        "CONNECT",
        "TEMPORARY",
        "USAGE",
        "EXECUTE",
        "ALL",
    }
)
_ALLOWED_OBJECT_TYPES = frozenset({"table", "schema", "database"})


@router.get("", response_model=list[RoleInfo])
def list_roles(client: DbClient = Depends(resolve_client)) -> list[RoleInfo]:
    """Roles from pg_roles (read-only; passwords never exposed)."""
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT rolname AS name, rolsuper AS superuser, rolcreatedb AS createdb,"
            " rolcreaterole AS createrole, rolcanlogin AS can_login,"
            " rolconnlimit AS connection_limit, rolvaliduntil AS valid_until"
            " FROM pg_roles ORDER BY 1"
        )
    return [
        RoleInfo(
            name=str(row.get("name")),
            superuser=bool(row.get("superuser")),
            createdb=bool(row.get("createdb")),
            createrole=bool(row.get("createrole")),
            can_login=bool(row.get("can_login")),
            connection_limit=to_int(row.get("connection_limit")),
            valid_until=str(row.get("valid_until")) if row.get("valid_until") else None,
        )
        for row in rows
    ]


def _role_options(body: RoleCreate) -> list:
    options: list = []
    options.append(SQL("LOGIN") if body.login else SQL("NOLOGIN"))
    if body.superuser:
        options.append(SQL("SUPERUSER"))
    if body.createdb:
        options.append(SQL("CREATEDB"))
    if body.createrole:
        options.append(SQL("CREATEROLE"))
    if body.connection_limit is not None:
        options.append(SQL("CONNECTION LIMIT {}").format(Literal(body.connection_limit)))
    if body.password:
        # Literal quoting is injection-safe; note in docs that server logs
        # with log_statement=all would record the literal (same as psql).
        options.append(SQL("PASSWORD {}").format(Literal(body.password)))
    return options


@router.post("", response_model=DryRunResult | RoleInfo)
def create_role(
    body: RoleCreate,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | RoleInfo:
    """Create a role (superuser flag escalates to DANGEROUS)."""
    if body.superuser:
        ensure_dangerous_allowed(settings, "role.create")
        risk = RiskLevel.DANGEROUS
    else:
        ensure_writes_allowed(settings, "role.create")
        risk = RiskLevel.MAINTENANCE
    name = validate_new_role_name(body.name)
    query = SQL("CREATE ROLE {} {}").format(Identifier(name), SQL(" ").join(_role_options(body)))
    if body.dry_run:
        return DryRunResult(action="role.create", risk=risk, sql=[query.as_string()], target=name)
    require_confirm(body, "role.create")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("role.create", name, risk, settings)
    return RoleInfo(name=name, can_login=body.login, superuser=body.superuser)


@router.patch("/{name}", response_model=DryRunResult | dict)
def alter_role(
    name: str,
    body: RoleAlter,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Alter password / connection limit / validity (MAINTENANCE)."""
    ensure_writes_allowed(settings, "role.alter")
    target = validate_identifier(name, what="role name")
    options: list = []
    if body.password:
        options.append(SQL("PASSWORD {}").format(Literal(body.password)))
    if body.connection_limit is not None:
        options.append(SQL("CONNECTION LIMIT {}").format(Literal(body.connection_limit)))
    if body.valid_until is not None:
        options.append(SQL("VALID UNTIL {}").format(Literal(body.valid_until.isoformat())))
    if not options:
        raise HTTPException(
            status_code=400,
            detail="Nothing to alter: provide password, connection_limit or valid_until.",
        )
    query = SQL("ALTER ROLE {} WITH {}").format(Identifier(target), SQL(" ").join(options))
    if body.dry_run:
        return DryRunResult(
            action="role.alter",
            risk=RiskLevel.MAINTENANCE,
            sql=["ALTER ROLE <name> WITH ... (secret redacted)"],
            target=target,
        )
    require_confirm(body, "role.alter")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("role.alter", target, RiskLevel.MAINTENANCE, settings)
    return {"altered": target}


@router.delete("/{name}", response_model=DryRunResult | dict)
def drop_role(
    name: str,
    body: MutationRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Drop a role (DANGEROUS: confirm_name; refuses pg_* and self)."""
    ensure_dangerous_allowed(settings, "role.drop")
    target = validate_identifier(name, what="role name")
    if target.lower().startswith("pg_"):
        raise HTTPException(status_code=400, detail=f"Refusing to drop system role '{target}'.")
    query = SQL("DROP ROLE {}").format(Identifier(target))
    if body.dry_run:
        return DryRunResult(
            action="role.drop",
            risk=RiskLevel.DANGEROUS,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "role.drop", target=target)
    with mapped_errors(settings):
        client.ping()
        current = client.fetch_one("SELECT current_user AS user")
        if current and str(current.get("user")) == target:
            raise HTTPException(status_code=409, detail="Refusing to drop your own role.")
        client.execute_raw(query)
    audit("role.drop", target, RiskLevel.DANGEROUS, settings)
    return {"dropped": target}


def _grant_sql(body: GrantChange, grant: bool) -> Composed:
    privilege = body.privilege.upper()
    if privilege not in _ALLOWED_PRIVILEGES:
        raise HTTPException(
            status_code=400, detail=f"Privilege '{body.privilege}' not in allowlist."
        )
    object_type = body.object_type.lower()
    if object_type not in _ALLOWED_OBJECT_TYPES:
        raise HTTPException(
            status_code=400, detail="object_type must be table, schema or database."
        )
    role = Identifier(validate_identifier(body.role, what="role name"))
    verb = SQL("GRANT") if grant else SQL("REVOKE")
    priv = SQL(privilege)
    if object_type == "table":
        if not body.object_name:
            raise HTTPException(status_code=400, detail="object_name is required for table grants.")
        table: object = Identifier(body.object_name)
        if body.schema_name:
            table = SQL("{}.{}").format(
                Identifier(validate_identifier(body.schema_name, what="schema name")),
                Identifier(validate_identifier(body.object_name, what="table name")),
            )
        return SQL("{} {} ON TABLE {} {} {}").format(
            verb, priv, table, SQL("TO") if grant else SQL("FROM"), role
        )
    if object_type == "schema":
        if not body.object_name:
            raise HTTPException(
                status_code=400, detail="object_name is required for schema grants."
            )
        return SQL("{} {} ON SCHEMA {} {} {}").format(
            verb,
            priv,
            Identifier(validate_identifier(body.object_name, what="schema name")),
            SQL("TO") if grant else SQL("FROM"),
            role,
        )
    if not body.object_name:
        raise HTTPException(status_code=400, detail="object_name is required for database grants.")
    return SQL("{} {} ON DATABASE {} {} {}").format(
        verb,
        priv,
        Identifier(validate_identifier(body.object_name, what="database name")),
        SQL("TO") if grant else SQL("FROM"),
        role,
    )


@router.post("/grants", response_model=DryRunResult | dict)
def grant_privilege(
    body: GrantChange,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Grant a privilege (MAINTENANCE)."""
    ensure_writes_allowed(settings, "grant.create")
    query = _grant_sql(body, grant=True)
    if body.dry_run:
        return DryRunResult(
            action="grant.create", risk=RiskLevel.MAINTENANCE, sql=[query.as_string()]
        )
    require_confirm(body, "grant.create")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("grant.create", body.role, RiskLevel.MAINTENANCE, settings)
    return {"granted": body.privilege, "role": body.role}


@router.post("/revoke", response_model=DryRunResult | dict)
def revoke_privilege(
    body: GrantChange,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Revoke a privilege (MAINTENANCE)."""
    ensure_writes_allowed(settings, "grant.revoke")
    query = _grant_sql(body, grant=False)
    if body.dry_run:
        return DryRunResult(
            action="grant.revoke", risk=RiskLevel.MAINTENANCE, sql=[query.as_string()]
        )
    require_confirm(body, "grant.revoke")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("grant.revoke", body.role, RiskLevel.MAINTENANCE, settings)
    return {"revoked": body.privilege, "role": body.role}


class RoleMembership(BaseModel):
    """One membership link: role is member of parent role."""

    model_config = ConfigDict(frozen=True)

    role: str
    member: str
    admin_option: bool = False


@router.get("/{name}/members", response_model=list[RoleMembership])
def list_role_members(
    name: str, client: DbClient = Depends(resolve_client)
) -> list[RoleMembership]:
    """Members of a role (read-only)."""
    role_name = validate_identifier(name, what="role name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT r.rolname AS role, m.rolname AS member, am.admin_option"
            " FROM pg_auth_members am"
            " JOIN pg_roles r ON r.oid = am.roleid"
            " JOIN pg_roles m ON m.oid = am.member"
            " WHERE r.rolname = %s ORDER BY 2",
            (role_name,),
        )
    return [
        RoleMembership(
            role=str(row.get("role")),
            member=str(row.get("member")),
            admin_option=bool(row.get("admin_option")),
        )
        for row in rows
    ]


@router.get("/{name}/memberships", response_model=list[RoleMembership])
def list_role_memberships(
    name: str, client: DbClient = Depends(resolve_client)
) -> list[RoleMembership]:
    """Roles that a given role is member of (read-only)."""
    role_name = validate_identifier(name, what="role name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT r.rolname AS role, m.rolname AS member, am.admin_option"
            " FROM pg_auth_members am"
            " JOIN pg_roles r ON r.oid = am.roleid"
            " JOIN pg_roles m ON m.oid = am.member"
            " WHERE m.rolname = %s ORDER BY 1",
            (role_name,),
        )
    return [
        RoleMembership(
            role=str(row.get("role")),
            member=str(row.get("member")),
            admin_option=bool(row.get("admin_option")),
        )
        for row in rows
    ]


@router.get("/memberships", response_model=list[RoleMembership])
def list_all_memberships(client: DbClient = Depends(resolve_client)) -> list[RoleMembership]:
    """All role memberships (read-only, top 500)."""
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT r.rolname AS role, m.rolname AS member, am.admin_option"
            " FROM pg_auth_members am"
            " JOIN pg_roles r ON r.oid = am.roleid"
            " JOIN pg_roles m ON m.oid = am.member"
            " ORDER BY 1, 2 LIMIT 500"
        )
    return [
        RoleMembership(
            role=str(row.get("role")),
            member=str(row.get("member")),
            admin_option=bool(row.get("admin_option")),
        )
        for row in rows
    ]


@router.get("/{name}/grants", response_model=list[dict])
def list_role_grants(name: str, client: DbClient = Depends(resolve_client)) -> list[dict]:
    """All grants for a role across tables/schemas/databases (read-only)."""
    role_name = validate_identifier(name, what="role name")
    with mapped_errors(client.settings):
        client.ping()
        rows = client.fetch_all(
            "SELECT grantee AS role, table_schema AS schema_name, table_name,"
            " privilege_type AS privilege, 'table' AS object_type"
            " FROM information_schema.role_table_grants WHERE grantee = %s"
            " UNION ALL"
            " SELECT grantee, object_schema, object_name, privilege_type, object_type"
            " FROM information_schema.role_usage_grants WHERE grantee = %s"
            " UNION ALL"
            " SELECT grantee, NULL, object_name, privilege_type, object_type"
            " FROM information_schema.role_routine_grants WHERE grantee = %s"
            " ORDER BY 5, 2, 3 LIMIT 500",
            (role_name, role_name, role_name),
        )
    return [dict(row) for row in rows]


@router.get("/grants/table", response_model=list[dict])
def list_table_grants(
    role: str | None = None, client: DbClient = Depends(resolve_client)
) -> list[dict]:
    """Table grants from information_schema (read-only)."""
    with mapped_errors(client.settings):
        client.ping()
        if role:
            rows = client.fetch_all(
                "SELECT grantee AS role, table_schema AS schema_name, table_name,"
                " privilege_type AS privilege FROM information_schema.role_table_grants"
                " WHERE grantee = %s ORDER BY 2, 3, 4",
                (validate_identifier(role, what="role name"),),
            )
        else:
            rows = client.fetch_all(
                "SELECT grantee AS role, table_schema AS schema_name, table_name,"
                " privilege_type AS privilege FROM information_schema.role_table_grants"
                " ORDER BY 1, 2, 3, 4 LIMIT 500"
            )
    return [dict(row) for row in rows]


@router.post("/{name}/grant-membership", response_model=DryRunResult | dict)
def grant_membership(
    name: str,
    body: GrantMembershipRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Add a member to a role: GRANT role TO member (MAINTENANCE)."""
    ensure_writes_allowed(settings, "role.grant_membership")
    target = validate_identifier(name, what="role name")
    member = validate_identifier(body.member, what="member name")
    query = SQL("GRANT {} TO {}").format(Identifier(target), Identifier(member))
    if body.dry_run:
        return DryRunResult(
            action="role.grant_membership",
            risk=RiskLevel.MAINTENANCE,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "role.grant_membership")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("role.grant_membership", target, RiskLevel.MAINTENANCE, settings)
    return {"granted": target, "to": member}


@router.post("/{name}/revoke-membership", response_model=DryRunResult | dict)
def revoke_membership(
    name: str,
    body: GrantMembershipRequest,
    client: DbClient = Depends(resolve_client),
    settings: ApiSettings = Depends(get_api_settings),
) -> DryRunResult | dict:
    """Remove a member from a role: REVOKE role FROM member (MAINTENANCE)."""
    ensure_writes_allowed(settings, "role.revoke_membership")
    target = validate_identifier(name, what="role name")
    member = validate_identifier(body.member, what="member name")
    query = SQL("REVOKE {} FROM {}").format(Identifier(target), Identifier(member))
    if body.dry_run:
        return DryRunResult(
            action="role.revoke_membership",
            risk=RiskLevel.MAINTENANCE,
            sql=[query.as_string()],
            target=target,
        )
    require_confirm(body, "role.revoke_membership")
    with mapped_errors(settings):
        client.ping()
        client.execute_raw(query)
    audit("role.revoke_membership", target, RiskLevel.MAINTENANCE, settings)
    return {"revoked": target, "from": member}
