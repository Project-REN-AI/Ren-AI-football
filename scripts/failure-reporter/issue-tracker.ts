// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { createHash } from "node:crypto";

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

/** The FailureSignature of a stable identity: the first 16 hex digits of the sha256 of its parts, one per line. */
export function failureSignatureOf(...parts: readonly string[]): FailureSignature {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16) as FailureSignature;
}

export interface FiledIssue {
  readonly number: number;
  readonly opened: boolean;
}

/**
 * Comments on the open issue that carries the signature; otherwise opens the issue built from the closed one, if
 * any. The new issue's body must start with the signature marker.
 */
export async function fileBySignature(
  issueTracker: IssueTracker,
  signature: FailureSignature,
  {
    comment,
    newIssue,
  }: { readonly comment: string; readonly newIssue: (closed: TrackedIssue | undefined) => NewIssue },
): Promise<FiledIssue> {
  const latest = await issueTracker.findLatestBySignature(signature);
  if (latest?.state === "open") {
    await issueTracker.comment(latest.number, comment);
    return { number: latest.number, opened: false };
  }
  const issue = await issueTracker.createIssue(newIssue(latest));
  return { number: issue.number, opened: true };
}

/** How a filing reads in a script's log. */
export function describeFiling({ number, opened }: FiledIssue): string {
  return opened ? `opened #${number}` : `commented on #${number}`;
}
