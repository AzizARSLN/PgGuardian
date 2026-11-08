const apiUrl = process.env.PGGUARDIAN_API_URL || "http://127.0.0.1:8000";

// The desktop build ships as static files. The bundled FastAPI sidecar serves
// them on 127.0.0.1 together with /api/v1, so the UI and the API share one
// origin: no server rewrites are needed and the refresh cookie keeps working.
// The web build keeps the Node server (standalone) and the rewrites below.
const isDesktop = process.env.PGGUARDIAN_DESKTOP === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isDesktop ? "export" : process.platform === "win32" ? undefined : "standalone",
  trailingSlash: isDesktop,
  ...(isDesktop
    ? { images: { unoptimized: true } }
    : {
        async rewrites() {
          return [
            {
              source: "/api/v1/events/stream",
              destination: `${apiUrl}/api/v1/events/stream`,
            },
            {
              source: "/api/v1/:path*",
              destination: `${apiUrl}/api/v1/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
