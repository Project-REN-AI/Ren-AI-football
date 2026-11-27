// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../..", import.meta.url));

function mirrorOfRepository(planted: Record<string, string>): string {
  const mirror = mkdtempSync(join(tmpdir(), "knip-"));
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repository,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(repository, file)));
  for (const file of files) {
    mkdirSync(dirname(join(mirror, file)), { recursive: true });
    cpSync(join(repository, file), join(mirror, file));
  }
  for (const workspace of [".", "scripts", "web"]) {
    symlinkSync(join(repository, workspace, "node_modules"), join(mirror, workspace, "node_modules"));
  }
  for (const [file, source] of Object.entries(planted)) {
    mkdirSync(dirname(join(mirror, file)), { recursive: true });
    writeFileSync(join(mirror, file), source);
  }
  return mirror;
}

function knip(root: string): { status: number | null; output: string } {
  const run = spawnSync("bun", ["run", "knip"], { cwd: root, encoding: "utf8" });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe("knip script", () => {
  it("passes the Bun workspaces as they are", () => {
    expect(knip(mirrorOfRepository({})).status).toBe(0);
  }, 60_000);

  it("fails on a file no workspace imports", () => {
    const result = knip(mirrorOfRepository({ "web/src/domain/orphan.ts": "export const orphan = 1;\n" }));

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("web/src/domain/orphan.ts");
  }, 60_000);

  it("fails on an export nothing uses", () => {
    const result = knip(
      mirrorOfRepository({
        "scripts/pr-title/limits.ts": "export const maxLength = 72;\nexport const minLength = 10;\n",
        "scripts/pr-title/limits.test.ts":
          'import { expect, it } from "vitest";\nimport { maxLength } from "./limits";\n\nit("caps", () => expect(maxLength).toBe(72));\n',
      }),
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("minLength");
  }, 60_000);
});
