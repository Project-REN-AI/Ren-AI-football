// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));

function runPrTitle(...args: string[]): { exitCode: number | null; output: string } {
  const result = spawnSync("bun", [CLI, ...args], { encoding: "utf8" });
  return { exitCode: result.status, output: result.stdout + result.stderr };
}

describe("pr title CLI", () => {
  it.each([
    "feat: add pr title check",
    "ci(scripts): add scripts workspace and gate verdict check",
    "fix(board-sync)!: drop legacy status column",
    "docs: bootstrap license, project docs and ADR-0001",
  ])("accepts %j", (title) => {
    const { exitCode, output } = runPrTitle(title);

    expect(exitCode).toBe(0);
    expect(output).toContain("pr title: ok");
  });

  it.each([
    ["Add pr title check", "type(scope)?: subject"],
    ["feature: add pr title check", "unknown type feature"],
    ["Feat: add pr title check", "unknown type Feat"],
    ["feat(): add pr title check", "type(scope)?: subject"],
    ["feat(Scripts): add pr title check", "type(scope)?: subject"],
    ["feat:add pr title check", "type(scope)?: subject"],
    ["feat: ", "type(scope)?: subject"],
    ["feat(-scripts): add pr title check", "type(scope)?: subject"],
    ["feat(scripts-): add pr title check", "type(scope)?: subject"],
    ["feat: add pr title check ", "type(scope)?: subject"],
    ["", "type(scope)?: subject"],
    ["feat: add pr title check.", "must not end with a period"],
  ])("rejects %j", (title, reason) => {
    const { exitCode, output } = runPrTitle(title);

    expect(exitCode).toBe(1);
    expect(output).toContain("pr title: invalid");
    expect(output).toContain(reason);
  });

  it("rejects a missing title", () => {
    const { exitCode, output } = runPrTitle();

    expect(exitCode).toBe(1);
    expect(output).toContain("pr title: invalid");
    expect(output).toContain("usage: pr-title");
  });
});
