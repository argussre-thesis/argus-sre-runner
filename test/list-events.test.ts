import assert from "node:assert/strict";
import { test } from "node:test";
import type { Query } from "../src/kubernetes/client.ts";
import { summarizeEvent, type KubeEvent } from "../src/kubernetes/events.ts";
import { listEvents } from "../src/ops/kubernetes/list-events.ts";
import type { OpResult } from "../src/protocol.ts";
import { fakeKube } from "./helpers.ts";

const event = (name: string, lastTimestamp: string, extra: Partial<KubeEvent> = {}): KubeEvent => ({
  metadata: { name },
  involvedObject: { kind: "Pod", name },
  lastTimestamp,
  ...extra,
});

// The event `secondsAgo` seconds before now, with a matching name.
const ago = (secondsAgo: number) => event(`e${secondsAgo}`, new Date(Date.now() - secondsAgo * 1000).toISOString());

const names = (result: OpResult) =>
  result.ok ? (result.data as { events: { object: string }[] }).events.map((e) => e.object.slice(4)) : result.error.code;

test("summarizeEvent: old-style (count, lastTimestamp) and new-style (series, eventTime) events", () => {
  assert.deepEqual(
    summarizeEvent({
      metadata: { name: "a" },
      involvedObject: { kind: "Pod", name: "api-1" },
      type: "Warning",
      reason: "Unhealthy",
      message: "Readiness probe failed: HTTP probe failed with statuscode: 404",
      count: 500,
      firstTimestamp: "2026-10-19T14:00:00Z",
      lastTimestamp: "2026-10-19T15:00:00Z",
      source: { component: "kubelet" },
    }),
    {
      time: "2026-10-19T15:00:00Z",
      firstTime: "2026-10-19T14:00:00Z",
      type: "Warning",
      reason: "Unhealthy",
      object: "Pod/api-1",
      message: "Readiness probe failed: HTTP probe failed with statuscode: 404",
      count: 500,
      source: "kubelet",
    },
  );
  const newStyle = summarizeEvent({
    metadata: { name: "b", creationTimestamp: "2026-10-19T13:00:00Z" },
    involvedObject: { kind: "Deployment", name: "api" },
    eventTime: "2026-10-19T15:00:00.123456Z",
    count: 0,
    firstTimestamp: null,
    lastTimestamp: "2026-10-19T15:00:00Z",
    series: { count: 7, lastObservedTime: "2026-10-19T15:05:00.000000Z" },
    reportingComponent: "deployment-controller",
  });
  assert.equal(newStyle.time, "2026-10-19T15:05:00.000000Z");
  assert.equal(newStyle.firstTime, undefined);
  assert.equal(newStyle.count, 7);
  assert.equal(newStyle.source, "deployment-controller");
  assert.equal(summarizeEvent({ metadata: { name: "c", creationTimestamp: "2026-10-19T13:00:00Z" }, involvedObject: {} }).time, "2026-10-19T13:00:00Z");
  assert.equal(summarizeEvent({ metadata: { name: "d" }, involvedObject: {} }).count, 1);
});

test("list_events: newest first by time, also across the two timestamp formats", async () => {
  const { run } = fakeKube(listEvents, {
    items: [
      event("middle", "2026-10-19T15:00:00.500000Z"),
      event("oldest", "2026-10-19T15:00:00Z"),
      event("newest", "2026-10-19T15:00:01Z"),
      event("no-time", ""),
    ],
  });
  assert.deepEqual(names(await run({ namespace: "demo" })), ["newest", "middle", "oldest", "no-time"]);
});

test("list_events: the filters go to the API as one fieldSelector", async () => {
  const { calls, run } = fakeKube(listEvents, { items: [] });
  await run({ namespace: "demo", involvedObject: "Pod/api-7d9f-x2k", type: "Warning" });
  await run({ namespace: "demo", involvedObject: "api-7d9f" });
  await run({ namespace: "demo", involvedObject: null, type: null, sinceSeconds: null });
  assert.deepEqual(calls, [
    {
      path: "/api/v1/namespaces/demo/events",
      query: { fieldSelector: "involvedObject.name=api-7d9f-x2k,involvedObject.kind=Pod,type=Warning", limit: 500, continue: undefined },
    },
    { path: "/api/v1/namespaces/demo/events", query: { fieldSelector: "involvedObject.name=api-7d9f", limit: 500, continue: undefined } },
    { path: "/api/v1/namespaces/demo/events", query: { fieldSelector: undefined, limit: 500, continue: undefined } },
  ]);
});

test("list_events: reads every page, so the newest event on a later page comes first", async () => {
  const pages: Record<string, { metadata?: { continue?: string }; items: KubeEvent[] }> = {
    first: { metadata: { continue: "p2" }, items: [ago(30), ago(10)] },
    p2: { items: [ago(1), ago(20)] },
  };
  const { calls, run } = fakeKube(listEvents, (query: Query) => pages[(query.continue as string) ?? "first"]);
  const result = await run({ namespace: "demo" });
  assert.deepEqual(names(result), ["e1", "e10", "e20", "e30"]);
  assert.deepEqual(
    calls.map((c) => c.query?.continue),
    [undefined, "p2"],
  );
  assert.equal(result.ok && (result.data as { truncated: boolean }).truncated, false);
});

test("list_events: keeps the newest 100 across pages and says truncated", async () => {
  const items = Array.from({ length: 150 }, (_, i) => ago(i + 1));
  const { run } = fakeKube(listEvents, (query: Query) =>
    query.continue ? { items: items.slice(0, 75) } : { metadata: { continue: "p2" }, items: items.slice(75) },
  );
  const result = await run({ namespace: "demo" });
  const got = names(result);
  assert.equal(got.length, 100);
  assert.equal(got[0], "e1");
  assert.equal(got[99], "e100");
  assert.equal(result.ok && (result.data as { truncated: boolean }).truncated, true);
});

test("list_events: stops after 10 pages and says truncated", async () => {
  const { calls, run } = fakeKube(listEvents, () => ({ metadata: { continue: "more" }, items: [ago(5)] }));
  const result = await run({ namespace: "demo" });
  assert.equal(calls.length, 10);
  assert.equal(result.ok && (result.data as { truncated: boolean }).truncated, true);
});

test("list_events: sinceSeconds drops older events", async () => {
  const { run } = fakeKube(listEvents, { items: [ago(10), ago(100), ago(1000)] });
  assert.deepEqual(names(await run({ namespace: "demo", sinceSeconds: 120 })), ["e10", "e100"]);
});

test("list_events: bad args are rejected before calling the API", async () => {
  const { calls, run } = fakeKube(listEvents, { items: [] });
  for (const args of [
    {},
    { namespace: ".." },
    { namespace: "demo", involvedObject: "pod/api" },
    { namespace: "demo", involvedObject: "Pod/" },
    { namespace: "demo", involvedObject: "Pod/api,type=Normal" },
    { namespace: "demo", involvedObject: "Pod/api/x" },
    { namespace: "demo", involvedObject: "Pod/../secrets" },
    { namespace: "demo", type: "warning" },
    { namespace: "demo", sinceSeconds: 0 },
    { namespace: "demo", sinceSeconds: 3601 },
    { namespace: "demo", sinceSeconds: "900" },
    { namespace: "demo", sinceSeconds: 1.5 },
    { namespace: "demo", since: 900 },
  ]) {
    assert.equal(names(await run(args)), "BAD_REQUEST", JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});
