// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const PASSING_RESULTS: readonly string[] = ["success", "skipped"];

interface JobResult {
  readonly job: string;
  readonly result: string;
}

function parseNeeds(raw: string | undefined): JobResult[] {
  if (raw === undefined) throw new Error("usage: gate-verdict '<toJSON(needs)>'");
  const needs: unknown = JSON.parse(raw);
  if (typeof needs !== "object" || needs === null || Array.isArray(needs)) {
    throw new Error("job results must be a JSON object keyed by job id");
  }
  return Object.entries(needs).map(([job, value]: [string, unknown]) => {
    if (typeof value !== "object" || value === null || !("result" in value) || typeof value.result !== "string") {
      throw new Error(`job ${job} has no result`);
    }
    return { job, result: value.result };
  });
}

function fail(lines: readonly string[]): never {
  console.log("gate: red");
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

let jobs: JobResult[];
try {
  jobs = parseNeeds(process.argv[2]);
} catch (error) {
  fail([error instanceof Error ? error.message : String(error)]);
}

if (jobs.length === 0) fail(["no jobs to judge"]);

const culprits = jobs.filter(({ result }) => !PASSING_RESULTS.includes(result));
if (culprits.length > 0) fail(culprits.map(({ job, result }) => `${job}: ${result}`));

console.log(`gate: green (${jobs.map(({ job, result }) => `${job}: ${result}`).join(", ")})`);
