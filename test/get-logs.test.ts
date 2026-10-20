import assert from "node:assert/strict";
import { test } from "node:test";
import { OpError } from "../src/dispatcher.ts";
import { getLogs } from "../src/ops/kubernetes/get-logs.ts";
import { fakeKube } from "./helpers.ts";

const linesOf = (result: Awaited<ReturnType<ReturnType<typeof fakeKube>["run"]>>) => {
  assert.ok(result.ok, JSON.stringify(result));
  return result.data as { lines: string[]; truncated: boolean };
};

test("get_logs: calls the pod's log endpoint with timestamps, the default tail and a 2 MB cap, splits lines", async () => {
  const { calls, run } = fakeKube(getLogs, "2026-10-20T14:43:32Z connecting to db...\n2026-10-20T14:43:34Z FATAL: db connection refused\n");
  const result = await run({ namespace: "demo", pod: "crashloop-1" });
  assert.deepEqual(calls, [
    {
      path: "/api/v1/namespaces/demo/pods/crashloop-1/log",
      query: { container: undefined, previous: undefined, tailLines: 100, sinceSeconds: undefined, timestamps: true },
      maxBytes: 2 * 1024 * 1024,
    },
  ]);
  assert.deepEqual(linesOf(result), {
    lines: ["2026-10-20T14:43:32Z connecting to db...", "2026-10-20T14:43:34Z FATAL: db connection refused"],
    truncated: false,
  });
});

test("get_logs: passes container, previous, tailLines and sinceSeconds; a full tail is truncated", async () => {
  const { calls, run } = fakeKube(getLogs, "a\nb\n");
  const result = await run({ namespace: "demo", pod: "p", container: "app", previous: true, tailLines: 2, sinceSeconds: 60 });
  assert.deepEqual(calls[0]?.query, { container: "app", previous: true, tailLines: 2, sinceSeconds: 60, timestamps: true });
  assert.deepEqual(linesOf(result), { lines: ["a", "b"], truncated: true });

  await run({ namespace: "demo", pod: "p", container: null, previous: false, tailLines: null, sinceSeconds: null });
  assert.deepEqual(calls[1]?.query, { container: undefined, previous: undefined, tailLines: 100, sinceSeconds: undefined, timestamps: true });
});

test("get_logs: keeps the newest lines that fit 64 KB as JSON, oldest dropped", async () => {
  // Quotes double in JSON, as in JSON logs.
  const log = Array.from({ length: 100 }, (_, i) => `${i} ${'"x'.repeat(500)}`).join("\n");
  const { lines, truncated } = linesOf(await fakeKube(getLogs, log).run({ namespace: "demo", pod: "p", tailLines: 500 }));
  assert.ok(lines.length > 30 && lines.length < 100, String(lines.length));
  assert.ok(lines.at(-1)!.startsWith("99 "));
  assert.ok(lines[0]!.startsWith(`${100 - lines.length} `));
  assert.ok(Buffer.byteLength(JSON.stringify(lines)) <= 64 * 1024);
  assert.equal(truncated, true);
});

test("get_logs: a long line keeps its start and says how much was cut", async () => {
  const { lines } = linesOf(await fakeKube(getLogs, `ts ${"y".repeat(4997)}\nshort`).run({ namespace: "demo", pod: "p" }));
  assert.deepEqual(lines, [`ts ${"y".repeat(1997)}… [3000 more characters]`, "short"]);
});

test("get_logs: the kubelet's 'unable to retrieve' line is NOT_FOUND", async () => {
  const { run } = fakeKube(getLogs, "unable to retrieve container logs for docker://94cf834b\n");
  assert.deepEqual(await run({ namespace: "demo", pod: "p", previous: true }), {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "unable to retrieve container logs for docker://94cf834b; the previous container may be gone, try without previous",
    },
  });
  assert.deepEqual(await run({ namespace: "demo", pod: "p" }), {
    ok: false,
    error: { code: "NOT_FOUND", message: "unable to retrieve container logs for docker://94cf834b" },
  });
});

test("get_logs: a log over the cap is TOO_LARGE with a hint", async () => {
  const { run } = fakeKube(getLogs, () => {
    throw new OpError("TOO_LARGE", "response from 10.96.0.1:443 exceeded 2097152 bytes");
  });
  assert.deepEqual(await run({ namespace: "demo", pod: "p", tailLines: 500 }), {
    ok: false,
    error: { code: "TOO_LARGE", message: "the newest 500 lines are over 2 MB; try a smaller tailLines" },
  });
});

test("get_logs: bad args are rejected before calling the API", async () => {
  const { calls, run } = fakeKube(getLogs, "");
  for (const args of [
    { namespace: "demo" },
    { namespace: "demo", pod: ".." },
    { namespace: "demo", pod: "p", container: "App" },
    { namespace: "demo", pod: "p", previous: "true" },
    { namespace: "demo", pod: "p", tailLines: 0 },
    { namespace: "demo", pod: "p", tailLines: 501 },
    { namespace: "demo", pod: "p", sinceSeconds: 0 },
    { namespace: "demo", pod: "p", limitBytes: 100 },
  ]) {
    const result = await run(args);
    assert.equal(result.ok ? "ok" : result.error.code, "BAD_REQUEST", JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});
