"use client";

import * as React from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Skull,
  Wrench,
  TerminalSquare,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ConfirmRiskLevel = "MAINTENANCE" | "DANGEROUS";

export interface ConfirmOptions {
  title: string;
  description: string;
  sql_preview?: string[];
  risk_level: ConfirmRiskLevel;
  confirm_label?: string;
  cancel_label?: string;
  confirm_name_required?: boolean;
  confirm_name_value?: string;
  confirm_name_placeholder?: string;
  confirm_name_description?: string;
}

interface DialogState {
  open: boolean;
  options: ConfirmOptions | null;
}

let globalResolver: ((value: boolean) => void) | null = null;

export function useConfirm() {
  const [dialogState, setDialogState] = React.useState<DialogState>({
    open: false,
    options: null,
  });
  const [confirmNameInput, setConfirmNameInput] = React.useState("");

  const close = React.useCallback((result: boolean) => {
    setDialogState({ open: false, options: null });
    setConfirmNameInput("");
    if (globalResolver) {
      globalResolver(result);
      globalResolver = null;
    }
  }, []);

  const confirm = React.useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        globalResolver = resolve;
        setConfirmNameInput("");
        setDialogState({ open: true, options });
      });
    },
    []
  );

  const handleCancel = React.useCallback(() => {
    close(false);
  }, [close]);

  const opts = dialogState.options;
  const isDangerous = opts?.risk_level === "DANGEROUS";
  const needsConfirmName = Boolean(opts?.confirm_name_required);

  const confirmNameMatch = React.useMemo(() => {
    if (!needsConfirmName || !opts) return true;
    const expected = opts.confirm_name_value?.toLowerCase() ?? "";
    return (
      !!confirmNameInput &&
      confirmNameInput.toLowerCase() === expected
    );
  }, [needsConfirmName, opts, confirmNameInput]);

  const handleConfirm = React.useCallback(() => {
    if (!opts) return;
    if (needsConfirmName && !confirmNameMatch) return;
    close(true);
  }, [opts, needsConfirmName, confirmNameMatch, close]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && confirmNameMatch && !e.repeat) {
        e.preventDefault();
        handleConfirm();
      }
    },
    [confirmNameMatch, handleConfirm]
  );

  const Component = function ConfirmDialog() {
    if (!opts) return null;

    return (
      <AlertDialog
        open={dialogState.open}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        <AlertDialogContent
          className={cn("sm:max-w-lg", isDangerous && "border-red-500/40")}
        >
          <AlertDialogHeader className="space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl shrink-0",
                  isDangerous
                    ? "bg-red-500/15 text-red-400"
                    : "bg-amber-500/15 text-amber-400"
                )}
              >
                {isDangerous ? (
                  <Skull className="h-6 w-6" />
                ) : (
                  <Wrench className="h-6 w-6" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <AlertDialogTitle className="text-xl">
                  {opts.title}
                </AlertDialogTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit font-semibold",
                    isDangerous
                      ? "bg-red-500/15 text-red-400 border-red-500/40"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/40"
                  )}
                >
                  {isDangerous ? (
                    <span className="flex items-center gap-1.5">
                      <ShieldAlert className="h-3 w-3" />
                      DANGEROUS
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3" />
                      MAINTENANCE
                    </span>
                  )}
                </Badge>
              </div>
            </div>
            <AlertDialogDescription className="text-base leading-relaxed">
              {opts.description}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {opts.sql_preview && opts.sql_preview.length > 0 && (
            <div className="rounded-2xl border bg-black/40 backdrop-blur-sm p-4 overflow-hidden">
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                <TerminalSquare className="h-3.5 w-3.5" />
                <span className="font-semibold">SQL Onizlemesi</span>
              </div>
              <div className="space-y-1.5">
                {opts.sql_preview.map((sql, idx) => (
                  <pre
                    key={idx}
                    className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all bg-black/20 rounded-lg p-3"
                  >
                    {sql}
                  </pre>
                ))}
              </div>
            </div>
          )}

          {needsConfirmName && (
            <div className="space-y-2.5 rounded-2xl border bg-black/20 backdrop-blur-sm p-4">
              <Label
                htmlFor="confirm-name"
                className={cn(
                  "font-semibold",
                  isDangerous && "text-red-400"
                )}
              >
                Onaylamak icin{" "}
                <span className="font-mono px-1.5 py-0.5 rounded bg-black/30">
                  {opts.confirm_name_value ?? "hedef adini"}
                </span>{" "}
                yazin
              </Label>
              <Input
                id="confirm-name"
                type="text"
                value={confirmNameInput}
                onChange={(e) => setConfirmNameInput(e.target.value)}
                placeholder={
                  opts.confirm_name_placeholder ??
                  "Onaylamak icin " +
                    (opts.confirm_name_value ?? "") +
                    " yazin"
                }
                className={cn(
                  "font-mono",
                  isDangerous && confirmNameMatch
                    ? "border-red-500/50 focus-visible:ring-red-500"
                    : confirmNameMatch && "focus-visible:ring-emerald-500"
                )}
                onKeyDown={onKeyDown}
              />
              {opts.confirm_name_description && (
                <p className="text-xs text-muted-foreground">
                  {opts.confirm_name_description}
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleCancel}
              className="h-12 rounded-full"
            >
              {opts.cancel_label ?? "Iptal"}
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={isDangerous ? "destructive" : "default"}
                disabled={needsConfirmName && !confirmNameMatch}
                onClick={handleConfirm}
                className={cn(
                  "h-12 rounded-full",
                  isDangerous &&
                    "bg-red-500 hover:bg-red-600 text-white font-bold"
                )}
              >
                {opts.confirm_label ?? (isDangerous ? "SIL" : "Onayla")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  return {
    confirm,
    Component,
  };
}

export default useConfirm;
