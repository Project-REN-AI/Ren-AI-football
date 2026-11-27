// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
};

export default nextConfig;
