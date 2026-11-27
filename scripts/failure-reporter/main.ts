// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { runFailureReporter } from "./cli";
import { GitHubIssueTracker } from "./github-issue-tracker";

function takeVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`failure-reporter: missing environment variable ${name}`);
    process.exit(1);
  }
  delete process.env[name];
  return value;
}

const issueTracker = new GitHubIssueTracker({
  token: takeVariable("GH_TOKEN"),
  repository: takeVariable("REPOSITORY"),
});
const { exitCode, output } = await runFailureReporter(process.argv.slice(2), { issueTracker });
console.log(output);
process.exit(exitCode);
