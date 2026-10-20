import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeReplicaSet, type ReplicaSet } from "../src/kubernetes/replicasets.ts";
import { listReplicaSets } from "../src/ops/kubernetes/list-replicasets.ts";
import { fakeKube } from "./helpers.ts";

const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

// The bad deploy: same image as before, only the command changed.
const v2: ReplicaSet = {
  metadata: {
    name: "web-86b67799d",
    creationTimestamp: "2026-10-19T12:00:00Z",
    annotations: {
      "deployment.kubernetes.io/revision": "4",
      "kubernetes.io/change-cause": "release v2: read config from /etc/web/config.yaml",
      "kubectl.kubernetes.io/last-applied-configuration": '{"env":[{"value":"s3cr3t"}]}',
    },
    ownerReferences: [{ kind: "Deployment", name: "web" }],
  },
  spec: {
    replicas: 1,
    template: {
      metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": "2026-10-19T17:49:16+03:00" } },
      spec: {
        containers: [
          {
            name: "web",
            image: "nginx:1.27-alpine",
            command: ["sh", "-c", "exit 1"],
            env: [{ name: "DB_PASSWORD", value: "s3cr3t" }],
          },
        ],
      },
    },
  },
  status: { readyReplicas: 0 },
};

const rs = (name: string, owner?: string, revision?: string): ReplicaSet => ({
  metadata: {
    name,
    annotations: revision ? { "deployment.kubernetes.io/revision": revision } : undefined,
    ownerReferences: owner ? [{ kind: "Deployment", name: owner }] : undefined,
  },
});

test("summarizeReplicaSet: revision, change cause, restart, ready and the pod template, never env values or other annotations", () => {
  assert.deepEqual(wire(summarizeReplicaSet(v2)), {
    name: "web-86b67799d",
    owner: "Deployment/web",
    revision: 4,
    changeCause: "release v2: read config from /etc/web/config.yaml",
    restartedAt: "2026-10-19T17:49:16+03:00",
    ready: "0/1",
    createdAt: "2026-10-19T12:00:00Z",
    containers: [
      {
        name: "web",
        image: "nginx:1.27-alpine",
        command: ["sh", "-c", "exit 1"],
        probes: {},
        env: ["DB_PASSWORD: value hidden"],
      },
    ],
  });
});

test("summarizeReplicaSet: missing spec, status and annotations fall back to Kubernetes defaults", () => {
  assert.deepEqual(wire(summarizeReplicaSet({ metadata: { name: "solo" } })), { name: "solo", ready: "0/1", containers: [] });
});

test("list_replicasets: calls the namespace's apps/v1 endpoint, groups by owner, newest revision first", async () => {
  const items = [rs("api-1", "api", "2"), rs("solo"), rs("web-a", "web", "9"), rs("web-b", "web", "10"), rs("web-c", "web", "1")];
  const { calls, run } = fakeKube(listReplicaSets, { items });
  const result = await run({ namespace: "demo", labelSelector: "app=web" });
  assert.deepEqual(calls, [
    { path: "/apis/apps/v1/namespaces/demo/replicasets", query: { labelSelector: "app=web", limit: 500 } },
  ]);
  assert.ok(result.ok);
  const { replicaSets, truncated } = result.data as { replicaSets: { name: string }[]; truncated: boolean };
  assert.deepEqual(
    replicaSets.map((r) => r.name),
    ["solo", "api-1", "web-b", "web-a", "web-c"],
  );
  assert.equal(truncated, false);
});

test("list_replicasets: more ReplicaSets than the limit is truncated: true", async () => {
  const { run } = fakeKube(listReplicaSets, { metadata: { continue: "abc" }, items: [] });
  assert.deepEqual(await run({ namespace: "demo" }), { ok: true, data: { replicaSets: [], truncated: true } });
});

test("list_replicasets: bad args are rejected before calling the API", async () => {
  const { calls, run } = fakeKube(listReplicaSets, { items: [] });
  for (const args of [{}, { namespace: ".." }, { namespace: "demo", labelSelecter: "app=web" }]) {
    const result = await run(args);
    assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST", JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});
