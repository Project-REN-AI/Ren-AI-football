// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export type IssueState = "open" | "closed";

export interface TrackedIssue {
  readonly number: number;
  readonly state: IssueState;
}

export interface NewIssue {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/**
 * The only port from CI scripts to GitHub issues.
 * Issues are matched by the failure signature marker written in their body.
 */
export interface IssueTracker {
  /** Returns the most recently created issue carrying the signature marker, open or closed. */
  findLatestBySignature(signature: string): Promise<TrackedIssue | undefined>;
  createIssue(issue: NewIssue): Promise<TrackedIssue>;
  comment(issueNumber: number, body: string): Promise<void>;
}

/** The invisible HTML marker that carries a failure signature in an issue body. */
export function signatureMarker(signature: string): string {
  return `<!-- scout-ci-bot:failure-signature ${signature} -->`;
}
