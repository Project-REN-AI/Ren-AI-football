// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type AffectedService, affectedServicesBetween } from "../affected-services/verdict";

const USAGE = "usage: pre-push [<remote> [<url>]] [--base <ref>] < <git pre-push refs>";
const INTEGRATION_BRANCH = "develop";
const WORKSPACE_SCRIPTS = ["format:check", "typecheck", "lint", "test"] as const;

function script(name: string): string {
  return fileURLToPath(new URL(`../${name}/main.ts`, import.meta.url));
}

interface Check {
  readonly command: readonly string[];
  readonly cwd?: string;
}

function parseArgs(argv: readonly string[]): { base: string } {
  let base: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--base" && argv[index + 1]) base = argv[(index += 1)];
    else if (!arg.startsWith("--") && positional.length < 2) positional.push(arg);
    else throw new Error(USAGE);
  }
  return { base: base ?? `${positional[0] ?? "origin"}/${INTEGRATION_BRANCH}` };
}

function pushedBranchTargets(stdin: string): string[] {
  const targets = stdin
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, sha = "", remoteRef = ""]) => remoteRef.startsWith("refs/heads/") && !/^0+$/.test(sha))
    .map(([, sha = ""]) => sha);
  return [...new Set(targets)];
}

function workspaceChecks(path: string): Check[] {
  return WORKSPACE_SCRIPTS.map((name) => ({ command: ["bun", "run", "--cwd", path, name] }));
}

function uvChecks(path: string): Check[] {
  const commands = [["ruff", "format", "--check", "."], ["ruff", "check", "."], ["mypy", "src", "tests"], ["pytest"]];
  return commands.map((command) => ({ command: ["uv", "--directory", path, "run", "--locked", ...command] }));
}

function mavenChecks(path: string): Check[] {
  const mvnw = ["./mvnw", "--batch-mode", "--no-transfer-progress"];
  return [
    { command: [...mvnw, "spotless:check", "test-compile", "checkstyle:check", "pmd:check"], cwd: path },
    { command: [...mvnw, "test", "-DexcludedGroups=architecture"], cwd: path },
  ];
}

function goChecks(path: string): Check[] {
  return [
    ["golangci-lint", "fmt", "--diff"],
    ["golangci-lint", "run"],
    ["go", "test", "-p", "4", "./..."],
  ].map((command) => ({ command, cwd: path }));
}

const SERVICE_CHECKS: Readonly<Record<string, (path: string) => Check[]>> = {
  typescript: workspaceChecks,
  python: uvChecks,
  java: mavenChecks,
  go: goChecks,
};

function serviceChecks({ path, language }: AffectedService): Check[] {
  const checks = SERVICE_CHECKS[language];
  if (checks === undefined) {
    throw new Error(`no pre-push path for ${language} services; mirror the service job of ci.yml in scripts/pre-push`);
  }
  return checks(path);
}

function describeCheck({ command, cwd }: Check): string {
  return cwd === undefined ? command.join(" ") : `(cd ${cwd} && ${command.join(" ")})`;
}

function passes(check: Check): boolean {
  const [program = "", ...args] = check.command;
  console.log(`$ ${describeCheck(check)}`);
  return spawnSync(program, args, { stdio: "inherit", cwd: check.cwd }).status === 0;
}

function checksFor(base: string, targets: readonly string[]): Check[] {
  const services = new Map<string, AffectedService>();
  for (const target of targets) {
    for (const service of affectedServicesBetween(base, target).services) services.set(service.path, service);
  }
  const names = [...services.values()].map(({ name }) => name).toSorted();
  console.log(`affected services: ${names.length === 0 ? "none" : names.join(", ")}`);
  return [
    ...workspaceChecks("scripts"),
    { command: ["bun", script("workflow-policy"), ".github/workflows"] },
    { command: ["bun", script("compose-budget"), "."] },
    ...targets.map((target) => ({ command: ["bun", script("check-comments"), "--base", base, "--head", target] })),
    ...[...services.values()].toSorted((left, right) => left.name.localeCompare(right.name)).flatMap(serviceChecks),
  ];
}

try {
  const { base } = parseArgs(process.argv.slice(2));
  const targets = pushedBranchTargets(await Bun.stdin.text());
  const failed = targets.length === 0 ? [] : checksFor(base, targets).filter((check) => !passes(check));
  for (const check of failed) console.error(`pre-push failed: ${describeCheck(check)}`);
  if (failed.length > 0) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
