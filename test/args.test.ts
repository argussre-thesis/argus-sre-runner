import assert from "node:assert/strict";
import { test } from "node:test";
import { optionalBool, optionalInt, optionalString, requiredLabelName, requiredObjectName, requiredString } from "../src/ops/args.ts";

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

test("optionalInt: absent or null is undefined, otherwise an integer in range", () => {
  const range = { min: 1, max: 3600 };
  assert.equal(optionalInt({}, "s", range), undefined);
  assert.equal(optionalInt({ s: null }, "s", range), undefined);
  assert.equal(optionalInt({ s: 1 }, "s", range), 1);
  assert.equal(optionalInt({ s: 3600 }, "s", range), 3600);
  for (const s of [0, 3601, 1.5, "900", true]) {
    assert.throws(() => optionalInt({ s }, "s", range, " (why)"), { code: "BAD_REQUEST", message: '"s" must be an integer between 1 and 3600 (why)' });
  }
});

test("optionalBool: absent or null is undefined, otherwise only true or false", () => {
  assert.equal(optionalBool({}, "previous"), undefined);
  assert.equal(optionalBool({ previous: null }, "previous"), undefined);
  assert.equal(optionalBool({ previous: true }, "previous"), true);
  assert.equal(optionalBool({ previous: false }, "previous"), false);
  for (const previous of ["true", 1, 0]) {
    assert.throws(() => optionalBool({ previous }, "previous"), { code: "BAD_REQUEST", message: '"previous" must be true or false' });
  }
});

test("optionalString: absent or null is undefined, otherwise checked like requiredString", () => {
  assert.equal(optionalString({}, "labelSelector"), undefined);
  assert.equal(optionalString({ labelSelector: null }, "labelSelector"), undefined);
  assert.equal(optionalString({ labelSelector: "app=api" }, "labelSelector"), "app=api");
  assert.throws(() => optionalString({ labelSelector: "" }, "labelSelector"), { code: "BAD_REQUEST" });
});
