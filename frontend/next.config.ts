import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build to plain static files (out/) that the Django backend serves
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
