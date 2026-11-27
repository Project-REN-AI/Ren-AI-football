// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const AFFECTED_SERVICES = fileURLToPath(new URL("../affected-services/main.ts", import.meta.url));
const CHECK_COMMENTS = fileURLToPath(new URL("../check-comments/main.ts", import.meta.url));
const DEFAULT_BASE = "origin/develop";
const WORKSPACE_CHECKS = ["format:check", "typecheck", "lint", "test"] as const;

interface AffectedService {
  readonly name: string;
  readonly path: string;
  readonly language: string;
}

interface AffectedServices {
  readonly all: boolean;
  readonly services: readonly AffectedService[];
}

interface Check {
  readonly label: string;
  readonly command: readonly string[];
}

function pushedTargets(stdin: string): string[] {
  return stdin
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1] ?? "")
    .filter((sha) => sha !== "" && !/^0+$/.test(sha));
}

function parseBase(args: readonly string[]): string {
  const index = args.indexOf("--base");
  if (index === -1) return DEFAULT_BASE;
  const base = args[index + 1];
  if (base === undefined || args.length !== 2) throw new Error("usage: pre-push [--base <ref>] < <git pre-push refs>");
  return base;
}

function passes({ command }: Check): boolean {
  const [program = "", ...args] = command;
  console.log(`$ ${command.join(" ")}`);
  return spawnSync(program, args, { stdio: "inherit" }).status === 0;
}

function affectedServices(base: string, target: string): AffectedServices {
  const result = spawnSync("bun", [AFFECTED_SERVICES, "--json", base, target], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`pre-push failed: affected-services\n${result.stderr}`);
  spawnSync("bun", [AFFECTED_SERVICES, base, target], { stdio: "inherit" });
  return JSON.parse(result.stdout) as AffectedServices;
}

function workspaceChecks(path: string): Check[] {
  return WORKSPACE_CHECKS.map((script) => {
    const command = ["bun", "run", "--cwd", path, script];
    return { label: command.join(" "), command };
  });
}

function serviceChecks({ path, language }: AffectedService): Check[] {
  if (language === "typescript") return workspaceChecks(path);
  const message = `no CI path for ${language} services yet; add its steps to the service job in ci.yml`;
  return [{ label: message, command: ["sh", "-c", `echo "${message}" >&2; exit 1`] }];
}

function checksFor(base: string, target: string, services: readonly AffectedService[]): Check[] {
  return [
    ...(existsSync(join("scripts", "package.json")) ? workspaceChecks("scripts") : []),
    {
      label: "check-comments",
      command: ["bun", CHECK_COMMENTS, "--base", base, "--head", target],
    },
    ...services.flatMap(serviceChecks),
  ];
}

async function failedChecks(): Promise<string[]> {
  const base = parseBase(process.argv.slice(2));
  const failed: string[] = [];
  for (const target of new Set(pushedTargets(await Bun.stdin.text()))) {
    const { services } = affectedServices(base, target);
    for (const check of checksFor(base, target, services)) if (!passes(check)) failed.push(check.label);
  }
  return failed;
}

try {
  const failed = await failedChecks();
  for (const label of failed) console.error(`pre-push failed: ${label}`);
  if (failed.length > 0) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
