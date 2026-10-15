type Level = "info" | "warn" | "error";

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = { time: new Date().toISOString(), level, msg, ...fields };
  process.stdout.write(JSON.stringify(line) + "\n");
}
