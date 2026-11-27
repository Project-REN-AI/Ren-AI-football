// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./main.ts", import.meta.url));
const REPOSITORY_WORKFLOWS = fileURLToPath(new URL("../../.github/workflows", import.meta.url));
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";

function runWorkflowPolicy(directory: string): { exitCode: number | null; output: string } {
  const result = spawnSync("bun", [CLI, directory], { encoding: "utf8" });
  return { exitCode: result.status, output: result.stdout + result.stderr };
}

function workflowsDirectory(workflows: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "workflow-policy-"));
  for (const [name, content] of Object.entries(workflows)) writeFileSync(join(directory, name), content);
  return directory;
}

function workflow({ on = "pull_request:", permissions = "permissions: {}", job = "" } = {}): string {
  return [
    "name: fixture",
    "on:",
    `  ${on}`,
    permissions,
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    job,
    "    steps:",
    `      - uses: ${CHECKOUT}`,
    "",
  ].join("\n");
}

describe("workflow policy CLI", () => {
  it("accepts the repository's own workflows", () => {
    const { exitCode, output } = runWorkflowPolicy(REPOSITORY_WORKFLOWS);

    expect(output).toContain("workflow policy: ok");
    expect(exitCode).toBe(0);
  });

  it("accepts read-only top-level permissions with a job that writes", () => {
    const directory = workflowsDirectory({
      "ci.yml": workflow({
        permissions: "permissions:\n  contents: read",
        job: "    permissions:\n      issues: write",
      }),
    });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(output).toContain("workflow policy: ok");
    expect(exitCode).toBe(0);
  });

  it.each(["pull_request_target", "issue_comment", "workflow_run"])("rejects the %s trigger", (trigger) => {
    const directory = workflowsDirectory({ "ci.yml": workflow({ on: `${trigger}:` }) });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain(`ci.yml: forbidden trigger ${trigger}`);
  });

  it("rejects a forbidden trigger written as a list", () => {
    const directory = workflowsDirectory({
      "ci.yaml": "on: [push, issue_comment]\npermissions: {}\njobs: {}\n",
    });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("ci.yaml: forbidden trigger issue_comment");
  });

  it("rejects a forbidden trigger written as a single event", () => {
    const directory = workflowsDirectory({ "ci.yml": "on: workflow_run\npermissions: {}\njobs: {}\n" });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("ci.yml: forbidden trigger workflow_run");
  });

  it("rejects a workflow without top-level permissions", () => {
    const directory = workflowsDirectory({ "ci.yml": workflow({ permissions: "" }) });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("ci.yml: top-level permissions missing");
  });

  it.each([
    ["permissions:\n  contents: write", "contents: write"],
    ["permissions: write-all", "write-all"],
  ])("rejects write access at the top level (%s)", (permissions, grant) => {
    const directory = workflowsDirectory({ "ci.yml": workflow({ permissions }) });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain(`ci.yml: top-level permissions not read-only (${grant})`);
  });

  it("reports every violation of every workflow", () => {
    const directory = workflowsDirectory({
      "a.yml": workflow({ on: "pull_request_target:", permissions: "permissions: write-all" }),
      "b.yml": workflow({ permissions: "" }),
    });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("a.yml: forbidden trigger pull_request_target");
    expect(output).toContain("a.yml: top-level permissions not read-only (write-all)");
    expect(output).toContain("b.yml: top-level permissions missing");
  });

  it("rejects a workflow that is not valid YAML", () => {
    const directory = workflowsDirectory({ "ci.yml": "on: [push\n" });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("workflow policy: violated");
    expect(output).toContain("ci.yml: invalid YAML");
  });

  it("rejects a missing workflows directory", () => {
    const { exitCode, output } = runWorkflowPolicy(join(tmpdir(), "workflow-policy-missing"));

    expect(exitCode).toBe(1);
    expect(output).toContain("workflow policy: violated");
    expect(output).toContain("cannot read");
  });

  it("rejects an empty workflows directory", () => {
    const { exitCode, output } = runWorkflowPolicy(workflowsDirectory({}));

    expect(exitCode).toBe(1);
    expect(output).toContain("no workflows found");
  });
});
