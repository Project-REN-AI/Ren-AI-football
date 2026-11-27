// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** The environment variable every hunted or rerun check reads its seed from. */
export const SEED_VARIABLE = "SCOUT_TEST_SEED";
/** The failure kind that never becomes an issue. */
export const INFRASTRUCTURE = "infrastructure";

const FAILURE_FIELDS = ["service", "check", "kind", "seed", "reproduce"] as const;
const RUN_FIELDS = ["layer", "sha", "runUrl"] as const;

/** One failing check of a C3/C4 run; `failsOn` lists the exit codes that count as a finding, any non-zero if absent. */
export interface Failure extends Readonly<Record<(typeof FAILURE_FIELDS)[number], string>> {
  readonly failsOn?: readonly number[];
}

/** The file the hunt writes and the failure reporter reads. */
export interface RunResult extends Readonly<Record<(typeof RUN_FIELDS)[number], string>> {
  readonly failures: readonly Failure[];
}

function requireStrings<const K extends string>(
  value: unknown,
  fields: readonly K[],
  path: (field: string) => string,
): Record<K, string> & Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path("")} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new Error(`${path(field)} must be a non-empty string`);
    }
  }
  return record as Record<K, string> & Record<string, unknown>;
}

function parseFailsOn(value: unknown, at: string): readonly number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || !value.every((code) => Number.isInteger(code) && code > 0)) {
    throw new Error(`${at}.failsOn must be a non-empty array of positive integers`);
  }
  return value as number[];
}

function parseFailure(failure: unknown, index: number): Failure {
  const at = `failures[${index}]`;
  const record = requireStrings(failure, FAILURE_FIELDS, (field) => (field ? `${at}.${field}` : at));
  const { service, check, kind, seed, reproduce } = record;
  const failsOn = parseFailsOn(record.failsOn, at);
  return { service, check, kind, seed, reproduce, ...(failsOn ? { failsOn } : {}) };
}

/** Parses and validates a run result file's text; throws naming the first invalid field. */
export function parseRunResult(raw: string): RunResult {
  const run = requireStrings(JSON.parse(raw), RUN_FIELDS, (field) => field || "run result");
  if (!Array.isArray(run.failures)) throw new Error("failures must be an array");
  return { layer: run.layer, sha: run.sha, runUrl: run.runUrl, failures: run.failures.map(parseFailure) };
}
