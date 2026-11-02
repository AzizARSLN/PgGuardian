"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  endpoints,
  type RoleInfo,
  type RoleAlter,
  type RoleMembership,
  type GrantChange,
  type GrantMembershipRequest,
  type DryRunResult,
  type GenericDict,
} from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Plus,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { IfWriter } from "@/components/role-guard";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useT } from "@/lib/i18n";
import { useForm } from "react-hook-form";

type GrantMode = "grant" | "revoke";

interface AttrForm {
  password: string;
  /** Null keeps the current limit; sending a default would silently overwrite it. */
  connection_limit: number | null;
  valid_until: string;
}

const KEEP_LIMIT = "keep";
const CONNECTION_LIMITS = [1, 5, 10, 20, 50, 100];
// The only object types POST /roles/grants and /roles/revoke accept.
const CHANGEABLE_OBJECT_TYPES = new Set(["table", "schema", "database"]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function InlineError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center gap-3 rounded-md border border-destructive/30 px-3 py-3 text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {t("common.loadFailed")}
      <Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        {t("common.retry")}
      </Button>
    </div>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  const t = useT();
  return (
    <div className="space-y-1.5" aria-label={t("common.loading")}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

function EmptyNote({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function RoleDetailPage() {
  const t = useT();
  const params = useParams<{ role: string }>();
  const roleName = safeDecode(params.role);
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [tab, setTab] = useState("attributes");
  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState("");

  const {
    register: attrRegister,
    handleSubmit: attrHandleSubmit,
    watch: attrWatch,
    setValue: attrSetValue,
    reset: attrReset,
    formState: { isSubmitting: attrSubmitting },
  } = useForm<AttrForm>({
    defaultValues: { password: "", connection_limit: null, valid_until: "" },
  });

  const rolesQuery = useQuery({
    queryKey: qk.roles.all(),
    queryFn: () => endpoints.listRoles(),
  });
  const rolesAll = rolesQuery.data;

  const role: RoleInfo | undefined = useMemo(
    () => (rolesAll ?? []).find((r) => r.name === roleName),
    [rolesAll, roleName]
  );

  const grantsQuery = useQuery({
    queryKey: qk.roles.grants(roleName),
    queryFn: () => endpoints.listRoleGrants(roleName),
    enabled: !!roleName,
  });
  const roleGrants = grantsQuery.data ?? [];

  const membershipsQuery = useQuery({
    queryKey: qk.roles.memberships(roleName),
    queryFn: () => endpoints.listRoleMemberships(roleName),
    enabled: !!roleName,
  });
  const memberships = membershipsQuery.data ?? [];

  const membersQuery = useQuery({
    queryKey: qk.roles.members(roleName),
    queryFn: () => endpoints.listRoleMembers(roleName),
    enabled: !!roleName,
  });
  const members = membersQuery.data ?? [];

  const isFetching =
    rolesQuery.isFetching ||
    grantsQuery.isFetching ||
    membershipsQuery.isFetching ||
    membersQuery.isFetching;

  const refreshAll = () => {
    rolesQuery.refetch();
    grantsQuery.refetch();
    membershipsQuery.refetch();
    membersQuery.refetch();
  };

  const alterMutation = useMutation({
    mutationFn: (body: RoleAlter) => endpoints.alterRole(roleName, body),
    onSuccess: () => {
      toast.success(t("roleDetail.toast.altered"));
      queryClient.invalidateQueries({ queryKey: qk.roles.all() });
      attrReset();
    },
  });

  // The mode travels with the call: reading it from state here would use the
  // value from the previous render, so a revoke could run as a grant.
  const grantMutation = useMutation({
    mutationFn: ({ mode, body }: { mode: GrantMode; body: GrantChange }) =>
      mode === "grant" ? endpoints.grantPrivilege(body) : endpoints.revokePrivilege(body),
    onSuccess: (_, { mode }) => {
      toast.success(mode === "grant" ? t("roleDetail.toast.granted") : t("roleDetail.toast.revoked"));
      queryClient.invalidateQueries({ queryKey: qk.roles.grants(roleName) });
    },
  });

  const invalidateMemberships = () => {
    queryClient.invalidateQueries({ queryKey: qk.roles.memberships(roleName) });
    queryClient.invalidateQueries({ queryKey: qk.roles.members(roleName) });
  };

  const grantMembershipMutation = useMutation({
    mutationFn: (body: GrantMembershipRequest) => endpoints.grantMembership(roleName, body),
    onSuccess: () => {
      toast.success(t("roleDetail.toast.memberAdded"));
      invalidateMemberships();
      setMembershipDialogOpen(false);
      setNewMember("");
    },
  });

  const revokeMembershipMutation = useMutation({
    mutationFn: (body: GrantMembershipRequest) => endpoints.revokeMembership(roleName, body),
    onSuccess: () => {
      toast.success(t("roleDetail.toast.memberRemoved"));
      invalidateMemberships();
    },
  });

  const onSubmitAttr = attrHandleSubmit(async (data) => {
    const payload: RoleAlter = {};
    if (data.password.trim()) payload.password = data.password;
    if (data.connection_limit !== null) payload.connection_limit = data.connection_limit;
    if (data.valid_until.trim()) payload.valid_until = data.valid_until;

    if (Object.keys(payload).length === 0) {
      toast.error(t("roleDetail.toast.nothingToChange"));
      return;
    }

    // Failures reach the user through the API client's toast with the backend message.
    try {
      const dryRun = await endpoints.alterRole(roleName, { ...payload, dry_run: true });
      if (dryRun && "sql" in dryRun && (dryRun as DryRunResult).sql) {
        const plan = dryRun as DryRunResult;
        const ok = await confirm({
          title: t("roleDetail.confirmAlter.title", { name: roleName }),
          description: t("roleDetail.confirmAlter.description"),
          risk_level: (plan.risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS",
          confirm_label: t("roleDetail.confirmAlter.confirm"),
          cancel_label: t("common.cancel"),
          sql_preview: plan.sql,
        });
        if (!ok) return;
      }
      await alterMutation.mutateAsync({ ...payload, confirm: true });
    } catch {
      // Already reported.
    }
  });

  const grantObject = (g: GenericDict) => ({
    privilege: String(g.privilege_type ?? g.privilege ?? ""),
    objectType: String(g.object_type ?? "table"),
    schemaName: g.schema_name ? String(g.schema_name) : null,
    // /roles/{name}/grants names this column table_name, whatever the object is.
    objectName: g.object_name
      ? String(g.object_name)
      : g.table_name
        ? String(g.table_name)
        : null,
  });

  const handleGrantRevoke = async (grant: GenericDict, mode: GrantMode) => {
    const { privilege, objectType, schemaName, objectName } = grantObject(grant);
    const target = `${schemaName ? `${schemaName}.` : ""}${objectName ?? ""}`;
    const sqlType = objectType.toUpperCase();
    const vars = { privilege, type: sqlType, target, role: roleName };

    const ok = await confirm({
      title:
        mode === "grant"
          ? t("roleDetail.confirmGrant.title", vars)
          : t("roleDetail.confirmRevoke.title", vars),
      description:
        mode === "grant"
          ? t("roleDetail.confirmGrant.description", vars)
          : t("roleDetail.confirmRevoke.description", vars),
      risk_level: "MAINTENANCE",
      confirm_label: mode === "grant" ? t("roleDetail.grants.regrant") : t("roleDetail.grants.revoke"),
      cancel_label: t("common.cancel"),
      sql_preview: [
        mode === "grant"
          ? `GRANT ${privilege} ON ${sqlType} ${target} TO "${roleName}";`
          : `REVOKE ${privilege} ON ${sqlType} ${target} FROM "${roleName}";`,
      ],
    });
    if (!ok) return;

    grantMutation.mutate({
      mode,
      body: {
        role: roleName,
        privilege,
        object_type: objectType,
        schema_name: schemaName,
        object_name: objectName,
        confirm: true,
      },
    });
  };

  const onSubmitMembership = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember) {
      toast.error(t("roleDetail.members.memberRequired"));
      return;
    }
    const ok = await confirm({
      title: t("roleDetail.confirmAddMember.title", { member: newMember, role: roleName }),
      description: t("roleDetail.confirmAddMember.description", { member: newMember, role: roleName }),
      risk_level: "MAINTENANCE",
      confirm_label: t("roleDetail.members.add"),
      cancel_label: t("common.cancel"),
      sql_preview: [`GRANT "${roleName}" TO "${newMember}";`],
    });
    if (ok) grantMembershipMutation.mutate({ member: newMember, confirm: true });
  };

  const handleRevokeMembership = async (membership: RoleMembership) => {
    const vars = { member: membership.member, role: roleName };
    const ok = await confirm({
      title: t("roleDetail.confirmRemoveMember.title", vars),
      description: t("roleDetail.confirmRemoveMember.description", vars),
      risk_level: "MAINTENANCE",
      confirm_label: t("roleDetail.members.remove"),
      cancel_label: t("common.cancel"),
      confirm_name_required: true,
      confirm_name_value: membership.member,
      confirm_name_placeholder: t("roleDetail.confirmRemoveMember.placeholder", {
        member: membership.member,
      }),
      sql_preview: [`REVOKE "${roleName}" FROM "${membership.member}";`],
    });
    if (ok) revokeMembershipMutation.mutate({ member: membership.member, confirm: true });
  };

  const candidates = (rolesAll ?? []).filter(
    (r) => r.name !== roleName && !members.some((m) => m.member === r.name)
  );

  const yesNo = (value: boolean) => (value ? t("roleDetail.yes") : t("roleDetail.no"));
  const roleMissing = !rolesQuery.isLoading && !rolesQuery.isError && !role;

  const attributeTiles = [
    { label: "SUPERUSER", val: role?.superuser, risk: "DANGEROUS" },
    { label: "CREATEDB", val: role?.createdb, risk: "MAINTENANCE" },
    { label: "CREATEROLE", val: role?.createrole, risk: "MAINTENANCE" },
    { label: "LOGIN", val: role?.can_login, risk: "OK" },
  ] as const;

  return (
    <div className="space-y-3">
      <ConfirmDialog />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/roles">
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("roleDetail.back")}
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 font-mono text-lg font-semibold text-foreground">
              <Shield className="h-4 w-4 text-muted-foreground" />
              {roleName}
              {role?.superuser && (
                <RiskBadge riskLevel="DANGEROUS" size="sm" showIcon={false}>
                  SUPERUSER
                </RiskBadge>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">{t("roleDetail.subtitle")}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          {t("roleDetail.refreshAll")}
        </Button>
      </div>

      {rolesQuery.isError ? (
        <InlineError onRetry={() => rolesQuery.refetch()} />
      ) : roleMissing ? (
        <EmptyNote
          title={t("roleDetail.notFound.title", { name: roleName })}
          hint={t("roleDetail.notFound.hint")}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {attributeTiles.map((m) => (
            <div key={m.label} className="rounded-md border border-border bg-card px-3 py-2">
              <p className="font-mono text-xs text-muted-foreground">{m.label}</p>
              {rolesQuery.isLoading ? (
                <Skeleton className="mt-1 h-5 w-12" />
              ) : (
                <div className="mt-1">
                  <RiskBadge riskLevel={m.val ? m.risk : "INFO"} size="sm" showIcon={false}>
                    {m.val ? t("roleDetail.on") : t("roleDetail.off")}
                  </RiskBadge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-card px-3 py-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="attributes">{t("roleDetail.tabs.attributes")}</TabsTrigger>
            <TabsTrigger value="grants">
              {t("roleDetail.tabs.grants", { count: roleGrants.length })}
            </TabsTrigger>
            <TabsTrigger value="memberships">
              {t("roleDetail.tabs.memberships", { count: members.length + memberships.length })}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="attributes" className="mt-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">{t("roleDetail.attributes.current")}</h3>
                {rolesQuery.isLoading ? (
                  <RowsSkeleton rows={7} />
                ) : !role ? (
                  <p className="text-xs text-muted-foreground">{t("common.noData")}</p>
                ) : (
                  <dl className="divide-y divide-border rounded-md border border-border text-xs">
                    {[
                      [t("roleDetail.attributes.name"), role.name],
                      [
                        t("roleDetail.attributes.connectionLimit"),
                        role.connection_limit === -1 || role.connection_limit === null
                          ? t("roleDetail.attributes.unlimited")
                          : String(role.connection_limit),
                      ],
                      [
                        t("roleDetail.attributes.validUntil"),
                        role.valid_until
                          ? role.valid_until.split(/[T ]/)[0]
                          : t("roleDetail.attributes.noExpiry"),
                      ],
                      ["SUPERUSER", yesNo(role.superuser)],
                      ["CREATEDB", yesNo(role.createdb)],
                      ["CREATEROLE", yesNo(role.createrole)],
                      ["LOGIN", yesNo(role.can_login)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-mono">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <IfWriter>
                <div>
                  <h3 className="mb-2 text-sm font-medium">{t("roleDetail.attributes.editable")}</h3>
                  <form onSubmit={onSubmitAttr} className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="alter-password">{t("roleDetail.attributes.newPassword")}</Label>
                      <Input
                        id="alter-password"
                        type="password"
                        autoComplete="new-password"
                        {...attrRegister("password")}
                        placeholder={t("roleDetail.attributes.newPasswordPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("roleDetail.attributes.connectionLimit")}</Label>
                      <Select
                        value={String(attrWatch("connection_limit") ?? KEEP_LIMIT)}
                        onValueChange={(v) =>
                          attrSetValue("connection_limit", v === KEEP_LIMIT ? null : Number(v))
                        }
                      >
                        <SelectTrigger aria-label={t("roleDetail.attributes.connectionLimit")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={KEEP_LIMIT}>{t("roleDetail.attributes.keep")}</SelectItem>
                          <SelectItem value="-1">{t("roleDetail.attributes.unlimited")}</SelectItem>
                          {CONNECTION_LIMITS.map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {t("roleDetail.attributes.connections", { count: n })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="alter-valid-until">{t("roleDetail.attributes.validUntil")}</Label>
                      <Input
                        id="alter-valid-until"
                        type="date"
                        className="font-mono"
                        {...attrRegister("valid_until")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("roleDetail.attributes.validUntilHelp")}
                      </p>
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={attrSubmitting || alterMutation.isPending}
                    >
                      {attrSubmitting || alterMutation.isPending ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      {attrSubmitting || alterMutation.isPending
                        ? t("roleDetail.attributes.saving")
                        : t("roleDetail.attributes.save")}
                    </Button>
                  </form>
                </div>
              </IfWriter>
            </div>
          </TabsContent>

          <TabsContent value="grants" className="mt-3">
            {grantsQuery.isLoading ? (
              <RowsSkeleton rows={8} />
            ) : grantsQuery.isError ? (
              <InlineError onRetry={() => grantsQuery.refetch()} />
            ) : roleGrants.length === 0 ? (
              <EmptyNote title={t("roleDetail.grants.emptyTitle")} hint={t("roleDetail.grants.emptyHint")} />
            ) : (
              <div className="max-h-[520px] overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("roleDetail.grants.privilege")}</TableHead>
                      <TableHead>{t("roleDetail.grants.type")}</TableHead>
                      <TableHead>{t("roleDetail.grants.object")}</TableHead>
                      <TableHead className="text-right">{t("roleDetail.grants.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roleGrants.map((g, idx) => {
                      const { privilege, objectType, schemaName, objectName } = grantObject(g);
                      const changeable =
                        CHANGEABLE_OBJECT_TYPES.has(objectType.toLowerCase()) && Boolean(objectName);
                      return (
                        <TableRow key={`grant-${idx}-${privilege}-${objectName}`}>
                          <TableCell className="font-mono font-medium">{privilege}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {objectType.toUpperCase()}
                          </TableCell>
                          <TableCell className="font-mono">
                            {schemaName && <span className="text-muted-foreground">{schemaName}.</span>}
                            {objectName ?? "-"}
                          </TableCell>
                          <TableCell>
                            <IfWriter>
                              {changeable && (
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2"
                                    disabled={grantMutation.isPending}
                                    onClick={() => handleGrantRevoke(g, "grant")}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    {t("roleDetail.grants.regrant")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    disabled={grantMutation.isPending}
                                    onClick={() => handleGrantRevoke(g, "revoke")}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {t("roleDetail.grants.revoke")}
                                  </Button>
                                </div>
                              )}
                            </IfWriter>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="memberships" className="mt-3">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {t("roleDetail.members.title", { count: members.length })}
                  </h3>
                  <IfWriter>
                    <Dialog
                      open={membershipDialogOpen}
                      onOpenChange={(open) => {
                        setMembershipDialogOpen(open);
                        if (!open) setNewMember("");
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button size="sm" className="h-7 px-2">
                          <UserPlus className="h-3.5 w-3.5" />
                          {t("roleDetail.members.addNew")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                          <DialogTitle>
                            {t("roleDetail.members.dialogTitle", { role: roleName })}
                          </DialogTitle>
                          <DialogDescription>
                            {t("roleDetail.members.dialogDescription", { role: roleName })}
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={onSubmitMembership} className="space-y-3">
                          <div className="space-y-1">
                            <Label>{t("roleDetail.members.memberLabel")}</Label>
                            <Select value={newMember} onValueChange={setNewMember}>
                              <SelectTrigger aria-label={t("roleDetail.members.memberLabel")}>
                                <SelectValue placeholder={t("roleDetail.members.memberPlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                {candidates.length === 0 ? (
                                  <SelectItem value="none" disabled>
                                    {t("roleDetail.members.noCandidates")}
                                  </SelectItem>
                                ) : (
                                  candidates.map((c) => (
                                    <SelectItem key={c.name} value={c.name} className="font-mono">
                                      {c.name}
                                      {c.superuser ? " (SUPERUSER)" : ""}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          <DialogFooter>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setMembershipDialogOpen(false);
                                setNewMember("");
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                            <Button
                              type="submit"
                              size="sm"
                              disabled={grantMembershipMutation.isPending || !newMember}
                            >
                              {grantMembershipMutation.isPending ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UserPlus className="h-3.5 w-3.5" />
                              )}
                              {grantMembershipMutation.isPending
                                ? t("roleDetail.members.adding")
                                : t("roleDetail.members.add")}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </IfWriter>
                </div>

                {membersQuery.isLoading ? (
                  <RowsSkeleton rows={4} />
                ) : membersQuery.isError ? (
                  <InlineError onRetry={() => membersQuery.refetch()} />
                ) : members.length === 0 ? (
                  <EmptyNote
                    title={t("roleDetail.members.emptyTitle")}
                    hint={t("roleDetail.members.emptyHint")}
                  />
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border text-xs">
                    {members.map((m) => (
                      <li key={m.member} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <Link
                            href={`/roles/${encodeURIComponent(m.member)}`}
                            className="truncate font-mono font-medium hover:text-info"
                          >
                            {m.member}
                          </Link>
                          {m.admin_option && (
                            <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                              ADMIN OPTION
                            </RiskBadge>
                          )}
                        </span>
                        <IfWriter>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleRevokeMembership(m)}
                            disabled={revokeMembershipMutation.isPending}
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            {t("roleDetail.members.remove")}
                          </Button>
                        </IfWriter>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 flex h-7 items-center text-sm font-medium">
                  {t("roleDetail.memberOf.title", { count: memberships.length })}
                </h3>
                {membershipsQuery.isLoading ? (
                  <RowsSkeleton rows={4} />
                ) : membershipsQuery.isError ? (
                  <InlineError onRetry={() => membershipsQuery.refetch()} />
                ) : memberships.length === 0 ? (
                  <EmptyNote
                    title={t("roleDetail.memberOf.emptyTitle")}
                    hint={t("roleDetail.memberOf.emptyHint", { role: roleName })}
                  />
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border text-xs">
                    {memberships.map((m) => (
                      <li key={m.role}>
                        <Link
                          href={`/roles/${encodeURIComponent(m.role)}`}
                          className="group flex items-center justify-between gap-2 px-3 py-1.5 transition-colors hover:bg-muted"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-mono font-medium">{m.role}</span>
                            {m.admin_option && (
                              <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                                ADMIN OPTION
                              </RiskBadge>
                            )}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
