export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

// A missing or malformed policy must retain the advertised default. An
// explicit zero keeps the existing "unlimited" setting semantics.
export function parseMaxUploadBytes(value: string | undefined): number {
  if (value == null || value.trim() === "") return DEFAULT_MAX_UPLOAD_BYTES;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0
    ? bytes
    : DEFAULT_MAX_UPLOAD_BYTES;
}

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
