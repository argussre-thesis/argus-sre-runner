import http from "node:http";
import https from "node:https";
import { OpError } from "./dispatcher.ts";

export interface HttpGetOptions {
  headers?: Record<string, string>;
  ca?: Buffer;
  signal?: AbortSignal;
  maxBytes: number;
}

export function httpGet(url: URL, options: HttpGetOptions): Promise<{ status: number; body: string }> {
  const { headers, ca, signal, maxBytes } = options;
  return new Promise((resolve, reject) => {
    const onResponse = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new OpError("TOO_LARGE", `response from ${url.host} exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    };

    const req =
      url.protocol === "https:"
        ? https.request(url, { headers, ca, signal }, onResponse)
        : http.request(url, { headers, signal }, onResponse);

    req.on("error", (err) => {
      if (err.name === "AbortError") reject(err);
      else reject(new OpError("UPSTREAM_ERROR", `cannot reach ${url.host}: ${err.message}`));
    });
    req.end();
  });
}
