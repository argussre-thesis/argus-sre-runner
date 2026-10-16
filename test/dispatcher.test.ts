import assert from "node:assert/strict";
import { test } from "node:test";
import { Dispatcher, OpError, resolveTimeout, type Op } from "../src/dispatcher.ts";
import { ping } from "../src/ops/ping.ts";
import { DEFAULT_OP_TIMEOUT_MS, MAX_OP_TIMEOUT_MS, type OpRequest } from "../src/protocol.ts";

const req = (op: string, args: unknown = {}, timeoutMs?: number) => ({ id: "req-1", op, args, timeoutMs }) as OpRequest;

const fakeOp = (name: string, run: Op["run"]): Op => ({ name, parseArgs: () => ({}), run });

test("ping: returns pong and the runner's time", async () => {
  const result = await new Dispatcher([ping]).dispatch(req("ping"));

  assert.ok(result.ok);
  const data = result.data as { pong: boolean; time: string };
  assert.equal(data.pong, true);
  assert.ok(!Number.isNaN(Date.parse(data.time)), `not a date: ${data.time}`);
});

test("missing args count as {}", async () => {
  const result = await new Dispatcher([ping]).dispatch({ id: "req-1", op: "ping" } as OpRequest);
  assert.equal(result.ok, true);
});

test("ping: an unknown arg is BAD_REQUEST", async () => {
  const result = await new Dispatcher([ping]).dispatch(req("ping", { namespce: "x" }));
  assert.deepEqual(result, {
    ok: false,
    error: { code: "BAD_REQUEST", message: "unknown argument(s): namespce (allowed: none)" },
  });
});

test("an op this runner doesn't have is UNKNOWN_OP", async () => {
  const result = await new Dispatcher([ping]).dispatch(req("drop_database"));
  assert.deepEqual(result, {
    ok: false,
    error: { code: "UNKNOWN_OP", message: 'op "drop_database" is not supported by this runner' },
  });
});

for (const args of [[], "x", 5]) {
  test(`args ${JSON.stringify(args)} is BAD_REQUEST`, async () => {
    const result = await new Dispatcher([ping]).dispatch(req("ping", args));
    assert.deepEqual(result, { ok: false, error: { code: "BAD_REQUEST", message: "args must be a JSON object" } });
  });
}

test("an op that runs too long is TIMEOUT, and its signal is aborted", async () => {
  let signal: AbortSignal | undefined;
  const hang = fakeOp("hang", (_args, s) => {
    signal = s;
    return new Promise(() => {});
  });

  const result = await new Dispatcher([hang]).dispatch(req("hang", {}, 50));

  assert.deepEqual(result, { ok: false, error: { code: "TIMEOUT", message: "op did not finish within 50ms" } });
  assert.equal(signal?.aborted, true);
});

test("an OpError from the op keeps its code and message", async () => {
  const missing = fakeOp("missing", async () => {
    throw new OpError("NOT_FOUND", 'pod "web-1" not found');
  });
  const result = await new Dispatcher([missing]).dispatch(req("missing"));
  assert.deepEqual(result, { ok: false, error: { code: "NOT_FOUND", message: 'pod "web-1" not found' } });
});

test("any other error is INTERNAL, without its details", async () => {
  const boom = fakeOp("boom", async () => {
    throw new Error("password=hunter2");
  });
  const result = await new Dispatcher([boom]).dispatch(req("boom"));
  assert.deepEqual(result, { ok: false, error: { code: "INTERNAL", message: "internal runner error" } });
});

test("opNames lists the registered ops", () => {
  const other = fakeOp("other", async () => null);
  assert.deepEqual(new Dispatcher([ping, other]).opNames, ["ping", "other"]);
});

test("resolveTimeout: default, keeps a valid value, caps at the max", () => {
  assert.equal(resolveTimeout(undefined), DEFAULT_OP_TIMEOUT_MS);
  assert.equal(resolveTimeout(5_000), 5_000);
  assert.equal(resolveTimeout(MAX_OP_TIMEOUT_MS + 1), MAX_OP_TIMEOUT_MS);
  for (const bad of [0, -1, NaN, Infinity, "5000"]) {
    assert.equal(resolveTimeout(bad), DEFAULT_OP_TIMEOUT_MS, `for ${String(bad)}`);
  }
});
