// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));

function runGateVerdict(needs: string): { exitCode: number | null; output: string } {
  const result = spawnSync("bun", [CLI, needs], { encoding: "utf8" });
  return { exitCode: result.status, output: result.stdout + result.stderr };
}

describe("gate verdict CLI", () => {
  it("is green when every job succeeded", () => {
    const { exitCode, output } = runGateVerdict(
      JSON.stringify({ scripts: { result: "success", outputs: {} }, lint: { result: "success", outputs: {} } }),
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("gate: green");
  });

  it("is green when a job was skipped as not affected", () => {
    const { exitCode, output } = runGateVerdict(
      JSON.stringify({ scripts: { result: "success", outputs: {} }, web: { result: "skipped", outputs: {} } }),
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("gate: green");
  });

  it("is red and names the culprit when a job failed", () => {
    const { exitCode, output } = runGateVerdict(
      JSON.stringify({ scripts: { result: "failure", outputs: {} }, web: { result: "success", outputs: {} } }),
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("gate: red");
    expect(output).toContain("scripts: failure");
    expect(output).not.toContain("web:");
  });

  it("is red and names the culprit when a job was cancelled", () => {
    const { exitCode, output } = runGateVerdict(
      JSON.stringify({ scripts: { result: "success", outputs: {} }, web: { result: "cancelled", outputs: {} } }),
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("gate: red");
    expect(output).toContain("web: cancelled");
    expect(output).not.toContain("scripts:");
  });

  it("is red when there is no job to judge", () => {
    const { exitCode, output } = runGateVerdict("{}");

    expect(exitCode).toBe(1);
    expect(output).toContain("gate: red");
    expect(output).toContain("no jobs to judge");
  });

  it("is red when the job results are not a JSON object of results", () => {
    const { exitCode, output } = runGateVerdict('{"scripts": "success"}');

    expect(exitCode).toBe(1);
    expect(output).toContain("gate: red");
  });
});
