// Local stand-in for the real gateway (argus-sre-gateway). Not production code.

import { createServer } from "node:http";
import express from "express";
import { Server, type Socket } from "socket.io";
import { log } from "../src/log.ts";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  RUNNER_PATH,
  type ClientToServerEvents,
  type ConnectErrorCode,
  type ConnectErrorData,
  type RunnerAuth,
  type ServerToClientEvents,
} from "../src/protocol.ts";

const PORT = 8080;

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

// One live connection per tenant + cluster, keyed "tenantId/clusterName". Ops will be routed through this.
const runners = new Map<string, RunnerSocket>();

const app = express();
const httpServer = createServer(app);
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

httpServer.listen(PORT, () => {
  log("info", "dev gateway listening", { url: `http://localhost:${PORT}`, path: RUNNER_PATH });
});
