// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { type IssueState, type IssueTracker, type NewIssue, signatureMarker, type TrackedIssue } from "./issue-tracker";

export interface RecordedIssue extends NewIssue {
  readonly number: number;
  state: IssueState;
  readonly comments: string[];
}

export class InMemoryIssueTracker implements IssueTracker {
  readonly issues: RecordedIssue[] = [];

  async findLatestBySignature(signature: string): Promise<TrackedIssue | undefined> {
    const issue = this.issues.findLast(({ body }) => body.includes(signatureMarker(signature)));
    return issue && { number: issue.number, state: issue.state };
  }

  async createIssue(issue: NewIssue): Promise<TrackedIssue> {
    const recorded: RecordedIssue = { ...issue, number: this.issues.length + 1, state: "open", comments: [] };
    this.issues.push(recorded);
    return { number: recorded.number, state: recorded.state };
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    const issue = this.issues.find(({ number }) => number === issueNumber);
    if (!issue) throw new Error(`no issue #${issueNumber}`);
    issue.comments.push(body);
  }

  close(issueNumber: number): void {
    const issue = this.issues.find(({ number }) => number === issueNumber);
    if (!issue) throw new Error(`no issue #${issueNumber}`);
    issue.state = "closed";
  }
}
