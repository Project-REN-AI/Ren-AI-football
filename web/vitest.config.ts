// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    isolate: false,
    maxWorkers: 4,
  },
});
