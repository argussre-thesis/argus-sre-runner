import { OpError } from "../dispatcher.ts";

export function checkKnownArgs(args: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    const allowedText = allowed.length ? allowed.join(", ") : "none";
    throw new OpError("BAD_REQUEST", `unknown argument(s): ${unknown.join(", ")} (allowed: ${allowedText})`);
  }
}
