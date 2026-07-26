import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silences a workspace-root warning: the repo root (one level up) has its
  // own package-lock.json for dev/test tooling unrelated to this app.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
