// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
  carriesSignature,
  type FailureSignature,
  type IssueState,
  type IssueTracker,
  type NewIssue,
  type TrackedIssue,
} from "./issue-tracker";

export interface RecordedIssue extends NewIssue {
  readonly number: number;
  state: IssueState;
  readonly comments: string[];
}

export class InMemoryIssueTracker implements IssueTracker {
  readonly issues: RecordedIssue[] = [];

  async findLatestBySignature(signature: FailureSignature): Promise<TrackedIssue | undefined> {
    const issue = this.issues.findLast(({ body }) => carriesSignature(body, signature));
    return issue && { number: issue.number, state: issue.state };
  }

  async createIssue(issue: NewIssue): Promise<TrackedIssue> {
    const recorded: RecordedIssue = { ...issue, number: this.issues.length + 1, state: "open", comments: [] };
    this.issues.push(recorded);
    return { number: recorded.number, state: recorded.state };
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    this.issue(issueNumber).comments.push(body);
  }

  close(issueNumber: number): void {
    this.issue(issueNumber).state = "closed";
  }

  private issue(issueNumber: number): RecordedIssue {
    const issue = this.issues.find(({ number }) => number === issueNumber);
    if (!issue) throw new Error(`no issue #${issueNumber}`);
    return issue;
  }
}
