"use client";

import * as React from "react";
import CodeMirror, { EditorView, Prec, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { openSearchPanel } from "@codemirror/search";
import { useTheme } from "next-themes";
import { Check, Code2, Copy, Download, Maximize2, Search } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function ViewerButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * A read-only SQL viewer: line numbers, syntax colours, search, copy, download
 * and a full-screen view. Used for the real-value statements from pgBadger.
 */
export function SqlViewer({
  value,
  label,
  filename,
  className,
  height = "11rem",
}: {
  value: string;
  label: string;
  filename?: string;
  className?: string;
  height?: string;
}) {
  const t = useT();
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const inlineRef = React.useRef<ReactCodeMirrorRef>(null);
  const dialogRef = React.useRef<ReactCodeMirrorRef>(null);

  const extensions = React.useMemo(
    () => [
      sql(),
      EditorView.lineWrapping,
      Prec.highest(
        EditorView.theme({
          "&": { backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))" },
          ".cm-gutters": {
            backgroundColor: "hsl(var(--muted))",
            color: "hsl(var(--muted-foreground))",
            borderColor: "hsl(var(--border))",
          },
          ".cm-content": { fontFamily: "var(--font-mono, ui-monospace), monospace" },
        })
      ),
    ],
    []
  );

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([value], { type: "application/sql" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(filename || "query").replace(/[^\w.-]+/g, "_")}.sql`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openSearch = (ref: React.RefObject<ReactCodeMirrorRef | null>) => {
    const view = ref.current?.view;
    if (view) openSearchPanel(view);
  };

  const actions = (ref: React.RefObject<ReactCodeMirrorRef | null>, allowFullscreen: boolean) => (
    <>
      <ViewerButton label={t("pgbadger.viewer.search")} onClick={() => openSearch(ref)}>
        <Search className="h-3.5 w-3.5" />
      </ViewerButton>
      <ViewerButton label={t(copied ? "common.copied" : "common.copy")} onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </ViewerButton>
      <ViewerButton label={t("pgbadger.viewer.download")} onClick={download}>
        <Download className="h-3.5 w-3.5" />
      </ViewerButton>
      {allowFullscreen && (
        <ViewerButton label={t("pgbadger.viewer.fullscreen")} onClick={() => setFullscreen(true)}>
          <Maximize2 className="h-3.5 w-3.5" />
        </ViewerButton>
      )}
    </>
  );

  const editorProps = {
    value,
    editable: false,
    theme: resolvedTheme === "dark" ? ("dark" as const) : ("light" as const),
    extensions,
    basicSetup: {
      lineNumbers: true,
      foldGutter: true,
      highlightActiveLine: false,
      highlightActiveLineGutter: false,
      searchKeymap: true,
      highlightSelectionMatches: true,
    },
  };

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Code2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5">{actions(inlineRef, true)}</div>
      </div>
      <CodeMirror ref={inlineRef} height={height} {...editorProps} />
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[92vh] max-w-[95vw] flex-col gap-2 p-3 sm:rounded-lg">
          <div className="flex items-center justify-between gap-2 pr-7">
            <DialogTitle className="truncate font-mono text-sm font-semibold">{label}</DialogTitle>
            <div className="flex shrink-0 items-center gap-0.5">{actions(dialogRef, false)}</div>
          </div>
          <DialogDescription className="sr-only">{t("pgbadger.viewer.fullscreen")}</DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <CodeMirror ref={dialogRef} height="100%" {...editorProps} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
