// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export type FailureSignature = string & { readonly __brand: "FailureSignature" };

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

/** Finds, opens and comments on CI failure issues, identified by the signature marker on the first body line. */
export interface IssueTracker {
  /** Returns the most recently created issue whose body carries the signature marker, open or closed. */
  findLatestBySignature(signature: FailureSignature): Promise<TrackedIssue | undefined>;
  createIssue(issue: NewIssue): Promise<TrackedIssue>;
  comment(issueNumber: number, body: string): Promise<void>;
}

/** The invisible HTML marker that carries a failure signature; it must be the first line of the issue body. */
export function signatureMarker(signature: FailureSignature): string {
  return `<!-- scout-ci-bot:failure-signature ${signature} -->`;
}

/** Whether the body's first line is the marker of this signature, so text further down never matches. */
export function carriesSignature(body: string, signature: FailureSignature): boolean {
  return body.split("\n", 1)[0] === signatureMarker(signature);
}
