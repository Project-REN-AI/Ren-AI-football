// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { gitHubIssueTrackerFromEnvironment } from "../failure-reporter/github-issue-tracker";
import { runSkipCrossCheck } from "./cli";

const issueTracker = gitHubIssueTrackerFromEnvironment("skip-cross-check");
const { exitCode, output } = await runSkipCrossCheck(process.argv.slice(2), { issueTracker, cwd: process.cwd() });
console.log(output);
process.exit(exitCode);
