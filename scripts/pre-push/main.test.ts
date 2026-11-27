// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));
const ZERO = "0000000000000000000000000000000000000000";

const WORKFLOW = `name: ci
on: pull_request
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions: {}
    steps:
      - run: "true"
`;

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

function stubScripts(prefix: string, overrides: Record<string, string> = {}): string {
  const scripts = Object.fromEntries(
    ["format:check", "typecheck", "lint", "test"].map((name) => [name, `echo ran ${prefix} ${name}`]),
  );
  return `${JSON.stringify({ name: prefix, private: true, scripts: { ...scripts, ...overrides } })}\n`;
}

function prePush(stdin: string, ...args: string[]): { exitCode: number | null; output: string } {
  const env = { ...process.env, PATH: `${join(repo, ".fake-bin")}:${process.env["PATH"] ?? ""}` };
  const result = spawnSync("bun", [CLI, ...args], { cwd: repo, encoding: "utf8", input: stdin, env });
  return { exitCode: result.status, output: result.stdout + result.stderr };
}

function pushLine(target: string): string {
  return `refs/heads/feat/x ${target} refs/heads/feat/x ${ZERO}\n`;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pre-push-"));
  git("init", "--quiet", "--initial-branch=develop");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "fixture");
  git("config", "commit.gpgsign", "false");
  write(".git/info/exclude", ".fake-bin/\n");
  write(".fake-bin/uv", '#!/bin/sh\necho "ran uv $*"\n');
  chmodSync(join(repo, ".fake-bin/uv"), 0o755);
  write("package.json", "{}\n");
  write("compose.yaml", "services: {}\n");
  write(".github/workflows/ci.yml", WORKFLOW);
  write("scripts/package.json", stubScripts("scripts"));
  write("web/service.json", JSON.stringify({ language: "typescript", dependsOn: [] }));
  write("web/package.json", stubScripts("web"));
  write("web/app.ts", "export const x = 1;\n");
  write("services/scouting/service.json", JSON.stringify({ language: "python", dependsOn: [] }));
  write("services/scouting/app.py", "x = 1\n");
  write("services/matching/service.json", JSON.stringify({ language: "go", dependsOn: [] }));
  write("services/matching/main.go", "package main\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("pre-push CLI", () => {
  it("runs the scripts workspace and every C1 check of the affected TypeScript service", () => {
    const base = commit("base");
    write("web/app.ts", "export const x = 2;\n");
    const target = commit("change web");

    const { exitCode, output } = prePush(pushLine(target), "--base", base);

    expect(output).toContain("ran scripts format:check");
    expect(output).toContain("ran scripts test");
    expect(output).toContain("workflow policy: ok");
    expect(output).toContain("compose budget: ok");
    for (const check of ["format:check", "typecheck", "lint", "test"]) expect(output).toContain(`ran web ${check}`);
    expect(output).toContain("affected services: web");
    expect(output).not.toContain("scouting");
    expect(exitCode).toBe(0);
  });

  it("fails and names the command when an affected service check fails", () => {
    const base = commit("base");
    write("web/package.json", stubScripts("web", { lint: "echo ran web lint && exit 1" }));
    const target = commit("break web lint");

    const { exitCode, output } = prePush(pushLine(target), "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("pre-push failed: bun run --cwd web lint");
    expect(output).not.toContain("pre-push failed: bun run --cwd web test");
  });

  it("runs the C1 checks of an affected Python service through uv, as CI does", () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    const { exitCode, output } = prePush(pushLine(target), "--base", base);

    for (const command of ["ruff format --check .", "ruff check .", "mypy src tests", "pytest"]) {
      expect(output).toContain(`ran uv --directory services/scouting run --locked ${command}`);
    }
    expect(output).not.toContain("lint-imports");
    expect(output).not.toContain("ran web");
    expect(exitCode).toBe(0);
  });

  it("fails like CI for an affected service whose language has no CI path yet", () => {
    const base = commit("base");
    write("services/matching/main.go", "package main\n\nfunc main() {}\n");
    const target = commit("change matching");

    const { exitCode, output } = prePush(pushLine(target), "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("no CI path for go services yet");
    expect(output).not.toContain("ran web");
  });

  it("checks a push of HEAD, which git reports without a local branch ref", () => {
    const base = commit("base");
    write("web/app.ts", "export const x = 2;\n");
    const target = commit("change web");

    const { output } = prePush(`HEAD ${target} refs/heads/feat/x ${ZERO}\n`, "--base", base);

    expect(output).toContain("ran web test");
  });

  it("checks every service when the monorepo root changed", () => {
    const base = commit("base");
    write("package.json", '{ "name": "root" }\n');
    const target = commit("change root");

    const { exitCode, output } = prePush(pushLine(target), "--base", base);

    expect(output).toContain("affected services: matching, scouting, web");
    expect(output).toContain("ran web test");
    expect(output).toContain("ran uv --directory services/scouting run --locked pytest");
    expect(output).toContain("no CI path for go services yet");
    expect(exitCode).toBe(1);
  });

  it("runs check-comments on the lines the push adds", () => {
    const base = commit("base");
    write("web/app.ts", "// narrating the code\nexport const x = 2;\n");
    const target = commit("add a banned comment");

    const { exitCode, output } = prePush(pushLine(target), "--base", base);

    expect(exitCode).toBe(1);
    expect(output).toContain("web/app.ts:1");
    expect(output).toMatch(/pre-push failed: bun \S+check-comments\/main\.ts --base/);
  });

  it("does nothing when the push only deletes a branch", () => {
    commit("base");

    const { exitCode, output } = prePush(`(delete) ${ZERO} refs/heads/feat/x ${git("rev-parse", "HEAD")}\n`);

    expect(output).not.toContain("ran ");
    expect(exitCode).toBe(0);
  });

  it("does nothing when git sends no refs", () => {
    commit("base");

    const { exitCode, output } = prePush("");

    expect(output).not.toContain("ran ");
    expect(exitCode).toBe(0);
  });
  it("diffs against develop on the remote git pushes to when no base is given", () => {
    const base = commit("base");
    git("update-ref", "refs/remotes/upstream/develop", base);
    write("web/app.ts", "export const x = 2;\n");
    const target = commit("change web");

    const { exitCode, output } = prePush(pushLine(target), "upstream", "git@example.com:scout.git");

    expect(output).toContain("affected services: web");
    expect(exitCode).toBe(0);
  });

  it("runs the target-independent checks once when several branches are pushed", () => {
    const base = commit("base");
    write("web/app.ts", "export const x = 2;\n");
    const first = commit("change web");
    write("web/app.ts", "export const x = 3;\n");
    const second = commit("change web again");

    const { exitCode, output } = prePush(pushLine(first) + pushLine(second), "--base", base);

    expect(output.match(/^ran scripts test$/gm)).toHaveLength(1);
    expect(output.match(/^ran web test$/gm)).toHaveLength(1);
    expect(exitCode).toBe(0);
  });

  it("ignores pushed tags", () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    const { exitCode, output } = prePush(`refs/tags/v0.1.0 ${target} refs/tags/v0.1.0 ${ZERO}\n`, "--base", base);

    expect(output).not.toContain("ran ");
    expect(exitCode).toBe(0);
  });

  it("rejects unknown arguments", () => {
    commit("base");

    const { exitCode, output } = prePush("", "--bse", "develop");

    expect(output).toContain("usage: pre-push");
    expect(exitCode).toBe(1);
  });
});
