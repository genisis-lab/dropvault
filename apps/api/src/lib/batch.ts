export const D1_IN_CLAUSE_BATCH_SIZE = 75;

export function chunkValues<T>(
  values: readonly T[],
  size = D1_IN_CLAUSE_BATCH_SIZE,
): T[][] {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new RangeError("batch size must be a positive integer");
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    chunks.push(values.slice(offset, offset + size));
  return chunks;
}
