"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function CodeBlock({
  code,
  className,
  label,
}: {
  code: string;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-muted/50", className)}>
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={t("common.copy")}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {t(copied ? "common.copied" : "common.copy")}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
