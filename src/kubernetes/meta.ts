export const LIST_LIMIT = 500;

export interface ObjectMeta {
  name: string;
  generation?: number;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  ownerReferences?: { kind: string; name: string }[];
}

// `continue` is set when the API has more items than `limit` returned.
export interface List<T> {
  metadata?: { continue?: string };
  items: T[];
}

export function ownerOf(meta: ObjectMeta): string | undefined {
  const owner = meta.ownerReferences?.[0];
  return owner ? `${owner.kind}/${owner.name}` : undefined;
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
}

// The labelSelector query syntax, so the agent can pass it straight to list_pods.
export function selectorString(s: LabelSelector | undefined): string {
  const labels = Object.entries(s?.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`);
  const expressions = (s?.matchExpressions ?? []).map(({ key, operator, values = [] }) => {
    if (operator === "Exists") return key;
    if (operator === "DoesNotExist") return `!${key}`;
    return `${key} ${operator.toLowerCase()} (${values.join(",")})`;
  });
  return [...labels, ...expressions].join(",");
}
