// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";

const GIGABYTE = 1024 ** 3;
const PROFILE_BUDGET_BYTES = 10 * GIGABYTE;
const ALWAYS_ON_GROUP = "(no profile)";

interface ComposeService {
  readonly name: string;
  readonly memLimitBytes: number | undefined;
  readonly profiles: readonly string[];
}

interface ProfileUsage {
  readonly profile: string;
  readonly bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveCompose(projectDirectory: string): unknown {
  const result = spawnSync("docker", ["compose", "--profile", "*", "config", "--format", "json"], {
    cwd: projectDirectory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`docker compose config failed: ${(result.stderr || result.error?.message || "").trim()}`);
  }
  return JSON.parse(result.stdout);
}

function toService(name: string, definition: unknown): ComposeService {
  const fields = isRecord(definition) ? definition : {};
  const memLimit = Number(fields["mem_limit"] ?? 0);
  const profiles = fields["profiles"];
  return {
    name,
    memLimitBytes: memLimit > 0 ? memLimit : undefined,
    profiles: Array.isArray(profiles) ? profiles.map(String) : [],
  };
}

function readServices(compose: unknown): ComposeService[] {
  const services = isRecord(compose) ? (compose["services"] ?? {}) : undefined;
  if (!isRecord(services)) throw new Error("docker compose config returned no services map");
  return Object.entries(services).map(([name, definition]) => toService(name, definition));
}

function usageByProfile(services: readonly ComposeService[]): ProfileUsage[] {
  const alwaysOn = services.filter(({ profiles }) => profiles.length === 0);
  const named = [...new Set(services.flatMap(({ profiles }) => profiles))].toSorted();
  const sum = (members: readonly ComposeService[]): number =>
    members.reduce((total, { memLimitBytes }) => total + (memLimitBytes ?? 0), 0);
  return [
    { profile: ALWAYS_ON_GROUP, bytes: sum(alwaysOn) },
    ...named.map((profile) => ({
      profile,
      bytes: sum([...alwaysOn, ...services.filter(({ profiles }) => profiles.includes(profile))]),
    })),
  ];
}

function gigabytes(bytes: number): string {
  return `${(bytes / GIGABYTE).toFixed(2)} GB`;
}

function fail(lines: readonly string[]): never {
  console.log("compose budget: fail");
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

const projectDirectory = process.argv[2];
if (projectDirectory === undefined) fail(["usage: compose-budget <compose project directory>"]);

let services: ComposeService[];
try {
  services = readServices(resolveCompose(projectDirectory));
} catch (error) {
  fail([error instanceof Error ? error.message : String(error)]);
}

const usages = usageByProfile(services);
const failures = [
  ...services
    .filter(({ memLimitBytes }) => memLimitBytes === undefined)
    .map(({ name }) => `service ${name}: no mem_limit`),
  ...usages
    .filter(({ bytes }) => bytes > PROFILE_BUDGET_BYTES)
    .map(({ profile, bytes }) => `profile ${profile}: ${gigabytes(bytes)} exceeds ${gigabytes(PROFILE_BUDGET_BYTES)}`),
];
if (failures.length > 0) fail(failures);

console.log("compose budget: ok");
for (const { profile, bytes } of usages) {
  console.log(`  ${profile}: ${gigabytes(bytes)} of ${gigabytes(PROFILE_BUDGET_BYTES)}`);
}
