import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { summarizeNamespace, type Namespace } from "../../kubernetes/namespaces.ts";
import { checkKnownArgs } from "../args.ts";

export function listNamespaces(kube: KubeApi): Op {
  return {
    name: "list_namespaces",
    parseArgs(raw) {
      checkKnownArgs(raw, []);
      return {};
    },
    async run(_args, signal) {
      const list = await kube.getJson<List<Namespace>>("/api/v1/namespaces", { limit: LIST_LIMIT }, signal);
      return { namespaces: list.items.map(summarizeNamespace), truncated: Boolean(list.metadata?.continue) };
    },
  };
}
