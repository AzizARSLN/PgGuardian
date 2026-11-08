import type { ReactNode } from "react";

// Desktop static-export placeholder for this segment (see app/statements/[queryid]/layout.tsx).
export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function PgbadgerDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
