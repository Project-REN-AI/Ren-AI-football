// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  type FailureSignature,
  type IssueTracker,
  signatureMarker,
  type TrackedIssue,
} from "../failure-reporter/issue-tracker";
import { type Failure, INFRASTRUCTURE, parseRunResult, type RunResult } from "../failure-reporter/run-result";

const AFFECTED_SERVICES_CLI = fileURLToPath(new URL("../affected-services/main.ts", import.meta.url));
const LABELS = ["ci-bot", "bug", "needs-triage"] as const;
const USAGE = "usage: skip-cross-check --base <ref> --target <ref> <run-result.json>...";

interface AffectedService {
  readonly name: string;
}

interface AffectedServices {
  readonly all: boolean;
  readonly services: readonly AffectedService[];
}

interface SkippedService {
  readonly service: string;
  readonly occurrences: readonly { readonly run: RunResult; readonly failure: Failure }[];
}

interface CrossCheckRange {
  readonly base: string;
  readonly target: string;
  readonly affected: readonly string[];
}

export interface SkipCrossCheckPorts {
  readonly issueTracker: IssueTracker;
  readonly cwd: string;
}

export interface SkipCrossCheckResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

function affectedServices(cwd: string, ...args: string[]): AffectedServices {
  const result = spawnSync("bun", [AFFECTED_SERVICES_CLI, "--json", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`affected-services ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout) as AffectedServices;
}

function commitOf(cwd: string, ref: string): string {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${ref} is not a commit`);
  return result.stdout.trim();
}

function skipSignatureOf(service: string): FailureSignature {
  return createHash("sha256")
    .update(["skipped-service", service].join("\n"))
    .digest("hex")
    .slice(0, 16) as FailureSignature;
}

function skippedServices(
  runs: readonly RunResult[],
  services: ReadonlySet<string>,
  affected: ReadonlySet<string>,
): SkippedService[] {
  const skipped = new Map<string, SkippedService["occurrences"][number][]>();
  for (const run of runs) {
    for (const failure of run.failures) {
      if (failure.kind === INFRASTRUCTURE || !services.has(failure.service) || affected.has(failure.service)) continue;
      skipped.set(failure.service, [...(skipped.get(failure.service) ?? []), { run, failure }]);
    }
  }
  return [...skipped]
    .map(([service, occurrences]) => ({ service, occurrences }))
    .toSorted((left, right) => left.service.localeCompare(right.service));
}

function occurrenceDetails({ occurrences }: SkippedService, { base, target, affected }: CrossCheckRange): string[] {
  return [
    `- **Commits:** \`${base}...${target}\``,
    `- **Serviços Afetados:** ${affected.length === 0 ? "nenhum" : affected.map((name) => `\`${name}\``).join(", ")}`,
    "",
    "## Checagens que falharam",
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
  range: CrossCheckRange,
  signature: FailureSignature,
  closed: TrackedIssue | undefined,
): string {
  return [
    signatureMarker(signature),
    ...(closed ? [`Volta do bug de #${closed.number}, que foi fechada.`, ""] : []),
    "## Serviço pulado",
    "",
    `- **Assinatura:** \`${signature}\``,
    `- **Serviço:** \`${skipped.service}\``,
    "",
    `A suíte noturna viu \`${skipped.service}\` falhar, mas a detecção de Serviços Afetados não o marcaria para os commits abaixo: a C2 teria pulado o serviço.`,
    "",
    ...occurrenceDetails(skipped, range),
  ].join("\n");
}

async function file(issueTracker: IssueTracker, skipped: SkippedService, range: CrossCheckRange): Promise<string> {
  const signature = skipSignatureOf(skipped.service);
  const latest = await issueTracker.findLatestBySignature(signature);
  if (latest?.state === "open") {
    await issueTracker.comment(
      latest.number,
      ["## Nova ocorrência", "", ...occurrenceDetails(skipped, range)].join("\n"),
    );
    return `commented on #${latest.number}`;
  }
  const issue = await issueTracker.createIssue({
    title: `ci: detecção de Serviços Afetados pulou ${skipped.service}`,
    body: issueBody(skipped, range, signature, latest),
    labels: LABELS,
  });
  return `opened #${issue.number}`;
}

/**
 * Compares the failures of C4 run results with the AffectedServices of the commits between --base and --target, and
 * files a detection bug through the IssueTracker for each service that failed although it was not affected.
 * Exits 1 only on bad arguments, a malformed run result or a failing affected-services call.
 */
export async function runSkipCrossCheck(
  argv: readonly string[],
  { issueTracker, cwd }: SkipCrossCheckPorts,
): Promise<SkipCrossCheckResult> {
  let range: CrossCheckRange;
  let services: ReadonlySet<string>;
  let runs: RunResult[];
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: { base: { type: "string" }, target: { type: "string" } },
      allowPositionals: true,
    });
    const { base, target } = values;
    if (!base || !target || positionals.length === 0) throw new Error(USAGE);
    runs = positionals.map((path) => parseRunResult(readFileSync(path, "utf8")));
    if (commitOf(cwd, base) === commitOf(cwd, target))
      return { exitCode: 0, output: "skip cross-check: no commits between base and target" };
    services = new Set(affectedServices(cwd, "--all", target).services.map(({ name }) => name));
    const verdict = affectedServices(cwd, base, target);
    range = { base, target, affected: verdict.all ? [...services] : verdict.services.map(({ name }) => name) };
  } catch (error) {
    return { exitCode: 1, output: `skip-cross-check: ${error instanceof Error ? error.message : String(error)}` };
  }
  const skipped = skippedServices(runs, services, new Set(range.affected));
  if (skipped.length === 0)
    return { exitCode: 0, output: "skip cross-check: no failure outside the affected services" };
  const lines: string[] = [];
  for (const service of skipped) {
    lines.push(`skipped ${service.service}: ${await file(issueTracker, service, range)}`);
  }
  return { exitCode: 0, output: lines.join("\n") };
}
