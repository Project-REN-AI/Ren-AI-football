// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export const BOARD_STATUSES = ["Backlog", "Ready", "In progress", "In review", "Done"] as const;

export type BoardStatus = (typeof BOARD_STATUSES)[number];

const READY_LABELS = ["ready-for-agent", "ready-for-human"] as const;

export interface IssueSnapshot {
  readonly closed: boolean;
  readonly assigneeCount: number;
  readonly openClosingPullRequestCount: number;
  readonly openBlockerCount: number;
  readonly labels: readonly string[];
}

/**
 * Returns the board column an issue belongs in, derived only from the issue's own state.
 * The first matching rule wins: closed, then under review, then claimed, then ready, then backlog.
 */
export function desiredStatus(issue: IssueSnapshot): BoardStatus {
  if (issue.closed) return "Done";
  if (issue.openClosingPullRequestCount > 0) return "In review";
  if (issue.assigneeCount > 0) return "In progress";
  const hasReadyLabel = issue.labels.some((label) => (READY_LABELS as readonly string[]).includes(label));
  if (hasReadyLabel && issue.openBlockerCount === 0) return "Ready";
  return "Backlog";
}
