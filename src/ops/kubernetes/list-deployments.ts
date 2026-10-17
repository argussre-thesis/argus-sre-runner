import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { summarizeDeployment, type Deployment } from "../../kubernetes/deployments.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { checkKnownArgs, optionalString, requiredLabelName } from "../args.ts";

export function listDeployments(kube: KubeApi): Op<{ namespace: string; labelSelector?: string }> {
  return {
    name: "list_deployments",
    parseArgs(raw) {
      checkKnownArgs(raw, ["namespace", "labelSelector"]);
      return { namespace: requiredLabelName(raw, "namespace"), labelSelector: optionalString(raw, "labelSelector") };
    },
    async run({ namespace, labelSelector }, signal) {
      const list = await kube.getJson<List<Deployment>>(
        `/apis/apps/v1/namespaces/${namespace}/deployments`,
        { labelSelector, limit: LIST_LIMIT },
        signal,
      );
      return { deployments: list.items.map(summarizeDeployment), truncated: Boolean(list.metadata?.continue) };
    },
  };
}
