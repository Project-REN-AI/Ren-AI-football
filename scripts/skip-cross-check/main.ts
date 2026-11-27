// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { GitHubIssueTracker } from "../failure-reporter/github-issue-tracker";
import { runSkipCrossCheck } from "./cli";

function takeVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`skip-cross-check: missing environment variable ${name}`);
    process.exit(1);
  }
  delete process.env[name];
  return value;
}

const issueTracker = new GitHubIssueTracker({
  token: takeVariable("GH_TOKEN"),
  repository: takeVariable("REPOSITORY"),
});
const { exitCode, output } = await runSkipCrossCheck(process.argv.slice(2), { issueTracker, cwd: process.cwd() });
console.log(output);
process.exit(exitCode);
