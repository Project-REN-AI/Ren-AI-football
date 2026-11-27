// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type FailureSignature, type IssueTracker, signatureMarker, type TrackedIssue } from "./issue-tracker";

const MAX_RERUNS = 3;
const INFRASTRUCTURE = "infrastructure";
const SEED_VARIABLE = "SCOUT_TEST_SEED";
const OUTPUT_TAIL_CHARACTERS = 8_000;

const FAILURE_FIELDS = ["service", "check", "kind", "seed", "reproduce"] as const;
const RUN_FIELDS = ["layer", "sha", "runUrl"] as const;

type Failure = Readonly<Record<(typeof FAILURE_FIELDS)[number], string>>;

interface RunResult extends Readonly<Record<(typeof RUN_FIELDS)[number], string>> {
  readonly failures: readonly Failure[];
}

type Classification = "ConfirmedFailure" | "FlakyTest";

interface ClassificationReport {
  readonly logWord: string;
  readonly heading: string;
  readonly labels: readonly string[];
}

const CLASSIFICATIONS: Readonly<Record<Classification, ClassificationReport>> = {
  ConfirmedFailure: { logWord: "confirmed", heading: "Falha Confirmada", labels: ["ci-bot", "bug", "ready-for-agent"] },
  FlakyTest: { logWord: "flaky", heading: "Teste Instável", labels: ["ci-bot", "flaky", "needs-triage"] },
};

interface Rerun {
  readonly passed: boolean;
  readonly output: string;
}

interface Occurrence {
  readonly run: RunResult;
  readonly failure: Failure;
  readonly classification: Classification;
  readonly failingOutput: string;
}

export interface FailureReporterPorts {
  readonly issueTracker: IssueTracker;
}

export interface FailureReporterResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
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

function parseRunResult(raw: string): RunResult {
  const run = requireStrings(JSON.parse(raw), RUN_FIELDS, (field) => field || "run result");
  if (!Array.isArray(run.failures)) throw new Error("failures must be an array");
  const failures = run.failures.map((failure: unknown, index) => {
    const at = `failures[${index}]`;
    const { service, check, kind, seed, reproduce } = requireStrings(failure, FAILURE_FIELDS, (field) =>
      field ? `${at}.${field}` : at,
    );
    return { service, check, kind, seed, reproduce };
  });
  return { layer: run.layer, sha: run.sha, runUrl: run.runUrl, failures };
}

function failureSignatureOf({ service, check, kind }: Failure): FailureSignature {
  return createHash("sha256").update([service, check, kind].join("\n")).digest("hex").slice(0, 16) as FailureSignature;
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

function classify(run: RunResult, failure: Failure): Occurrence {
  const reruns = rerunUntilPass(failure);
  return {
    run,
    failure,
    classification: reruns.some(({ passed }) => passed) ? "FlakyTest" : "ConfirmedFailure",
    failingOutput: reruns.findLast(({ passed }) => !passed)?.output ?? "",
  };
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

function occurrenceDetails({ run, failure, failingOutput }: Occurrence): string[] {
  return [
    `- **Camada:** ${run.layer}`,
    `- **SHA:** \`${run.sha}\``,
    `- **Execução:** ${run.runUrl}`,
    `- **Seed:** \`${failure.seed}\``,
    "",
    "## Reproduzir",
    "",
    codeBlock(`export ${SEED_VARIABLE}=${failure.seed}\n${failure.reproduce}`, "sh"),
    "",
    "## Saída",
    "",
    truncatedOutput(failingOutput),
    "",
  ];
}

function issueBody(occurrence: Occurrence, signature: FailureSignature, closed: TrackedIssue | undefined): string {
  const { failure } = occurrence;
  return [
    signatureMarker(signature),
    ...(closed ? [`Volta da falha de #${closed.number}, que foi fechada.`, ""] : []),
    "## Falha",
    "",
    `- **Assinatura:** \`${signature}\``,
    `- **Serviço:** \`${failure.service}\``,
    `- **Checagem:** \`${failure.check}\``,
    `- **Tipo:** \`${failure.kind}\``,
    ...occurrenceDetails(occurrence),
  ].join("\n");
}

function occurrenceComment(occurrence: Occurrence): string {
  const { heading } = CLASSIFICATIONS[occurrence.classification];
  return [`## Nova ocorrência: ${heading}`, "", ...occurrenceDetails(occurrence)].join("\n");
}

async function file(issueTracker: IssueTracker, occurrence: Occurrence): Promise<string> {
  const { failure, classification } = occurrence;
  const signature = failureSignatureOf(failure);
  const latest = await issueTracker.findLatestBySignature(signature);
  if (latest?.state === "open") {
    await issueTracker.comment(latest.number, occurrenceComment(occurrence));
    return `commented on #${latest.number}`;
  }
  const issue = await issueTracker.createIssue({
    title: `ci: ${failure.service} ${failure.check} falhou`,
    body: issueBody(occurrence, signature, latest),
    labels: CLASSIFICATIONS[classification].labels,
  });
  return `opened #${issue.number}`;
}

/**
 * Reruns each failure of a C3/C4 run result file and files every ConfirmedFailure and FlakyTest through the
 * IssueTracker; infrastructure failures are ignored. Exits 1 only when the run result is missing or malformed.
 */
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
    const subject = `${failure.service} ${failure.check}`;
    if (failure.kind === INFRASTRUCTURE) {
      lines.push(`${INFRASTRUCTURE} ${subject}: ignored`);
      continue;
    }
    const occurrence = classify(run, failure);
    const outcome = await file(issueTracker, occurrence);
    lines.push(`${CLASSIFICATIONS[occurrence.classification].logWord} ${subject}: ${outcome}`);
  }
  return { exitCode: 0, output: lines.join("\n") };
}
