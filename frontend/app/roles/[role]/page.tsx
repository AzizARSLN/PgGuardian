"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  ArrowLeft,
  Shield,
  CheckCircle2,
  XCircle,
  RefreshCw,
  UserPlus,
  UserMinus,
  Save,
  LockKeyhole,
  KeyRound,
  Plus,
  Trash2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/lib/hooks/useConfirm";
import { useForm } from "react-hook-form";

interface MembershipAddForm {
  member: string;
  admin_option: boolean;
}

export default function RoleDetailPage() {
  const params = useParams<{ role: string }>();
  const router = useRouter();
  const roleName = decodeURIComponent(params.role);
  const queryClient = useQueryClient();
  const { confirm, Component: ConfirmDialog } = useConfirm();

  const [tab, setTab] = useState("attributes");
  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [addOrRevokeMode, setAddOrRevokeMode] = useState<"grant" | "revoke">("grant");

  const {
    register: attrRegister,
    handleSubmit: attrHandleSubmit,
    watch: attrWatch,
    setValue: attrSetValue,
    reset: attrReset,
    formState: { isSubmitting: attrSubmitting, errors: attrErrors },
  } = useForm<RoleAlter>({
    defaultValues: {
      password: "",
      connection_limit: -1,
      valid_until: "",
    },
  });

  const {
    register: memRegister,
    handleSubmit: memHandleSubmit,
    watch: memWatch,
    setValue: memSetValue,
    reset: memReset,
  } = useForm<MembershipAddForm>({
    defaultValues: {
      member: "",
      admin_option: false,
    },
  });

  const { data: rolesAll, isLoading: rolesAllLoading } = useQuery({
    queryKey: qk.roles.all(),
    queryFn: () => endpoints.listRoles(),
  });

  const role: RoleInfo | undefined = useMemo(
    () => (rolesAll ?? []).find((r) => r.name === roleName),
    [rolesAll, roleName]
  );

  const { data: roleGrants, isLoading: grantsLoading, refetch: refetchGrants } = useQuery({
    queryKey: qk.roles.grants(roleName),
    queryFn: () => endpoints.listRoleGrants(roleName),
    enabled: !!roleName,
  });

  const {
    data: memberships,
    isLoading: membershipsLoading,
    refetch: refetchMemberships,
  } = useQuery({
    queryKey: qk.roles.memberships(roleName),
    queryFn: () => endpoints.listRoleMemberships(roleName),
    enabled: !!roleName,
  });

  const {
    data: members,
    isLoading: membersLoading,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: qk.roles.members(roleName),
    queryFn: () => endpoints.listRoleMembers(roleName),
    enabled: !!roleName,
  });

  const alterMutation = useMutation({
    mutationFn: (body: RoleAlter) => endpoints.alterRole(roleName, body),
    onSuccess: () => {
      toast.success("Rol öznitelikleri güncellendi");
      queryClient.invalidateQueries({ queryKey: qk.roles.all() });
      attrReset();
    },
    onError: () => {
      toast.error("Rol güncellenemedi");
    },
  });

  const grantMutation = useMutation({
    mutationFn: (body: GrantChange) =>
      addOrRevokeMode === "grant" ? endpoints.grantPrivilege(body) : endpoints.revokePrivilege(body),
    onSuccess: () => {
      toast.success(addOrRevokeMode === "grant" ? "Yetki verildi" : "Yetki geri alındı");
      queryClient.invalidateQueries({ queryKey: qk.roles.grants(roleName) });
      refetchGrants();
      setGrantDialogOpen(false);
    },
    onError: () => {
      toast.error("İşlem başarısız");
    },
  });

  const grantMembershipMutation = useMutation({
    mutationFn: (body: GrantMembershipRequest) =>
      endpoints.grantMembership(roleName, body),
    onSuccess: () => {
      toast.success("Üyelik verildi");
      queryClient.invalidateQueries({ queryKey: qk.roles.memberships(roleName) });
      queryClient.invalidateQueries({ queryKey: qk.roles.members(roleName) });
      refetchMemberships();
      refetchMembers();
      setMembershipDialogOpen(false);
      memReset();
    },
    onError: () => {
      toast.error("Üyelik eklenemedi");
    },
  });

  const revokeMembershipMutation = useMutation({
    mutationFn: (body: GrantMembershipRequest) =>
      endpoints.revokeMembership(roleName, body),
    onSuccess: () => {
      toast.success("Üyelik iptal edildi");
      queryClient.invalidateQueries({ queryKey: qk.roles.memberships(roleName) });
      queryClient.invalidateQueries({ queryKey: qk.roles.members(roleName) });
      refetchMemberships();
      refetchMembers();
    },
    onError: () => {
      toast.error("Üyelik iptal edilemedi");
    },
  });

  const onSubmitAttr = attrHandleSubmit(async (data) => {
    try {
      const payload: RoleAlter = {};
      if (data.password && data.password.trim()) {
        payload.password = data.password;
      }
      if (data.connection_limit !== undefined && data.connection_limit !== null) {
        payload.connection_limit = Number(data.connection_limit);
      }
      if (data.valid_until && data.valid_until.trim()) {
        payload.valid_until = data.valid_until;
      }

      if (!payload.password && payload.connection_limit === undefined && !payload.valid_until) {
        toast.error("Değiştirilecek bir alan girmediniz");
        return;
      }

      const dryRunPayload: RoleAlter = { ...payload, dry_run: true };
      const dryRunRes = await endpoints.alterRole(roleName, dryRunPayload);

      if (dryRunRes && "sql" in dryRunRes && (dryRunRes as DryRunResult).sql) {
        const risk = ((dryRunRes as DryRunResult).risk ?? "MAINTENANCE") as "MAINTENANCE" | "DANGEROUS";
        const ok = await confirm({
          title: `"${roleName}" öznitelikleri güncellensin mi?`,
          description:
            "Rol öznitelikleri (şifre, bağlantı limiti, geçerlilik tarihi vb.) aşağıdaki SQL komutuyla güncellenecek. Onaylıyor musunuz?",
          risk_level: risk,
          confirm_label: "Değişiklikleri Uygula",
          cancel_label: "İptal",
          sql_preview: (dryRunRes as DryRunResult).sql,
        });
        if (!ok) return;
      }

      await alterMutation.mutateAsync({ ...payload, confirm: true });
    } catch (e) {}
  });

  const handleGrantRevoke = async (grant: GenericDict, mode: "grant" | "revoke") => {
    const privilege = String(grant.privilege_type ?? grant.privilege ?? "");
    const objectType = String(grant.object_type ?? "TABLE");
    const schemaName = grant.schema_name ? String(grant.schema_name) : null;
    const objectName = grant.object_name ? String(grant.object_name) : null;

    const grantPreview =
      mode === "grant"
        ? `GRANT ${privilege} ON ${objectType} ${schemaName ? schemaName + "." : ""}${objectName ?? "???"} TO ${roleName};`
        : `REVOKE ${privilege} ON ${objectType} ${schemaName ? schemaName + "." : ""}${objectName ?? "???"} FROM ${roleName};`;

    const ok = await confirm({
      title:
        mode === "grant"
          ? `"${privilege}" yetkisi verilsin mi?`
          : `"${privilege}" yetkisi geri alınsın mı?`,
      description:
        mode === "grant"
          ? `${roleName} rolüne ${objectType} üzerinde ${privilege} yetkisi verilecek.`
          : `${roleName} rolünden ${objectType} üzerinde ${privilege} yetkisi geri alınacak.`,
      risk_level: "MAINTENANCE",
      confirm_label: mode === "grant" ? "Yetki Ver" : "Geri Al",
      cancel_label: "İptal",
      sql_preview: [grantPreview],
    });
    if (!ok) return;

    const body: GrantChange = {
      role: roleName,
      privilege,
      object_type: objectType,
      schema_name: schemaName,
      object_name: objectName,
      confirm: true,
    };
    setAddOrRevokeMode(mode);
    await grantMutation.mutateAsync(body);
  };

  const onSubmitMembership = memHandleSubmit(async (data) => {
    try {
      if (!data.member) {
        toast.error("Üye rolü seçmek zorunludur");
        return;
      }
      const preview = `GRANT "${roleName}" TO "${data.member}"${data.admin_option ? " WITH ADMIN OPTION" : ""};`;
      const ok = await confirm({
        title: `"${data.member}" rolüne "${roleName}" üyeliği verilsin mi?`,
        description: `"${data.member}" rolü artık "${roleName}" üyesi olacak ve tüm izinlerini devralacak.${
          data.admin_option ? " ADMIN OPTION ile (üyelik dağıtabilir)." : ""
        }`,
        risk_level: "MAINTENANCE",
        confirm_label: "Üyeliği Ver",
        cancel_label: "İptal",
        sql_preview: [preview],
      });
      if (!ok) return;

      await grantMembershipMutation.mutateAsync({ member: data.member, confirm: true });
    } catch (e) {}
  });

  const handleRevokeMembership = async (membership: RoleMembership) => {
    const preview = `REVOKE "${roleName}" FROM "${membership.member}";`;
    const ok = await confirm({
      title: `"${membership.member}" üyeliği iptal edilsin mi?`,
      description: `"${membership.member}" rolünden "${roleName}" üyeliği kaldırılacak. Artık bu rolün izinlerini devralmayacak.`,
      risk_level: "MAINTENANCE",
      confirm_label: "Üyeliği İptal Et",
      cancel_label: "İptal",
      confirm_name_required: true,
      confirm_name_value: membership.member,
      sql_preview: [preview],
    });
    if (!ok) return;
    await revokeMembershipMutation.mutateAsync({ member: membership.member, confirm: true });
  };

  const isSuperuser = role?.superuser;
  const candidatesForMembership = (rolesAll ?? []).filter(
    (r) =>
      r.name !== roleName &&
      !(members ?? []).some((m) => m.member === r.name)
  );

  return (
    <div className="space-y-8">
      <ConfirmDialog />

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/roles")}
            className="h-10 rounded-full"
          >
            <ArrowLeft className="h-4 w-4" />
            Rollere Dön
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Shield className="h-8 w-8 text-emerald-400" />
                {roleName}
              </h1>
              {isSuperuser && (
                <RiskBadge riskLevel="DANGEROUS" size="md">
                  SUPERUSER
                </RiskBadge>
              )}
              {role?.can_login && !isSuperuser && (
                <RiskBadge riskLevel="OK" size="md">
                  LOGIN
                </RiskBadge>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              Rol detayları: öznitelikler, yetkiler ve üyelikler
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: qk.roles.all() });
            refetchGrants();
            refetchMemberships();
            refetchMembers();
            toast.success("Veriler yenilendi");
          }}
          className="h-12 px-6 rounded-full"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Tümünü Yenile
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {rolesAllLoading ? (
          [0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-3 w-24 mb-3" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          [
            {
              label: "SUPERUSER",
              val: role?.superuser,
              icon: Shield,
              risk: "DANGEROUS",
            },
            {
              label: "CREATEDB",
              val: role?.createdb,
              icon: KeyRound,
              risk: "MAINTENANCE",
            },
            {
              label: "CREATEROLE",
              val: role?.createrole,
              icon: UserPlus,
              risk: "MAINTENANCE",
            },
            {
              label: "CAN LOGIN",
              val: role?.can_login,
              icon: LockKeyhole,
              risk: "OK",
            },
          ].map((m) => (
            <Card key={m.label} className="overflow-hidden relative">
              <div
                className={cn(
                  "absolute inset-0 opacity-10 pointer-events-none bg-gradient-to-br",
                  m.val ? "from-emerald-500 to-teal-500" : "from-zinc-500 to-zinc-600"
                )}
              />
              <CardContent className="p-6 relative">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center",
                      m.val
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-white/5 text-muted-foreground"
                    )}
                  >
                    <m.icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {m.label}
                  </span>
                </div>
                {m.val ? (
                  <RiskBadge riskLevel={m.risk as "OK" | "MAINTENANCE" | "DANGEROUS"} size="md">
                    <CheckCircle2 className="h-3 w-3" />
                    AKTİF
                  </RiskBadge>
                ) : (
                  <RiskBadge riskLevel="INFO" size="md">
                    <XCircle className="h-3 w-3" />
                    PASİF
                  </RiskBadge>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="!p-0">
          <div className="p-6 border-b border-white/5">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="attributes">Öznitelikler</TabsTrigger>
                <TabsTrigger value="grants">
                  Yetkiler ({(roleGrants ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="memberships">
                  Üyelikler ({(members ?? []).length + (memberships ?? []).length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="attributes" className="mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Save className="h-5 w-5 text-indigo-400" />
                      Değiştirilebilir Öznitelikler
                    </h3>
                    <form onSubmit={onSubmitAttr} className="space-y-5">
                      <div className="space-y-2">
                        <Label>Yeni Şifre</Label>
                        <Input
                          type="password"
                          {...attrRegister("password")}
                          placeholder="•••••••• (değiştirmek istemiyorsanız boş bırakın)"
                          className={cn(attrErrors.password && "border-red-500/50")}
                        />
                        <p className="text-xs text-muted-foreground">
                          Şifreyi yalnızca değiştirmek istiyorsanız doldurun
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Bağlantı Limiti</Label>
                        <Select
                          value={String(attrWatch("connection_limit") ?? "-1")}
                          onValueChange={(v) => attrSetValue("connection_limit", Number(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-1">Sınırsız (∞)</SelectItem>
                            <SelectItem value="1">1 bağlantı</SelectItem>
                            <SelectItem value="5">5 bağlantı</SelectItem>
                            <SelectItem value="10">10 bağlantı</SelectItem>
                            <SelectItem value="20">20 bağlantı</SelectItem>
                            <SelectItem value="50">50 bağlantı</SelectItem>
                            <SelectItem value="100">100 bağlantı</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Şifre Geçerlilik Tarihi</Label>
                        <Input
                          type="date"
                          {...attrRegister("valid_until")}
                          placeholder="YYYY-MM-DD"
                        />
                        <p className="text-xs text-muted-foreground">
                          Şifrenin süresi ne zaman bitsin? (boş = süresiz)
                        </p>
                      </div>

                      <Button
                        type="submit"
                        disabled={attrSubmitting || alterMutation.isPending}
                        className="h-12 rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 w-full"
                      >
                        {attrSubmitting || alterMutation.isPending ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Kaydediliyor…
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Değişiklikleri Kaydet
                          </>
                        )}
                      </Button>
                    </form>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Shield className="h-5 w-5 text-emerald-400" />
                      Mevcut Durum
                    </h3>
                    {rolesAllLoading || !role ? (
                      <div className="space-y-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <Skeleton key={i} className="h-11 w-full" />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[
                          ["Rol Adı", role.name],
                          [
                            "Bağlantı Limiti",
                            role.connection_limit === -1 || role.connection_limit === null
                              ? "∞ (sınırsız)"
                              : String(role.connection_limit),
                          ],
                          [
                            "Şifre Geçerlilik",
                            role.valid_until
                              ? role.valid_until.split("T")[0]
                              : "Süresiz (infinity)",
                          ],
                          ["SUPERUSER", role.superuser ? "EVET" : "HAYIR"],
                          ["CREATEDB", role.createdb ? "EVET" : "HAYIR"],
                          ["CREATEROLE", role.createrole ? "EVET" : "HAYIR"],
                          ["LOGIN", role.can_login ? "EVET" : "HAYIR"],
                        ].map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5"
                          >
                            <span className="text-sm font-medium text-muted-foreground">
                              {k}
                            </span>
                            <code className="text-sm font-mono bg-black/30 px-3 py-1 rounded-full">
                              {v}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="grants" className="mt-6">
                <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                  <h3 className="text-lg font-semibold">
                    Rolün Sahip Olduğu Yetkiler
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {(roleGrants ?? []).length} adet yetki kaydı
                  </p>
                </div>

                {grantsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (roleGrants ?? []).length === 0 ? (
                  <div className="p-12 text-center rounded-3xl border border-dashed border-white/10">
                    <Shield className="h-14 w-14 mx-auto text-muted-foreground mb-4" />
                    <p className="font-semibold text-lg">Henüz yetki yok</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      Bu role doğrudan atanmış bir yetki bulunmuyor. (Rol üyelikleri üzerinden yetki alabilir)
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-2">
                    {(roleGrants ?? []).map((g, idx) => {
                      const privilege = String(g.privilege_type ?? g.privilege ?? "");
                      const objectType = String(g.object_type ?? g.kind ?? "TABLE");
                      const schema = g.schema_name ? String(g.schema_name) : null;
                      const objName = g.object_name ? String(g.object_name) : null;
                      const grantor = g.grantor ? String(g.grantor) : null;
                      const isGrante = Boolean(g.is_grantable ?? g.grantable);

                      return (
                        <div
                          key={`grant-${idx}-${privilege}-${objName}`}
                          className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition-colors"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <RiskBadge riskLevel="OK" size="sm" showIcon={false}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  {privilege}
                                </RiskBadge>
                                <RiskBadge riskLevel="INFO" size="sm" showIcon={false}>
                                  {objectType}
                                </RiskBadge>
                                {isGrante && (
                                  <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                                    WITH GRANT OPTION
                                  </RiskBadge>
                                )}
                              </div>
                              <p className="font-semibold text-sm">
                                {schema && (
                                  <span className="text-muted-foreground font-normal">
                                    {schema}
                                    <span className="text-muted-foreground">.</span>
                                  </span>
                                )}
                                <span>{objName ?? "(tümü)"}</span>
                              </p>
                              {grantor && (
                                <p className="text-xs text-muted-foreground mt-1 font-mono">
                                  Veren: {grantor}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-full border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => handleGrantRevoke(g, "grant")}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Tekrar Ver
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-full border-red-500/30 text-red-400 hover:bg-red-500/10"
                                onClick={() => handleGrantRevoke(g, "revoke")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Geri Al
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="memberships" className="mt-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <UserPlus className="h-5 w-5 text-emerald-400" />
                        Bu Rolün Üyeleri
                        <span className="text-xs font-normal text-muted-foreground">
                          (
                          {(members ?? []).length} kişi &quot;{roleName}&quot; rolünü kullanabilir)
                        </span>
                      </h3>
                      <Dialog
                        open={membershipDialogOpen}
                        onOpenChange={setMembershipDialogOpen}
                      >
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            className="h-10 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                          >
                            <UserPlus className="h-4 w-4 mr-2" />
                            Yeni Üye Ekle
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              <UserPlus className="h-5 w-5 text-emerald-400" />
                              &quot;{roleName}&quot; Rolüne Yeni Üye Ekle
                            </DialogTitle>
                            <DialogDescription>
                              Seçtiğiniz rol artık &quot;{roleName}&quot; üyesi olacak
                            </DialogDescription>
                          </DialogHeader>
                          <form onSubmit={onSubmitMembership} className="space-y-5">
                            <div className="space-y-2">
                              <Label>Üye Olacak Rol *</Label>
                              <Select
                                value={memWatch("member")}
                                onValueChange={(v) => memSetValue("member", v)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Rol seç..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {candidatesForMembership.length === 0 ? (
                                    <SelectItem value="none" disabled>
                                      Eklenecek uygun rol yok
                                    </SelectItem>
                                  ) : (
                                    candidatesForMembership.map((c) => (
                                      <SelectItem key={c.name} value={c.name}>
                                        {c.name}
                                        {c.superuser ? " (SUPERUSER)" : ""}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                              <Checkbox
                                id="admin-option"
                                checked={memWatch("admin_option")}
                                onCheckedChange={(v) =>
                                  memSetValue("admin_option", typeof v === "boolean" ? v : false)
                                }
                              />
                              <div>
                                <label
                                  htmlFor="admin-option"
                                  className="text-sm font-medium cursor-pointer text-amber-400"
                                >
                                  ADMIN OPTION
                                </label>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Üye, bu üyeliği başkalarına da dağıtabilir
                                </p>
                              </div>
                            </div>

                            <DialogFooter>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setMembershipDialogOpen(false);
                                  memReset();
                                }}
                                className="h-11 rounded-full"
                              >
                                İptal
                              </Button>
                              <Button
                                type="submit"
                                disabled={grantMembershipMutation.isPending}
                                className="h-11 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                              >
                                {grantMembershipMutation.isPending ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                    Ekleniyor…
                                  </>
                                ) : (
                                  <>
                                    <UserPlus className="h-4 w-4 mr-2" />
                                    Üyeyi Ekle
                                  </>
                                )}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {membersLoading ? (
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : (members ?? []).length === 0 ? (
                      <div className="p-10 text-center rounded-3xl border border-dashed border-white/10">
                        <UserMinus className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                        <p className="font-semibold">Henüz üye yok</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          &quot;Yeni Üye Ekle&quot; butonuna tıklayarak başka rolleri bu rolün üyesi yapın
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(members ?? []).map((m, idx) => (
                          <div
                            key={`member-${idx}-${m.member}`}
                            className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between gap-4"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                                <UserPlus className="h-5 w-5 text-emerald-400" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm truncate">{m.member}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    Rol: &quot;{roleName}&quot; üyesi
                                  </span>
                                  {m.admin_option && (
                                    <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                                      ADMIN OPTION
                                    </RiskBadge>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRevokeMembership(m)}
                              disabled={revokeMembershipMutation.isPending}
                              className={cn(
                                "h-9 rounded-full shrink-0 text-red-400 border-red-500/30 hover:bg-red-500/10"
                              )}
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Çıkar
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2 mb-5">
                      <Shield className="h-5 w-5 text-indigo-400" />
                      Bu Rolün Üye Olduğu Gruplar
                      <span className="text-xs font-normal text-muted-foreground">
                        ({(memberships ?? []).length} grup)
                      </span>
                    </h3>

                    {membershipsLoading ? (
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : (memberships ?? []).length === 0 ? (
                      <div className="p-10 text-center rounded-3xl border border-dashed border-white/10">
                        <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                        <p className="font-semibold">Üye olunan grup yok</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          &quot;{roleName}&quot; rolü henüz başka bir rolün üyesi değil
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {(memberships ?? []).map((m, idx) => (
                          <Link
                            key={`membership-${idx}-${m.role}`}
                            href={`/roles/${encodeURIComponent(m.role)}`}
                            className="block rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
                                <Shield className="h-5 w-5 text-indigo-400" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm truncate group-hover:text-emerald-400 transition-colors">
                                  {m.role}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">
                                    &quot;{roleName}&quot; bu grubun üyesi
                                  </span>
                                  {m.admin_option && (
                                    <RiskBadge riskLevel="WARNING" size="sm" showIcon={false}>
                                      ADMIN OPTION
                                    </RiskBadge>
                                  )}
                                </div>
                              </div>
                              <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 group-hover:text-emerald-400 transition-colors shrink-0" />
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
