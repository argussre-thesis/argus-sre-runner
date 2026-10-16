import { type ObjectMeta, ownerOf } from "./meta.ts";

interface ContainerState {
  running?: object;
  waiting?: { reason?: string };
  terminated?: { reason?: string; exitCode: number; finishedAt?: string };
}

interface ContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state?: ContainerState;
  lastState?: ContainerState;
}

export interface Pod {
  metadata: ObjectMeta;
  spec?: { nodeName?: string; containers: unknown[] };
  status?: {
    phase?: string;
    reason?: string;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}

export function summarizePod(pod: Pod) {
  const containers = pod.status?.containerStatuses ?? [];
  return {
    name: pod.metadata.name,
    status: podStatus(pod),
    ready: `${containers.filter((c) => c.ready).length}/${pod.spec?.containers.length ?? containers.length}`,
    restarts: containers.reduce((sum, c) => sum + c.restartCount, 0),
    node: pod.spec?.nodeName,
    owner: ownerOf(pod.metadata),
    createdAt: pod.metadata.creationTimestamp,
    containers: containers.map(summarizeContainer),
  };
}

function summarizeContainer(c: ContainerStatus) {
  const last = c.lastState?.terminated;
  return {
    name: c.name,
    image: c.image,
    ready: c.ready,
    restarts: c.restartCount,
    state: describeState(c.state),
    lastTermination: last && { reason: last.reason, exitCode: last.exitCode, finishedAt: last.finishedAt },
  };
}

function describeState(state: ContainerState | undefined): string {
  if (state?.waiting) return `waiting: ${state.waiting.reason ?? "unknown"}`;
  if (state?.terminated) return `terminated: ${state.terminated.reason ?? "unknown"} (exit ${state.terminated.exitCode})`;
  if (state?.running) return "running";
  return "unknown";
}

const reasonOf = (c: ContainerStatus) => c.state?.waiting?.reason ?? c.state?.terminated?.reason;

// Close to the STATUS column of `kubectl get pods`.
export function podStatus(pod: Pod): string {
  if (pod.metadata.deletionTimestamp) return "Terminating";

  for (const c of pod.status?.initContainerStatuses ?? []) {
    if (c.state?.terminated?.exitCode === 0) continue;
    const reason = reasonOf(c);
    if (reason && reason !== "PodInitializing") return `Init:${reason}`;
  }

  const reason = pod.status?.containerStatuses?.map(reasonOf).find(Boolean);
  return reason ?? pod.status?.reason ?? pod.status?.phase ?? "Unknown";
}
