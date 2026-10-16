import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { KubeClient } from "../src/kubernetes/client.ts";

const statusBody = (message: string) => JSON.stringify({ kind: "Status", status: "Failure", message });

// A fake Kubernetes API server: path → [HTTP status, body].
const routes: Record<string, [number, string | Buffer]> = {
  "/ok": [200, JSON.stringify({ items: [] })],
  "/bad": [400, statusBody("unable to parse requirement: found 'in', expected: '('")],
  "/forbidden": [403, statusBody('pods is forbidden: User "x" cannot list resource "pods"')],
  "/missing": [404, statusBody('pods "nope" not found')],
  "/broken": [500, "<html>oops</html>"],
  "/huge": [200, Buffer.alloc(9 * 1024 * 1024, "a")],
};

let server: http.Server;
let baseUrl: string;
let lastRequest: http.IncomingMessage | undefined;

before(async () => {
  server = http.createServer((req, res) => {
    lastRequest = req;
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/slow") return setTimeout(() => res.end("{}"), 5_000).unref();
    const [status, body] = routes[path] ?? [404, ""];
    res.statusCode = status;
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const kube = () => new KubeClient({ baseUrl });

test("returns parsed JSON and sends the query, skipping undefined values", async () => {
  assert.deepEqual(await kube().getJson("/ok", { labelSelector: "app=api", limit: 5, skip: undefined }), { items: [] });
  assert.equal(lastRequest?.url, "/ok?labelSelector=app%3Dapi&limit=5");
});

test("sends the ServiceAccount token, re-read on every request", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kube-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, "token");
  const client = new KubeClient({ baseUrl, tokenFile });

  writeFileSync(tokenFile, "sa-token-1\n");
  await client.getJson("/ok");
  assert.equal(lastRequest?.headers.authorization, "Bearer sa-token-1");

  writeFileSync(tokenFile, "sa-token-2\n"); // rotated by the kubelet
  await client.getJson("/ok");
  assert.equal(lastRequest?.headers.authorization, "Bearer sa-token-2");
});

test("maps 400, 403 and 404 to protocol codes, keeping the Status message", async () => {
  for (const [path, code] of [["/bad", "BAD_REQUEST"], ["/forbidden", "FORBIDDEN"], ["/missing", "NOT_FOUND"]] as const) {
    const message = JSON.parse(routes[path][1] as string).message;
    await assert.rejects(kube().getJson(path), { code, message }, path);
  }
});

test("other errors are UPSTREAM_ERROR, with a generic message when the body isn't a Status", async () => {
  await assert.rejects(kube().getJson("/broken"), { code: "UPSTREAM_ERROR", message: "Kubernetes API returned HTTP 500" });
});

test("an unreachable API is UPSTREAM_ERROR", async () => {
  await assert.rejects(new KubeClient({ baseUrl: "http://127.0.0.1:1" }).getJson("/ok"), {
    code: "UPSTREAM_ERROR",
    message: /cannot reach 127\.0\.0\.1:1/,
  });
});

test("a body over the 8 MB cap is TOO_LARGE", async () => {
  await assert.rejects(kube().getText("/huge"), { code: "TOO_LARGE" });
});

test("the signal stops the request", async () => {
  const started = Date.now();
  await assert.rejects(kube().getJson("/slow", {}, AbortSignal.timeout(50)), { name: "AbortError" });
  assert.ok(Date.now() - started < 1_000);
});
