import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeNamespace, type Namespace } from "../src/kubernetes/namespaces.ts";
import { listNamespaces } from "../src/ops/kubernetes/list-namespaces.ts";
import { fakeKube } from "./helpers.ts";

const payments: Namespace = {
  metadata: {
    name: "payments",
    creationTimestamp: "2026-10-12T10:00:00Z",
    labels: { team: "billing" },
    annotations: { "kubectl.kubernetes.io/last-applied-configuration": '{"secret":"s3cr3t"}' },
  },
  status: { phase: "Active" },
};

test("summarizeNamespace: name, status and creation time, never labels or annotations", () => {
  assert.deepEqual(summarizeNamespace(payments), {
    name: "payments",
    status: "Active",
    createdAt: "2026-10-12T10:00:00Z",
  });
});

test("summarizeNamespace: a missing phase is Unknown", () => {
  assert.equal(summarizeNamespace({ metadata: { name: "payments" } }).status, "Unknown");
});

test("list_namespaces: calls the cluster-wide endpoint with the limit", async () => {
  const { calls, run } = fakeKube(listNamespaces, { items: [payments] });
  const result = await run({});
  assert.deepEqual(calls, [{ path: "/api/v1/namespaces", query: { limit: 500 } }]);
  assert.deepEqual(result, { ok: true, data: { namespaces: [summarizeNamespace(payments)], truncated: false } });
});

test("list_namespaces: more namespaces than the limit is truncated: true", async () => {
  const { run } = fakeKube(listNamespaces, { metadata: { continue: "abc" }, items: [] });
  assert.deepEqual(await run({}), { ok: true, data: { namespaces: [], truncated: true } });
});

test("list_namespaces: any argument is rejected before calling the API", async () => {
  const { calls, run } = fakeKube(listNamespaces, { items: [] });
  const result = await run({ namespace: "demo" });
  assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST");
  assert.equal(calls.length, 0);
});
