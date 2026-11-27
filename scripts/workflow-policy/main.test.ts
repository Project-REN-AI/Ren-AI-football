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

function workflow({ on = "pull_request:", permissions = "permissions: {}", uses = CHECKOUT, job = "" } = {}): string {
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
    `      - uses: ${uses}`,
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

  it.each(["actions/checkout@v7", "actions/checkout@main", "actions/checkout@3d3c42e", "docker://alpine:3"])(
    "rejects an action not pinned by SHA (%s)",
    (uses) => {
      const directory = workflowsDirectory({ "ci.yml": workflow({ uses }) });

      const { exitCode, output } = runWorkflowPolicy(directory);

      expect(exitCode).toBe(1);
      expect(output).toContain(`ci.yml: action not pinned by SHA (${uses})`);
    },
  );

  it.each([
    "./.github/actions/setup",
    "docker://alpine@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1",
  ])("accepts a local or digest-pinned action (%s)", (uses) => {
    const directory = workflowsDirectory({ "ci.yml": workflow({ uses }) });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(output).toContain("workflow policy: ok");
    expect(exitCode).toBe(0);
  });

  it("rejects a reusable workflow not pinned by SHA", () => {
    const directory = workflowsDirectory({
      "ci.yml": "on: push\npermissions: {}\njobs:\n  call:\n    uses: octo/repo/.github/workflows/w.yml@v1\n",
    });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("ci.yml: action not pinned by SHA (octo/repo/.github/workflows/w.yml@v1)");
  });

  it("reports every violation of every workflow", () => {
    const directory = workflowsDirectory({
      "a.yml": workflow({ on: "pull_request_target:", uses: "actions/checkout@v7" }),
      "b.yml": workflow({ permissions: "" }),
    });

    const { exitCode, output } = runWorkflowPolicy(directory);

    expect(exitCode).toBe(1);
    expect(output).toContain("a.yml: forbidden trigger pull_request_target");
    expect(output).toContain("a.yml: action not pinned by SHA (actions/checkout@v7)");
    expect(output).toContain("b.yml: top-level permissions missing");
  });

  it("rejects an empty workflows directory", () => {
    const { exitCode, output } = runWorkflowPolicy(workflowsDirectory({}));

    expect(exitCode).toBe(1);
    expect(output).toContain("no workflows found");
  });
});
