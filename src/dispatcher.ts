import { log } from "./log.ts";
import {
  DEFAULT_OP_TIMEOUT_MS,
  MAX_OP_TIMEOUT_MS,
  type ErrorCode,
  type OpRequest,
  type OpResult,
} from "./protocol.ts";

export class OpError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "OpError";
    this.code = code;
  }
}

export interface Op<A = unknown> {
  name: string;
  parseArgs(raw: Record<string, unknown>): A;
  run(args: A, signal: AbortSignal): Promise<unknown>;
}

export class Dispatcher {
  private readonly ops: Map<string, Op>;

  constructor(ops: Op[]) {
    this.ops = new Map(ops.map((op) => [op.name, op]));
  }

  get opNames(): string[] {
    return [...this.ops.keys()];
  }

  // Never rejects: every request gets exactly one result.
  async dispatch(req: OpRequest): Promise<OpResult> {
    const started = performance.now();
    const result = await this.execute(req);
    log("info", "op finished", {
      id: req.id,
      op: req.op,
      args: req.args,
      ok: result.ok,
      errorCode: result.ok ? undefined : result.error.code,
      durationMs: Math.round(performance.now() - started),
    });
    return result;
  }

  private async execute(req: OpRequest): Promise<OpResult> {
    try {
      const op = this.ops.get(req.op);
      if (!op) throw new OpError("UNKNOWN_OP", `op "${req.op}" is not supported by this runner`);

      const raw: unknown = req.args ?? {};
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new OpError("BAD_REQUEST", "args must be a JSON object");
      }
      const args = op.parseArgs(raw as Record<string, unknown>);

      const data = await runWithTimeout((signal) => op.run(args, signal), resolveTimeout(req.timeoutMs));
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: toResultError(err, req) };
    }
  }
}

export function resolveTimeout(requested: unknown): number {
  const valid = typeof requested === "number" && Number.isFinite(requested) && requested > 0;
  return Math.min(valid ? requested : DEFAULT_OP_TIMEOUT_MS, MAX_OP_TIMEOUT_MS);
}

async function runWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OpError("TIMEOUT", `op did not finish within ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function toResultError(err: unknown, req: OpRequest): { code: ErrorCode; message: string } {
  if (err instanceof OpError) return { code: err.code, message: err.message };
  log("error", "op failed unexpectedly", { id: req.id, op: req.op, error: String(err), stack: (err as Error)?.stack });
  return { code: "INTERNAL", message: "internal runner error" };
}
