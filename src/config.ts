// In Kubernetes the Deployment sets these; RUNNER_TOKEN comes from a Secret, so it never sits in the pod spec.

export interface Config {
  gatewayUrl: string;
  token: string;
  clusterName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };

  const gatewayUrl = required("GATEWAY_URL");
  const protocol = URL.parse(gatewayUrl)?.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`GATEWAY_URL must start with http:// or https://, got "${gatewayUrl}"`);
  }

  return {
    gatewayUrl,
    token: required("RUNNER_TOKEN"),
    clusterName: required("CLUSTER_NAME"),
  };
}
