import pkg from "../package.json" with { type: "json" };
import { loadConfig, type Config } from "./config.ts";
import { connect } from "./connection.ts";
import { Dispatcher } from "./dispatcher.ts";
import { KubeClient } from "./kubernetes/client.ts";
import { log } from "./log.ts";
import { getPod } from "./ops/kubernetes/get-pod.ts";
import { listDeployments } from "./ops/kubernetes/list-deployments.ts";
import { listEvents } from "./ops/kubernetes/list-events.ts";
import { listPods } from "./ops/kubernetes/list-pods.ts";
import { ping } from "./ops/ping.ts";

let config: Config;
let kube: KubeClient;
try {
  config = loadConfig();
  kube = config.kubeApiUrl ? new KubeClient({ baseUrl: config.kubeApiUrl }) : KubeClient.inCluster();
} catch (err) {
  log("error", "invalid configuration", { error: (err as Error).message });
  process.exit(1);
}

log("info", "runner starting", {
  version: pkg.version,
  clusterName: config.clusterName,
  kubeApi: config.kubeApiUrl ?? "in-cluster",
});

const { stop } = connect(config, new Dispatcher([ping, listPods(kube), getPod(kube), listEvents(kube), listDeployments(kube)]));

// Kubernetes sends SIGTERM before killing a pod, Ctrl+C sends SIGINT. `once`: a second Ctrl+C kills right away.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    log("info", "shutting down", { signal });
    stop();
    // Node exits by itself once nothing is left running; this only catches something that hangs.
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}
