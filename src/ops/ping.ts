import type { Op } from "../dispatcher.ts";
import { checkKnownArgs } from "./args.ts";

export const ping: Op = {
  name: "ping",
  parseArgs(raw) {
    checkKnownArgs(raw, []);
    return {};
  },
  async run() {
    return { pong: true, time: new Date().toISOString() };
  },
};
