"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { IfWriter } from "@/components/role-guard";
import { CodeBlock } from "@/components/statements/code-block";
import { formatBytes } from "@/components/statements/format";
import { api } from "@/lib/api/client";
import { qk } from "@/lib/api/queryKeys";
import { useI18n } from "@/lib/i18n";
import { useProfileStore } from "@/store/useProfileStore";

interface DatabaseInfo {
  name: string;
  owner: string | null;
  size_bytes: number;
  allow_connections: boolean;
  connection_limit: number;
}

interface DryRun {
  sql: string[];
}

const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [preview, setPreview] = React.useState<string | null>(null);

  const body = { name: name.trim(), owner: owner.trim() || undefined };

  const dryRun = useMutation({
    mutationFn: () => api.post<DryRun>("/databases", { ...body, dry_run: true }),
    onSuccess: (result) => setPreview(result.sql.join("\n")),
  });
  const create = useMutation({
    mutationFn: () => api.post("/databases", { ...body, confirm: true }),
    onSuccess: () => {
      toast.success(t("databases.created", { name: body.name }));
      queryClient.invalidateQueries({ queryKey: ["databases"] });
      setName("");
      setOwner("");
      setPreview(null);
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("databases.createTitle")}</DialogTitle>
          <DialogDescription>{t("databases.writesDisabled")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-xs font-medium">
            {t("databases.name")}
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setPreview(null);
              }}
              className="font-mono"
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            {t("databases.ownerOptional")}
            <Input
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setPreview(null);
              }}
              className="font-mono"
            />
          </label>
          {preview && <CodeBlock code={preview} label={t("databases.preview")} />}
        </div>
        <DialogFooter>
          {preview ? (
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {t("common.confirm")}
            </Button>
          ) : (
            <Button onClick={() => dryRun.mutate()} disabled={!body.name || dryRun.isPending}>
              {t("databases.preview")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DropDialog({ target, onClose }: { target: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [typed, setTyped] = React.useState("");

  const drop = useMutation({
    mutationFn: () =>
      api.delete(`/databases/${encodeURIComponent(target ?? "")}`, {
        confirm: true,
        confirm_name: typed,
      }),
    onSuccess: () => {
      toast.success(t("databases.dropped", { name: target ?? "" }));
      queryClient.invalidateQueries({ queryKey: ["databases"] });
      setTyped("");
      onClose();
    },
  });

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          setTyped("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("databases.dropTitle", { name: target ?? "" })}</DialogTitle>
          <DialogDescription>{t("databases.dropDesc")}</DialogDescription>
        </DialogHeader>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={target ?? ""}
          className="font-mono"
        />
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={typed !== target || drop.isPending}
            onClick={() => drop.mutate()}
          >
            {t("databases.drop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DatabasesPage() {
  const { t, formatNumber } = useI18n();
  const profile = useProfileStore((s) => s.selectedProfileName);
  const [creating, setCreating] = React.useState(false);
  const [dropping, setDropping] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: [...qk.databases.all(), profile],
    queryFn: () => api.get<DatabaseInfo[]>("/databases"),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("databases.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("databases.subtitle")}</p>
        </div>
        <IfWriter>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> {t("databases.create")}
          </Button>
        </IfWriter>
      </div>

      {query.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {query.isError && (
        <div className="rounded-lg border border-destructive/40 p-4 text-[13px]">
          <p className="mb-2 font-medium">{t("common.loadFailed")}</p>
          <p className="mb-3 text-muted-foreground">{(query.error as Error).message}</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {query.data && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t("databases.name")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("databases.owner")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("databases.size")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("databases.connectionLimit")}</th>
                <th scope="col" className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {query.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    {t("common.noData")}
                  </td>
                </tr>
              )}
              {query.data.map((database) => {
                const isSystem = SYSTEM_DATABASES.has(database.name);
                return (
                  <tr key={database.name} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5 font-mono font-medium">
                      {database.name}
                      {isSystem && (
                        <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">
                          {t("databases.system")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{database.owner}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatBytes(database.size_bytes)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {database.connection_limit < 0
                        ? t("databases.unlimited")
                        : formatNumber(database.connection_limit)}
                    </td>
                    <td className="px-3 py-1">
                      {!isSystem && (
                        <IfWriter>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={t("databases.drop")}
                            onClick={() => setDropping(database.name)}
                          >
                            <Trash2 />
                          </Button>
                        </IfWriter>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} />
      <DropDialog target={dropping} onClose={() => setDropping(null)} />
    </div>
  );
}
