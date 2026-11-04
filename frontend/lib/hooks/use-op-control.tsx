"use client";

import * as React from "react";
import { Loader2, Lock, Zap } from "lucide-react";

import { api } from "@/lib/api/client";
import type { LockInfo, OpStatus } from "@/lib/api/types";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/** How often a running operation is polled for lock blockers. */
const POLL_INTERVAL_MS = 3000;

export interface OpHandle {
  /** Sent as `?op_id=`; also the backend connection's `application_name` tag. */
  opId: string;
  /** Abort signal for the request. Aborting only stops the client wait. */
  signal: AbortSignal;
}

/**
 * Generates an id matching the backend's `[A-Za-z0-9_-]{1,64}` rule.
 */
export function newOpId(prefix = "op"): string {
  let suffix = "";
  for (let i = 0; i < 12; i += 1) {
    suffix += Math.floor(Math.random() * 36).toString(36);
  }
  return `${prefix}-${suffix}`;
}

/**
 * Tracks one long-running expert operation so it can be stopped.
 *
 * `begin` tags a request with a fresh op id and an abort signal; `stop` aborts
 * the client wait AND asks the backend to cancel the running query
 * (`pg_cancel_backend`). While the operation runs its status is polled so
 * blocking locks can be surfaced and cleared.
 */
export function useOpControl() {
  const [opId, setOpId] = React.useState<string | null>(null);
  const [blocked, setBlocked] = React.useState<LockInfo[]>([]);
  const [stopping, setStopping] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const begin = React.useCallback((prefix = "op"): OpHandle => {
    const id = newOpId(prefix);
    const controller = new AbortController();
    abortRef.current = controller;
    setOpId(id);
    setBlocked([]);
    setStopping(false);
    return { opId: id, signal: controller.signal };
  }, []);

  const end = React.useCallback(() => {
    abortRef.current = null;
    setOpId(null);
    setBlocked([]);
    setStopping(false);
  }, []);

  /** Abort the client wait and cancel the backend query. */
  const stop = React.useCallback(async () => {
    const id = opId;
    if (!id) return;
    setStopping(true);
    abortRef.current?.abort();
    try {
      await api.post(`/ops/${id}/cancel`, { confirm: true }, { skipToast: true });
    } catch {
      // Best effort: the client abort already released the UI.
    }
  }, [opId]);

  /** Terminate the backends currently blocking this operation. */
  const killBlockers = React.useCallback(async () => {
    const pids = Array.from(
      new Set(blocked.map((lock) => lock.blocking_pid).filter((pid) => pid > 0))
    );
    for (const pid of pids) {
      try {
        await api.post(
          `/queries/${pid}/terminate`,
          { confirm: true, confirm_name: String(pid) },
          { skipToast: true }
        );
      } catch {
        // Best effort per blocker.
      }
    }
    setBlocked([]);
  }, [blocked]);

  React.useEffect(() => {
    if (!opId) return;
    let active = true;
    const tick = async () => {
      try {
        const status = await api.get<OpStatus>(`/ops/${opId}`, { skipToast: true });
        if (active) setBlocked(status.blocked_by ?? []);
      } catch {
        // Status is advisory; a failure must not disturb the running op.
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [opId]);

  return {
    opId,
    running: opId !== null,
    blocked,
    stopping,
    begin,
    end,
    stop,
    killBlockers,
  };
}

export type OpControl = ReturnType<typeof useOpControl>;

/** A ready-made "Durdur" button for a running operation. */
export function OpStopButton({
  control,
  label,
  className,
}: {
  control: OpControl;
  label?: string;
  className?: string;
}) {
  const t = useT();
  if (!control.running) return null;
  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      className={className}
      onClick={() => void control.stop()}
      disabled={control.stopping}
    >
      {control.stopping ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <span className="mr-1.5 inline-block h-3 w-3 rounded-[2px] bg-current" />
      )}
      {label ?? t("op.stop")}
    </Button>
  );
}

/**
 * Warns that the running operation is blocked and offers to clear the blockers.
 * The operation itself keeps running; only the blocking backends are terminated.
 */
export function OpBlockedHint({
  control,
  className,
}: {
  control: OpControl;
  className?: string;
}) {
  const t = useT();
  const [killing, setKilling] = React.useState(false);
  if (control.blocked.length === 0) return null;
  const pids = Array.from(new Set(control.blocked.map((lock) => lock.blocking_pid)));
  const onKill = async () => {
    setKilling(true);
    try {
      await control.killBlockers();
    } finally {
      setKilling(false);
    }
  };
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 ${className ?? ""}`}
      role="alert"
    >
      <span className="flex items-center gap-1.5 text-xs text-warning">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        {t("op.blocked", { pids: pids.join(", ") })}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 border-warning/50 text-xs text-warning hover:bg-warning/15"
        onClick={() => void onKill()}
        disabled={killing}
      >
        {killing ? (
          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        ) : (
          <Zap className="mr-1.5 h-3 w-3" />
        )}
        {t("op.killBlockers")}
      </Button>
    </div>
  );
}
