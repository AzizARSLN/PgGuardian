/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.platform === "win32" ? undefined : "standalone",
  async rewrites() {
    return [
      {
        source: "/api/v1/events/stream",
        destination: "http://127.0.0.1:8000/api/v1/events/stream",
      },
      {
        source: "/api/v1/:path*",
        destination: "http://127.0.0.1:8000/api/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
