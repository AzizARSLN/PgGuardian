// Builds the static frontend bundle for the pgGuardian desktop (Tauri) shell.
//
// The web build relies on server-only Next.js features that `output: "export"`
// cannot produce: `middleware.ts` (route protection) and the `app/api` route
// handler (the login/logout/refresh proxy). The desktop shell serves the very
// same pages straight from the bundled FastAPI sidecar — one origin for the UI
// and /api/v1 — and restores the session client-side (see app/providers.tsx).
// Those entry points are therefore renamed aside for the duration of the build
// and renamed back afterwards, even if the build fails.
//
// Usage:  npm run build:desktop        (from ./frontend)
// Output: ./frontend/out

import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Server-only entry points that must not be present in a static export.
const SERVER_ONLY = ["middleware.ts", "app/api/auth/route.ts"];
const SUFFIX = ".desktop-off";

function toggle(stash) {
  for (const rel of SERVER_ONLY) {
    const src = path.join(frontendDir, rel);
    const off = `${src}${SUFFIX}`;
    if (stash) {
      if (existsSync(src)) renameSync(src, off);
    } else if (existsSync(off)) {
      renameSync(off, src);
    }
  }
}

toggle(true);
try {
  execFileSync("npm", ["run", "build"], {
    cwd: frontendDir,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PGGUARDIAN_DESKTOP: "1",
      // Inlined at build time; drives the auth endpoints and export settings.
      NEXT_PUBLIC_PGGUARDIAN_DESKTOP: "1",
    },
  });
} finally {
  toggle(false);
}
