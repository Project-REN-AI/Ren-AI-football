// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const JOB_RESULTS = ["success", "failure", "cancelled", "skipped"] as const;

type JobResult = (typeof JOB_RESULTS)[number];

interface JudgedJob {
  readonly job: string;
  readonly result: JobResult;
}

function isJobResult(value: unknown): value is JobResult {
  return JOB_RESULTS.some((result) => result === value);
}

function passes(result: JobResult): boolean {
  switch (result) {
    case "success":
    case "skipped":
      return true;
    case "failure":
    case "cancelled":
      return false;
  }
}

function parseNeeds(raw: string | undefined): JudgedJob[] {
  if (raw === undefined) throw new Error("usage: gate-verdict '<toJSON(needs)>'");
  const needs: unknown = JSON.parse(raw);
  if (typeof needs !== "object" || needs === null || Array.isArray(needs)) {
    throw new Error("job results must be a JSON object keyed by job id");
  }
  return Object.entries(needs).map(([job, value]: [string, unknown]) => {
    const result = typeof value === "object" && value !== null && "result" in value ? value.result : undefined;
    if (!isJobResult(result)) throw new Error(`job ${job} has no known result: ${JSON.stringify(result)}`);
    return { job, result };
  });
}

function describe({ job, result }: JudgedJob): string {
  return `${job}: ${result}`;
}

function fail(lines: readonly string[]): never {
  console.log("gate: red");
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

let jobs: JudgedJob[];
try {
  jobs = parseNeeds(process.argv[2]);
} catch (error) {
  fail([error instanceof Error ? error.message : String(error)]);
}

if (jobs.length === 0) fail(["no jobs to judge"]);

const culprits = jobs.filter(({ result }) => !passes(result));
if (culprits.length > 0) fail(culprits.map(describe));

console.log(`gate: green (${jobs.map(describe).join(", ")})`);
