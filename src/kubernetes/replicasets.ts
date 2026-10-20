import { type ObjectMeta, ownerOf } from "./meta.ts";
import { type ContainerSpec, describeContainerSpec } from "./pods.ts";

export interface ReplicaSet {
  metadata: ObjectMeta;
  spec?: {
    replicas?: number;
    template?: { metadata?: { annotations?: Record<string, string> }; spec?: { containers: ContainerSpec[] } };
  };
  status?: { readyReplicas?: number };
}

// One per Deployment revision: comparing two templates shows what a rollout changed.
export function summarizeReplicaSet(rs: ReplicaSet) {
  const revision = rs.metadata.annotations?.["deployment.kubernetes.io/revision"];
  return {
    name: rs.metadata.name,
    owner: ownerOf(rs.metadata),
    revision: revision === undefined ? undefined : Number(revision),
    changeCause: rs.metadata.annotations?.["kubernetes.io/change-cause"],
    // `kubectl rollout restart` makes a new revision that differs only by this.
    restartedAt: rs.spec?.template?.metadata?.annotations?.["kubectl.kubernetes.io/restartedAt"],
    ready: `${rs.status?.readyReplicas ?? 0}/${rs.spec?.replicas ?? 1}`,
    createdAt: rs.metadata.creationTimestamp,
    containers: (rs.spec?.template?.spec?.containers ?? []).map(describeContainerSpec),
  };
}
