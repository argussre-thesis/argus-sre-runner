import { OpError, type Op } from "../../dispatcher.ts";
import type { KubeApi } from "../../kubernetes/client.ts";
import { eventTime, summarizeEvent, type KubeEvent } from "../../kubernetes/events.ts";
import { LIST_LIMIT, type List } from "../../kubernetes/meta.ts";
import { checkKnownArgs, isObjectName, optionalInt, optionalString, requiredLabelName } from "../args.ts";

const MAX_EVENTS = 100;
const MAX_PAGES = 10;
const KIND = /^[A-Z][A-Za-z0-9]*$/;
const TYPES = ["Warning", "Normal"];

interface Args {
  namespace: string;
  involvedObject?: { kind?: string; name: string };
  type?: string;
  sinceSeconds?: number;
}

export function listEvents(kube: KubeApi): Op<Args> {
  return {
    name: "list_events",
    parseArgs(raw) {
      checkKnownArgs(raw, ["namespace", "involvedObject", "type", "sinceSeconds"]);
      return {
        namespace: requiredLabelName(raw, "namespace"),
        involvedObject: parseInvolvedObject(raw),
        type: parseType(raw),
        sinceSeconds: optionalInt(raw, "sinceSeconds", { min: 1, max: 3600 }, " (Kubernetes keeps events for 1 hour by default)"),
      };
    },
    async run({ namespace, involvedObject, type, sinceSeconds }, signal) {
      const fieldSelector = [
        involvedObject && `involvedObject.name=${involvedObject.name}`,
        involvedObject?.kind && `involvedObject.kind=${involvedObject.kind}`,
        type && `type=${type}`,
      ]
        .filter(Boolean)
        .join(",");
      const cutoff = sinceSeconds ? Date.now() - sinceSeconds * 1000 : 0;

      // The API lists events by name, not time, so every page is read and only the newest are kept.
      let newest: { event: KubeEvent; time: number }[] = [];
      let matched = 0;
      let next: string | undefined;
      let pages = 0;
      do {
        const list = await kube.getJson<List<KubeEvent>>(
          `/api/v1/namespaces/${namespace}/events`,
          { fieldSelector: fieldSelector || undefined, limit: LIST_LIMIT, continue: next },
          signal,
        );
        const recent = list.items
          .map((event) => ({ event, time: Date.parse(eventTime(event) ?? "") || 0 }))
          .filter(({ time }) => time >= cutoff);
        matched += recent.length;
        newest = [...newest, ...recent].sort((a, b) => b.time - a.time).slice(0, MAX_EVENTS);
        next = list.metadata?.continue;
      } while (next && ++pages < MAX_PAGES);

      return { events: newest.map(({ event }) => summarizeEvent(event)), truncated: matched > MAX_EVENTS || Boolean(next) };
    },
  };
}

// "Kind/name", the format of `owner` in list_pods and get_pod, or a bare name. Both go into a fieldSelector, where a "," would add a filter.
function parseInvolvedObject(raw: Record<string, unknown>): Args["involvedObject"] {
  const value = optionalString(raw, "involvedObject");
  if (value === undefined) return undefined;
  const slash = value.indexOf("/");
  const kind = slash === -1 ? undefined : value.slice(0, slash);
  const name = value.slice(slash + 1);
  if ((kind !== undefined && !KIND.test(kind)) || !isObjectName(name)) {
    throw new OpError(
      "BAD_REQUEST",
      `"involvedObject" must be "Kind/name" or "name", kind case-sensitive (e.g. Pod/api-7d9f-x2k, ReplicaSet/api-7d9f)`,
    );
  }
  return { kind, name };
}

function parseType(raw: Record<string, unknown>): string | undefined {
  const type = optionalString(raw, "type");
  if (type !== undefined && !TYPES.includes(type)) throw new OpError("BAD_REQUEST", `"type" must be "Warning" or "Normal"`);
  return type;
}
