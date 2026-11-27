// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  type Failure,
  INFRASTRUCTURE,
  parseRunResult,
  type RunResult,
  SEED_VARIABLE,
} from "../failure-reporter/run-result";

const REQUIRED = ["result", "layer", "sha", "run-url", "service", "check", "kind"] as const;

const USAGE = [
  "usage: hunt --result <run-result.json> --layer <layer> --sha <sha> --run-url <url>",
  "            --service <service> --check <check> --kind <kind> [--repeat <n>] [--fails-on <codes>] -- <command>",
].join("\n");

type RequiredOption = (typeof REQUIRED)[number];

interface HuntOptions extends Readonly<Record<RequiredOption, string>> {
  readonly repeat: number;
  readonly failsOn: readonly number[];
  readonly command: string;
}

export interface HuntPorts {
  readonly nextSeed: () => string;
}

export interface HuntResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

const STRING_OPTION = { type: "string" } as const;

function parseOptions(argv: readonly string[]): HuntOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      result: STRING_OPTION,
      layer: STRING_OPTION,
      sha: STRING_OPTION,
      "run-url": STRING_OPTION,
      service: STRING_OPTION,
      check: STRING_OPTION,
      kind: STRING_OPTION,
      repeat: { type: "string", default: "1" },
      "fails-on": { type: "string", default: "1" },
    },
    allowPositionals: true,
  });
  const required: Partial<Record<RequiredOption, string>> = values;
  const missing = REQUIRED.filter((name) => !required[name]);
  if (missing.length > 0) throw new Error(`missing ${missing.map((name) => `--${name}`).join(", ")}\n${USAGE}`);
  if (required.kind === INFRASTRUCTURE) throw new Error(`--kind must not be ${INFRASTRUCTURE}`);
  const command = positionals.join(" ");
  if (command === "") throw new Error(`missing command\n${USAGE}`);
  return {
    ...(required as Record<RequiredOption, string>),
    repeat: positiveInteger(values.repeat, "--repeat"),
    failsOn: values["fails-on"].split(",").map((code) => positiveInteger(code.trim(), "--fails-on")),
    command,
  };
}

function loadRunResult(options: HuntOptions): RunResult {
  if (!existsSync(options.result)) {
    return { layer: options.layer, sha: options.sha, runUrl: options["run-url"], failures: [] };
  }
  return parseRunResult(readFileSync(options.result, "utf8"));
}

function run(command: string, seed: string): number | null {
  return spawnSync("sh", ["-c", command], { stdio: "inherit", env: { ...process.env, [SEED_VARIABLE]: seed } }).status;
}

/**
 * Runs a C3/C4 check up to --repeat times, each with a fresh seed in SCOUT_TEST_SEED, and appends the first failing
 * run to the run result the failure reporter reads. An exit code outside --fails-on is an infrastructure failure.
 * Exits 1 only on bad arguments or a malformed run result; a failing check is a finding, not an error.
 */
export async function runHunt(argv: readonly string[], { nextSeed }: HuntPorts): Promise<HuntResult> {
  let options: HuntOptions;
  let result: RunResult;
  try {
    options = parseOptions(argv);
    result = loadRunResult(options);
  } catch (error) {
    return { exitCode: 1, output: `hunt: ${error instanceof Error ? error.message : String(error)}` };
  }
  const failures: Failure[] = [...result.failures];
  const subject = `${options.service} ${options.check}`;
  let output = `${subject}: passed ${options.repeat} runs`;
  for (let attempt = 1; attempt <= options.repeat; attempt += 1) {
    const seed = nextSeed();
    const status = run(options.command, seed);
    if (status === 0) continue;
    const kind = status !== null && options.failsOn.includes(status) ? options.kind : INFRASTRUCTURE;
    failures.push({
      service: options.service,
      check: options.check,
      kind,
      seed,
      reproduce: options.command,
      failsOn: options.failsOn,
    });
    output = `${subject}: ${kind} failure on run ${attempt} of ${options.repeat}, seed ${seed}`;
    if (kind === INFRASTRUCTURE) output += ` (exit ${status ?? "by signal"})`;
    break;
  }
  writeFileSync(options.result, `${JSON.stringify({ ...result, failures }, null, 2)}\n`);
  return { exitCode: 0, output };
}
