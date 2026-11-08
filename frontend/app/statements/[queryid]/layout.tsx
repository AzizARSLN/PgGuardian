import type { ReactNode } from "react";

// The desktop build is a static export, which cannot prerender unbounded dynamic
// params. We emit a single placeholder shell for this segment; the bundled
// FastAPI sidecar serves that shell for any concrete id and the client router
// reads the real value from the URL (see useParams in ./page.tsx). The web build
// keeps server rendering and ignores the placeholder.
export function generateStaticParams() {
  return [{ queryid: "_" }];
}

export default function StatementsDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
