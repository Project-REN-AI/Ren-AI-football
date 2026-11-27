// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));

export interface AffectedService {
  readonly name: string;
  readonly path: string;
  readonly language: string;
}

/** What the affected-services CLI prints with --json: `all` is true when a root change made every service affected. */
export interface AffectedServicesVerdict {
  readonly all: boolean;
  readonly services: readonly AffectedService[];
}

function isAffectedService(value: unknown): value is AffectedService {
  if (typeof value !== "object" || value === null) return false;
  const { name, path, language } = value as Record<string, unknown>;
  return typeof name === "string" && typeof path === "string" && typeof language === "string";
}

function parseVerdict(stdout: string): AffectedServicesVerdict {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null) throw new Error(`unexpected verdict: ${stdout}`);
  const { all, services } = parsed as Record<string, unknown>;
  if (typeof all !== "boolean" || !Array.isArray(services) || !services.every(isAffectedService)) {
    throw new Error(`unexpected verdict: ${stdout}`);
  }
  return { all, services };
}

function verdictOf(args: readonly string[], cwd: string | undefined): AffectedServicesVerdict {
  const result = spawnSync("bun", [CLI, "--json", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`affected-services ${args.join(" ")} failed:\n${result.stderr}`);
  return parseVerdict(result.stdout);
}

/** Runs the affected-services CLI for the commits in base...target, in the repository at cwd. */
export function affectedServicesBetween(base: string, target: string, cwd?: string): AffectedServicesVerdict {
  return verdictOf([base, target], cwd);
}

/** Runs the affected-services CLI for every service declared at target, in the repository at cwd. */
export function servicesAt(target: string, cwd?: string): readonly AffectedService[] {
  return verdictOf(["--all", target], cwd).services;
}
