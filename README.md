# Argus SRE: Runner

This is the runner of **Argus SRE**, a platform that investigates Kubernetes incidents automatically. When an alert fires, an AI agent gathers telemetry from the cluster and writes a root cause analysis that engineers can then discuss in a chat.

The runner is a small, **read-only** agent installed inside a customer's cluster. It opens an outbound WebSocket to the Argus gateway and answers the agent's questions about the cluster (pods, logs, events and so on). Because the runner dials out, the cluster needs no inbound ports, load balancer or firewall changes.

## Where it fits

```
Agent service ──MCP──▶ Gateway ◀──WebSocket (opened by the runner)── Runner ──▶ Kubernetes API
                                                                    (in your cluster)
```

| Repo | Role |
| --- | --- |
| [argus-sre-frontend](https://github.com/argussre-thesis/argus-sre-frontend) | Web app |
| [argus-sre-backend](https://github.com/argussre-thesis/argus-sre-backend) | API, webhooks, database |
| [argus-sre-agent-service](https://github.com/argussre-thesis/argus-sre-agent-service) | AI investigations and chat |
| [argus-sre-gateway](https://github.com/argussre-thesis/argus-sre-gateway) | Accepts runner connections |
| **argus-sre-runner** | Runs inside the customer's cluster |

## What it can do

| Operation | Kubernetes access |
| --- | --- |
| List namespaces, nodes, events, replica sets | `list` |
| List pods, list problem pods, get a pod | `get`, `list` on pods |
| List deployments | `get`, `list` on deployments |
| Read a container's logs | `get` on `pods/log` |

That's the whole ClusterRole in the Helm chart. The runner can't create, change or delete anything, and it can't read Secrets or ConfigMaps.

## Design notes

- **Read-only by design:** see the RBAC table above.
- **Small:** the only dependency is `socket.io-client`. It talks to the Kubernetes API directly with its service account token, without a Kubernetes client library. Requests are limited to 200m CPU and 128Mi memory.
- **Safe errors:** an unexpected error goes back to the gateway as `INTERNAL`, without its message, so nothing from inside the cluster leaks by accident.
- **Reconnects on its own:** if the gateway refuses the token or protocol version, the runner waits 30 seconds before retrying instead of hammering it.
- **Versioned protocol:** `src/protocol.ts` is the contract with the gateway. The gateway keeps the same file, and its version number must match on both sides.

## Install

You get the token when you add a cluster in the Argus web app, which shows these same commands:

```bash
kubectl create namespace argus-runner
kubectl -n argus-runner create secret generic argus-runner-token --from-literal=token=<TOKEN>
helm install argus-runner oci://registry-1.docker.io/tsandas/argus-runner --version 0.1.0 \
  -n argus-runner --set gatewayUrl=<GATEWAY_URL> --set clusterName=<CLUSTER_NAME> \
  --set existingSecret=argus-runner-token
```

The runner reads its token only at startup. After you rotate it, update the Secret and run `kubectl -n argus-runner rollout restart deploy/argus-runner`.

The chart is in [`charts/argus-runner`](charts/argus-runner), and the image is `tsandas/argus-sre-runner` on Docker Hub.

## Tests

```bash
npm install
npm test
```
