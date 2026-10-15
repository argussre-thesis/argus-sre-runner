import { io, type Socket } from "socket.io-client";
import pkg from "../package.json" with { type: "json" };
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import {
  PROTOCOL_VERSION,
  RUNNER_PATH,
  type ClientToServerEvents,
  type ConnectErrorData,
  type RunnerAuth,
  type ServerToClientEvents,
} from "./protocol.ts";

// A refused token or protocol won't fix itself in seconds; don't hammer the gateway.
const SLOW_RETRY_MS = 30_000;

export type RunnerSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// slowRetryMs is only changed by tests.
export function connect(
  config: Config,
  ops: string[],
  slowRetryMs = SLOW_RETRY_MS,
): { socket: RunnerSocket; stop: () => void } {
  const auth: RunnerAuth = {
    token: config.token,
    clusterName: config.clusterName,
    runnerVersion: pkg.version,
    protocolVersion: PROTOCOL_VERSION,
    ops,
  };
  // WebSocket only: no HTTP long-polling start and upgrade (see CONTEXT §5.3).
  const socket: RunnerSocket = io(config.gatewayUrl, { path: RUNNER_PATH, auth, transports: ["websocket"] });

  socket.on("connect", () => log("info", "connected to gateway", { url: config.gatewayUrl, socketId: socket.id }));
  // Socket.IO gives up when the gateway refuses or drops us, so we retry ourselves, slowly.
  let retryTimer: NodeJS.Timeout | undefined;
  const retrySlowly = (msg: string, fields: Record<string, unknown>) => {
    log("error", msg, { ...fields, retryInMs: slowRetryMs });
    retryTimer = setTimeout(() => socket.connect(), slowRetryMs);
  };

  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") {
      return retrySlowly("dropped by gateway: another runner connected with this token, or the token was revoked", { reason });
    }
    log("warn", "disconnected from gateway", { reason });
  });
  socket.on("connect_error", (err) => {
    // Still active = a network problem, and Socket.IO retries by itself.
    if (socket.active) {
      log("warn", "cannot connect to gateway", { error: err.message });
      return;
    }
    const { code } = (err as Error & { data?: ConnectErrorData }).data ?? {};
    retrySlowly("refused by gateway", { code, error: err.message });
  });

  // A client-side disconnect is final: Socket.IO won't reconnect, and the pending retry is cancelled.
  const stop = () => {
    clearTimeout(retryTimer);
    socket.disconnect();
  };

  return { socket, stop };
}
