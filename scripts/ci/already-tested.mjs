import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function evaluateFullTierJobs(jobs = []) {
  const conclusion = (name) =>
    jobs.find((job) => job.name === name)?.conclusion;
  const hasE2e = jobs.some((job) => job.name?.startsWith("e2e"));
  if (conclusion("gate") !== "success")
    return { passed: false, reason: "gate did not pass" };
  if (!hasE2e) return { passed: true, reason: "gate passed (no e2e job)" };
  const required = ["e2e (full)", "sweeps (1/2)", "sweeps (2/2)", "webkit"];
  const missing = required.find((name) => conclusion(name) !== "success");
  return missing
    ? { passed: false, reason: `${missing} did not pass` }
    : { passed: true, reason: "full e2e, sweep and webkit jobs passed" };
}
export const fullTierPassed = (jobs) => evaluateFullTierJobs(jobs).passed;

export function decideAlreadyTested({
  event,
  ref,
  parents,
  parentIsAncestor,
  mergeTree,
  headTree,
  prRunJobs,
}) {
  if (event !== "push" || ref !== "refs/heads/main")
    return { tested: false, reason: "not a push to main" };
  if (!Array.isArray(parents) || parents.length !== 1)
    return {
      tested: false,
      reason: "push is not a squash commit with one parent",
    };
  if (!parentIsAncestor)
    return {
      tested: false,
      reason: "the parent is not an ancestor of the PR head",
    };
  if (!mergeTree || mergeTree !== headTree)
    return {
      tested: false,
      reason: "the push tree differs from the PR head tree",
    };
  if (
    !Array.isArray(prRunJobs) ||
    !prRunJobs.some((jobs) => fullTierPassed(jobs))
  )
    return {
      tested: false,
      reason: "no pull_request run on the PR head passed the full tier",
    };
  return {
    tested: true,
    reason: "the squash commit repeats a passing PR tree",
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function localObject(sha, gitApi) {
  try {
    gitApi("cat-file", "-e", `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}
function localTree(sha, gitApi) {
  return localObject(sha, gitApi) ? gitApi("rev-parse", `${sha}^{tree}`) : null;
}
function isAncestor(ancestor, descendant, gitApi) {
  try {
    gitApi("merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}
async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`);
  return response.json();
}
async function commitTree(sha, api, env, gitApi) {
  return (
    localTree(sha, gitApi) ??
    (
      await api(
        `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/commits/${sha}`,
      )
    ).commit.tree.sha
  );
}
async function ancestor(ancestorSha, descendantSha, api, env, gitApi) {
  if (localObject(ancestorSha, gitApi) && localObject(descendantSha, gitApi))
    return isAncestor(ancestorSha, descendantSha, gitApi);
  const result = await api(
    `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/compare/${ancestorSha}...${descendantSha}`,
  );
  return result.status === "ahead" || result.status === "identical";
}
export async function inspectAlreadyTested(
  env = process.env,
  api = getJson,
  gitApi = git,
) {
  const { GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: sha } = env;
  if (event !== "push" || ref !== "refs/heads/main")
    return decideAlreadyTested({ event, ref });
  const parents = gitApi("rev-list", "--parents", "-n", "1", sha)
    .split(" ")
    .slice(1);
  if (parents.length !== 1) return decideAlreadyTested({ event, ref, parents });
  const prs = await api(
    `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/commits/${sha}/pulls`,
  );
  const pr = prs.find(
    (candidate) =>
      candidate.merge_commit_sha === sha && candidate.base?.ref === "main",
  );
  if (!pr?.head?.sha)
    return { tested: false, reason: "no merged pull request found" };
  const [mergeTree, headTree, parentIsAncestor] = await Promise.all([
    commitTree(sha, api, env, gitApi),
    commitTree(pr.head.sha, api, env, gitApi),
    ancestor(parents[0], pr.head.sha, api, env, gitApi),
  ]);
  if (!parentIsAncestor || mergeTree !== headTree)
    return decideAlreadyTested({
      event,
      ref,
      parents,
      parentIsAncestor,
      mergeTree,
      headTree,
    });
  const runs =
    (
      await api(
        `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${env.WORKFLOW_FILE}/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`,
      )
    ).workflow_runs ?? [];
  const prRunJobs = [];
  for (const run of runs) {
    if (
      run.event !== "pull_request" ||
      run.head_sha !== pr.head.sha ||
      run.conclusion !== "success"
    )
      continue;
    const result = await api(`${run.jobs_url}?per_page=100`);
    prRunJobs.push(result.jobs ?? []);
  }
  return decideAlreadyTested({
    event,
    ref,
    parents,
    parentIsAncestor,
    mergeTree,
    headTree,
    prRunJobs,
  });
}
export async function safeInspectAlreadyTested(
  env = process.env,
  api = getJson,
  gitApi = git,
) {
  try {
    return await inspectAlreadyTested(env, api, gitApi);
  } catch (error) {
    return {
      tested: false,
      reason: `check failed, running everything: ${error.message}`,
    };
  }
}
async function main() {
  const result = await safeInspectAlreadyTested();
  console.log(`Already tested: ${result.tested} (${result.reason})`);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `tested=${result.tested}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
