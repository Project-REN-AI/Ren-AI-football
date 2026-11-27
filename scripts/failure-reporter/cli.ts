// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  describeFiling,
  type FailureSignature,
  failureSignatureOf,
  type FiledIssue,
  fileBySignature,
  type IssueTracker,
  signatureMarker,
  type TrackedIssue,
} from "./issue-tracker";
import { type Failure, INFRASTRUCTURE, parseRunResult, type RunResult, SEED_VARIABLE } from "./run-result";

const MAX_RERUNS = 3;
const OUTPUT_TAIL_CHARACTERS = 8_000;

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
  readonly outcome: "passed" | "failed" | "infrastructure";
  readonly exit: string;
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

const RERUN_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

function outcomeOf(status: number | null, failsOn: readonly number[] | undefined): Rerun["outcome"] {
  if (status === 0) return "passed";
  if (!failsOn) return "failed";
  return status !== null && failsOn.includes(status) ? "failed" : "infrastructure";
}

function rerun({ reproduce, seed, failsOn }: Failure): Rerun {
  const result = spawnSync("sh", ["-c", reproduce], {
    encoding: "utf8",
    maxBuffer: RERUN_OUTPUT_BUFFER_BYTES,
    env: { ...process.env, [SEED_VARIABLE]: seed },
  });
  return {
    outcome: outcomeOf(result.status, failsOn),
    exit: result.status === null ? "by signal" : String(result.status),
    output: result.stdout + result.stderr,
  };
}

function rerunUntilSettled(failure: Failure): Rerun[] {
  const reruns: Rerun[] = [];
  while (reruns.length < MAX_RERUNS) {
    const attempt = rerun(failure);
    reruns.push(attempt);
    if (attempt.outcome !== "failed") break;
  }
  return reruns;
}

function classify(run: RunResult, failure: Failure): Occurrence | Rerun {
  const reruns = rerunUntilSettled(failure);
  const infrastructure = reruns.find(({ outcome }) => outcome === "infrastructure");
  if (infrastructure) return infrastructure;
  return {
    run,
    failure,
    classification: reruns.some(({ outcome }) => outcome === "passed") ? "FlakyTest" : "ConfirmedFailure",
    failingOutput: reruns.findLast(({ outcome }) => outcome === "failed")?.output ?? "",
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

function file(issueTracker: IssueTracker, occurrence: Occurrence): Promise<FiledIssue> {
  const { failure, classification } = occurrence;
  const signature = failureSignatureOf(failure.service, failure.check, failure.kind);
  return fileBySignature(issueTracker, signature, {
    comment: occurrenceComment(occurrence),
    newIssue: (closed) => ({
      title: `ci: ${failure.service} ${failure.check} falhou`,
      body: issueBody(occurrence, signature, closed),
      labels: CLASSIFICATIONS[classification].labels,
    }),
  });
}

const USAGE = "usage: failure-reporter <run-result.json> [--new-confirmed <run-result.json>]";

function parseOptions(argv: readonly string[]): { readonly path: string; readonly newConfirmed: string | undefined } {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { "new-confirmed": { type: "string" } },
    allowPositionals: true,
  });
  const [path] = positionals;
  if (path === undefined || positionals.length > 1) throw new Error(USAGE);
  return { path, newConfirmed: values["new-confirmed"] };
}

/**
 * Reruns each failure of a C3/C4 run result file and files every ConfirmedFailure and FlakyTest through the
 * IssueTracker; infrastructure failures are ignored. With --new-confirmed, also writes a run result holding only the
 * ConfirmedFailures that opened a new issue. Exits 1 only on bad arguments or a missing or malformed run result.
 */
export async function runFailureReporter(
  argv: readonly string[],
  { issueTracker }: FailureReporterPorts,
): Promise<FailureReporterResult> {
  let options: ReturnType<typeof parseOptions>;
  let run: RunResult;
  try {
    options = parseOptions(argv);
    run = parseRunResult(readFileSync(options.path, "utf8"));
  } catch (error) {
    return { exitCode: 1, output: `failure-reporter: ${error instanceof Error ? error.message : String(error)}` };
  }
  const lines: string[] = [];
  const newConfirmed: Failure[] = [];
  for (const failure of run.failures) {
    const subject = `${failure.service} ${failure.check}`;
    if (failure.kind === INFRASTRUCTURE) {
      lines.push(`${INFRASTRUCTURE} ${subject}: ignored`);
      continue;
    }
    const occurrence = classify(run, failure);
    if ("exit" in occurrence) {
      lines.push(`${INFRASTRUCTURE} ${subject}: ignored, a rerun exited ${occurrence.exit}`);
      continue;
    }
    const filed = await file(issueTracker, occurrence);
    if (filed.opened && occurrence.classification === "ConfirmedFailure") newConfirmed.push(failure);
    lines.push(`${CLASSIFICATIONS[occurrence.classification].logWord} ${subject}: ${describeFiling(filed)}`);
  }
  if (options.newConfirmed !== undefined) {
    writeFileSync(options.newConfirmed, JSON.stringify({ ...run, failures: newConfirmed }));
  }
  return { exitCode: 0, output: lines.join("\n") };
}
