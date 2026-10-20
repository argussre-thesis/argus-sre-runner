import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { OpError } from "../dispatcher.ts";
import { httpGet } from "../http.ts";

const SERVICE_ACCOUNT_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type Query = Record<string, string | number | boolean | undefined>;

export interface KubeApi {
  getJson<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T>;
  getText(path: string, query?: Query, signal?: AbortSignal, maxBytes?: number): Promise<string>;
}

interface KubeClientOptions {
  baseUrl: string;
  ca?: Buffer;
  tokenFile?: string;
}

export class KubeClient implements KubeApi {
  private readonly baseUrl: URL;
  private readonly ca: Buffer | undefined;
  private readonly tokenFile: string | undefined;

  constructor(options: KubeClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.ca = options.ca;
    this.tokenFile = options.tokenFile;
  }

  static inCluster(): KubeClient {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = process.env.KUBERNETES_SERVICE_PORT;
    if (!host || !port) {
      throw new Error("not running inside Kubernetes; set KUBE_API_URL (e.g. run `kubectl proxy` and use http://127.0.0.1:8001)");
    }
    return new KubeClient({
      baseUrl: `https://${host.includes(":") ? `[${host}]` : host}:${port}`,
      ca: readFileSync(`${SERVICE_ACCOUNT_DIR}/ca.crt`),
      tokenFile: `${SERVICE_ACCOUNT_DIR}/token`,
    });
  }

  async getJson<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return JSON.parse(await this.getText(path, query, signal)) as T;
  }

  async getText(path: string, query: Query = {}, signal?: AbortSignal, maxBytes = MAX_BODY_BYTES): Promise<string> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Accept: "application/json, */*" };
    // Re-read every request: the kubelet rotates this token file before it expires.
    if (this.tokenFile) headers.Authorization = `Bearer ${(await readFile(this.tokenFile, "utf8")).trim()}`;

    const { status, body } = await httpGet(url, { headers, ca: this.ca, signal, maxBytes });
    if (status >= 400) throw toOpError(status, body);
    return body;
  }
}

function toOpError(status: number, body: string): OpError {
  let message = `Kubernetes API returned HTTP ${status}`;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.kind === "Status" && typeof parsed.message === "string") message = parsed.message;
  } catch {
    // not JSON; keep the generic message
  }
  if (status === 400) return new OpError("BAD_REQUEST", message);
  if (status === 403) return new OpError("FORBIDDEN", message);
  if (status === 404) return new OpError("NOT_FOUND", message);
  return new OpError("UPSTREAM_ERROR", message);
}
