import { Dispatcher, type Op } from "../src/dispatcher.ts";
import type { KubeApi, Query } from "../src/kubernetes/client.ts";

// Runs one op through the dispatcher against a fake API that answers every getJson with `response`.
export function fakeKube(makeOp: (kube: KubeApi) => Op, response: unknown) {
  const calls: { path: string; query?: Query }[] = [];
  const kube: KubeApi = {
    async getJson<T>(path: string, query?: Query) {
      calls.push({ path, query });
      return response as T;
    },
    async getText() {
      throw new Error("getText isn't faked");
    },
  };
  const op = makeOp(kube);
  const dispatcher = new Dispatcher([op]);
  const run = (args: Record<string, unknown>) => dispatcher.dispatch({ id: "t", op: op.name, args });
  return { calls, run };
}
