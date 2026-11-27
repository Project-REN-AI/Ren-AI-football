// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    isolate: false,
    maxWorkers: 4,
  },
});
