import assert from "node:assert/strict";
import { test } from "node:test";
import { Dispatcher } from "../src/dispatcher.ts";
import type { KubeApi, Query } from "../src/kubernetes/client.ts";
import { podStatus, summarizePod, type Pod } from "../src/kubernetes/pods.ts";
import { listPods } from "../src/ops/kubernetes/list-pods.ts";

const crashLooping: Pod = {
  metadata: {
    name: "api-7d9f-x2k",
    creationTimestamp: "2026-10-12T10:00:00Z",
    ownerReferences: [{ kind: "ReplicaSet", name: "api-7d9f" }],
  },
  spec: { nodeName: "node-1", containers: [{ name: "api" }, { name: "sidecar" }] },
  status: {
    phase: "Running",
    containerStatuses: [
      {
        name: "api",
        image: "api:1.4.2",
        ready: false,
        restartCount: 7,
        state: { waiting: { reason: "CrashLoopBackOff" } },
        lastState: { terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-12T10:05:00Z" } },
      },
      { name: "sidecar", image: "envoy:1.30", ready: true, restartCount: 0, state: { running: {} } },
    ],
  },
};

const pod = (status: Pod["status"], meta: Partial<Pod["metadata"]> = {}): Pod => ({
  metadata: { name: "p", ...meta },
  spec: { containers: [{}] },
  status,
});
const container = (state: object) => ({ name: "c", image: "i", ready: false, restartCount: 0, state });

test("summarizePod: status, readiness, restarts, owner and last termination", () => {
  assert.deepEqual(summarizePod(crashLooping), {
    name: "api-7d9f-x2k",
    status: "CrashLoopBackOff",
    ready: "1/2",
    restarts: 7,
    node: "node-1",
    owner: "ReplicaSet/api-7d9f",
    createdAt: "2026-10-12T10:00:00Z",
    containers: [
      {
        name: "api",
        image: "api:1.4.2",
        ready: false,
        restarts: 7,
        state: "waiting: CrashLoopBackOff",
        lastTermination: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-12T10:05:00Z" },
      },
      { name: "sidecar", image: "envoy:1.30", ready: true, restarts: 0, state: "running", lastTermination: undefined },
    ],
  });
});

test("summarizePod: a pending pod without container statuses is 0/1", () => {
  const summary = summarizePod(pod({ phase: "Pending" }));
  assert.equal(summary.status, "Pending");
  assert.equal(summary.ready, "0/1");
  assert.deepEqual(summary.containers, []);
});

test("podStatus: close to kubectl's STATUS column", () => {
  const cases: [expected: string, pod: Pod][] = [
    ["Running", pod({ phase: "Running", containerStatuses: [container({ running: {} })] })],
    ["ImagePullBackOff", pod({ phase: "Pending", containerStatuses: [container({ waiting: { reason: "ImagePullBackOff" } })] })],
    ["OOMKilled", pod({ phase: "Running", containerStatuses: [container({ terminated: { reason: "OOMKilled", exitCode: 137 } })] })],
    [
      "CrashLoopBackOff", // the first container with a reason wins, as in kubectl
      pod({
        phase: "Running",
        containerStatuses: [
          container({ waiting: { reason: "CrashLoopBackOff" } }),
          container({ terminated: { reason: "Error", exitCode: 1 } }),
        ],
      }),
    ],
    [
      "Init:CrashLoopBackOff", // a completed init container is skipped
      pod({
        phase: "Pending",
        initContainerStatuses: [
          container({ terminated: { reason: "Completed", exitCode: 0 } }),
          container({ waiting: { reason: "CrashLoopBackOff" } }),
        ],
      }),
    ],
    ["Evicted", pod({ phase: "Failed", reason: "Evicted" })],
    ["Terminating", pod({ phase: "Running" }, { deletionTimestamp: "2026-10-12T10:00:00Z" })],
  ];
  for (const [expected, p] of cases) assert.equal(podStatus(p), expected, expected);
});

function fakeKube(list: unknown) {
  const calls: { path: string; query?: Query }[] = [];
  const kube: KubeApi = {
    async getJson<T>(path: string, query?: Query) {
      calls.push({ path, query });
      return list as T;
    },
    async getText() {
      throw new Error("list_pods doesn't call getText");
    },
  };
  const dispatcher = new Dispatcher([listPods(kube)]);
  const run = (args: Record<string, unknown>) => dispatcher.dispatch({ id: "t", op: "list_pods", args });
  return { calls, run };
}

test("list_pods: calls the namespace's pods endpoint with the selector and the limit", async () => {
  const { calls, run } = fakeKube({ items: [crashLooping] });
  const result = await run({ namespace: "payments", labelSelector: "app=api" });
  assert.deepEqual(calls, [{ path: "/api/v1/namespaces/payments/pods", query: { labelSelector: "app=api", limit: 500 } }]);
  assert.deepEqual(result, { ok: true, data: { pods: [summarizePod(crashLooping)], truncated: false } });
});

test("list_pods: more pods than the limit is truncated: true", async () => {
  const { run } = fakeKube({ metadata: { continue: "abc" }, items: [] });
  assert.deepEqual(await run({ namespace: "payments" }), { ok: true, data: { pods: [], truncated: true } });
});

test("list_pods: bad args are rejected before calling the API", async () => {
  const { calls, run } = fakeKube({ items: [] });
  for (const args of [{}, { namespace: ".." }, { namespace: "demo", labelSelecter: "app=api" }]) {
    const result = await run(args);
    assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST", JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});
