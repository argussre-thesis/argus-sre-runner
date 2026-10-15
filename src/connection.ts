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

export function connect(config: Config, ops: string[]): RunnerSocket {
  const auth: RunnerAuth = {
    token: config.token,
    clusterName: config.clusterName,
    runnerVersion: pkg.version,
    protocolVersion: PROTOCOL_VERSION,
    ops,
  };
  const socket: RunnerSocket = io(config.gatewayUrl, { path: RUNNER_PATH, auth });

  socket.on("connect", () => log("info", "connected to gateway", { url: config.gatewayUrl, socketId: socket.id }));
  socket.on("disconnect", (reason) => log("warn", "disconnected from gateway", { reason }));
  socket.on("connect_error", (err) => {
    // Still active = a network problem, and Socket.IO retries by itself.
    if (socket.active) {
      log("warn", "cannot connect to gateway", { error: err.message });
      return;
    }
    // Not active = the gateway refused us. Socket.IO gives up here, so retry ourselves, slowly.
    const { code } = (err as Error & { data?: ConnectErrorData }).data ?? {};
    log("error", "refused by gateway", { code, error: err.message, retryInMs: SLOW_RETRY_MS });
    setTimeout(() => socket.connect(), SLOW_RETRY_MS);
  });

  return socket;
}
