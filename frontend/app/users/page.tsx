"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  UserPlus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
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
import { useAuthStore, type UserRole } from "@/store/useAuthStore";
import { formatDateAgo } from "@/lib/utils";

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  password_must_change: boolean;
}

const createUserSchema = z.object({
  email: z.string().email({ message: "Geçerli bir e-posta girin" }),
  full_name: z
    .string()
    .min(2, { message: "Ad soyad en az 2 karakter olmalı" }),
  password: z
    .string()
    .min(8, { message: "Şifre en az 8 karakter olmalı" }),
  app_role: z.enum(["Admin", "DBA", "Viewer"], {
    required_error: "Rol seçin",
  }),
});

const editUserSchema = z.object({
  email: z.string().email({ message: "Geçerli bir e-posta girin" }).optional(),
  full_name: z
    .string()
    .min(2, { message: "Ad soyad en az 2 karakter olmalı" })
    .optional(),
  app_role: z.enum(["Admin", "DBA", "Viewer"]).optional(),
  is_active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  new_password: z
    .string()
    .min(8, { message: "Yeni şifre en az 8 karakter olmalı" }),
});

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case "Admin":
      return "bg-red-500/20 text-red-300 border-red-500/30";
    case "DBA":
      return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "Viewer":
    default:
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
  }
}

export default function UsersPage() {
  const router = useRouter();
  const { isAdmin } = useRole();
  const currentUser = useAuthStore((s) => s.user);

  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserRow | null>(null);
  const [resettingUser, setResettingUser] = React.useState<UserRow | null>(null);
  const [deletingUser, setDeletingUser] = React.useState<UserRow | null>(null);

  React.useEffect(() => {
    if (!isAdmin) {
      toast.error("Bu sayfa Admin içindir");
      router.replace("/dashboard");
      return;
    }
    fetchUsers();
  }, [isAdmin, router]);

  async function fetchUsers() {
    setLoading(true);
    try {
      const list = await api.get<UserRow[]>("/users");
      setUsers(list);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Kullanıcılar alınamadı";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const createForm = useForm<z.infer<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      full_name: "",
      password: "",
      app_role: "Viewer",
    },
  });

  const editForm = useForm<z.infer<typeof editUserSchema>>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      email: "",
      full_name: "",
      app_role: "Viewer",
      is_active: true,
    },
  });

  const resetForm = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      new_password: "",
    },
  });

  async function onCreateUser(values: z.infer<typeof createUserSchema>) {
    try {
      await api.post<UserRow>("/users", values);
      toast.success("Kullanıcı oluşturuldu");
      setCreateOpen(false);
      createForm.reset();
      fetchUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Kullanıcı oluşturulamadı";
      toast.error(msg);
    }
  }

  function openEditDialog(u: UserRow) {
    setEditingUser(u);
    editForm.reset({
      email: u.email,
      full_name: u.full_name,
      app_role: u.role,
      is_active: u.is_active,
    });
  }

  async function onEditUser(values: z.infer<typeof editUserSchema>) {
    if (!editingUser) return;
    try {
      const body: Record<string, unknown> = {};
      if (values.email !== undefined) body.email = values.email;
      if (values.full_name !== undefined) body.full_name = values.full_name;
      if (values.app_role !== undefined) body.app_role = values.app_role;
      if (values.is_active !== undefined) body.is_active = values.is_active;

      await api.patch(`/users/${editingUser.id}`, body);
      toast.success("Kullanıcı güncellendi");
      setEditingUser(null);
      editForm.reset();
      fetchUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Kullanıcı güncellenemedi";
      toast.error(msg);
    }
  }

  async function onToggleActive(u: UserRow, checked: boolean) {
    try {
      await api.patch(`/users/${u.id}`, { is_active: checked });
      toast.success(checked ? "Kullanıcı aktifleştirildi" : "Kullanıcı pasifleştirildi");
      fetchUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Durum değiştirilemedi";
      toast.error(msg);
      fetchUsers();
    }
  }

  async function onResetPassword(values: z.infer<typeof resetPasswordSchema>) {
    if (!resettingUser) return;
    try {
      await api.post(`/users/${resettingUser.id}/reset_password`, {
        new_password: values.new_password,
      });
      toast.success("Şifre sıfırlandı");
      setResettingUser(null);
      resetForm.reset();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Şifre sıfırlanamadı";
      toast.error(msg);
    }
  }

  async function onDeleteUser() {
    if (!deletingUser) return;
    try {
      await api.delete(`/users/${deletingUser.id}`);
      toast.success("Kullanıcı silindi");
      setDeletingUser(null);
      fetchUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Kullanıcı silinemedi";
      toast.error(msg);
    }
  }

  const isSelf = (u: UserRow): boolean =>
    !!(currentUser && (currentUser.id === u.id || currentUser.email === u.email));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Kullanıcı Yönetimi</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sisteme erişen kullanıcıları buradan yönetin
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Yeni Kullanıcı
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Yeni Kullanıcı</DialogTitle>
              <DialogDescription>
                Sisteme yeni bir kullanıcı ekleyin.
              </DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form
                onSubmit={createForm.handleSubmit(onCreateUser)}
                className="space-y-4"
              >
                <FormField
                  control={createForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-posta</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="ornek@local"
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
                      <FormLabel>Ad Soyad</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Ahmet Yılmaz"
                          disabled={createForm.formState.isSubmitting}
                        />
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
                      <FormLabel>İlk Şifre</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
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
                      <FormLabel>Rol</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={createForm.formState.isSubmitting}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Rol seçin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="DBA">DBA</SelectItem>
                          <SelectItem value="Viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createForm.formState.isSubmitting}
                  >
                    {createForm.formState.isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Oluşturuluyor
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Oluştur
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-xl">
        <CardHeader className="p-4 md:p-6 pb-2">
          <CardTitle className="text-lg">Kullanıcılar ({users.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-posta</TableHead>
                <TableHead>Ad Soyad</TableHead>
                <TableHead>Son Giriş</TableHead>
                <TableHead>Aktif</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 mr-2 inline-block animate-spin" />
                    Yükleniyor...
                  </TableCell>
                </TableRow>
              )}
              {!loading && users.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-10 text-muted-foreground"
                  >
                    Henüz kullanıcı bulunmuyor
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className={roleBadgeClass(u.role)}
                        >
                          {u.role}
                        </Badge>
                        <span className="font-medium">{u.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>{u.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.last_login ? formatDateAgo(u.last_login) : "-"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={u.is_active}
                        onCheckedChange={(c) => onToggleActive(u, c)}
                        disabled={isSelf(u)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(u)}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Düzenle
                        </Button>
                        <Dialog
                          open={resettingUser?.id === u.id}
                          onOpenChange={(o) => {
                            if (!o) setResettingUser(null);
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setResettingUser(u)}
                            >
                              <KeyRound className="h-4 w-4 mr-1" />
                              Şifre
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Şifre Sıfırla</DialogTitle>
                              <DialogDescription>
                                {u.email} kullanıcısı için yeni bir şifre
                                belirleyin.
                              </DialogDescription>
                            </DialogHeader>
                            <Form {...resetForm}>
                              <form
                                onSubmit={resetForm.handleSubmit(
                                  onResetPassword
                                )}
                                className="space-y-4"
                              >
                                <FormField
                                  control={resetForm.control}
                                  name="new_password"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Yeni Şifre</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...field}
                                          type="password"
                                          placeholder="••••••••"
                                          disabled={
                                            resetForm.formState.isSubmitting
                                          }
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <DialogFooter>
                                  <Button
                                    type="submit"
                                    disabled={
                                      resetForm.formState.isSubmitting
                                    }
                                  >
                                    {resetForm.formState.isSubmitting ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Sıfırlanıyor
                                      </>
                                    ) : (
                                      "Şifreyi Sıfırla"
                                    )}
                                  </Button>
                                </DialogFooter>
                              </form>
                            </Form>
                          </DialogContent>
                        </Dialog>
                        <AlertDialog
                          open={deletingUser?.id === u.id}
                          onOpenChange={(o) => {
                            if (!o) setDeletingUser(null);
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeletingUser(u)}
                              disabled={isSelf(u)}
                              title={
                                isSelf(u)
                                  ? "Kendinizi silemezsiniz"
                                  : undefined
                              }
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Sil
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Kullanıcıyı Sil
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Kullanıcıyı silmek istediğine emin misin?
                                <div className="mt-2 p-3 rounded-xl bg-white/5 border border-white/10 font-mono text-sm break-all">
                                  EMAİL: {deletingUser?.email}
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>İptal</AlertDialogCancel>
                              <AlertDialogAction onClick={onDeleteUser}>
                                Sil
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={editingUser !== null}
        onOpenChange={(o) => {
          if (!o) setEditingUser(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kullanıcıyı Düzenle</DialogTitle>
            <DialogDescription>
              {editingUser?.email} bilgilerini güncelleyin.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit(onEditUser)}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-posta</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="ornek@local"
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
                    <FormLabel>Ad Soyad</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Ahmet Yılmaz"
                        disabled={editForm.formState.isSubmitting}
                      />
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
                    <FormLabel>Rol</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={editForm.formState.isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Rol seçin" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Admin">Admin</SelectItem>
                        <SelectItem value="DBA">DBA</SelectItem>
                        <SelectItem value="Viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-white/10 p-4 space-y-0">
                    <div className="space-y-0.5">
                      <FormLabel>Aktif</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Kullanıcının sisteme giriş yapabilmesi için aktif olmalıdır.
                      </p>
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
                <Button
                  type="submit"
                  disabled={editForm.formState.isSubmitting}
                >
                  {editForm.formState.isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Kaydediliyor
                    </>
                  ) : (
                    "Kaydet"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
