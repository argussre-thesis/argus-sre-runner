import assert from "node:assert/strict";
import { test } from "node:test";
import { isProblemPod, summarizePod, type Pod } from "../src/kubernetes/pods.ts";
import { listProblemPods } from "../src/ops/kubernetes/list-problem-pods.ts";
import { fakeKube } from "./helpers.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const minutesAgo = (minutes: number, now = NOW) => new Date(now - minutes * 60_000).toISOString();

const up = { name: "app", image: "app:1", ready: true, restartCount: 0, state: { running: {} } };
const restarted = (finishedAt: string) => ({
  ...up,
  restartCount: 7,
  lastState: { terminated: { reason: "Error", exitCode: 1, finishedAt } },
});
const pod = (status: Pod["status"], name = "app-1", namespace = "demo"): Pod => ({
  metadata: { name, namespace, creationTimestamp: "2026-10-12T10:00:00Z" },
  spec: { containers: [{ name: "app" }] },
  status,
});
const running = (...containerStatuses: NonNullable<NonNullable<Pod["status"]>["containerStatuses"]>) =>
  pod({ phase: "Running", containerStatuses });

test("isProblemPod: which pods count", () => {
  const cases: [expected: boolean, label: string, pod: Pod][] = [
    [false, "running and ready", running(up)],
    [false, "restarted 61 minutes ago", running(restarted(minutesAgo(61)))],
    [true, "up and ready, but restarted 59 minutes ago", running(restarted(minutesAgo(59)))],
    [true, "not ready", running({ ...up, ready: false })],
    [true, "one of two containers not ready", running(up, { ...up, name: "sidecar", ready: false })],
    [true, "crash loop", running({ ...up, ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } })],
    [true, "pending, no container statuses", pod({ phase: "Pending" })],
    [true, "bad image", pod({ phase: "Pending", containerStatuses: [{ ...up, ready: false, state: { waiting: { reason: "ImagePullBackOff" } } }] })],
    [true, "evicted", pod({ phase: "Failed", reason: "Evicted" })],
    [true, "terminating", { ...running(up), metadata: { name: "app-1", deletionTimestamp: minutesAgo(1) } }],
    [true, "no status", pod(undefined)],
    [
      false,
      "finished Job: never ready, not a problem",
      pod({ phase: "Succeeded", containerStatuses: [{ ...up, ready: false, state: { terminated: { reason: "Completed", exitCode: 0 } } }] }),
    ],
    [false, "finished Job that restarted before it succeeded", pod({ phase: "Succeeded", containerStatuses: [restarted(minutesAgo(5))] })],
  ];
  for (const [expected, label, p] of cases) assert.equal(isProblemPod(p, NOW), expected, label);
});

test("list_problem_pods: reads every namespace, counts all pods, returns only the problems with their namespace", async () => {
  const healthy = running(up);
  const broken = pod({ phase: "Pending" }, "web-1", "payments");
  const { calls, run } = fakeKube(listProblemPods, { items: [healthy, broken] });
  const result = await run({});
  assert.deepEqual(calls, [{ path: "/api/v1/pods", query: { limit: 500 } }]);
  assert.deepEqual(result, {
    ok: true,
    data: { total: 2, problems: [{ namespace: "payments", ...summarizePod(broken) }], truncated: false },
  });
});

test("list_problem_pods: a restart is judged against the current time", async () => {
  const recent = pod({ phase: "Running", containerStatuses: [restarted(minutesAgo(5, Date.now()))] }, "recent");
  const old = pod({ phase: "Running", containerStatuses: [restarted(minutesAgo(120, Date.now()))] }, "old");
  const { run } = fakeKube(listProblemPods, { items: [recent, old] });
  const result = await run({});
  assert.ok(result.ok);
  const { problems } = result.data as { problems: { name: string }[] };
  assert.deepEqual(
    problems.map((p) => p.name),
    ["recent"],
  );
});

test("list_problem_pods: more pods than the limit is truncated: true", async () => {
  const { run } = fakeKube(listProblemPods, { metadata: { continue: "abc" }, items: [] });
  assert.deepEqual(await run({}), { ok: true, data: { total: 0, problems: [], truncated: true } });
});

test("list_problem_pods: any argument is rejected before calling the API", async () => {
  const { calls, run } = fakeKube(listProblemPods, { items: [] });
  const result = await run({ namespace: "demo" });
  assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST");
  assert.equal(calls.length, 0);
});
