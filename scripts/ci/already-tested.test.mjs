import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAlreadyTested,
  evaluateFullTierJobs,
  inspectAlreadyTested,
  safeInspectAlreadyTested,
} from "./already-tested.mjs";
const jobs = [
  { name: "gate", conclusion: "success" },
  { name: "e2e (full)", conclusion: "success" },
  { name: "sweeps (1/2)", conclusion: "success" },
  { name: "sweeps (2/2)", conclusion: "success" },
];
const proven = {
  event: "push",
  ref: "refs/heads/main",
  parents: ["P"],
  parentIsAncestor: true,
  mergeTree: "T",
  headTree: "T",
  prRunJobs: [jobs],
};
test("passing squash proof", () =>
  assert.equal(decideAlreadyTested(proven).tested, true));
for (const [name, change] of [
  ["not push", { event: "pull_request" }],
  ["not main", { ref: "refs/heads/release" }],
  ["no PR", { prRunJobs: [] }],
  ["tree mismatch", { headTree: "other" }],
  ["not ancestor", { parentIsAncestor: false }],
  ["two parents", { parents: ["P", "H"] }],
  [
    "smoke only",
    {
      prRunJobs: [
        [
          { name: "gate", conclusion: "success" },
          { name: "e2e (smoke)", conclusion: "success" },
        ],
      ],
    },
  ],
  [
    "failed sweep",
    {
      prRunJobs: [
        [
          { name: "gate", conclusion: "success" },
          { name: "e2e (full)", conclusion: "success" },
          { name: "sweeps (1/2)", conclusion: "failure" },
          { name: "sweeps (2/2)", conclusion: "success" },
        ],
      ],
    },
  ],
  ["skipped gate", { prRunJobs: [[{ name: "gate", conclusion: "skipped" }]] }],
])
  test(`${name} fails closed`, () =>
    assert.equal(decideAlreadyTested({ ...proven, ...change }).tested, false));
test("docs/workflow run with only a successful gate counts", () =>
  assert.equal(
    evaluateFullTierJobs([{ name: "gate", conclusion: "success" }]).passed,
    true,
  ));
test("cancelled jobs do not pass", () =>
  assert.equal(
    evaluateFullTierJobs([{ name: "gate", conclusion: "cancelled" }]).passed,
    false,
  ));
test("API errors fail closed", async () => {
  const result = await safeInspectAlreadyTested(
    {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "HEAD",
      GITHUB_API_URL: "https://api.invalid",
      GITHUB_REPOSITORY: "owner/repo",
      WORKFLOW_FILE: "ci.yml",
    },
    async () => {
      throw new Error("fixture API failure");
    },
    // A one-parent commit, so the API is reached even in CI's shallow checkout.
    () => "HEAD PARENT",
  );
  assert.equal(result.tested, false);
  assert.match(result.reason, /fixture API failure/);
});

// These are deliberately trimmed from .context/adc-ci/gh-commit-pulls.sample.json,
// gh-commit.sample.json, gh-runs.sample.json, and gh-jobs.sample.json.
const env = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "MERGE",
  GITHUB_API_URL: "https://api.github.test",
  GITHUB_REPOSITORY: "hiraya-dev/eunice-warren",
  WORKFLOW_FILE: "ci.yml",
};
const mergePr = [
  { merge_commit_sha: "MERGE", base: { ref: "main" }, head: { sha: "HEAD" } },
];
const commit = { commit: { tree: { sha: "TREE" } } };
const fixtureJobs = [
  { name: "gate", conclusion: "success" },
  { name: "e2e (full)", conclusion: "success" },
  { name: "sweeps (1/2)", conclusion: "success" },
  { name: "sweeps (2/2)", conclusion: "success" },
];
const runs = {
  workflow_runs: [
    {
      event: "pull_request",
      head_sha: "OTHER",
      conclusion: "success",
      jobs_url: "other-jobs",
    },
    {
      event: "pull_request",
      head_sha: "HEAD",
      conclusion: "failure",
      jobs_url: "failed-jobs",
    },
    {
      event: "pull_request",
      head_sha: "HEAD",
      conclusion: "success",
      jobs_url: "passing-jobs",
    },
  ],
};
function fakeGit(parents = ["PARENT"]) {
  return (...args) => {
    if (args[0] === "rev-list") return ["MERGE", ...parents].join(" ");
    throw new Error("not present in local fixture");
  };
}
function fakeApi({
  pulls = mergePr,
  compare = "ahead",
  workflows = runs,
  passingJobs = fixtureJobs,
} = {}) {
  return async (url) => {
    if (url.endsWith("/commits/MERGE/pulls")) return pulls;
    if (url.endsWith("/commits/MERGE")) return commit;
    if (url.endsWith("/commits/HEAD")) return commit;
    if (url.includes("/compare/PARENT...HEAD")) return { status: compare };
    if (url.includes("/runs?")) return workflows;
    if (url === "passing-jobs?per_page=100") return { jobs: passingJobs };
    throw new Error(`unexpected fixture URL: ${url}`);
  };
}
test("inspectAlreadyTested proves a passing squash from trimmed GitHub fixtures", async () => {
  const result = await inspectAlreadyTested(env, fakeApi(), fakeGit());
  assert.equal(result.tested, true);
});
test("inspectAlreadyTested fails closed when no PR matches the merge SHA", async () => {
  const result = await inspectAlreadyTested(
    env,
    fakeApi({
      pulls: [
        {
          merge_commit_sha: "OTHER",
          base: { ref: "main" },
          head: { sha: "HEAD" },
        },
      ],
    }),
    fakeGit(),
  );
  assert.equal(result.tested, false);
});
for (const status of ["behind", "diverged"]) {
  test(`compare status ${status} fails closed`, async () => {
    const result = await inspectAlreadyTested(
      env,
      fakeApi({ compare: status }),
      fakeGit(),
    );
    assert.equal(result.tested, false);
  });
}
test("a two-parent commit fails closed before API inspection", async () => {
  const result = await inspectAlreadyTested(
    env,
    fakeApi(),
    fakeGit(["PARENT", "SECOND"]),
  );
  assert.equal(result.tested, false);
});
