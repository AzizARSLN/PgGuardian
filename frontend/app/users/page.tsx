"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { api } from "@/lib/api/client";
import { useRole } from "@/lib/hooks/use-role";
import { useI18n, type TFunction } from "@/lib/i18n";
import { useAuthStore, type UserRole } from "@/store/useAuthStore";

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  password_must_change: boolean;
}

const USERS_KEY = ["users"] as const;
const APP_ROLES = ["Admin", "DBA", "Viewer"] as const;
const MIN_PASSWORD_LENGTH = 8;

const emailSchema = (t: TFunction) =>
  z.string().email({ message: t("users.validation.email") });
const fullNameSchema = (t: TFunction) =>
  z.string().min(2, { message: t("users.validation.fullName") });

const createUserSchema = (t: TFunction) =>
  z.object({
    email: emailSchema(t),
    full_name: fullNameSchema(t),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, { message: t("users.validation.password", { min: MIN_PASSWORD_LENGTH }) }),
    app_role: z.enum(APP_ROLES, { required_error: t("users.validation.role") }),
  });

const editUserSchema = (t: TFunction) =>
  z.object({
    email: emailSchema(t).optional(),
    full_name: fullNameSchema(t).optional(),
    app_role: z.enum(APP_ROLES).optional(),
    is_active: z.boolean().optional(),
  });

const resetPasswordSchema = (t: TFunction) =>
  z.object({
    new_password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, { message: t("users.validation.password", { min: MIN_PASSWORD_LENGTH }) }),
  });

type CreateValues = z.infer<ReturnType<typeof createUserSchema>>;
type EditValues = z.infer<ReturnType<typeof editUserSchema>>;
type ResetValues = z.infer<ReturnType<typeof resetPasswordSchema>>;

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case "Admin":
      return "bg-destructive/20 text-destructive border-destructive/30";
    case "DBA":
      return "bg-warning/20 text-warning border-warning/30";
    case "Viewer":
    default:
      return "bg-success/20 text-success border-success/30";
  }
}

export default function UsersPage() {
  const { t, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const currentUser = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserRow | null>(null);
  const [resettingUser, setResettingUser] = React.useState<UserRow | null>(null);
  const [deactivatingUser, setDeactivatingUser] = React.useState<UserRow | null>(null);

  const {
    data: users = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => api.get<UserRow[]>("/users", { skipToast: true }),
    enabled: isAdmin,
  });

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });
  const showError = (fallback: string) => (error: unknown) => {
    // The backend's reason is more useful than a generic failure message.
    toast.error(error instanceof Error && error.message ? error.message : fallback);
  };

  // Validation messages follow the selected language.
  const createResolver = React.useMemo(() => zodResolver(createUserSchema(t)), [t]);
  const editResolver = React.useMemo(() => zodResolver(editUserSchema(t)), [t]);
  const resetResolver = React.useMemo(() => zodResolver(resetPasswordSchema(t)), [t]);

  const createForm = useForm<CreateValues>({
    resolver: createResolver,
    defaultValues: { email: "", full_name: "", password: "", app_role: "Viewer" },
  });
  const editForm = useForm<EditValues>({
    resolver: editResolver,
    defaultValues: { email: "", full_name: "", app_role: "Viewer", is_active: true },
  });
  const resetForm = useForm<ResetValues>({
    resolver: resetResolver,
    defaultValues: { new_password: "" },
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateValues) => api.post<UserRow>("/users", values, { skipToast: true }),
    onSuccess: () => {
      toast.success(t("users.toast.created"));
      setCreateOpen(false);
      createForm.reset();
      refreshUsers();
    },
    onError: showError(t("users.toast.createFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: EditValues }) =>
      api.patch<UserRow>(`/users/${id}`, body, { skipToast: true }),
    onSuccess: (updated) => {
      if (currentUser && updated && currentUser.id === updated.id) {
        setUser({ ...currentUser, email: updated.email, full_name: updated.full_name });
      }
      refreshUsers();
    },
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, new_password }: { id: number; new_password: string }) =>
      api.post(`/users/${id}/reset_password`, { new_password }, { skipToast: true }),
    onSuccess: () => {
      toast.success(t("users.toast.passwordReset"));
      setResettingUser(null);
      resetForm.reset();
    },
    onError: showError(t("users.toast.passwordResetFailed")),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`, undefined, { skipToast: true }),
    onSuccess: () => {
      toast.success(t("users.toast.deactivated"));
      setDeactivatingUser(null);
      refreshUsers();
    },
    onError: showError(t("users.toast.deactivateFailed")),
  });

  function openEditDialog(u: UserRow) {
    setEditingUser(u);
    editForm.reset({
      email: u.email,
      full_name: u.full_name,
      app_role: u.role,
      is_active: u.is_active,
    });
  }

  async function onCreateUser(values: CreateValues) {
    await createMutation.mutateAsync(values).catch(() => undefined);
  }

  async function onEditUser(values: EditValues) {
    if (!editingUser) return;
    try {
      await updateMutation.mutateAsync({ id: editingUser.id, body: values });
      toast.success(t("users.toast.updated"));
      setEditingUser(null);
      editForm.reset();
    } catch (error) {
      showError(t("users.toast.updateFailed"))(error);
    }
  }

  function onToggleActive(u: UserRow, checked: boolean) {
    updateMutation.mutate(
      { id: u.id, body: { is_active: checked } },
      {
        onSuccess: () =>
          toast.success(checked ? t("users.toast.activated") : t("users.toast.deactivated")),
        onError: showError(t("users.toast.statusFailed")),
      }
    );
  }

  async function onResetPassword(values: ResetValues) {
    if (!resettingUser) return;
    await resetMutation
      .mutateAsync({ id: resettingUser.id, new_password: values.new_password })
      .catch(() => undefined);
  }

  const isSelf = (u: UserRow): boolean =>
    !!(currentUser && (currentUser.id === u.id || currentUser.email === u.email));

  const formatLastLogin = (value: string | null) => {
    if (!value) return "-";
    return Number.isNaN(new Date(value).getTime()) ? value : formatDate(value);
  };

  if (!isAdmin) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-foreground">{t("users.title")}</h1>
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-card px-3 py-2 text-xs">
          <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
          {t("users.forbidden")}
        </div>
      </div>
    );
  }

  const roleOptions = APP_ROLES.map((role) => (
    <SelectItem key={role} value={role}>
      {role}
    </SelectItem>
  ));
  const emailPlaceholder = "admin@local";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("users.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) createForm.reset();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="h-3.5 w-3.5" />
                {t("users.newUser")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("users.newUser")}</DialogTitle>
                <DialogDescription>{t("users.createDescription")}</DialogDescription>
              </DialogHeader>
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreateUser)} className="space-y-3">
                  <FormField
                    control={createForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("users.fields.email")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={emailPlaceholder}
                            className="font-mono"
                            disabled={createForm.formState.isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="full_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("users.fields.fullName")}</FormLabel>
                        <FormControl>
                          <Input {...field} disabled={createForm.formState.isSubmitting} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("users.fields.initialPassword")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            autoComplete="new-password"
                            placeholder="••••••••"
                            disabled={createForm.formState.isSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="app_role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("users.fields.role")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={createForm.formState.isSubmitting}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("users.fields.rolePlaceholder")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>{roleOptions}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" size="sm" disabled={createForm.formState.isSubmitting}>
                      {createForm.formState.isSubmitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {createForm.formState.isSubmitting ? t("users.creating") : t("common.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground">
          {t("users.count", { count: users.length })}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("users.fields.email")}</TableHead>
              <TableHead>{t("users.fields.fullName")}</TableHead>
              <TableHead>{t("users.fields.lastLogin")}</TableHead>
              <TableHead>{t("users.fields.active")}</TableHead>
              <TableHead className="text-right">{t("users.fields.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="space-y-1.5" aria-label={t("common.loading")}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex items-center justify-center gap-3 py-4 text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {t("common.loadFailed")}
                    <Button variant="outline" size="sm" className="h-7" onClick={() => refetch()}>
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t("common.retry")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {t("users.empty")}
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              users.map((u) => (
                <TableRow key={u.id} className={u.is_active ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${roleBadgeClass(u.role)}`}>
                        {u.role}
                      </Badge>
                      <span className="font-mono font-medium">{u.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>{u.full_name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {formatLastLogin(u.last_login)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.is_active}
                      onCheckedChange={(c) => onToggleActive(u, c)}
                      disabled={isSelf(u) || updateMutation.isPending}
                      aria-label={t("users.fields.activeFor", { email: u.email })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => openEditDialog(u)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("users.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setResettingUser(u)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {t("users.password")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeactivatingUser(u)}
                        disabled={isSelf(u) || !u.is_active}
                        title={isSelf(u) ? t("users.cannotDeactivateSelf") : undefined}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        {t("users.deactivate")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={resettingUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResettingUser(null);
            resetForm.reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.resetTitle")}</DialogTitle>
            <DialogDescription>
              {t("users.resetDescription", { email: resettingUser?.email ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <Form {...resetForm}>
            <form onSubmit={resetForm.handleSubmit(onResetPassword)} className="space-y-3">
              <FormField
                control={resetForm.control}
                name="new_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.fields.newPassword")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        placeholder="••••••••"
                        disabled={resetForm.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" size="sm" disabled={resetForm.formState.isSubmitting}>
                  {resetForm.formState.isSubmitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {resetForm.formState.isSubmitting ? t("users.resetting") : t("users.resetSubmit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deactivatingUser !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivatingUser(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("users.deactivateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("users.deactivateDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="break-all rounded-md border border-border bg-card px-3 py-2 font-mono text-xs">
            {deactivatingUser?.email}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivatingUser) deactivateMutation.mutate(deactivatingUser.id);
              }}
            >
              {t("users.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open) setEditingUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("users.editDescription", { email: editingUser?.email ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditUser)} className="space-y-3">
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.fields.email")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={emailPlaceholder}
                        className="font-mono"
                        disabled={editForm.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.fields.fullName")}</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={editForm.formState.isSubmitting} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="app_role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.fields.role")}</FormLabel>
                    {/* Demoting yourself would lock the only way back to this page. */}
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={
                        editForm.formState.isSubmitting ||
                        (editingUser ? isSelf(editingUser) : false)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("users.fields.rolePlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>{roleOptions}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between space-y-0 rounded-md border border-border px-3 py-2">
                    <div>
                      <FormLabel>{t("users.fields.active")}</FormLabel>
                      <p className="text-xs text-muted-foreground">{t("users.activeHelp")}</p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={(field.value ?? true) as boolean}
                        onCheckedChange={field.onChange}
                        disabled={
                          editForm.formState.isSubmitting ||
                          (editingUser ? isSelf(editingUser) : false)
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" size="sm" disabled={editForm.formState.isSubmitting}>
                  {editForm.formState.isSubmitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {editForm.formState.isSubmitting ? t("users.saving") : t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
