// Protocol v1: the contract between runner and gateway.
// Transport: Socket.IO over WebSocket. The runner always connects out to the gateway;
// the gateway never connects in, so the cluster needs no open inbound ports.
//
// The gateway keeps a copy of this file. Change both together, and bump
// PROTOCOL_VERSION when a change breaks runners that are already running.

export const PROTOCOL_VERSION = 1;

// Socket.IO path on the gateway: the runner connects to https://<gateway-host>/runner.
export const RUNNER_PATH = "/runner";

// The runner uses the default when the gateway sends no timeoutMs, and caps what the gateway asks for.
// The gateway waits a little longer than the capped value before failing the request itself.
export const DEFAULT_OP_TIMEOUT_MS = 10_000;
export const MAX_OP_TIMEOUT_MS = 30_000;

// Largest message the gateway accepts (Socket.IO maxHttpBufferSize). A bigger result makes
// the gateway drop the connection, so the runner must keep every result under it.
export const MAX_MESSAGE_BYTES = 1_000_000;

// ---- Connecting ----

// Sent once when connecting, as the Socket.IO handshake `auth`. It travels in the first
// message, not in the URL, so the token stays out of access logs.
export interface RunnerAuth {
  token: string;
  clusterName: string; // must match the cluster the token was created for
  runnerVersion: string;
  protocolVersion: number;
  ops: string[]; // the ops this runner can run
}

// Why the gateway refused the connection: `err.data.code` on the runner's `connect_error`.
// Neither fixes itself within seconds, so the runner retries slowly.
export type ConnectErrorCode =
  | "UNAUTHORIZED" // bad or revoked token, or clusterName doesn't match the token
  | "UNSUPPORTED_PROTOCOL"; // the gateway doesn't accept this protocolVersion

export interface ConnectErrorData {
  code: ConnectErrorCode;
}

// The gateway may also disconnect a runner that is already connected: a newer connection for
// the same tenant + cluster replaced it, or its token was revoked. The runner retries slowly then too.

// ---- Ops ----

export interface OpRequest {
  // Unique per request. Only for matching gateway and runner log lines: Socket.IO matches the reply itself.
  id: string;
  op: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
}

export type ErrorCode =
  | "BAD_REQUEST" // invalid args; the message says how to fix the call
  | "UNKNOWN_OP" // this runner doesn't support the op
  | "FORBIDDEN" // blocked by the runner's own rules or by its permissions
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UPSTREAM_ERROR" // the system the op reads from failed (Kubernetes API, Prometheus)
  | "TOO_LARGE" // the result would exceed the size limit
  | "INTERNAL"; // unexpected runner error; details only in the runner's own logs

export type OpResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: ErrorCode; message: string } };

// ---- Typed Socket.IO events ----
// Gateway: Server<ClientToServerEvents, ServerToClientEvents>
// Runner:  Socket<ServerToClientEvents, ClientToServerEvents>

export interface ServerToClientEvents {
  // The runner calls `reply` exactly once per op, on failure too.
  op: (req: OpRequest, reply: (result: OpResult) => void) => void;
}

// The runner sends no events of its own: everything it says is a reply to an op.
export type ClientToServerEvents = Record<never, never>;
