import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { describePod, type Pod } from "../../kubernetes/pods.ts";
import { checkKnownArgs, requiredLabelName, requiredObjectName } from "../args.ts";

export function getPod(kube: KubeApi): Op<{ namespace: string; name: string }> {
  return {
    name: "get_pod",
    parseArgs(raw) {
      checkKnownArgs(raw, ["namespace", "name"]);
      return { namespace: requiredLabelName(raw, "namespace"), name: requiredObjectName(raw, "name") };
    },
    async run({ namespace, name }, signal) {
      return describePod(await kube.getJson<Pod>(`/api/v1/namespaces/${namespace}/pods/${name}`, {}, signal));
    },
  };
}
