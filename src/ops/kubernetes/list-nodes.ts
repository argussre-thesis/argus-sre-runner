import type { Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { summarizeNode, type KubeNode } from "../../kubernetes/nodes.ts";
import { checkKnownArgs } from "../args.ts";

export function listNodes(kube: KubeApi): Op {
  return {
    name: "list_nodes",
    parseArgs(raw) {
      checkKnownArgs(raw, []);
      return {};
    },
    async run(_args, signal) {
      const list = await kube.getJson<List<KubeNode>>("/api/v1/nodes", { limit: LIST_LIMIT }, signal);
      return { nodes: list.items.map(summarizeNode), truncated: Boolean(list.metadata?.continue) };
    },
  };
}
