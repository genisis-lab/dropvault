export function applyRequestedSettingChanges<Key extends string>(
  before: Record<Key, string>,
  requested: Partial<Record<Key, unknown>>,
  keys: readonly Key[],
  normalize: (key: Key, value: unknown) => string,
): Record<Key, string> {
  const after = { ...before };
  for (const key of keys) {
    if (!(key in requested)) continue;

    const rawValue = String(requested[key] ?? "");
    if (rawValue === before[key]) continue;

    after[key] = normalize(key, requested[key]);
  }
  return after;
}
