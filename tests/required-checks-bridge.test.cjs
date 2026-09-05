const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const workflow = readFileSync(new URL('../.github/workflows/required-checks-bridge.yml', `file://${__filename}`), 'utf8');
const script = workflow.split('          script: |\n')[1]
  .split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github', 'context', 'core', 'setTimeout', script);
const names = ['Quality Gates Pipeline', 'Unit Tests', 'Scan changed Git history', 'Constitution Compliance Validation'];
const sha = 'current-head';
const suite = (id = 1, status = 'completed') => ({ id, status, head_sha: sha, app: { id: 15368 } });
const good = () => names.map((name, index) => ({
  name, id: index + 1, head_sha: sha, app: { id: 15368 },
  check_suite: { id: 1 }, status: 'completed', conclusion: 'success'
}));

async function audit(runs, suites = [suite()], heads = [sha], executions = [{ id: 1, run_attempt: 1, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success', check_suite_id: 1 }]) {
  const failures = [];
  let reads = 0;
  let pages = 0;
  const checks = { listForRef() {}, listSuitesForRef() {} };
  const actions = { listWorkflowRuns() {} };
  const github = {
    rest: { checks, actions, pulls: { get: async () => ({ data: { head: { sha: heads[Math.min(reads++, heads.length - 1)] } } }) } },
    paginate: async (method, args) => {
      assert.equal(args.ref ?? args.head_sha, sha);
      assert.equal(args.per_page, 100);
      const data = method === actions.listWorkflowRuns ? executions : method === checks.listForRef ? runs : suites;
      if (method === checks.listForRef) assert.equal(args.filter, 'all');
      const result = [];
      for (let start = 0; start < data.length; start += 100) {
        pages++;
        result.push(...data.slice(start, start + 100));
      }
      return result;
    }
  };
  await execute(github, { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { number: 12, head: { sha } } } },
    { info() {}, setFailed: message => failures.push(message) }, callback => callback());
  return { failures, reads, pages };
}

test('workflow grants no mutation permissions or checkout', () => {
  assert.doesNotMatch(workflow, /:\s*write|actions\/checkout|createCommitStatus/);
});
test('all four successful app checks across multiple pages pass', async () => {
  const filler = Array.from({ length: 100 }, (_, id) => ({ ...good()[0], name: 'unrelated', id: id + 100 }));
  const result = await audit([...filler, ...good()]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pages, 7);
});
for (const kind of ['missing', 'wrong app', 'wrong SHA', 'pending', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral']) {
  test(`${kind} cannot pass`, async () => {
    const runs = good();
    if (kind === 'missing') runs.pop();
    else if (kind === 'wrong app') runs[0].app.id = 7;
    else if (kind === 'wrong SHA') runs[0].head_sha = 'old-head';
    else if (kind === 'pending') runs[0].status = 'in_progress';
    else runs[0].conclusion = kind;
    assert.equal((await audit(runs)).failures.length, 1);
  });
}
test('newer pending rerun supersedes old success', async () => {
  assert.equal((await audit([...good(), { ...good()[0], id: 99, status: 'queued' }])).failures.length, 1);
});
test('newer suite supersedes higher run ID in older suite', async () => {
  const runs = good();
  runs[0].id = 999;
  runs.push({ ...good()[0], id: 10, check_suite: { id: 2 }, status: 'queued' });
  assert.equal((await audit(runs, [suite(), suite(2)], [sha], [{ id: 2, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success', check_suite_id: 2 }])).failures.length, 1);
});
test('pending or missing suite cannot pass', async () => {
  assert.equal((await audit(good(), [suite(1, 'in_progress')])).failures.length, 1);
  assert.equal((await audit(good(), [])).failures.length, 1);
});
test('head changes before success fail closed', async () => {
  await assert.rejects(audit(good(), [suite()], [sha, 'new-head']), /PR head changed/);
});
test('new queued workflow suite without jobs supersedes old successful checks', async () => {
  const executions = [
    { id: 1, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success', check_suite_id: 1 },
    { id: 2, head_sha: sha, event: 'pull_request', status: 'queued', check_suite_id: 2 }
  ];
  assert.equal((await audit(good(), [suite(), suite(2, 'queued')], [sha], executions)).failures.length, 1);
});
test('queued rerun attempt and missing workflow fail closed', async () => {
  const executions = [
    { id: 1, run_attempt: 1, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success', check_suite_id: 1 },
    { id: 1, run_attempt: 2, head_sha: sha, event: 'pull_request', status: 'queued', check_suite_id: 1 }
  ];
  assert.equal((await audit(good(), [suite()], [sha], executions)).failures.length, 1);
  assert.equal((await audit(good(), [suite()], [sha], [])).failures.length, 1);
});
for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', null]) {
  test(`completed workflow rerun with ${conclusion} cannot reuse green check records`, async () => {
    const execution = { id: 1, run_attempt: 2, head_sha: sha, event: 'pull_request', status: 'completed', conclusion, check_suite_id: 1 };
    assert.equal((await audit(good(), [suite()], [sha], [execution])).failures.length, 1);
  });
}
