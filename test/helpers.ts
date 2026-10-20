import { Dispatcher, type Op } from "../src/dispatcher.ts";
import type { KubeApi, Query } from "../src/kubernetes/client.ts";

// Runs one op through the dispatcher against a fake API that answers every call with `response`,
// or with `response(query)` when it's a function (pages, errors).
export function fakeKube(makeOp: (kube: KubeApi) => Op, response: unknown) {
  const calls: { path: string; query?: Query; maxBytes?: number }[] = [];
  const answer = (call: (typeof calls)[number]) => {
    calls.push(call);
    return typeof response === "function" ? response(call.query) : response;
  };
  const kube: KubeApi = {
    async getJson<T>(path: string, query?: Query) {
      return answer({ path, query }) as T;
    },
    async getText(path: string, query?: Query, _signal?: AbortSignal, maxBytes?: number) {
      return answer({ path, query, maxBytes }) as string;
    },
  };
  const op = makeOp(kube);
  const dispatcher = new Dispatcher([op]);
  const run = (args: Record<string, unknown>) => dispatcher.dispatch({ id: "t", op: op.name, args });
  return { calls, run };
}
