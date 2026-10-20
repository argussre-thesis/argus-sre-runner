import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { summarizeReplicaSet, type ReplicaSet } from "../../kubernetes/replicasets.ts";
import { checkKnownArgs, optionalString, requiredLabelName } from "../args.ts";

export function listReplicaSets(kube: KubeApi): Op<{ namespace: string; labelSelector?: string }> {
  return {
    name: "list_replicasets",
    parseArgs(raw) {
      checkKnownArgs(raw, ["namespace", "labelSelector"]);
      return { namespace: requiredLabelName(raw, "namespace"), labelSelector: optionalString(raw, "labelSelector") };
    },
    async run({ namespace, labelSelector }, signal) {
      const list = await kube.getJson<List<ReplicaSet>>(
        `/apis/apps/v1/namespaces/${namespace}/replicasets`,
        { labelSelector, limit: LIST_LIMIT },
        signal,
      );
      // Each Deployment's history together, newest revision first.
      const replicaSets = list.items
        .map(summarizeReplicaSet)
        .sort((a, b) => (a.owner ?? "").localeCompare(b.owner ?? "") || (b.revision ?? 0) - (a.revision ?? 0));
      return { replicaSets, truncated: Boolean(list.metadata?.continue) };
    },
  };
}
