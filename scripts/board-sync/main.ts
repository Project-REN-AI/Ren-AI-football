// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BOARD_STATUSES, type BoardStatus, desiredStatus } from "./status";

const API = "https://api.github.com";
const STATUS_FIELD = "Status";

interface Env {
  readonly token: string;
  readonly projectOwner: string;
  readonly projectNumber: number;
  readonly repository: string;
}

interface StatusField {
  readonly fieldId: string;
  readonly optionIdByStatus: ReadonlyMap<BoardStatus, string>;
}

interface BoardIssue {
  readonly itemId: string;
  readonly number: number;
  readonly closed: boolean;
  readonly assigneeCount: number;
  readonly openClosingPullRequestCount: number;
  readonly labels: readonly string[];
  readonly currentStatus: string | null;
}

function readEnv(): Env {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`missing environment variable ${name}`);
    return value;
  };
  const projectNumber = Number(required("PROJECT_NUMBER"));
  if (!Number.isInteger(projectNumber) || projectNumber <= 0)
    throw new Error("PROJECT_NUMBER must be a positive integer");
  return {
    token: required("GH_TOKEN"),
    projectOwner: required("PROJECT_OWNER"),
    projectNumber,
    repository: required("REPOSITORY"),
  };
}

async function graphql<T>(env: Env, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await response.json()) as { data?: T; errors?: unknown };
  if (!response.ok || payload.errors || !payload.data) {
    throw new Error(`GraphQL request failed (${response.status}): ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.data;
}

async function openBlockerCount(env: Env, issueNumber: number): Promise<number> {
  const response = await fetch(`${API}/repos/${env.repository}/issues/${issueNumber}`, {
    headers: { authorization: `Bearer ${env.token}`, accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`reading issue #${issueNumber} failed (${response.status})`);
  const issue = (await response.json()) as { issue_dependencies_summary?: { blocked_by?: number } };
  return issue.issue_dependencies_summary?.blocked_by ?? 0;
}

const PROJECT_QUERY = `
query($owner: String!, $number: Int!, $after: String) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: "${STATUS_FIELD}") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValueByName(name: "${STATUS_FIELD}") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content {
            ... on Issue {
              number
              state
              repository { nameWithOwner }
              assignees { totalCount }
              labels(first: 50) { nodes { name } }
              closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount }
            }
          }
        }
      }
    }
  }
}`;

type StatusFieldNode = { id: string; options: { id: string; name: string }[] } | null;

interface ProjectPage {
  organization: {
    projectV2: {
      id: string;
      field: StatusFieldNode;
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          fieldValueByName: { name?: string } | null;
          content: {
            number?: number;
            state?: "OPEN" | "CLOSED";
            repository?: { nameWithOwner: string };
            assignees?: { totalCount: number };
            labels?: { nodes: { name: string }[] };
            closedByPullRequestsReferences?: { totalCount: number };
          } | null;
        }[];
      };
    } | null;
  };
}

function toStatusField(field: StatusFieldNode): StatusField {
  if (!field) throw new Error(`project has no single-select field named ${STATUS_FIELD}`);
  const optionIdByStatus = new Map<BoardStatus, string>();
  for (const status of BOARD_STATUSES) {
    const option = field.options.find((candidate) => candidate.name.toLowerCase() === status.toLowerCase());
    if (!option) throw new Error(`field ${STATUS_FIELD} has no option named "${status}"`);
    optionIdByStatus.set(status, option.id);
  }
  return { fieldId: field.id, optionIdByStatus };
}

async function readBoard(env: Env): Promise<{ projectId: string; statusField: StatusField; issues: BoardIssue[] }> {
  const issues: BoardIssue[] = [];
  let after: string | null = null;
  let projectId = "";
  let statusField: StatusField | null = null;
  do {
    const page: ProjectPage = await graphql<ProjectPage>(env, PROJECT_QUERY, {
      owner: env.projectOwner,
      number: env.projectNumber,
      after,
    });
    const project = page.organization.projectV2;
    if (!project) throw new Error(`project ${env.projectOwner}#${env.projectNumber} not found or not accessible`);
    projectId = project.id;
    statusField ??= toStatusField(project.field);
    for (const node of project.items.nodes) {
      const content = node.content;
      if (!content?.number || content.repository?.nameWithOwner !== env.repository) continue;
      issues.push({
        itemId: node.id,
        number: content.number,
        closed: content.state === "CLOSED",
        assigneeCount: content.assignees?.totalCount ?? 0,
        openClosingPullRequestCount: content.closedByPullRequestsReferences?.totalCount ?? 0,
        labels: content.labels?.nodes.map((label) => label.name) ?? [],
        currentStatus: node.fieldValueByName?.name ?? null,
      });
    }
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after);
  if (!statusField) throw new Error("project returned no pages");
  return { projectId, statusField, issues };
}

const UPDATE_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}`;

async function main(): Promise<void> {
  const env = readEnv();
  const { projectId, statusField, issues } = await readBoard(env);
  let moved = 0;
  for (const issue of issues) {
    const blockers = issue.closed ? 0 : await openBlockerCount(env, issue.number);
    const target = desiredStatus({ ...issue, openBlockerCount: blockers });
    if (issue.currentStatus?.toLowerCase() === target.toLowerCase()) continue;
    await graphql(env, UPDATE_MUTATION, {
      projectId,
      itemId: issue.itemId,
      fieldId: statusField.fieldId,
      optionId: statusField.optionIdByStatus.get(target),
    });
    console.log(`#${issue.number}: ${issue.currentStatus ?? "(no status)"} -> ${target}`);
    moved += 1;
  }
  console.log(`board-sync: ${issues.length} issues checked, ${moved} moved`);
}

await main();
