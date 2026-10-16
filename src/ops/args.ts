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

export function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  if (args[name] === undefined) return undefined;
  return requiredString(args, name);
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
