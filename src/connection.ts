import { io, type Socket } from "socket.io-client";
import pkg from "../package.json" with { type: "json" };
import type { Config } from "./config.ts";
import { log } from "./log.ts";
import {
  PROTOCOL_VERSION,
  RUNNER_PATH,
  type ClientToServerEvents,
  type RunnerAuth,
  type ServerToClientEvents,
} from "./protocol.ts";

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
  socket.on("connect_error", (err) => log("warn", "cannot connect to gateway", { error: err.message }));

  return socket;
}
