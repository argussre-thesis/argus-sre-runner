import { OpError } from "../dispatcher.ts";

export function checkKnownArgs(args: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const allowedText = allowed.length ? allowed.join(", ") : "none";
    throw new OpError("BAD_REQUEST", `unknown argument(s): ${unknown.join(", ")} (allowed: ${allowedText})`);
  }
}

export function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new OpError("BAD_REQUEST", `"${name}" is required and must be a non-empty string`);
  }
  return value;
}

// `null` counts as not given: models often send it for an arg they skip.
export function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  if (args[name] == null) return undefined;
  return requiredString(args, name);
}

export function optionalInt(
  args: Record<string, unknown>,
  name: string,
  range: { min: number; max: number },
  why = "",
): number | undefined {
  const value = args[name];
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < range.min || value > range.max) {
    throw new OpError("BAD_REQUEST", `"${name}" must be an integer between ${range.min} and ${range.max}${why}`);
  }
  return value;
}

export function optionalBool(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value == null) return undefined;
  if (typeof value !== "boolean") throw new OpError("BAD_REQUEST", `"${name}" must be true or false`);
  return value;
}

// Names go into URL paths, so this strict check also blocks tricks like "..".
const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function requiredLabelName(args: Record<string, unknown>, name: string): string {
  const value = requiredString(args, name);
  if (value.length > 63 || !DNS1123_LABEL.test(value)) {
    throw new OpError("BAD_REQUEST", `"${name}" must be a valid Kubernetes name (lowercase letters, digits, "-"; max 63 chars)`);
  }
  return value;
}

// Pod and most other object names may contain dots, but each dot-separated part starts with a letter or digit, so ".." still fails.
const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export function isObjectName(value: string): boolean {
  return value.length <= 253 && DNS1123_SUBDOMAIN.test(value);
}

export function requiredObjectName(args: Record<string, unknown>, name: string): string {
  const value = requiredString(args, name);
  if (!isObjectName(value)) {
    throw new OpError("BAD_REQUEST", `"${name}" must be a valid Kubernetes object name (lowercase letters, digits, "-", "."; max 253 chars)`);
  }
  return value;
}
