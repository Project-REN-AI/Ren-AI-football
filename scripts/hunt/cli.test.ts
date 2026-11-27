// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHunt } from "./cli";

const SHA = "4d375a5f0c9e2b7a1d3e5f7a9b1c3d5e7f9a1b3c";
const RUN_URL = "https://github.com/Project-REN-AI/Ren-AI-football/actions/runs/42";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "hunt-"));
}

function seeds(...values: string[]): () => string {
  const queue = [...values];
  return () => {
    const seed = queue.shift();
    if (seed === undefined) throw new Error("no seed left");
    return seed;
  };
}

function huntArgs(result: string, options: readonly string[], command: string): string[] {
  return [
    "--result",
    result,
    "--layer",
    "C3",
    "--sha",
    SHA,
    "--run-url",
    RUN_URL,
    "--service",
    "go-example",
    "--check",
    "unit-race",
    "--kind",
    "test",
    ...options,
    "--",
    command,
  ];
}

function readResult(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("hunt CLI", () => {
  it("runs the check once per repetition with a fresh seed and records no failure when every run passes", async () => {
    const dir = workspace();
    const result = join(dir, "run-result.json");
    const runs = join(dir, "runs.log");

    const { exitCode, output } = await runHunt(
      huntArgs(result, ["--repeat", "3"], `echo "seed=$SCOUT_TEST_SEED" >> ${runs}`),
      { nextSeed: seeds("11", "22", "33") },
    );

    expect(exitCode).toBe(0);
    expect(readFileSync(runs, "utf8")).toBe("seed=11\nseed=22\nseed=33\n");
    expect(readResult(result)).toEqual({ layer: "C3", sha: SHA, runUrl: RUN_URL, failures: [] });
    expect(output).toContain("go-example unit-race: passed 3 runs");
  });

  it("stops at the first failing run and records it with its seed and the command that reproduces it", async () => {
    const dir = workspace();
    const result = join(dir, "run-result.json");
    const command = `echo x >> ${join(dir, "runs.log")}; [ "$SCOUT_TEST_SEED" != 22 ]`;

    const { exitCode, output } = await runHunt(huntArgs(result, ["--repeat", "3"], command), {
      nextSeed: seeds("11", "22", "33"),
    });

    expect(exitCode).toBe(0);
    expect(readFileSync(join(dir, "runs.log"), "utf8")).toBe("x\nx\n");
    expect(readResult(result)).toEqual({
      layer: "C3",
      sha: SHA,
      runUrl: RUN_URL,
      failures: [
        { service: "go-example", check: "unit-race", kind: "test", seed: "22", reproduce: command, failsOn: [1] },
      ],
    });
    expect(output).toContain("go-example unit-race: test failure on run 2 of 3, seed 22");
  });

  it("records an exit code outside --fails-on as an infrastructure failure", async () => {
    const dir = workspace();
    const result = join(dir, "run-result.json");

    const { exitCode, output } = await runHunt(huntArgs(result, [], "exit 2"), { nextSeed: seeds("11") });

    expect(exitCode).toBe(0);
    expect(readResult(result)).toMatchObject({
      failures: [
        { service: "go-example", check: "unit-race", kind: "infrastructure", seed: "11", reproduce: "exit 2" },
      ],
    });
    expect(output).toContain("go-example unit-race: infrastructure failure on run 1 of 1, seed 11 (exit 2)");
  });

  it("treats every exit code listed in --fails-on as a finding of the check's kind", async () => {
    const dir = workspace();
    const result = join(dir, "run-result.json");

    await runHunt(huntArgs(result, ["--fails-on", "1,3"], "exit 3"), { nextSeed: seeds("11") });

    expect(readResult(result)).toMatchObject({ failures: [{ kind: "test", reproduce: "exit 3", failsOn: [1, 3] }] });
  });

  it("appends to the run result that an earlier check of the same run already wrote", async () => {
    const dir = workspace();
    const result = join(dir, "run-result.json");
    await runHunt(huntArgs(result, [], "exit 1"), { nextSeed: seeds("11") });

    await runHunt(
      [
        "--result",
        result,
        "--layer",
        "C3",
        "--sha",
        SHA,
        "--run-url",
        RUN_URL,
        "--service",
        "repository",
        "--check",
        "osv-scanner",
        "--kind",
        "vulnerability",
        "--",
        "exit 1",
      ],
      { nextSeed: seeds("44") },
    );

    expect(readResult(result)).toMatchObject({
      failures: [
        { service: "go-example", check: "unit-race", seed: "11" },
        { service: "repository", check: "osv-scanner", kind: "vulnerability", seed: "44" },
      ],
    });
  });

  it("exits 1 with usage when a required option or the command is missing", async () => {
    const { exitCode, output } = await runHunt(["--result", "x.json", "--", "true"], { nextSeed: seeds() });

    expect(exitCode).toBe(1);
    expect(output).toContain("usage: hunt");
    expect(output).toContain("--layer");
  });

  it("exits 1 when --kind names the infrastructure kind, which only an unexpected exit code may assign", async () => {
    const args = huntArgs("x.json", [], "true");
    args[args.indexOf("--kind") + 1] = "infrastructure";

    const { exitCode, output } = await runHunt(args, { nextSeed: seeds() });

    expect(exitCode).toBe(1);
    expect(output).toContain("--kind must not be infrastructure");
  });

  it("exits 1 without running the check when the existing run result is malformed", async () => {
    const dir = workspace();
    const result = join(dir, "run-result.json");
    writeFileSync(result, JSON.stringify({ layer: "C3", failures: [] }));

    const { exitCode, output } = await runHunt(huntArgs(result, [], `touch ${join(dir, "ran")}`), {
      nextSeed: seeds("11"),
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("sha must be a non-empty string");
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });

  it("exits 1 when --repeat is not a positive integer", async () => {
    const { exitCode, output } = await runHunt(huntArgs("x.json", ["--repeat", "0"], "true"), { nextSeed: seeds() });

    expect(exitCode).toBe(1);
    expect(output).toContain("--repeat must be a positive integer");
  });
});
