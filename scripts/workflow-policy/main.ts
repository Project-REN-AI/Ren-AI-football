// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_TRIGGERS = ["pull_request_target", "issue_comment", "workflow_run"] as const;
const READ_ONLY_GRANTS = ["read", "none"] as const;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/;

interface Violation {
  readonly file: string;
  readonly reason: string;
}

type Mapping = Record<string, unknown>;

function isMapping(value: unknown): value is Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function triggersOf(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.filter((event): event is string => typeof event === "string");
  if (isMapping(on)) return Object.keys(on);
  return [];
}

function forbiddenTriggers(workflow: Mapping): string[] {
  const triggers = triggersOf(workflow.on);
  return FORBIDDEN_TRIGGERS.filter((trigger) => triggers.includes(trigger)).map(
    (trigger) => `forbidden trigger ${trigger}`,
  );
}

function isReadOnly(grant: unknown): boolean {
  return READ_ONLY_GRANTS.some((readOnly) => readOnly === grant);
}

function topLevelPermissions(workflow: Mapping): string[] {
  if (!("permissions" in workflow)) return ["top-level permissions missing"];
  const { permissions } = workflow;
  if (permissions === "read-all") return [];
  if (!isMapping(permissions)) return [`top-level permissions not read-only (${String(permissions)})`];
  return Object.entries(permissions)
    .filter(([, grant]) => !isReadOnly(grant))
    .map(([scope, grant]) => `top-level permissions not read-only (${scope}: ${String(grant)})`);
}

function isPinned(uses: string): boolean {
  if (uses.startsWith("./")) return true;
  if (uses.startsWith("docker://")) return IMAGE_DIGEST.test(uses);
  const ref = uses.split("@")[1];
  return ref !== undefined && COMMIT_SHA.test(ref);
}

function usesOf(workflow: Mapping): string[] {
  const jobs = isMapping(workflow.jobs) ? Object.values(workflow.jobs) : [];
  return jobs.filter(isMapping).flatMap((job) => {
    const steps = Array.isArray(job.steps) ? job.steps.filter(isMapping) : [];
    return [job.uses, ...steps.map((step) => step.uses)].filter((uses): uses is string => typeof uses === "string");
  });
}

function unpinnedActions(workflow: Mapping): string[] {
  return usesOf(workflow)
    .filter((uses) => !isPinned(uses))
    .map((uses) => `action not pinned by SHA (${uses})`);
}

function audit(file: string, source: string): Violation[] {
  const workflow: unknown = Bun.YAML.parse(source);
  if (!isMapping(workflow)) return [{ file, reason: "not a workflow mapping" }];
  return [...forbiddenTriggers(workflow), ...topLevelPermissions(workflow), ...unpinnedActions(workflow)].map(
    (reason) => ({ file, reason }),
  );
}

function fail(lines: readonly string[]): never {
  console.log("workflow policy: violated");
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

const directory = process.argv[2];
if (directory === undefined) fail(["usage: workflow-policy <workflows-directory>"]);

const files = readdirSync(directory)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .toSorted();
if (files.length === 0) fail([`no workflows found in ${directory}`]);

const violations = files.flatMap((file) => audit(file, readFileSync(join(directory, file), "utf8")));
if (violations.length > 0) fail(violations.map(({ file, reason }) => `${file}: ${reason}`));

console.log(`workflow policy: ok (${files.join(", ")})`);
