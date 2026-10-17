import assert from "node:assert/strict";
import { test } from "node:test";
import { rolloutStatus, summarizeDeployment, type Deployment } from "../src/kubernetes/deployments.ts";
import { selectorString } from "../src/kubernetes/meta.ts";
import { listDeployments } from "../src/ops/kubernetes/list-deployments.ts";
import { fakeKube } from "./helpers.ts";

// A bad deploy: the new ReplicaSet never got ready, the old pods still serve, so READY alone looks fine.
const stuck: Deployment = {
  metadata: { name: "web", generation: 2, creationTimestamp: "2026-10-12T10:00:00Z" },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "web" } },
    template: { spec: { containers: [{ image: "web:2.0" }, { image: "envoy:1.30" }] } },
  },
  status: {
    observedGeneration: 2,
    replicas: 3,
    updatedReplicas: 1,
    readyReplicas: 2,
    availableReplicas: 2,
    conditions: [{ type: "Progressing", reason: "ProgressDeadlineExceeded" }],
  },
};

const deployment = (spec: Deployment["spec"], status: Deployment["status"], generation?: number): Deployment => ({
  metadata: { name: "d", generation },
  spec,
  status,
});
const progressing = (reason: string) => [{ type: "Progressing", reason }];

test("summarizeDeployment: replicas, rollout, selector and images", () => {
  assert.deepEqual(summarizeDeployment(stuck), {
    name: "web",
    ready: "2/2",
    upToDate: 1,
    available: 2,
    rollout: "failed: progress deadline exceeded",
    selector: "app=web",
    images: ["web:2.0", "envoy:1.30"],
    createdAt: "2026-10-12T10:00:00Z",
  });
});

test("summarizeDeployment: missing spec and status fall back to Kubernetes defaults", () => {
  const summary = summarizeDeployment({ metadata: { name: "d" } });
  assert.equal(summary.ready, "0/1");
  assert.equal(summary.upToDate, 0);
  assert.equal(summary.available, 0);
  assert.equal(summary.selector, "");
  assert.deepEqual(summary.images, []);
});

test("rolloutStatus: kubectl rollout status, plus a finished rollout that broke later", () => {
  const done = { replicas: 2, updatedReplicas: 2, availableReplicas: 2 };
  const cases: [expected: string, d: Deployment][] = [
    ["complete", deployment({ replicas: 2 }, { ...done, conditions: progressing("NewReplicaSetAvailable") })],
    ["complete", deployment({ replicas: 0 }, {})], // scaled to zero
    ["paused", deployment({ replicas: 2, paused: true }, done)],
    ["pending: controller has not processed the latest spec yet", deployment({ replicas: 2 }, { ...done, observedGeneration: 1 }, 2)],
    ["failed: progress deadline exceeded", deployment({ replicas: 2 }, { ...done, conditions: progressing("ProgressDeadlineExceeded") })],
    ["in progress: 1 of 2 new replicas updated", deployment({ replicas: 2 }, { replicas: 2, updatedReplicas: 1 })],
    ["in progress: 1 old replicas pending termination", deployment({ replicas: 2 }, { ...done, replicas: 3 })],
    [
      "in progress: 1 of 2 updated replicas available",
      deployment({ replicas: 2 }, { ...done, availableReplicas: 1, conditions: progressing("ReplicaSetUpdated") }),
    ],
    [
      "complete, but only 0 of 2 replicas available",
      deployment({ replicas: 2 }, { ...done, availableReplicas: 0, conditions: progressing("NewReplicaSetAvailable") }),
    ],
  ];
  for (const [expected, d] of cases) assert.equal(rolloutStatus(d), expected, expected);
});

test("selectorString: matchLabels and every matchExpressions operator, in labelSelector syntax", () => {
  assert.equal(selectorString(undefined), "");
  assert.equal(
    selectorString({
      matchLabels: { app: "web", tier: "frontend" },
      matchExpressions: [
        { key: "env", operator: "In", values: ["prod", "staging"] },
        { key: "track", operator: "NotIn", values: ["canary"] },
        { key: "team", operator: "Exists" },
        { key: "legacy", operator: "DoesNotExist" },
      ],
    }),
    "app=web,tier=frontend,env in (prod,staging),track notin (canary),team,!legacy",
  );
});

test("list_deployments: calls the namespace's apps/v1 endpoint with the selector and the limit", async () => {
  const { calls, run } = fakeKube(listDeployments, { items: [stuck] });
  const result = await run({ namespace: "payments", labelSelector: "app=web" });
  assert.deepEqual(calls, [
    { path: "/apis/apps/v1/namespaces/payments/deployments", query: { labelSelector: "app=web", limit: 500 } },
  ]);
  assert.deepEqual(result, { ok: true, data: { deployments: [summarizeDeployment(stuck)], truncated: false } });
});

test("list_deployments: more deployments than the limit is truncated: true", async () => {
  const { run } = fakeKube(listDeployments, { metadata: { continue: "abc" }, items: [] });
  assert.deepEqual(await run({ namespace: "payments" }), { ok: true, data: { deployments: [], truncated: true } });
});

test("list_deployments: bad args are rejected before calling the API", async () => {
  const { calls, run } = fakeKube(listDeployments, { items: [] });
  for (const args of [{}, { namespace: ".." }, { namespace: "demo", labelSelecter: "app=web" }]) {
    const result = await run(args);
    assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST", JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});
