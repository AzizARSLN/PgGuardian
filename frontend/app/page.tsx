import { redirect } from "next/navigation";

import RootRedirect from "./root-redirect";

// Static exports (desktop build) cannot redirect on the server, so the landing
// shell redirects to the dashboard on the client instead.
const DESKTOP_BUILD = process.env.PGGUARDIAN_DESKTOP === "1";

export default function RootPage() {
  if (DESKTOP_BUILD) {
    return <RootRedirect to="/dashboard" />;
  }
  redirect("/dashboard");
}
