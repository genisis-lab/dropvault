export type MultipartPart = { partNumber: number; etag: string };

export type MultipartFailureKind = "stale" | "invalid" | "transient";

// resumeMultipartUpload() is intentionally lazy: Cloudflare does not verify
// that the upload still exists until uploadPart/complete is called. Normalize
// the provider errors so routes can retire dead D1 sessions instead of sending
// every retry back to the same invalid uploadId.
export function multipartFailureKind(error: unknown): MultipartFailureKind {
  const message =
    error instanceof Error ? error.message : String(error ?? "");

  if (
    /\b10024\b|NoSuchUpload|no such upload|multipart upload (?:does not exist|was aborted)|upload(?:Id)?[^\n]*(?:not found|expired|aborted)/i.test(
      message,
    )
  )
    return "stale";

  if (
    /\b10025\b|\b10048\b|InvalidPart|invalid part|non-trailing parts|uniform part/i.test(
      message,
    )
  )
    return "invalid";

  return "transient";
}

export function storedMultipartParts(value: string | null): MultipartPart[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const byPart = new Map<number, MultipartPart>();
  for (const candidate of parsed) {
    if (!candidate || typeof candidate !== "object") continue;
    const partNumber = Number(
      (candidate as { partNumber?: unknown }).partNumber,
    );
    const etag = String((candidate as { etag?: unknown }).etag ?? "");
    if (
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > 10_000 ||
      !etag
    )
      continue;
    byPart.set(partNumber, { partNumber, etag });
  }
  return [...byPart.values()].sort(
    (left, right) => left.partNumber - right.partNumber,
  );
}
