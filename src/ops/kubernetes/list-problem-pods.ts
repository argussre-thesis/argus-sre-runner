import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { isProblemPod, summarizePod, type Pod } from "../../kubernetes/pods.ts";
import { checkKnownArgs } from "../args.ts";

export function listProblemPods(kube: KubeApi): Op {
  return {
    name: "list_problem_pods",
    parseArgs(raw) {
      checkKnownArgs(raw, []);
      return {};
    },
    async run(_args, signal) {
      const list = await kube.getJson<List<Pod>>("/api/v1/pods", { limit: LIST_LIMIT }, signal);
      const now = Date.now();
      return {
        total: list.items.length,
        problems: list.items
          .filter((pod) => isProblemPod(pod, now))
          .map((pod) => ({ namespace: pod.metadata.namespace, ...summarizePod(pod) })),
        truncated: Boolean(list.metadata?.continue),
      };
    },
  };
}
