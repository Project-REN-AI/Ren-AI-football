// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));

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

function runAffectedServices(...args: string[]): { exitCode: number | null; stdout: string; output: string } {
  const result = spawnSync("bun", [CLI, ...args], { cwd: repo, encoding: "utf8" });
  return { exitCode: result.status, stdout: result.stdout, output: result.stdout + result.stderr };
}

function affectedNames(base: string, target: string): string[] {
  const { exitCode, stdout, output } = runAffectedServices("--json", base, target);
  if (exitCode !== 0) throw new Error(`affected-services failed: ${output}`);
  const parsed = JSON.parse(stdout) as { services: { name: string }[] };
  return parsed.services.map(({ name }) => name);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "affected-services-"));
  git("init", "--quiet", "--initial-branch=develop");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "fixture");
  git("config", "commit.gpgsign", "false");
  write("package.json", "{}\n");
  write("services/catalog/service.json", JSON.stringify({ language: "java", dependsOn: ["contracts/catalog"] }));
  write("services/catalog/src/Main.java", "class Main {}\n");
  write("services/scouting/service.json", JSON.stringify({ language: "python", dependsOn: [] }));
  write("services/scouting/app.py", "x = 1\n");
  write("web/service.json", JSON.stringify({ language: "typescript", dependsOn: ["contracts/catalog/"] }));
  write("web/app.ts", "export {};\n");
  write("contracts/catalog/openapi.yaml", "openapi: 3.1.0\n");
  write("contracts/ingestion/openapi.yaml", "openapi: 3.1.0\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("affected services CLI", () => {
  it("marks only the service whose directory changed", () => {
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    const target = commit("change scouting");

    expect(affectedNames(base, target)).toEqual(["scouting"]);
  });

  it("marks every service that declares the changed path as a dependency", () => {
    const base = commit("base");
    write("contracts/catalog/openapi.yaml", "openapi: 3.1.1\n");
    const target = commit("change catalog contract");

    expect(affectedNames(base, target)).toEqual(["catalog", "web"]);
  });

  it("marks every service when an undeclared path next to a declared dependency changes", () => {
    write("contracts/catalog-v2/openapi.yaml", "openapi: 3.1.0\n");
    const base = commit("base");
    write("services/scouting/app.py", "x = 2\n");
    write("contracts/catalog-v2/openapi.yaml", "openapi: 3.1.1\n");
    const target = commit("change scouting and an undeclared contract");

    const { exitCode, stdout } = runAffectedServices("--json", base, target);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ all: true });
  });

  it.each([
    [".github/workflows/ci.yml", "name: ci\n"],
    ["bun.lock", "{}\n"],
    ["bunfig.toml", "[fmt]\n"],
    ["scripts/gate-verdict/main.ts", "export {};\n"],
  ])("marks every service when %s at the monorepo root changes", (path, content) => {
    const base = commit("base");
    write(path, content);
    const target = commit("change the root");

    const { exitCode, stdout, output } = runAffectedServices(base, target);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("all");
    expect(output).toContain("catalog, scouting, web");
    expect(affectedNames(base, target)).toEqual(["catalog", "scouting", "web"]);
  });

  it("marks both services when a file is renamed from one into the other", () => {
    const base = commit("base");
    git("mv", "services/scouting/app.py", "services/catalog/app.py");
    const target = commit("move a file across services");

    expect(affectedNames(base, target)).toEqual(["catalog", "scouting"]);
  });

  it("marks the service whose file was deleted", () => {
    const base = commit("base");
    git("rm", "--quiet", "services/catalog/src/Main.java");
    const target = commit("delete a file");

    expect(affectedNames(base, target)).toEqual(["catalog"]);
  });

  it("marks no service on an empty diff", () => {
    const base = commit("base");
    const target = commit("empty");

    const { exitCode, stdout } = runAffectedServices("--json", base, target);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ all: false, services: [] });
    expect(runAffectedServices(base, target).stdout).toContain("none");
  });

  it("diffs from the merge base, ignoring what landed on the base branch meanwhile", () => {
    const fork = commit("base");
    git("switch", "--quiet", "-c", "feature");
    write("web/app.ts", "export const changed = true;\n");
    const target = commit("change web");
    git("switch", "--quiet", "develop");
    write("services/scouting/app.py", "x = 3\n");
    const base = commit("develop moved on");

    expect(fork).not.toBe(base);
    expect(affectedNames(base, target)).toEqual(["web"]);
  });

  it("reports each affected service with its path and language for the job matrix", () => {
    const base = commit("base");
    write("web/app.ts", "export const changed = true;\n");
    write("services/catalog/src/Main.java", "class Main { }\n");
    const target = commit("change web and catalog");

    const { stdout } = runAffectedServices("--json", base, target);

    expect(JSON.parse(stdout)).toEqual({
      all: false,
      services: [
        { name: "catalog", path: "services/catalog", language: "java" },
        { name: "web", path: "web", language: "typescript" },
      ],
    });
  });

  it("fails when a service has no manifest", () => {
    write("services/orphan/main.go", "package main\n");
    const base = commit("base");
    write("services/orphan/main.go", "package main\n\nfunc main() {}\n");
    const target = commit("change orphan");

    const { exitCode, output } = runAffectedServices(base, target);

    expect(exitCode).toBe(1);
    expect(output).toContain("services/orphan has no service.json");
  });

  it.each([
    ["an unknown language", { language: "cobol", dependsOn: [] }, "language must be one of"],
    ["a dependency outside the repo", { language: "go", dependsOn: ["../elsewhere"] }, "relative to the repo root"],
    ["dependencies that are not a list", { language: "go", dependsOn: "contracts" }, "dependsOn must be an array"],
  ])("fails when a manifest declares %s", (_case, manifest, message) => {
    write("services/ingestion/service.json", JSON.stringify(manifest));
    const base = commit("base");
    const target = commit("empty");

    const { exitCode, output } = runAffectedServices(base, target);

    expect(exitCode).toBe(1);
    expect(output).toContain(message);
  });

  it("marks every service when a whole service is deleted", () => {
    const base = commit("base");
    git("rm", "--quiet", "-r", "services/scouting");
    const target = commit("delete scouting");

    expect(affectedNames(base, target)).toEqual(["catalog", "web"]);
  });

  it("names the manifest that is not valid JSON", () => {
    write("services/ingestion/service.json", "{ language: go");
    const base = commit("base");
    const target = commit("empty");

    const { exitCode, output } = runAffectedServices(base, target);

    expect(exitCode).toBe(1);
    expect(output).toContain("services/ingestion/service.json is not valid JSON");
  });

  it("lists every service of the target with --all, for jobs that cover the whole monorepo", () => {
    const target = commit("base");

    const { exitCode, stdout } = runAffectedServices("--json", "--all", target);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      all: true,
      services: [
        { name: "catalog", path: "services/catalog", language: "java" },
        { name: "scouting", path: "services/scouting", language: "python" },
        { name: "web", path: "web", language: "typescript" },
      ],
    });
  });

  it("fails with --all and more than the target ref", () => {
    const target = commit("base");

    const { exitCode, output } = runAffectedServices("--all", target, target);

    expect(exitCode).toBe(1);
    expect(output).toContain("usage");
  });

  it("fails without a base and a target ref", () => {
    commit("base");

    const { exitCode, output } = runAffectedServices("HEAD");

    expect(exitCode).toBe(1);
    expect(output).toContain("usage");
  });
});
