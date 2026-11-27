// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const USAGE = "usage: pre-push [<remote> [<url>]] [--base <ref>] < <git pre-push refs>";
const INTEGRATION_BRANCH = "develop";
const WORKSPACE_SCRIPTS = ["format:check", "typecheck", "lint", "test"] as const;

function script(name: string): string {
  return fileURLToPath(new URL(`../${name}/main.ts`, import.meta.url));
}

interface AffectedService {
  readonly name: string;
  readonly path: string;
  readonly language: string;
}

type Check = { readonly command: readonly string[] } | { readonly unsupportedLanguage: string };

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
    .filter(([localRef = "", sha = ""]) => localRef.startsWith("refs/heads/") && !/^0+$/.test(sha))
    .map(([, sha = ""]) => sha);
  return [...new Set(targets)];
}

function isAffectedService(value: unknown): value is AffectedService {
  if (typeof value !== "object" || value === null) return false;
  const { name, path, language } = value as Record<string, unknown>;
  return typeof name === "string" && typeof path === "string" && typeof language === "string";
}

function affectedServices(base: string, target: string): AffectedService[] {
  const result = spawnSync("bun", [script("affected-services"), "--json", base, target], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`affected-services ${base} ${target} failed:\n${result.stderr}`);
  const parsed: unknown = JSON.parse(result.stdout);
  const services = typeof parsed === "object" && parsed !== null && "services" in parsed ? parsed.services : undefined;
  if (!Array.isArray(services) || !services.every(isAffectedService)) {
    throw new Error(`affected-services printed an unexpected verdict: ${result.stdout}`);
  }
  return services;
}

function workspaceChecks(path: string): Check[] {
  return WORKSPACE_SCRIPTS.map((name) => ({ command: ["bun", "run", "--cwd", path, name] }));
}

function serviceChecks({ path, language }: AffectedService): Check[] {
  return language === "typescript" ? workspaceChecks(path) : [{ unsupportedLanguage: language }];
}

function describeCheck(check: Check): string {
  return "command" in check ? check.command.join(" ") : `no CI path for ${check.unsupportedLanguage} services yet`;
}

function passes(check: Check): boolean {
  if (!("command" in check)) {
    console.error(`${describeCheck(check)}; add its steps to the service job in ci.yml and to scripts/pre-push`);
    return false;
  }
  const [program = "", ...args] = check.command;
  console.log(`$ ${describeCheck(check)}`);
  return spawnSync(program, args, { stdio: "inherit" }).status === 0;
}

function checksFor(base: string, targets: readonly string[]): Check[] {
  const services = new Map<string, AffectedService>();
  for (const target of targets) {
    for (const service of affectedServices(base, target)) services.set(service.path, service);
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
