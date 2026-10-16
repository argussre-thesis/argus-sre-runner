// In Kubernetes the Deployment sets these; RUNNER_TOKEN comes from a Secret, so it never sits in the pod spec.

export interface Config {
  gatewayUrl: string;
  token: string;
  clusterName: string;
  kubeApiUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };

  const httpUrl = (name: string, value: string): string => {
    const protocol = URL.parse(value)?.protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new Error(`${name} must start with http:// or https://, got "${value}"`);
    }
    return value;
  };

  return {
    gatewayUrl: httpUrl("GATEWAY_URL", required("GATEWAY_URL")),
    token: required("RUNNER_TOKEN"),
    clusterName: required("CLUSTER_NAME"),
    // Set it only when running the runner outside a K8s cluster.
    kubeApiUrl: env.KUBE_API_URL ? httpUrl("KUBE_API_URL", env.KUBE_API_URL) : undefined,
  };
}
