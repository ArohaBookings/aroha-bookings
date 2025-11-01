// next.config.ts
import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  outputFileTracingRoot: path.join(__dirname),

  // ✅ Let Server Actions run from dev + your Vercel prod domain
  experimental: {
    serverActions: {
      allowedOrigins: [
        "http://localhost:3000",
        "https://aroha-bookings.vercel.app",
      ],
    },
  },
};

export default nextConfig;
