// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));

function runComposeBudget(files: Readonly<Record<string, string>>): { exitCode: number | null; output: string } {
  const project = mkdtempSync(join(tmpdir(), "compose-budget-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(project, name), content);
    const result = spawnSync("bun", [CLI, project], { encoding: "utf8" });
    return { exitCode: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

describe("compose budget CLI", { timeout: 30_000 }, () => {
  it("passes when every profile fits in 10 GB, counting services without profiles in each one", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": `
services:
  postgres:
    image: postgres:18
    mem_limit: 1g
  api:
    image: scout/api
    mem_limit: 6g
    profiles: [api]
  ingest:
    image: scout/ingest
    mem_limit: 512m
    profiles: [ingest, api]
`,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("compose budget: ok");
    expect(output).toContain("(no profile): 1.00 GB of 10.00 GB");
    expect(output).toContain("api: 7.50 GB of 10.00 GB");
    expect(output).toContain("ingest: 1.50 GB of 10.00 GB");
  });

  it("passes the skeleton with no services", () => {
    const { exitCode, output } = runComposeBudget({ "compose.yaml": "name: scout\nservices: {}\n" });

    expect(exitCode).toBe(0);
    expect(output).toContain("compose budget: ok");
  });

  it("passes a profile at exactly 10 GB", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": `
services:
  model:
    image: scout/model
    mem_limit: 10GiB
    profiles: [ml]
`,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("ml: 10.00 GB of 10.00 GB");
  });

  it("fails and names the profile whose services add up to more than 10 GB", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": `
services:
  postgres:
    image: postgres:18
    mem_limit: 2g
  model:
    image: scout/model
    mem_limit: 8704m
    profiles: [ml]
  api:
    image: scout/api
    mem_limit: 1g
    profiles: [api]
`,
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("compose budget: fail");
    expect(output).toContain("profile ml: 10.50 GB exceeds 10.00 GB");
    expect(output).not.toContain("profile api:");
  });

  it("counts the override file that Compose merges on its own", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": "services:\n  postgres:\n    image: postgres:18\n    mem_limit: 1g\n",
      "compose.override.yaml": "services:\n  postgres:\n    mem_limit: 12g\n",
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("profile (no profile): 12.00 GB exceeds 10.00 GB");
  });

  it("fails and names the service that declares no mem_limit", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": `
services:
  postgres:
    image: postgres:18
    mem_limit: 1g
  redis:
    image: redis:8
    profiles: [cache]
`,
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("compose budget: fail");
    expect(output).toContain("service redis: no mem_limit");
    expect(output).not.toContain("service postgres:");
  });

  it("fails a mem_limit of zero, which Docker reads as no limit", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": 'services:\n  redis:\n    image: redis:8\n    mem_limit: "0"\n',
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("service redis: no mem_limit");
  });

  it("fails when Compose rejects the file", () => {
    const { exitCode, output } = runComposeBudget({
      "compose.yaml": "services:\n  redis:\n    image: redis:8\n    mem_limit: lots\n",
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("compose budget: fail");
    expect(output).toContain("docker compose config");
  });
});
