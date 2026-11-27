// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
  carriesSignature,
  type FailureSignature,
  type IssueState,
  type IssueTracker,
  type NewIssue,
  type TrackedIssue,
} from "./issue-tracker";

const API = "https://api.github.com";
const CI_BOT_LABEL = "ci-bot";
const PAGE_SIZE = 100;

interface GitHubIssue {
  readonly number: number;
  readonly state: IssueState;
  readonly body?: string | null;
  readonly pull_request?: unknown;
}

export interface GitHubIssueTrackerOptions {
  readonly token: string;
  readonly repository: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** IssueTracker over the GitHub REST API, authenticated with the scout-ci-bot installation token. */
export class GitHubIssueTracker implements IssueTracker {
  private readonly token: string;
  private readonly repository: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor({ token, repository, fetch = globalThis.fetch }: GitHubIssueTrackerOptions) {
    this.token = token;
    this.repository = repository;
    this.fetch = fetch;
  }

  async findLatestBySignature(signature: FailureSignature): Promise<TrackedIssue | undefined> {
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        labels: CI_BOT_LABEL,
        state: "all",
        sort: "created",
        direction: "desc",
        per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const issues = await this.request<GitHubIssue[]>("GET", `/issues?${query.toString()}`);
      if (issues.length === 0) return undefined;
      const found = issues.find(({ body, pull_request }) => !pull_request && carriesSignature(body ?? "", signature));
      if (found) return { number: found.number, state: found.state };
    }
  }

  async createIssue({ title, body, labels }: NewIssue): Promise<TrackedIssue> {
    const created = await this.request<GitHubIssue>("POST", "/issues", { title, body, labels });
    return { number: created.number, state: created.state };
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    await this.request("POST", `/issues/${issueNumber}/comments`, { body });
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const route = `/repos/${this.repository}${path}`;
    const response = await this.fetch(`${API}${route}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof payload === "object" && payload !== null && "message" in payload
          ? String(payload.message)
          : JSON.stringify(payload);
      throw new Error(`${method} ${route.split("?")[0]} failed (${response.status}): ${message}`);
    }
    return payload as T;
  }
}
