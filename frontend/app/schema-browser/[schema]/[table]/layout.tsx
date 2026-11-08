import type { ReactNode } from "react";

// Desktop static-export placeholder for this two-level segment
// (see app/statements/[queryid]/layout.tsx).
export function generateStaticParams() {
  return [{ schema: "_", table: "_" }];
}

export default function SchemaTableLayout({ children }: { children: ReactNode }) {
  return children;
}
