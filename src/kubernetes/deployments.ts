import { type LabelSelector, type ObjectMeta, selectorString } from "./meta.ts";

export interface Deployment {
  metadata: ObjectMeta;
  spec?: {
    replicas?: number;
    paused?: boolean;
    selector?: LabelSelector;
    template?: { spec?: { containers: { image: string }[] } };
  };
  status?: {
    observedGeneration?: number;
    replicas?: number;
    updatedReplicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    conditions?: { type: string; reason?: string }[];
  };
}

export function summarizeDeployment(d: Deployment) {
  return {
    name: d.metadata.name,
    ready: `${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? 1}`,
    upToDate: d.status?.updatedReplicas ?? 0,
    available: d.status?.availableReplicas ?? 0,
    rollout: rolloutStatus(d),
    selector: selectorString(d.spec?.selector),
    images: (d.spec?.template?.spec?.containers ?? []).map((c) => c.image),
    createdAt: d.metadata.creationTimestamp,
  };
}

// The checks of `kubectl rollout status`, plus telling a finished rollout that broke later from one in progress.
export function rolloutStatus(d: Deployment): string {
  if (d.spec?.paused) return "paused";
  if ((d.status?.observedGeneration ?? 0) < (d.metadata.generation ?? 0)) {
    return "pending: controller has not processed the latest spec yet";
  }
  const progressing = d.status?.conditions?.find((c) => c.type === "Progressing");
  if (progressing?.reason === "ProgressDeadlineExceeded") return "failed: progress deadline exceeded";

  const desired = d.spec?.replicas ?? 1;
  const updated = d.status?.updatedReplicas ?? 0;
  const total = d.status?.replicas ?? 0;
  const available = d.status?.availableReplicas ?? 0;
  if (updated < desired) return `in progress: ${updated} of ${desired} new replicas updated`;
  if (total > updated) return `in progress: ${total - updated} old replicas pending termination`;
  if (available < updated) {
    return progressing?.reason === "NewReplicaSetAvailable"
      ? `complete, but only ${available} of ${updated} replicas available`
      : `in progress: ${available} of ${updated} updated replicas available`;
  }
  return "complete";
}
