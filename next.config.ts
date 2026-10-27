import type { NextConfig } from "next";

// موقع ثابت بالكامل (Static Export) حتى يُنشر على GitHub Pages بدون خادم.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
