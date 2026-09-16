"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/useAuthStore";

interface MasterPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function loginWithApiToken(apiToken: string): Promise<boolean> {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ api_token: apiToken }),
    credentials: "include",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ detail: "Bağlantı hatası" }));
    throw new Error(data?.detail || "Bağlantı başarısız");
  }

  return true;
}

export function MasterPasswordModal({
  open,
  onOpenChange,
}: MasterPasswordModalProps) {
  const router = useRouter();
  const setApiToken = useAuthStore((s) => s.setApiToken);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setLoading(false);
    }
  }, [open]);

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (loading || !password.trim()) return;

      const token = password.trim();
      setLoading(true);

      try {
        await loginWithApiToken(token);
        setApiToken(token);
        setAuthenticated(true);
        toast.success("Bağlantı başarılı", {
          description: "PgGuardian paneline yönlendiriliyorsunuz.",
        });
        onOpenChange(false);
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Bağlantı başarısız";
        toast.error("Bağlantı başarısız", { description: message });
      } finally {
        setLoading(false);
      }
    },
    [loading, password, onOpenChange, router, setApiToken, setAuthenticated]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-left">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 sm:mx-0">
            <Lock className="h-8 w-8 text-indigo-400" />
          </div>
          <DialogTitle className="text-2xl">PgGuardian&apos;a Bağlan</DialogTitle>
          <DialogDescription>
            API token veya master parolanızı girerek PostgreSQL yönetim paneline
            erişin.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="master-password">API Token / Master Parola</Label>
            <Input
              id="master-password"
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
              className="h-14 rounded-2xl"
            />
          </div>

          <DialogFooter>
            <Button
              type="submit"
              className="w-full h-12 bg-gradient-to-r from-indigo-500 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600"
              disabled={loading || !password.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Bağlanıyor...
                </>
              ) : (
                "Bağlan"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default MasterPasswordModal;
