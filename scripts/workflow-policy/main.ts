// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_TRIGGERS = ["pull_request_target", "issue_comment", "workflow_run"] as const;
const READ_ONLY_GRANTS = ["read", "none"] as const;

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

function triggerViolations(workflow: Mapping): string[] {
  const triggers = triggersOf(workflow.on);
  return FORBIDDEN_TRIGGERS.filter((trigger) => triggers.includes(trigger)).map(
    (trigger) => `forbidden trigger ${trigger}`,
  );
}

const MINUTE_OFF_THE_TURN = /^0*[1-9]$|^[1-5][0-9]$/;

function schedulesOf(on: unknown): unknown[] {
  if (!isMapping(on) || !Array.isArray(on.schedule)) return [];
  return on.schedule.map((entry: unknown) => (isMapping(entry) ? entry.cron : undefined));
}

function scheduleViolations(workflow: Mapping): string[] {
  return schedulesOf(workflow.on)
    .filter((cron) => {
      const minutes = typeof cron === "string" ? (cron.trim().split(/\s+/)[0] ?? "") : "";
      return !minutes.split(",").every((minute) => MINUTE_OFF_THE_TURN.test(minute));
    })
    .map(
      (cron) =>
        `schedule "${String(cron)}" must list minutes from 1 to 59; write literal minutes off the turn of the hour, where GitHub delays and drops scheduled runs`,
    );
}

function isReadOnly(grant: unknown): boolean {
  return READ_ONLY_GRANTS.some((readOnly) => readOnly === grant);
}

function permissionViolations(workflow: Mapping): string[] {
  if (!("permissions" in workflow)) return ["top-level permissions missing"];
  const { permissions } = workflow;
  if (permissions === "read-all") return [];
  if (!isMapping(permissions)) return [`top-level permissions not read-only (${String(permissions)})`];
  return Object.entries(permissions)
    .filter(([, grant]) => !isReadOnly(grant))
    .map(([scope, grant]) => `top-level permissions not read-only (${scope}: ${String(grant)})`);
}

function audit(file: string, source: string): Violation[] {
  let workflow: unknown;
  try {
    workflow = Bun.YAML.parse(source);
  } catch (error) {
    return [{ file, reason: `invalid YAML: ${error instanceof Error ? error.message : String(error)}` }];
  }
  if (!isMapping(workflow)) return [{ file, reason: "not a workflow mapping" }];
  return [...triggerViolations(workflow), ...scheduleViolations(workflow), ...permissionViolations(workflow)].map(
    (reason) => ({ file, reason }),
  );
}

function fail(lines: readonly string[]): never {
  console.log("workflow policy: violated");
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

function workflowFiles(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .toSorted();
  } catch (error) {
    fail([`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

const directory = process.argv[2];
if (directory === undefined) fail(["usage: workflow-policy <workflows-directory>"]);

const files = workflowFiles(directory);
if (files.length === 0) fail([`no workflows found in ${directory}`]);

const violations = files.flatMap((file) => audit(file, readFileSync(join(directory, file), "utf8")));
if (violations.length > 0) fail(violations.map(({ file, reason }) => `${file}: ${reason}`));

console.log(`workflow policy: ok (${files.join(", ")})`);
