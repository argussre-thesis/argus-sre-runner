import { OpError, type Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { checkKnownArgs, optionalBool, optionalInt, requiredLabelName, requiredObjectName } from "../args.ts";

const DEFAULT_TAIL_LINES = 100;
const MAX_TAIL_LINES = 500;
// Each call holds ~4× the body in memory; 8 MB bodies in parallel OOM-killed the runner.
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_REPLY_BYTES = 64 * 1024;
const MAX_LINE_CHARS = 2000;

interface Args {
  namespace: string;
  pod: string;
  container?: string;
  previous?: boolean;
  tailLines: number;
  sinceSeconds?: number;
}

export function getLogs(kube: KubeApi): Op<Args> {
  return {
    name: "get_logs",
    parseArgs(raw) {
      checkKnownArgs(raw, ["namespace", "pod", "container", "previous", "tailLines", "sinceSeconds"]);
      return {
        namespace: requiredLabelName(raw, "namespace"),
        pod: requiredObjectName(raw, "pod"),
        container: raw.container == null ? undefined : requiredLabelName(raw, "container"),
        previous: optionalBool(raw, "previous"),
        tailLines: optionalInt(raw, "tailLines", { min: 1, max: MAX_TAIL_LINES }) ?? DEFAULT_TAIL_LINES,
        sinceSeconds: optionalInt(raw, "sinceSeconds", { min: 1, max: 7 * 24 * 3600 }),
      };
    },
    async run({ namespace, pod, container, previous, tailLines, sinceSeconds }, signal) {
      // No limitBytes: the kubelet applies it from the oldest end of the tail, so it drops the newest lines.
      const text = await kube
        .getText(
          `/api/v1/namespaces/${namespace}/pods/${pod}/log`,
          { container, previous: previous || undefined, tailLines, sinceSeconds, timestamps: true },
          signal,
          MAX_LOG_BYTES,
        )
        .catch((err) => {
          if (err instanceof OpError && err.code === "TOO_LARGE") {
            throw new OpError("TOO_LARGE", `the newest ${tailLines} lines are over 2 MB; try a smaller tailLines`);
          }
          throw err;
        });
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();

      // The kubelet sends this as a 200 "log"; real lines start with a timestamp.
      if (lines[0]?.startsWith("unable to retrieve container logs")) {
        throw new OpError("NOT_FOUND", previous ? `${lines[0]}; the previous container may be gone, try without previous` : lines[0]!);
      }

      // Newest lines first into the budget: the crash is usually at the end.
      const kept: string[] = [];
      let bytes = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = cutLine(lines[i]!);
        bytes += Buffer.byteLength(JSON.stringify(line)) + 1;
        if (bytes > MAX_REPLY_BYTES) break;
        kept.push(line);
      }
      return { lines: kept.reverse(), truncated: lines.length >= tailLines || kept.length < lines.length };
    },
  };
}

function cutLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [${line.length - MAX_LINE_CHARS} more characters]` : line;
}
