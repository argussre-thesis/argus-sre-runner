// Local stand-in for the real gateway (argus-sre-gateway). Not production code.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { Server, type Socket } from "socket.io";
import { log } from "../src/log.ts";
import {
  DEFAULT_OP_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  RUNNER_PATH,
  type ClientToServerEvents,
  type ConnectErrorCode,
  type ConnectErrorData,
  type ErrorCode,
  type OpRequest,
  type OpResult,
  type RunnerAuth,
  type ServerToClientEvents,
} from "../src/protocol.ts";

const PORT = 8080;
// Keep the ops endpoint local.
const OPS_PORT = 8081;

// token → the cluster it was created for. The real gateway asks the backend instead.
const DEV_TOKENS = new Map([
  ["dev-token", { tenantId: "t_dev", clusterName: "minikube" }],
  ["dev-token-local", { tenantId: "t_dev", clusterName: "local-dev" }],
]);

// Set by the middleware once the token is verified.
interface SocketData {
  tenantId: string;
  clusterName: string;
}
type RunnerSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<never, never>, SocketData>;

// One connection per tenant and cluster.
const runners = new Map<string, RunnerSocket>();

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<never, never>, SocketData>(httpServer, {
  path: RUNNER_PATH,
  maxHttpBufferSize: MAX_MESSAGE_BYTES,
  pingInterval: 25_000, // Socket.IO's default, written out because the protocol relies on it
});

// Runs before "connection": calling next(err) refuses the runner, and it gets err as connect_error.
io.use((socket, next) => {
  const { token, clusterName, protocolVersion } = socket.handshake.auth as Partial<RunnerAuth>;
  const refuse = (code: ConnectErrorCode, message: string) => {
    log("warn", "runner refused", { code, clusterName, protocolVersion });
    next(Object.assign(new Error(message), { data: { code } satisfies ConnectErrorData }));
  };

  if (protocolVersion !== PROTOCOL_VERSION) {
    return refuse("UNSUPPORTED_PROTOCOL", `protocol version ${protocolVersion} is not supported, use ${PROTOCOL_VERSION}`);
  }
  const cluster = typeof token === "string" ? DEV_TOKENS.get(token) : undefined;
  if (!cluster || cluster.clusterName !== clusterName) {
    return refuse("UNAUTHORIZED", "invalid token, or the token belongs to another cluster");
  }
  socket.data = { tenantId: cluster.tenantId, clusterName: cluster.clusterName };
  next();
});

io.on("connection", (socket) => {
  const { tenantId, clusterName } = socket.data;
  const { runnerVersion, protocolVersion, ops } = socket.handshake.auth as RunnerAuth;
  const key = `${tenantId}/${clusterName}`;

  // Newest wins: the old connection is either dead and not noticed yet, or a second runner with the same token.
  const previous = runners.get(key);
  if (previous) {
    log("warn", "runner replaced by a newer connection", { tenantId, clusterName, oldSocketId: previous.id, newSocketId: socket.id });
    previous.disconnect(true);
  }
  runners.set(key, socket);
  log("info", "runner connected", { socketId: socket.id, tenantId, clusterName, runnerVersion, protocolVersion, ops });

  socket.on("disconnect", (reason) => {
    // Only remove our own entry: a replaced connection must not unregister the one that replaced it.
    if (runners.get(key) === socket) runners.delete(key);
    log("info", "runner disconnected", { socketId: socket.id, tenantId, clusterName, reason });
  });
});

type GatewayErrorCode = "RUNNER_OFFLINE" | "RUNNER_DISCONNECTED" | "GATEWAY_TIMEOUT";
type GatewayResult = OpResult | { ok: false; error: { code: ErrorCode | GatewayErrorCode; message: string } };
const fail = (code: ErrorCode | GatewayErrorCode, message: string): GatewayResult => ({ ok: false, error: { code, message } });
const ACK_TIMEOUT_MS = DEFAULT_OP_TIMEOUT_MS + 2_000;

function sendOp(socket: RunnerSocket, req: OpRequest): Promise<[number, GatewayResult]> {
  return new Promise((resolve) => {
    // Resolve immediately if the runner disconnects.
    const onDisconnect = () => resolve([502, fail("RUNNER_DISCONNECTED", "runner disconnected before answering, retry the op")]);
    socket.once("disconnect", onDisconnect);
    socket.timeout(ACK_TIMEOUT_MS).emit("op", req, (err, result) => {
      socket.off("disconnect", onDisconnect);
      resolve(err ? [504, fail("GATEWAY_TIMEOUT", `runner did not answer within ${ACK_TIMEOUT_MS}ms`)] : [200, result]);
    });
  });
}

const app = express();

// Use 200 when the runner answered, even if the operation failed.
app.post("/internal/tenants/:tenantId/clusters/:cluster/ops", express.json(), async (req, res) => {
  const { tenantId, cluster } = req.params;
  const { op, args = {} } = req.body ?? {};
  if (typeof op !== "string") {
    res.status(400).json(fail("BAD_REQUEST", 'send JSON like {"op":"ping","args":{}} with content-type application/json'));
    return;
  }
  const socket = runners.get(`${tenantId}/${cluster}`);
  if (!socket) {
    res.status(503).json(fail("RUNNER_OFFLINE", `no runner connected for cluster "${cluster}" of tenant ${tenantId}`));
    return;
  }

  const opReq: OpRequest = { id: randomUUID(), op, args };
  const started = performance.now();
  const [status, body] = await sendOp(socket, opReq);
  log("info", "op answered", {
    id: opReq.id,
    tenantId,
    cluster,
    op,
    status,
    errorCode: body.ok ? undefined : body.error.code,
    durationMs: Math.round(performance.now() - started),
  });
  res.status(status).json(body);
});

httpServer.listen(PORT, () => {
  log("info", "dev gateway listening", { url: `http://localhost:${PORT}`, path: RUNNER_PATH });
});
app.listen(OPS_PORT, "127.0.0.1", () => {
  log("info", "ops endpoint listening", { url: `http://127.0.0.1:${OPS_PORT}/internal/tenants/t_dev/clusters/{cluster}/ops` });
});
