// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { desiredStatus, type IssueSnapshot } from "./status";

const openReadyIssue: IssueSnapshot = {
  closed: false,
  assigneeCount: 0,
  openClosingPullRequestCount: 0,
  openBlockerCount: 0,
  labels: ["ready-for-agent"],
};

describe("desiredStatus", () => {
  it("puts a closed issue in Done whatever else is true", () => {
    expect(desiredStatus({ ...openReadyIssue, closed: true, assigneeCount: 1, openClosingPullRequestCount: 1 })).toBe(
      "Done",
    );
  });

  it("puts an issue with an open closing pull request in In review", () => {
    expect(desiredStatus({ ...openReadyIssue, assigneeCount: 1, openClosingPullRequestCount: 1 })).toBe("In review");
  });

  it("puts an assigned issue in In progress", () => {
    expect(desiredStatus({ ...openReadyIssue, assigneeCount: 1 })).toBe("In progress");
  });

  it("keeps an assigned issue in In progress even while a blocker is open", () => {
    expect(desiredStatus({ ...openReadyIssue, assigneeCount: 1, openBlockerCount: 1 })).toBe("In progress");
  });

  it("puts an unassigned ready-for-agent issue without open blockers in Ready", () => {
    expect(desiredStatus(openReadyIssue)).toBe("Ready");
  });

  it("puts an unassigned ready-for-human issue without open blockers in Ready", () => {
    expect(desiredStatus({ ...openReadyIssue, labels: ["ready-for-human"] })).toBe("Ready");
  });

  it("keeps a ready issue with an open blocker in Backlog", () => {
    expect(desiredStatus({ ...openReadyIssue, openBlockerCount: 2 })).toBe("Backlog");
  });

  it("keeps an issue without a ready label in Backlog", () => {
    expect(desiredStatus({ ...openReadyIssue, labels: ["needs-triage"] })).toBe("Backlog");
  });
});
