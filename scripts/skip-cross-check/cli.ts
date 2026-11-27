// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { affectedServicesBetween, servicesAt } from "../affected-services/verdict";
import {
  describeFiling,
  type FailureSignature,
  failureSignatureOf,
  type FiledIssue,
  fileBySignature,
  type IssueTracker,
  signatureMarker,
  type TrackedIssue,
} from "../failure-reporter/issue-tracker";
import { type Failure, INFRASTRUCTURE, parseRunResult, type RunResult } from "../failure-reporter/run-result";

const SCRIPT = "skip-cross-check";
const LABELS = ["ci-bot", "bug", "needs-triage"] as const;
const KINDS_NO_COMMIT_CAUSES: ReadonlySet<string> = new Set([INFRASTRUCTURE, "vulnerability", "link"]);
const USAGE = `usage: ${SCRIPT} --base <ref> --target <ref> <new-confirmed-run-result.json>...`;

interface Occurrence {
  readonly run: RunResult;
  readonly failure: Failure;
}

interface SkippedService {
  readonly service: string;
  readonly occurrences: readonly Occurrence[];
}

interface CommitRange {
  readonly base: string;
  readonly target: string;
  readonly commits: readonly string[];
}

export interface SkipCrossCheckPorts {
  readonly issueTracker: IssueTracker;
  readonly cwd: string;
}

export interface SkipCrossCheckResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

function firstParentCommits(cwd: string, base: string, target: string): string[] {
  const result = spawnSync("git", ["rev-list", "--first-parent", "--reverse", `${base}..${target}`, "--"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git rev-list ${base}..${target} failed: ${result.stderr.trim()}`);
  return result.stdout.split("\n").filter((line) => line !== "");
}

function affectedByAnyCommit(cwd: string, { target, commits }: CommitRange): ReadonlySet<string> {
  const affected = new Set<string>();
  for (const commit of commits) {
    const verdict = affectedServicesBetween(`${commit}^`, commit, cwd);
    if (verdict.all) return new Set(servicesAt(target, cwd).map(({ name }) => name));
    for (const { name } of verdict.services) affected.add(name);
  }
  return affected;
}

function skippedServices(
  runs: readonly RunResult[],
  services: ReadonlySet<string>,
  affected: ReadonlySet<string>,
): SkippedService[] {
  const skipped = new Map<string, Occurrence[]>();
  for (const run of runs) {
    for (const failure of run.failures) {
      const { service, kind } = failure;
      if (KINDS_NO_COMMIT_CAUSES.has(kind) || !services.has(service) || affected.has(service)) continue;
      const occurrences = skipped.get(service) ?? [];
      occurrences.push({ run, failure });
      skipped.set(service, occurrences);
    }
  }
  return [...skipped]
    .map(([service, occurrences]) => ({ service, occurrences }))
    .toSorted((left, right) => left.service.localeCompare(right.service));
}

function occurrenceDetails(
  { occurrences }: SkippedService,
  { base, target }: CommitRange,
  affected: ReadonlySet<string>,
): string[] {
  const names = [...affected].toSorted();
  return [
    `- **Commits:** \`${base}..${target}\``,
    `- **Serviços Afetados:** ${names.length === 0 ? "nenhum" : names.map((name) => `\`${name}\``).join(", ")}`,
    "",
    "## Falhas Confirmadas",
    "",
    ...occurrences.map(
      ({ run, failure }) =>
        `- \`${failure.check}\` (\`${failure.kind}\`), ${run.layer} em \`${run.sha}\`: ${run.runUrl}`,
    ),
    "",
  ];
}

function issueBody(
  skipped: SkippedService,
  details: readonly string[],
  signature: FailureSignature,
  closed: TrackedIssue | undefined,
): string {
  return [
    signatureMarker(signature),
    ...(closed ? [`Volta do bug de #${closed.number}, que foi fechada.`, ""] : []),
    "## Serviço Pulado",
    "",
    `- **Assinatura:** \`${signature}\``,
    `- **Serviço:** \`${skipped.service}\``,
    "",
    `A suíte noturna confirmou falha nova em \`${skipped.service}\`, mas a detecção de Serviços Afetados não o marcou em nenhum commit do intervalo: a C2 pulou o serviço.`,
    "",
    ...details,
  ].join("\n");
}

function fileDetectionBug(
  issueTracker: IssueTracker,
  skipped: SkippedService,
  range: CommitRange,
  affected: ReadonlySet<string>,
): Promise<FiledIssue> {
  const signature = failureSignatureOf("skipped-service", skipped.service);
  const details = occurrenceDetails(skipped, range, affected);
  return fileBySignature(issueTracker, signature, {
    comment: ["## Nova ocorrência", "", ...details].join("\n"),
    newIssue: (closed) => ({
      title: `ci: detecção de Serviços Afetados pulou ${skipped.service}`,
      body: issueBody(skipped, details, signature, closed),
      labels: LABELS,
    }),
  });
}

function parseOptions(argv: readonly string[]): {
  readonly base: string;
  readonly target: string;
  readonly paths: string[];
} {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { base: { type: "string" }, target: { type: "string" } },
    allowPositionals: true,
  });
  const { base, target } = values;
  if (!base || !target || positionals.length === 0) throw new Error(USAGE);
  return { base, target, paths: positionals };
}

/**
 * Compares the new ConfirmedFailures in the given run results with the AffectedServices of each first-parent commit in
 * --base..--target, and files a detection bug through the IssueTracker for every SkippedService: a service that failed
 * although no commit of the range affected it. Exits 1 only on bad arguments, a malformed run result or a git failure.
 */
export async function runSkipCrossCheck(
  argv: readonly string[],
  { issueTracker, cwd }: SkipCrossCheckPorts,
): Promise<SkipCrossCheckResult> {
  let range: CommitRange;
  let runs: RunResult[];
  let services: ReadonlySet<string>;
  let affected: ReadonlySet<string>;
  try {
    const { base, target, paths } = parseOptions(argv);
    runs = paths.map((path) => parseRunResult(readFileSync(path, "utf8")));
    range = { base, target, commits: firstParentCommits(cwd, base, target) };
    if (range.commits.length === 0) return { exitCode: 0, output: `${SCRIPT}: no commits between base and target` };
    services = new Set(servicesAt(target, cwd).map(({ name }) => name));
    affected = affectedByAnyCommit(cwd, range);
  } catch (error) {
    return { exitCode: 1, output: `${SCRIPT}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const skipped = skippedServices(runs, services, affected);
  if (skipped.length === 0) return { exitCode: 0, output: `${SCRIPT}: no failure outside the affected services` };
  const lines: string[] = [];
  for (const service of skipped) {
    const filed = await fileDetectionBug(issueTracker, service, range, affected);
    lines.push(`skipped ${service.service}: ${describeFiling(filed)}`);
  }
  return { exitCode: 0, output: lines.join("\n") };
}
