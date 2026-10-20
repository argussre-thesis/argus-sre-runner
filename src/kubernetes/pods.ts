import { type Condition, type ObjectMeta, ownerOf, summarizeCondition } from "./meta.ts";

interface ContainerState {
  running?: object;
  waiting?: { reason?: string; message?: string };
  terminated?: { reason?: string; exitCode: number; message?: string; startedAt?: string; finishedAt?: string };
}

interface ContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state?: ContainerState;
  lastState?: ContainerState;
}

interface KeyRef {
  name?: string;
  key: string;
}

interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: KeyRef;
    configMapKeyRef?: KeyRef;
    fieldRef?: { fieldPath: string };
    resourceFieldRef?: { resource: string };
  };
}

interface Probe {
  httpGet?: { path?: string; port: number | string };
  tcpSocket?: { port: number | string };
  grpc?: { port: number };
  exec?: { command?: string[] };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
}

export interface ContainerSpec {
  name: string;
  image?: string;
  command?: string[];
  args?: string[];
  ports?: { containerPort: number; protocol?: string }[];
  env?: EnvVar[];
  envFrom?: { secretRef?: { name?: string }; configMapRef?: { name?: string } }[];
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
  livenessProbe?: Probe;
  readinessProbe?: Probe;
  startupProbe?: Probe;
}

export interface Pod {
  metadata: ObjectMeta;
  spec?: { nodeName?: string; serviceAccountName?: string; containers: ContainerSpec[]; initContainers?: ContainerSpec[] };
  status?: {
    phase?: string;
    reason?: string;
    message?: string;
    qosClass?: string;
    conditions?: Condition[];
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

// Like `kubectl describe pod`, without annotations or env var values.
export function describePod(pod: Pod) {
  // Container names are unique across init and regular containers.
  const statuses = new Map(
    [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])].map((s) => [s.name, s]),
  );
  const describe = (c: ContainerSpec) => describeContainer(c, statuses.get(c.name));
  return {
    name: pod.metadata.name,
    status: podStatus(pod),
    reason: pod.status?.reason,
    message: pod.status?.message,
    node: pod.spec?.nodeName,
    owner: ownerOf(pod.metadata),
    serviceAccount: pod.spec?.serviceAccountName,
    qosClass: pod.status?.qosClass,
    createdAt: pod.metadata.creationTimestamp,
    labels: pod.metadata.labels,
    // Pod conditions are healthy when True, except DisruptionTarget (that pod shows Terminating anyway).
    problems: (pod.status?.conditions ?? []).filter((c) => c.status !== "True").map(summarizeCondition),
    initContainers: pod.spec?.initContainers?.map(describe),
    containers: (pod.spec?.containers ?? []).map(describe),
  };
}

// Also the pod template of a ReplicaSet.
export function describeContainerSpec(c: ContainerSpec) {
  return {
    name: c.name,
    image: c.image,
    command: c.command,
    args: c.args,
    ports: c.ports?.map((p) => `${p.containerPort}/${p.protocol ?? "TCP"}`),
    resources: c.resources,
    probes: {
      liveness: describeProbe(c.livenessProbe),
      readiness: describeProbe(c.readinessProbe),
      startup: describeProbe(c.startupProbe),
    },
    env: c.env?.map(describeEnv),
    envFrom: c.envFrom?.map((e) =>
      e.secretRef ? `secret ${e.secretRef.name}` : e.configMapRef ? `configMap ${e.configMapRef.name}` : "unknown",
    ),
  };
}

function describeContainer(c: ContainerSpec, status: ContainerStatus | undefined) {
  const last = status?.lastState?.terminated;
  return {
    ...describeContainerSpec(c),
    ready: status?.ready,
    restarts: status?.restartCount,
    state: describeState(status?.state),
    stateMessage: status?.state?.waiting?.message ?? status?.state?.terminated?.message,
    lastTermination: last && {
      reason: last.reason,
      exitCode: last.exitCode,
      message: last.message,
      startedAt: last.startedAt,
      finishedAt: last.finishedAt,
    },
  };
}

// Never the value itself: only where it comes from.
function describeEnv(e: EnvVar): string {
  const from = e.valueFrom;
  if (from?.secretKeyRef) return `${e.name}: from secret ${from.secretKeyRef.name}/${from.secretKeyRef.key}`;
  if (from?.configMapKeyRef) return `${e.name}: from configMap ${from.configMapKeyRef.name}/${from.configMapKeyRef.key}`;
  if (from?.fieldRef) return `${e.name}: from field ${from.fieldRef.fieldPath}`;
  if (from?.resourceFieldRef) return `${e.name}: from resource ${from.resourceFieldRef.resource}`;
  return `${e.name}: value hidden`;
}

function describeProbe(p: Probe | undefined): string | undefined {
  if (!p) return undefined;
  const target = p.httpGet
    ? `http GET ${p.httpGet.path ?? "/"} on port ${p.httpGet.port}`
    : p.tcpSocket
      ? `tcp port ${p.tcpSocket.port}`
      : p.grpc
        ? `grpc port ${p.grpc.port}`
        : p.exec
          ? `exec ${(p.exec.command ?? []).join(" ")}`
          : "unknown";
  return `${target} (delay ${p.initialDelaySeconds ?? 0}s, every ${p.periodSeconds ?? 10}s, timeout ${p.timeoutSeconds ?? 1}s, fails after ${p.failureThreshold ?? 3})`;
}
