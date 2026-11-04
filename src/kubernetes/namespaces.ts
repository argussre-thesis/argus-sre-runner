import type { ObjectMeta } from "./meta.ts";

export interface Namespace {
  metadata: ObjectMeta;
  status?: { phase?: string };
}

export function summarizeNamespace(ns: Namespace) {
  return { name: ns.metadata.name, status: ns.status?.phase ?? "Unknown", createdAt: ns.metadata.creationTimestamp };
}
