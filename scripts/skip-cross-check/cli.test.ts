// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryIssueTracker } from "../failure-reporter/in-memory-issue-tracker";
import { runSkipCrossCheck } from "./cli";

interface FailureFixture {
  service: string;
  check: string;
  kind: string;
}

let repo: string;

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  const absolute = join(repo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function commit(message: string): string {
  git("add", "--all");
  git("commit", "--quiet", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
}

let runResults = 0;

function runResult(...failures: FailureFixture[]): string {
  runResults += 1;
  const path = join(repo, `run-result-${runResults}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      layer: "C4",
      sha: "4d375a5f0c9e2b7a1d3e5f7a9b1c3d5e7f9a1b3c",
      runUrl: "https://github.com/Project-REN-AI/Ren-AI-football/actions/runs/42",
      failures: failures.map((failure) => ({ seed: "1337", reproduce: "exit 1", ...failure })),
    }),
  );
  return path;
}

function failure(service: string, check = "unit", kind = "test"): FailureFixture {
  return { service, check, kind };
}

async function crossCheck(argv: string[], tracker = new InMemoryIssueTracker()) {
  const result = await runSkipCrossCheck(argv, { issueTracker: tracker, cwd: repo });
  return { ...result, tracker };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "skip-cross-check-"));
  git("init", "--quiet", "--initial-branch=develop");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "fixture");
  git("config", "commit.gpgsign", "false");
  write("package.json", "{}\n");
  write("services/catalog/service.json", JSON.stringify({ language: "java", dependsOn: [] }));
  write("services/catalog/src/Main.java", "class Main {}\n");
  write("services/scouting/service.json", JSON.stringify({ language: "python", dependsOn: [] }));
  write("services/scouting/app.py", "x = 1\n");
  write("web/service.json", JSON.stringify({ language: "typescript", dependsOn: [] }));
  write("web/app.ts", "export {};\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("skip cross-check CLI", () => {
  it("opens a detection bug issue when a service outside the affected services failed", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    const { exitCode, output, tracker } = await crossCheck([
      "--base",
      base,
      "--target",
      target,
      runResult(failure("catalog", "unit"), failure("catalog", "architecture", "architecture")),
    ]);

    expect(exitCode).toBe(0);
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]?.title).toBe("ci: detecção de Serviços Afetados pulou catalog");
    expect(tracker.issues[0]?.labels).toEqual(["ci-bot", "bug", "needs-triage"]);
    expect(tracker.issues[0]?.body).toContain("`catalog`");
    expect(tracker.issues[0]?.body).toContain("`unit`");
    expect(tracker.issues[0]?.body).toContain("`architecture`");
    expect(tracker.issues[0]?.body).toContain(`${base}...${target}`);
    expect(tracker.issues[0]?.body).toContain("scouting");
    expect(output).toContain("skipped catalog: opened #1");
  });

  it("files nothing when every failed service was affected", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    const { exitCode, output, tracker } = await crossCheck([
      "--base",
      base,
      "--target",
      target,
      runResult(failure("scouting")),
    ]);

    expect(exitCode).toBe(0);
    expect(tracker.issues).toEqual([]);
    expect(output).toBe("skip cross-check: no failure outside the affected services");
  });

  it("files nothing when a root change made every service affected", async () => {
    const base = commit("base");
    write("package.json", '{"name":"scout"}\n');
    const target = commit("change the root");

    const { tracker } = await crossCheck(["--base", base, "--target", target, runResult(failure("catalog"))]);

    expect(tracker.issues).toEqual([]);
  });

  it("ignores infrastructure failures and targets that are not services", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    const { tracker } = await crossCheck([
      "--base",
      base,
      "--target",
      target,
      runResult(failure("catalog", "unit", "infrastructure"), failure("repository", "gitleaks", "secret")),
      runResult(failure("scripts", "unit")),
    ]);

    expect(tracker.issues).toEqual([]);
  });

  it("files nothing when no commit landed between base and target", async () => {
    const target = commit("base");

    const { exitCode, output, tracker } = await crossCheck([
      "--base",
      target,
      "--target",
      target,
      runResult(failure("catalog")),
    ]);

    expect(exitCode).toBe(0);
    expect(tracker.issues).toEqual([]);
    expect(output).toBe("skip cross-check: no commits between base and target");
  });

  it("gathers failures of the same service from several run results into one issue", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    const { output, tracker } = await crossCheck([
      "--base",
      base,
      "--target",
      target,
      runResult(failure("web", "lint", "static")),
      runResult(failure("web", "unit"), failure("catalog", "unit")),
    ]);

    expect(tracker.issues.map(({ title }) => title)).toEqual([
      "ci: detecção de Serviços Afetados pulou catalog",
      "ci: detecção de Serviços Afetados pulou web",
    ]);
    expect(tracker.issues[1]?.body).toContain("`lint`");
    expect(tracker.issues[1]?.body).toContain("`unit`");
    expect(output).toBe("skipped catalog: opened #1\nskipped web: opened #2");
  });

  it("comments on the open detection bug of the same service instead of opening another", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");
    const tracker = new InMemoryIssueTracker();
    await crossCheck(["--base", base, "--target", target, runResult(failure("catalog"))], tracker);

    const { output } = await crossCheck(
      ["--base", base, "--target", target, runResult(failure("catalog", "lint", "static"))],
      tracker,
    );

    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]?.comments).toHaveLength(1);
    expect(tracker.issues[0]?.comments[0]).toContain("`lint`");
    expect(output).toBe("skipped catalog: commented on #1");
  });

  it("opens a new issue citing the closed one when the detection bug comes back", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");
    const tracker = new InMemoryIssueTracker();
    await crossCheck(["--base", base, "--target", target, runResult(failure("catalog"))], tracker);
    tracker.close(1);

    const { output } = await crossCheck(["--base", base, "--target", target, runResult(failure("catalog"))], tracker);

    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[1]?.body).toContain("#1");
    expect(output).toBe("skipped catalog: opened #2");
  });

  it("does not mistake a failure issue of the same service for its detection bug", async () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");
    const tracker = new InMemoryIssueTracker();
    await tracker.createIssue({
      title: "ci: catalog unit falhou",
      body: "<!-- scout-ci-bot:failure-signature 0123456789abcdef -->",
      labels: [],
    });

    await crossCheck(["--base", base, "--target", target, runResult(failure("catalog"))], tracker);

    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[0]?.comments).toEqual([]);
  });

  it("exits 1 with usage and files nothing when an argument is missing", async () => {
    const target = commit("base");

    const { exitCode, output, tracker } = await crossCheck(["--target", target, runResult(failure("catalog"))]);

    expect(exitCode).toBe(1);
    expect(output).toContain("usage: skip-cross-check");
    expect(tracker.issues).toEqual([]);
  });

  it("exits 1 naming the field when a run result is malformed", async () => {
    const base = commit("base");
    const path = join(repo, "broken.json");
    writeFileSync(path, JSON.stringify({ layer: "C4", sha: "abc", failures: [] }));

    const { exitCode, output } = await crossCheck(["--base", base, "--target", base, path]);

    expect(exitCode).toBe(1);
    expect(output).toContain("runUrl");
  });

  it("exits 1 when a ref does not exist", async () => {
    const base = commit("base");

    const { exitCode, output } = await crossCheck(["--base", base, "--target", "nope", runResult(failure("catalog"))]);

    expect(exitCode).toBe(1);
    expect(output).toContain("skip-cross-check:");
  });
});
