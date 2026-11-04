import assert from "node:assert/strict";
import { test } from "node:test";
import type { Condition } from "../src/kubernetes/meta.ts";
import { summarizeNode, type KubeNode } from "../src/kubernetes/nodes.ts";
import { listNodes } from "../src/ops/kubernetes/list-nodes.ts";
import { fakeKube } from "./helpers.ts";

const condition = (type: string, status: string, reason: string, message: string) => ({
  type,
  status,
  reason,
  message,
  lastTransitionTime: "2026-11-01T10:00:00Z",
});
const problem = (type: string, status: string, reason: string, message: string) => ({
  type,
  status,
  reason,
  message,
  since: "2026-11-01T10:00:00Z",
});

const node = (conditions: Condition[]): KubeNode => ({
  metadata: {
    name: "node-1",
    creationTimestamp: "2026-10-12T10:00:00Z",
    labels: { "topology.kubernetes.io/zone": "fra1" },
    annotations: { "node.alpha.kubernetes.io/ttl": "0" },
  },
  status: { allocatable: { cpu: "1880m", memory: "2362648Ki", pods: "110" }, conditions },
});

const ready = condition("Ready", "True", "KubeletReady", "kubelet is posting ready status");
const memoryFine = condition("MemoryPressure", "False", "KubeletHasSufficientMemory", "kubelet has sufficient memory available");

test("summarizeNode: a healthy node has no problems, and labels and annotations stay out", () => {
  assert.deepEqual(summarizeNode(node([memoryFine, ready])), {
    name: "node-1",
    ready: "True",
    problems: [],
    allocatable: { cpu: "1880m", memory: "2362648Ki", pods: "110" },
    createdAt: "2026-10-12T10:00:00Z",
  });
});

test("summarizeNode: any condition but Ready is a problem when True, also ones Kubernetes doesn't define", () => {
  const disk = ["DiskPressure", "True", "KubeletHasDiskPressure", "ephemeral storage is low"] as const;
  const kernel = ["KernelDeadlock", "True", "DockerHung", "task blocked for more than 120 seconds"] as const;
  const summary = summarizeNode(node([memoryFine, condition(...disk), condition(...kernel), ready]));
  assert.equal(summary.ready, "True");
  assert.deepEqual(summary.problems, [problem(...disk), problem(...kernel)]);
});

test("summarizeNode: a node that stopped reporting has every condition Unknown, all of them problems", () => {
  const message = "Kubelet stopped posting node status.";
  const summary = summarizeNode(
    node([condition("MemoryPressure", "Unknown", "NodeStatusUnknown", message), condition("Ready", "Unknown", "NodeStatusUnknown", message)]),
  );
  assert.equal(summary.ready, "Unknown");
  assert.deepEqual(summary.problems, [
    problem("MemoryPressure", "Unknown", "NodeStatusUnknown", message),
    problem("Ready", "Unknown", "NodeStatusUnknown", message),
  ]);
});

test("summarizeNode: Ready False is a problem", () => {
  const notReady = ["Ready", "False", "KubeletNotReady", "container runtime network not ready"] as const;
  const summary = summarizeNode(node([memoryFine, condition(...notReady)]));
  assert.equal(summary.ready, "False");
  assert.deepEqual(summary.problems, [problem(...notReady)]);
});

test("summarizeNode: no status is Unknown with no problems", () => {
  const summary = summarizeNode({ metadata: { name: "node-1" } });
  assert.equal(summary.ready, "Unknown");
  assert.deepEqual(summary.problems, []);
  assert.equal(summary.allocatable, undefined);
});

test("list_nodes: calls the cluster-wide endpoint with the limit", async () => {
  const healthy = node([ready]);
  const { calls, run } = fakeKube(listNodes, { items: [healthy] });
  const result = await run({});
  assert.deepEqual(calls, [{ path: "/api/v1/nodes", query: { limit: 500 } }]);
  assert.deepEqual(result, { ok: true, data: { nodes: [summarizeNode(healthy)], truncated: false } });
});

test("list_nodes: more nodes than the limit is truncated: true", async () => {
  const { run } = fakeKube(listNodes, { metadata: { continue: "abc" }, items: [] });
  assert.deepEqual(await run({}), { ok: true, data: { nodes: [], truncated: true } });
});

test("list_nodes: any argument is rejected before calling the API", async () => {
  const { calls, run } = fakeKube(listNodes, { items: [] });
  const result = await run({ namespace: "demo" });
  assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST");
  assert.equal(calls.length, 0);
});
