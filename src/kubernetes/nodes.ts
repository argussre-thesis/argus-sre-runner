import { type Condition, type ObjectMeta, summarizeCondition } from "./meta.ts";

export interface KubeNode {
  metadata: ObjectMeta;
  status?: { allocatable?: Record<string, string>; conditions?: Condition[] };
}

export function summarizeNode(node: KubeNode) {
  const conditions = node.status?.conditions ?? [];
  return {
    name: node.metadata.name,
    ready: conditions.find((c) => c.type === "Ready")?.status ?? "Unknown",
    // Only Ready is healthy when True; the rest (MemoryPressure, DiskPressure, KernelDeadlock...) when False.
    problems: conditions.filter((c) => c.status !== (c.type === "Ready" ? "True" : "False")).map(summarizeCondition),
    allocatable: node.status?.allocatable,
    createdAt: node.metadata.creationTimestamp,
  };
}
