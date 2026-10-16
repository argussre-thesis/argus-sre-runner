import assert from "node:assert/strict";
import { test } from "node:test";
import { optionalString, requiredLabelName, requiredString } from "../src/ops/args.ts";

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
