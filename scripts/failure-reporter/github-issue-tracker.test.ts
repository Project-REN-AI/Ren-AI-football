// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, expect, it } from "vitest";
import { GitHubIssueTracker } from "./github-issue-tracker";
import { type FailureSignature, signatureMarker } from "./issue-tracker";

const SIGNATURE = "0ba133238eb040d6" as FailureSignature;
const API = "https://api.github.com/repos/Project-REN-AI/Ren-AI-football";

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function fakeGitHub(respond: (request: RecordedRequest) => { status: number; json: unknown }) {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url: input instanceof Request ? input.url : input.toString(),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const { status, json } = respond(request);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

function tracker(fetch: typeof globalThis.fetch): GitHubIssueTracker {
  return new GitHubIssueTracker({ token: "installation-token", repository: "Project-REN-AI/Ren-AI-football", fetch });
}

function issue(number: number, state: string, body: string, extra: Record<string, unknown> = {}) {
  return { number, state, body, ...extra };
}

describe("GitHub issue tracker", () => {
  it("finds the newest ci-bot issue whose first body line is the signature marker, open or closed", async () => {
    const github = fakeGitHub(() => ({
      status: 200,
      json: [
        issue(9, "open", `text\n${signatureMarker(SIGNATURE)}`),
        issue(8, "open", signatureMarker(SIGNATURE), { pull_request: {} }),
        issue(7, "closed", `${signatureMarker(SIGNATURE)}\n## Falha`),
        issue(3, "open", `${signatureMarker(SIGNATURE)}\n## Falha`),
      ],
    }));

    const found = await tracker(github.fetch).findLatestBySignature(SIGNATURE);

    expect(found).toEqual({ number: 7, state: "closed" });
    const [request] = github.requests;
    expect(request?.method).toBe("GET");
    const url = new URL(request?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${API}/issues`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      labels: "ci-bot",
      state: "all",
      sort: "created",
      direction: "desc",
      page: "1",
    });
    expect(request?.headers.get("authorization")).toBe("Bearer installation-token");
  });

  it("reads the next page until it finds the signature or the pages run out", async () => {
    const pages: Record<string, unknown[]> = {
      "1": [issue(5, "open", "## other")],
      "2": [issue(2, "open", signatureMarker(SIGNATURE))],
    };
    const github = fakeGitHub(({ url }) => ({
      status: 200,
      json: pages[new URL(url).searchParams.get("page") ?? ""] ?? [],
    }));

    expect(await tracker(github.fetch).findLatestBySignature(SIGNATURE)).toEqual({ number: 2, state: "open" });
    expect(await tracker(github.fetch).findLatestBySignature("ffffffffffffffff" as FailureSignature)).toBeUndefined();
    expect(github.requests.map(({ url }) => new URL(url).searchParams.get("page"))).toEqual(["1", "2", "1", "2", "3"]);
  });

  it("creates the issue with title, body and labels", async () => {
    const github = fakeGitHub(() => ({ status: 201, json: issue(12, "open", "body") }));

    const created = await tracker(github.fetch).createIssue({
      title: "ci: web unit falhou",
      body: "body",
      labels: ["ci-bot", "bug", "ready-for-agent"],
    });

    expect(created).toEqual({ number: 12, state: "open" });
    expect(github.requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: `${API}/issues`,
        body: { title: "ci: web unit falhou", body: "body", labels: ["ci-bot", "bug", "ready-for-agent"] },
      }),
    ]);
  });

  it("comments on the issue", async () => {
    const github = fakeGitHub(() => ({ status: 201, json: { id: 1 } }));

    await tracker(github.fetch).comment(12, "## Nova ocorrência");

    expect(github.requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: `${API}/issues/12/comments`,
        body: { body: "## Nova ocorrência" },
      }),
    ]);
  });

  it("throws with the status when GitHub refuses the request", async () => {
    const github = fakeGitHub(() => ({ status: 403, json: { message: "Resource not accessible by integration" } }));

    await expect(tracker(github.fetch).comment(12, "x")).rejects.toThrow(
      "POST /repos/Project-REN-AI/Ren-AI-football/issues/12/comments failed (403): Resource not accessible by integration",
    );
  });
});
