// Local stand-in for the real gateway (argus-sre-gateway). Not production code.

import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { log } from "../src/log.ts";
import {
  MAX_MESSAGE_BYTES,
  RUNNER_PATH,
  type ClientToServerEvents,
  type RunnerAuth,
  type ServerToClientEvents,
} from "../src/protocol.ts";

const PORT = 8080;

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  path: RUNNER_PATH,
  maxHttpBufferSize: MAX_MESSAGE_BYTES,
  pingInterval: 25_000, // Socket.IO's default, written out because the protocol relies on it
});

io.on("connection", (socket) => {
  const { clusterName, runnerVersion, protocolVersion, ops } = socket.handshake.auth as RunnerAuth;
  log("info", "runner connected", { socketId: socket.id, clusterName, runnerVersion, protocolVersion, ops });

  socket.on("disconnect", (reason) => {
    log("info", "runner disconnected", { socketId: socket.id, clusterName, reason });
  });
});

httpServer.listen(PORT, () => {
  log("info", "dev gateway listening", { url: `http://localhost:${PORT}`, path: RUNNER_PATH });
});
