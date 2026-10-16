export const LIST_LIMIT = 500;

export interface ObjectMeta {
  name: string;
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
