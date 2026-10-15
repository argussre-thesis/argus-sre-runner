import pkg from "../package.json" with { type: "json" };
import { loadConfig, type Config } from "./config.ts";
import { connect } from "./connection.ts";
import { log } from "./log.ts";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  log("error", "invalid configuration", { error: (err as Error).message });
  process.exit(1);
}

log("info", "runner starting", { version: pkg.version, clusterName: config.clusterName });

// The op list arrives with the dispatcher in step 3.
connect(config, []);
