import assert from "node:assert/strict";
import { test } from "node:test";
import { describePod, type Pod } from "../src/kubernetes/pods.ts";
import { getPod } from "../src/ops/kubernetes/get-pod.ts";
import { fakeKube } from "./helpers.ts";

// What reaches the gateway: undefined fields vanish in JSON.
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

const web = {
  metadata: {
    name: "web-1",
    namespace: "demo",
    creationTimestamp: "2026-10-12T10:00:00Z",
    labels: { app: "web" },
    annotations: { "kubectl.kubernetes.io/last-applied-configuration": '{"env":[{"value":"s3cr3t"}]}' },
    ownerReferences: [{ kind: "ReplicaSet", name: "web-6cdf9c6f95" }],
  },
  spec: {
    nodeName: "node-1",
    serviceAccountName: "default",
    initContainers: [{ name: "migrate", image: "migrate:1", command: ["./migrate"] }],
    containers: [
      {
        name: "web",
        image: "nginx:1.27-alpine",
        args: ["--port=8080"],
        ports: [{ containerPort: 8080 }, { containerPort: 9090, protocol: "UDP" }],
        env: [
          { name: "DB_PASSWORD", value: "s3cr3t" },
          { name: "API_KEY", valueFrom: { secretKeyRef: { name: "api", key: "key" } } },
        ],
        envFrom: [{ secretRef: { name: "db-creds" } }],
        resources: { limits: { memory: "32Mi" } },
        readinessProbe: { httpGet: { path: "/ready", port: 8080 }, periodSeconds: 5 },
      },
    ],
  },
  status: {
    phase: "Running",
    qosClass: "Burstable",
    conditions: [
      { type: "PodScheduled", status: "True" },
      {
        type: "Ready",
        status: "False",
        reason: "ContainersNotReady",
        message: "containers with unready status: [web]",
        lastTransitionTime: "2026-10-12T10:01:00Z",
      },
    ],
    initContainerStatuses: [
      {
        name: "migrate",
        image: "migrate:1",
        ready: true,
        restartCount: 0,
        state: { terminated: { reason: "Completed", exitCode: 0, message: "3 tables migrated" } },
      },
    ],
    containerStatuses: [
      {
        name: "web",
        image: "nginx:1.27-alpine",
        ready: false,
        restartCount: 4,
        state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 1m20s restarting failed container" } },
        lastState: {
          terminated: {
            reason: "Error",
            exitCode: 1,
            message: "config missing",
            startedAt: "2026-10-12T10:04:00Z",
            finishedAt: "2026-10-12T10:04:02Z",
          },
        },
      },
    ],
  },
};

type ContainerSpec = NonNullable<Pod["spec"]>["containers"][number];
const withContainer = (c: ContainerSpec): Pod => ({ metadata: { name: "p" }, spec: { containers: [c] } });

test("describePod: spec and status of each container, only the conditions that aren't True", () => {
  assert.deepEqual(wire(describePod(web as Pod)), {
    name: "web-1",
    status: "CrashLoopBackOff",
    node: "node-1",
    owner: "ReplicaSet/web-6cdf9c6f95",
    serviceAccount: "default",
    qosClass: "Burstable",
    createdAt: "2026-10-12T10:00:00Z",
    labels: { app: "web" },
    problems: [
      {
        type: "Ready",
        status: "False",
        reason: "ContainersNotReady",
        message: "containers with unready status: [web]",
        since: "2026-10-12T10:01:00Z",
      },
    ],
    initContainers: [
      {
        name: "migrate",
        image: "migrate:1",
        command: ["./migrate"],
        probes: {},
        ready: true,
        restarts: 0,
        state: "terminated: Completed (exit 0)",
        stateMessage: "3 tables migrated",
      },
    ],
    containers: [
      {
        name: "web",
        image: "nginx:1.27-alpine",
        args: ["--port=8080"],
        ports: ["8080/TCP", "9090/UDP"],
        resources: { limits: { memory: "32Mi" } },
        probes: { readiness: "http GET /ready on port 8080 (delay 0s, every 5s, timeout 1s, fails after 3)" },
        env: ["DB_PASSWORD: value hidden", "API_KEY: from secret api/key"],
        envFrom: ["secret db-creds"],
        ready: false,
        restarts: 4,
        state: "waiting: CrashLoopBackOff",
        stateMessage: "back-off 1m20s restarting failed container",
        lastTermination: {
          reason: "Error",
          exitCode: 1,
          message: "config missing",
          startedAt: "2026-10-12T10:04:00Z",
          finishedAt: "2026-10-12T10:04:02Z",
        },
      },
    ],
  });
});

test("describePod: an evicted pod, its container without a status", () => {
  const evicted = { ...withContainer({ name: "c" }), status: { phase: "Failed", reason: "Evicted", message: "The node was low on memory." } };
  assert.deepEqual(wire(describePod(evicted)), {
    name: "p",
    status: "Evicted",
    reason: "Evicted",
    message: "The node was low on memory.",
    problems: [],
    containers: [{ name: "c", probes: {}, state: "unknown" }],
  });
});

test("describePod: env vars show only where their value comes from", () => {
  const [c] = describePod(
    withContainer({
      name: "c",
      env: [
        { name: "PLAIN", value: "s3cr3t" },
        { name: "S", valueFrom: { secretKeyRef: { name: "db", key: "password" } } },
        { name: "C", valueFrom: { configMapKeyRef: { name: "cfg", key: "url" } } },
        { name: "F", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
        { name: "R", valueFrom: { resourceFieldRef: { resource: "limits.memory" } } },
      ],
      envFrom: [{ secretRef: { name: "db-creds" } }, { configMapRef: { name: "cfg" } }, {}],
    }),
  ).containers;
  assert.deepEqual(c!.env, [
    "PLAIN: value hidden",
    "S: from secret db/password",
    "C: from configMap cfg/url",
    "F: from field status.podIP",
    "R: from resource limits.memory",
  ]);
  assert.deepEqual(c!.envFrom, ["secret db-creds", "configMap cfg", "unknown"]);
});

test("describePod: each probe on one line, with Kubernetes' defaults", () => {
  const [c] = describePod(
    withContainer({
      name: "c",
      livenessProbe: { tcpSocket: { port: "http" }, initialDelaySeconds: 10, timeoutSeconds: 2, failureThreshold: 5 },
      readinessProbe: { exec: { command: ["cat", "/tmp/ready"] } },
      startupProbe: { grpc: { port: 9000 } },
    }),
  ).containers;
  assert.deepEqual(c!.probes, {
    liveness: "tcp port http (delay 10s, every 10s, timeout 2s, fails after 5)",
    readiness: "exec cat /tmp/ready (delay 0s, every 10s, timeout 1s, fails after 3)",
    startup: "grpc port 9000 (delay 0s, every 10s, timeout 1s, fails after 3)",
  });
  const [noPath] = describePod(withContainer({ name: "c", livenessProbe: { httpGet: { port: 80 } } })).containers;
  assert.equal(noPath!.probes.liveness, "http GET / on port 80 (delay 0s, every 10s, timeout 1s, fails after 3)");
});

test("get_pod: gets the pod by namespace and name, with no secret in the reply", async () => {
  const { calls, run } = fakeKube(getPod, web);
  const result = await run({ namespace: "demo", name: "web-1" });
  assert.deepEqual(calls, [{ path: "/api/v1/namespaces/demo/pods/web-1", query: {} }]);
  assert.deepEqual(result, { ok: true, data: describePod(web as Pod) });
  assert.ok(!JSON.stringify(result).includes("s3cr3t"), "a secret value leaked");
});

test("get_pod: bad args are rejected before calling the API", async () => {
  const { calls, run } = fakeKube(getPod, web);
  for (const args of [
    { namespace: "demo" },
    { name: "web-1" },
    { namespace: "demo", name: ".." },
    { namespace: "demo", name: "../secrets" },
    { namespace: "..", name: "web-1" },
    { namespace: "demo", name: "web-1", container: "web" },
  ]) {
    const result = await run(args);
    assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST", JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});
