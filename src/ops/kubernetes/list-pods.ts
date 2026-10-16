import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { summarizePod, type Pod } from "../../kubernetes/pods.ts";
import { checkKnownArgs, optionalString, requiredLabelName } from "../args.ts";

export function listPods(kube: KubeApi): Op<{ namespace: string; labelSelector?: string }> {
  return {
    name: "list_pods",
    parseArgs(raw) {
      checkKnownArgs(raw, ["namespace", "labelSelector"]);
      return { namespace: requiredLabelName(raw, "namespace"), labelSelector: optionalString(raw, "labelSelector") };
    },
    async run({ namespace, labelSelector }, signal) {
      const list = await kube.getJson<List<Pod>>(
        `/api/v1/namespaces/${namespace}/pods`,
        { labelSelector, limit: LIST_LIMIT },
        signal,
      );
      return { pods: list.items.map(summarizePod), truncated: Boolean(list.metadata?.continue) };
    },
  };
}
