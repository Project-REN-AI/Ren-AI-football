// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { runFailureReporter } from "./cli";
import { gitHubIssueTrackerFromEnvironment } from "./github-issue-tracker";

const issueTracker = gitHubIssueTrackerFromEnvironment("failure-reporter");
const { exitCode, output } = await runFailureReporter(process.argv.slice(2), { issueTracker });
console.log(output);
process.exit(exitCode);
