// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type IssueTracker, signatureMarker, type TrackedIssue } from "./issue-tracker";

const MAX_RERUNS = 3;
const INFRASTRUCTURE = "infrastructure";
const SEED_VARIABLE = "SCOUT_TEST_SEED";
const OUTPUT_TAIL_CHARACTERS = 8_000;

interface Failure {
  readonly service: string;
  readonly check: string;
  readonly kind: string;
  readonly seed: string;
  readonly reproduce: string;
}

interface RunResult {
  readonly layer: string;
  readonly sha: string;
  readonly runUrl: string;
  readonly failures: readonly Failure[];
}

const FAILURE_FIELDS = ["service", "check", "kind", "seed", "reproduce"] as const;
const RUN_FIELDS = ["layer", "sha", "runUrl"] as const;

function requireStrings<const K extends string>(
  value: unknown,
  fields: readonly K[],
  where: string,
): Record<K, string> & Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where || "run result"} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new Error(`${where ? `${where}.` : ""}${field} must be a non-empty string`);
    }
  }
  return record as Record<K, string> & Record<string, unknown>;
}

function parseRunResult(raw: string): RunResult {
  const run = requireStrings(JSON.parse(raw), RUN_FIELDS, "");
  if (!Array.isArray(run.failures)) throw new Error("failures must be an array");
  const failures = run.failures.map((failure: unknown, index) => {
    const { service, check, kind, seed, reproduce } = requireStrings(failure, FAILURE_FIELDS, `failures[${index}]`);
    return { service, check, kind, seed, reproduce };
  });
  return { layer: run.layer, sha: run.sha, runUrl: run.runUrl, failures };
}

type Classification = "ConfirmedFailure" | "FlakyTest";

const CLASSIFICATIONS: Readonly<
  Record<Classification, { readonly report: string; readonly title: string; readonly labels: readonly string[] }>
> = {
  ConfirmedFailure: { report: "confirmed", title: "Falha Confirmada", labels: ["ci-bot", "bug", "ready-for-agent"] },
  FlakyTest: { report: "flaky", title: "Teste Instável", labels: ["ci-bot", "flaky", "needs-triage"] },
};

interface Rerun {
  readonly passed: boolean;
  readonly output: string;
}

export interface FailureReporterPorts {
  readonly issueTracker: IssueTracker;
}

export interface FailureReporterResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

function failureSignatureOf({ service, check, kind }: Failure): string {
  return createHash("sha256").update([service, check, kind].join("\n")).digest("hex").slice(0, 16);
}

function rerun({ reproduce, seed }: Failure): Rerun {
  const result = spawnSync("sh", ["-c", reproduce], {
    encoding: "utf8",
    env: { ...process.env, [SEED_VARIABLE]: seed },
  });
  return { passed: result.status === 0, output: result.stdout + result.stderr };
}

function rerunUntilPass(failure: Failure): Rerun[] {
  const reruns: Rerun[] = [];
  while (reruns.length < MAX_RERUNS) {
    const attempt = rerun(failure);
    reruns.push(attempt);
    if (attempt.passed) break;
  }
  return reruns;
}

function codeBlock(text: string, language = ""): string {
  const longestBacktickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${text.trimEnd()}\n${fence}`;
}

function truncatedOutput(output: string): string {
  if (output.length <= OUTPUT_TAIL_CHARACTERS) return codeBlock(output);
  const note = `_Saída truncada: últimos ${OUTPUT_TAIL_CHARACTERS} caracteres de ${output.length}._`;
  return `${note}\n\n${codeBlock(output.slice(-OUTPUT_TAIL_CHARACTERS))}`;
}

function occurrence(run: RunResult, failure: Failure, reruns: readonly Rerun[]): string[] {
  return [
    `- **Camada:** ${run.layer}`,
    `- **SHA:** \`${run.sha}\``,
    `- **Execução:** ${run.runUrl}`,
    `- **Seed:** \`${failure.seed}\``,
    "",
    "## Reproduzir",
    "",
    codeBlock(`${SEED_VARIABLE}=${failure.seed} ${failure.reproduce}`, "sh"),
    "",
    "## Saída",
    "",
    truncatedOutput(reruns.at(-1)?.output ?? ""),
    "",
  ];
}

function issueBody(
  run: RunResult,
  failure: Failure,
  signature: string,
  reruns: readonly Rerun[],
  previous: TrackedIssue | undefined,
): string {
  return [
    signatureMarker(signature),
    ...(previous ? [`Volta da falha de #${previous.number}, que foi fechada.`, ""] : []),
    "## Falha",
    "",
    `- **Assinatura:** \`${signature}\``,
    `- **Serviço:** \`${failure.service}\``,
    `- **Checagem:** \`${failure.check}\``,
    `- **Tipo:** \`${failure.kind}\``,
    ...occurrence(run, failure, reruns),
  ].join("\n");
}

function occurrenceComment(
  run: RunResult,
  failure: Failure,
  classification: Classification,
  reruns: readonly Rerun[],
): string {
  return [`## Nova ocorrência: ${CLASSIFICATIONS[classification].title}`, "", ...occurrence(run, failure, reruns)].join(
    "\n",
  );
}

async function report(
  issueTracker: IssueTracker,
  run: RunResult,
  failure: Failure,
  classification: Classification,
  reruns: readonly Rerun[],
): Promise<string> {
  const signature = failureSignatureOf(failure);
  const latest = await issueTracker.findLatestBySignature(signature);
  if (latest?.state === "open") {
    await issueTracker.comment(latest.number, occurrenceComment(run, failure, classification, reruns));
    return `commented on #${latest.number}`;
  }
  const issue = await issueTracker.createIssue({
    title: `ci: ${failure.service} ${failure.check} falhou`,
    body: issueBody(run, failure, signature, reruns, latest),
    labels: CLASSIFICATIONS[classification].labels,
  });
  return `opened #${issue.number}`;
}

/** Reruns each failure of a C3/C4 run and files the confirmed ones through the IssueTracker. */
export async function runFailureReporter(
  argv: readonly string[],
  { issueTracker }: FailureReporterPorts,
): Promise<FailureReporterResult> {
  const [path] = argv;
  if (path === undefined) return { exitCode: 1, output: "usage: failure-reporter <run-result.json>" };
  let run: RunResult;
  try {
    run = parseRunResult(readFileSync(path, "utf8"));
  } catch (error) {
    return { exitCode: 1, output: `failure-reporter: ${error instanceof Error ? error.message : String(error)}` };
  }
  const lines: string[] = [];
  for (const failure of run.failures) {
    if (failure.kind === INFRASTRUCTURE) {
      lines.push(`${INFRASTRUCTURE} ${failure.service} ${failure.check}: ignored`);
      continue;
    }
    const reruns = rerunUntilPass(failure);
    const classification: Classification = reruns.some(({ passed }) => passed) ? "FlakyTest" : "ConfirmedFailure";
    const outcome = await report(issueTracker, run, failure, classification, reruns);
    lines.push(`${CLASSIFICATIONS[classification].report} ${failure.service} ${failure.check}: ${outcome}`);
  }
  return { exitCode: 0, output: lines.join("\n") };
}
