// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFailureReporter } from "./cli";
import { InMemoryIssueTracker } from "./in-memory-issue-tracker";

interface FailureFixture {
  service: string;
  check: string;
  kind: string;
  seed: string;
  reproduce: string;
  failsOn?: number[];
  output?: string;
}

const RUN = {
  layer: "C3",
  sha: "4d375a5f0c9e2b7a1d3e5f7a9b1c3d5e7f9a1b3c",
  runUrl: "https://github.com/Project-REN-AI/Ren-AI-football/actions/runs/42",
};

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "failure-reporter-"));
}

function writeRun(dir: string, failures: readonly FailureFixture[]): string {
  const path = join(dir, "run.json");
  writeFileSync(path, JSON.stringify({ ...RUN, failures }));
  return path;
}

function failure(overrides: Partial<FailureFixture>): FailureFixture {
  return {
    service: "web",
    check: "unit",
    kind: "test",
    seed: "1337",
    reproduce: "exit 1",
    ...overrides,
  };
}

describe("failure reporter CLI", () => {
  it("opens a ready-for-agent bug issue when the failure repeats in every rerun", async () => {
    const dir = workspace();
    const runs = join(dir, "runs.log");
    const run = writeRun(dir, [
      failure({ reproduce: `echo "seed=$SCOUT_TEST_SEED" >> ${runs}; echo "expected 2, got 3"; exit 1` }),
    ]);
    const tracker = new InMemoryIssueTracker();

    const { exitCode, output } = await runFailureReporter([run], { issueTracker: tracker });

    expect(exitCode).toBe(0);
    expect(readFileSync(runs, "utf8")).toBe("seed=1337\nseed=1337\nseed=1337\n");
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]?.title).toBe("ci: web unit falhou");
    expect(tracker.issues[0]?.labels).toEqual(["ci-bot", "bug", "ready-for-agent"]);
    expect(output).toContain("confirmed web unit: opened #1");
  });

  it("opens a needs-triage flaky issue when the failure passes in a rerun", async () => {
    const dir = workspace();
    const attempts = join(dir, "attempts");
    const run = writeRun(dir, [
      failure({
        check: "race",
        reproduce: `echo x >> ${attempts}; [ "$(wc -l < ${attempts})" -ge 2 ]`,
      }),
    ]);
    const tracker = new InMemoryIssueTracker();

    const { exitCode, output } = await runFailureReporter([run], { issueTracker: tracker });

    expect(exitCode).toBe(0);
    expect(readFileSync(attempts, "utf8")).toBe("x\nx\n");
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]?.labels).toEqual(["ci-bot", "flaky", "needs-triage"]);
    expect(output).toContain("flaky web race: opened #1");
  });

  it("opens nothing and reruns nothing for an infrastructure failure", async () => {
    const dir = workspace();
    const attempts = join(dir, "attempts");
    const run = writeRun(dir, [failure({ kind: "infrastructure", reproduce: `echo x >> ${attempts}; exit 1` })]);
    const tracker = new InMemoryIssueTracker();

    const { exitCode, output } = await runFailureReporter([run], { issueTracker: tracker });

    expect(exitCode).toBe(0);
    expect(existsSync(attempts)).toBe(false);
    expect(tracker.issues).toHaveLength(0);
    expect(output).toContain("infrastructure web unit: ignored");
  });

  it("files nothing when a rerun exits with a code outside the failure's failsOn", async () => {
    const dir = workspace();
    const attempts = join(dir, "attempts");
    const run = writeRun(dir, [
      failure({
        check: "govulncheck",
        kind: "vulnerability",
        failsOn: [3],
        reproduce: `echo x >> ${attempts}; [ "$(wc -l < ${attempts})" -ge 2 ] && exit 1; exit 3`,
      }),
    ]);
    const tracker = new InMemoryIssueTracker();

    const { exitCode, output } = await runFailureReporter([run], { issueTracker: tracker });

    expect(exitCode).toBe(0);
    expect(readFileSync(attempts, "utf8")).toBe("x\nx\n");
    expect(tracker.issues).toHaveLength(0);
    expect(output).toContain("infrastructure web govulncheck: ignored, a rerun exited 1");
  });

  it("confirms a failure whose reruns all exit with a code listed in failsOn", async () => {
    const dir = workspace();
    const run = writeRun(dir, [
      failure({ check: "govulncheck", kind: "vulnerability", failsOn: [3], reproduce: "exit 3" }),
    ]);
    const tracker = new InMemoryIssueTracker();

    const { output } = await runFailureReporter([run], { issueTracker: tracker });

    expect(tracker.issues[0]?.labels).toEqual(["ci-bot", "bug", "ready-for-agent"]);
    expect(output).toContain("confirmed web govulncheck: opened #1");
  });

  it("writes the failure signature marker and the fixed template in the issue body", async () => {
    const dir = workspace();
    const run = writeRun(dir, [failure({ reproduce: "echo first line; seq 1 5000; echo last line; exit 1" })]);
    const tracker = new InMemoryIssueTracker();

    await runFailureReporter([run], { issueTracker: tracker });

    const body = tracker.issues[0]?.body ?? "";
    expect(body).toContain("<!-- scout-ci-bot:failure-signature 0ba133238eb040d6 -->");
    expect(body).toContain("**Assinatura:** `0ba133238eb040d6`");
    expect(body).toContain("**Camada:** C3");
    expect(body).toContain(`**SHA:** \`${RUN.sha}\``);
    expect(body).toContain(`**Execução:** ${RUN.runUrl}`);
    expect(body).toContain("**Seed:** `1337`");
    expect(body).toContain(
      "```sh\nexport SCOUT_TEST_SEED=1337\necho first line; seq 1 5000; echo last line; exit 1\n```",
    );
    expect(body).toContain("last line");
    expect(body).not.toContain("first line\n");
    expect(body.length).toBeLessThan(12_000);
  });

  it("comments on the open issue that already carries the same failure signature", async () => {
    const dir = workspace();
    const tracker = new InMemoryIssueTracker();
    await runFailureReporter([writeRun(dir, [failure({})])], { issueTracker: tracker });

    const { exitCode, output } = await runFailureReporter([writeRun(dir, [failure({ seed: "2024" })])], {
      issueTracker: tracker,
    });

    expect(exitCode).toBe(0);
    expect(tracker.issues).toHaveLength(1);
    expect(tracker.issues[0]?.comments).toHaveLength(1);
    expect(tracker.issues[0]?.comments[0]).toContain("**Seed:** `2024`");
    expect(tracker.issues[0]?.comments[0]).toContain(`**Execução:** ${RUN.runUrl}`);
    expect(output).toContain("confirmed web unit: commented on #1");
  });

  it("opens a new issue citing the closed one when the failure comes back", async () => {
    const dir = workspace();
    const tracker = new InMemoryIssueTracker();
    await runFailureReporter([writeRun(dir, [failure({})])], { issueTracker: tracker });
    tracker.close(1);

    const { exitCode, output } = await runFailureReporter([writeRun(dir, [failure({})])], { issueTracker: tracker });

    expect(exitCode).toBe(0);
    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[0]?.comments).toHaveLength(0);
    expect(tracker.issues[1]?.body).toContain("Volta da falha de #1");
    expect(tracker.issues[1]?.body).toContain("<!-- scout-ci-bot:failure-signature 0ba133238eb040d6 -->");
    expect(output).toContain("confirmed web unit: opened #2");
  });

  it("exits 1 without touching the tracker when the run result is malformed", async () => {
    const dir = workspace();
    const path = join(dir, "run.json");
    writeFileSync(path, JSON.stringify({ ...RUN, failures: [{ service: "web", check: "unit" }] }));
    const tracker = new InMemoryIssueTracker();

    const { exitCode, output } = await runFailureReporter([path], { issueTracker: tracker });

    expect(exitCode).toBe(1);
    expect(output).toContain("failures[0].kind");
    expect(tracker.issues).toHaveLength(0);
  });

  it("exits 1 with usage when no run result is given", async () => {
    const { exitCode, output } = await runFailureReporter([], { issueTracker: new InMemoryIssueTracker() });

    expect(exitCode).toBe(1);
    expect(output).toContain("usage: failure-reporter <run-result.json>");
  });

  it("shows the failing output, not the passing rerun, in a flaky issue", async () => {
    const dir = workspace();
    const attempts = join(dir, "attempts");
    const run = writeRun(dir, [
      failure({
        reproduce: `echo x >> ${attempts}; if [ "$(wc -l < ${attempts})" -ge 2 ]; then echo "passing-$SCOUT_TEST_SEED"; else echo "failing-$SCOUT_TEST_SEED"; exit 1; fi`,
      }),
    ]);
    const tracker = new InMemoryIssueTracker();

    await runFailureReporter([run], { issueTracker: tracker });

    expect(tracker.issues[0]?.body).toContain("failing-1337");
    expect(tracker.issues[0]?.body).not.toContain("passing-1337");
  });

  it("ignores a failure signature marker printed inside the test output", async () => {
    const dir = workspace();
    const tracker = new InMemoryIssueTracker();
    const plantedMarker = "<!-- scout-ci-bot:failure-signature c73fad8323fbbd5b -->";
    await runFailureReporter([writeRun(dir, [failure({ reproduce: `echo '${plantedMarker}'; exit 1` })])], {
      issueTracker: tracker,
    });

    const { output } = await runFailureReporter([writeRun(dir, [failure({ service: "api" })])], {
      issueTracker: tracker,
    });

    expect(tracker.issues).toHaveLength(2);
    expect(tracker.issues[0]?.comments).toHaveLength(0);
    expect(output).toContain("confirmed api unit: opened #2");
  });
});
