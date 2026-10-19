import assert from "node:assert/strict";
import { test } from "node:test";
import { optionalString, requiredLabelName, requiredObjectName, requiredString } from "../src/ops/args.ts";

test("requiredLabelName accepts valid namespace names", () => {
  for (const namespace of ["demo", "kube-system", "a", "team-1", "x".repeat(63)]) {
    assert.equal(requiredLabelName({ namespace }, "namespace"), namespace);
  }
});

test("requiredLabelName rejects path tricks and invalid names", () => {
  for (const namespace of ["..", "%2e%2e", "kube-system/../..", "a/b", "ns?x=1", "Payments", "-demo", "demo-", "x".repeat(64)]) {
    assert.throws(() => requiredLabelName({ namespace }, "namespace"), { code: "BAD_REQUEST", message: /valid Kubernetes name/ }, namespace);
  }
});

test("requiredObjectName allows dots between parts, but still no path tricks", () => {
  for (const name of ["web-1", "etcd-ip-10-0-1-2.ec2.internal", "a", "x".repeat(253)]) {
    assert.equal(requiredObjectName({ name }, "name"), name);
  }
  for (const name of ["..", ".", "a..b", ".a", "a.", "a.-b", "../secrets", "a/b", "Web", "-a", "x".repeat(254)]) {
    assert.throws(() => requiredObjectName({ name }, "name"), { code: "BAD_REQUEST", message: /valid Kubernetes object name/ }, name);
  }
});

test("requiredString: missing, empty or not a string is BAD_REQUEST", () => {
  assert.equal(requiredString({ name: "api" }, "name"), "api");
  for (const name of [undefined, "", 5, null]) {
    assert.throws(() => requiredString({ name }, "name"), { code: "BAD_REQUEST", message: '"name" is required and must be a non-empty string' });
  }
});

test("optionalString: absent is undefined, otherwise checked like requiredString", () => {
  assert.equal(optionalString({}, "labelSelector"), undefined);
  assert.equal(optionalString({ labelSelector: "app=api" }, "labelSelector"), "app=api");
  assert.throws(() => optionalString({ labelSelector: "" }, "labelSelector"), { code: "BAD_REQUEST" });
});
