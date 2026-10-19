import type { ObjectMeta } from "./meta.ts";

export interface KubeEvent {
  metadata: ObjectMeta;
  involvedObject: { kind?: string; name?: string };
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string | null;
  lastTimestamp?: string | null;
  eventTime?: string | null;
  series?: { count?: number; lastObservedTime?: string } | null;
  source?: { component?: string };
  reportingComponent?: string;
}

// Old-style events set lastTimestamp; newer ones series or eventTime.
export function eventTime(e: KubeEvent): string | undefined {
  return e.series?.lastObservedTime || e.lastTimestamp || e.eventTime || e.metadata.creationTimestamp || undefined;
}

export function summarizeEvent(e: KubeEvent) {
  return {
    time: eventTime(e),
    firstTime: e.firstTimestamp || undefined,
    type: e.type,
    reason: e.reason,
    object: `${e.involvedObject.kind}/${e.involvedObject.name}`,
    message: e.message,
    count: e.series?.count ?? e.count ?? 1,
    source: e.source?.component || e.reportingComponent || undefined,
  };
}
