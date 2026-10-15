import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { Server } from "socket.io";
import pkg from "../package.json" with { type: "json" };
import { connect } from "../src/connection.ts";
import { PROTOCOL_VERSION, RUNNER_PATH, type ConnectErrorCode, type ConnectErrorData } from "../src/protocol.ts";

const SLOW_RETRY_MS = 300;

// A bare gateway on a random port. It records every connection attempt and refuses while `refuse` is set.
async function startGateway(t: TestContext) {
  const httpServer = createServer();
  const io = new Server(httpServer, { path: RUNNER_PATH });
  const gateway = { io, url: "", attempts: [] as number[], refuse: undefined as ConnectErrorCode | undefined };

  io.use((_socket, next) => {
    gateway.attempts.push(Date.now());
    if (!gateway.refuse) return next();
    next(Object.assign(new Error("refused"), { data: { code: gateway.refuse } satisfies ConnectErrorData }));
  });

  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  gateway.url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  t.after(() => io.close());
  return gateway;
}

function startRunner(t: TestContext, gatewayUrl: string, slowRetryMs = SLOW_RETRY_MS) {
  const runner = connect({ gatewayUrl, token: "tok", clusterName: "c1" }, ["ping"], slowRetryMs);
  t.after(runner.stop);
  return runner;
}

test("connects and sends its auth", async (t) => {
  const gateway = await startGateway(t);
  startRunner(t, gateway.url);

  const [socket] = await once(gateway.io, "connection");
  assert.deepEqual(socket.handshake.auth, {
    token: "tok",
    clusterName: "c1",
    runnerVersion: pkg.version,
    protocolVersion: PROTOCOL_VERSION,
    ops: ["ping"],
  });
});

for (const code of ["UNAUTHORIZED", "UNSUPPORTED_PROTOCOL"] as const) {
  test(`refused with ${code}: retries after the slow delay, then connects`, async (t) => {
    const gateway = await startGateway(t);
    gateway.refuse = code;
    const runner = startRunner(t, gateway.url);

    await new Promise((resolve) => runner.socket.once("connect_error", resolve));
    gateway.refuse = undefined; // e.g. the gateway now accepts this protocol version
    await once(gateway.io, "connection");

    assert.equal(gateway.attempts.length, 2);
    assert.ok(gateway.attempts[1] - gateway.attempts[0] >= SLOW_RETRY_MS, "retried too early");
  });
}

test("dropped by the gateway: reconnects after the slow delay", async (t) => {
  const gateway = await startGateway(t);
  startRunner(t, gateway.url);

  const [first] = await once(gateway.io, "connection");
  const droppedAt = Date.now();
  first.disconnect(true); // what the gateway does to a replaced connection
  await once(gateway.io, "connection");

  assert.ok(Date.now() - droppedAt >= SLOW_RETRY_MS, "reconnected too early");
});

test("connection lost: Socket.IO reconnects by itself, not after the slow delay", { timeout: 5_000 }, async (t) => {
  const gateway = await startGateway(t);
  startRunner(t, gateway.url, 60_000); // if the slow path were taken, the test would time out

  const [first] = await once(gateway.io, "connection");
  first.conn.close(); // closes the transport underneath, like a network drop
  await once(gateway.io, "connection");
});

test("stop() says goodbye to the gateway", async (t) => {
  const gateway = await startGateway(t);
  const runner = startRunner(t, gateway.url);
  // The gateway accepts slightly before the runner knows it's connected; only then does it send a goodbye.
  const runnerConnected = new Promise<void>((resolve) => runner.socket.once("connect", () => resolve()));

  const [socket] = await once(gateway.io, "connection");
  await runnerConnected;
  runner.stop();
  const [reason] = await once(socket, "disconnect");
  assert.equal(reason, "client namespace disconnect");
});

test("stop() while waiting to retry: no more attempts", async (t) => {
  const gateway = await startGateway(t);
  gateway.refuse = "UNAUTHORIZED";
  const runner = startRunner(t, gateway.url);

  await new Promise((resolve) => runner.socket.once("connect_error", resolve));
  runner.stop();
  await sleep(SLOW_RETRY_MS * 2);

  assert.equal(gateway.attempts.length, 1);
});
