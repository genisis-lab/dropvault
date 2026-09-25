const PRIVATE_API_PREFIXES = [
  "/api/account",
  "/api/admin",
  "/api/operations",
  "/api/auth",
  "/api/sessions",
] as const;

/**
 * These APIs vary by the caller's session or bearer credentials and must never
 * be stored by browsers, shared proxies, or the edge cache.
 */
export function isPrivateCredentialApiPath(pathname: string): boolean {
  return PRIVATE_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Preserve existing Vary dimensions (notably Origin from CORS) while adding
 * the credentials that select private API representations.
 */
export function credentialVaryHeader(current: string | null): string {
  const values = (current ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.includes("*")) return "*";

  const seen = new Set(values.map((value) => value.toLowerCase()));
  for (const value of ["Cookie", "Authorization"]) {
    if (!seen.has(value.toLowerCase())) values.push(value);
  }
  return values.join(", ");
}
