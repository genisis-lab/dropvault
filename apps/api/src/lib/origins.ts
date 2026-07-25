type AppOriginEnv = {
  PUBLIC_APP_URL: string;
  TRUSTED_ORIGINS?: string;
};

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Exact browser origins allowed to make credentialed API/auth requests.
 * PUBLIC_APP_URL is canonical and always comes first; TRUSTED_ORIGINS adds
 * comma-separated aliases such as the provider's default Pages hostname.
 */
export function trustedAppOrigins(env: AppOriginEnv): string[] {
  const configured = [
    env.PUBLIC_APP_URL,
    ...(env.TRUSTED_ORIGINS ?? "").split(","),
  ];
  const origins = configured
    .map(normalizeHttpOrigin)
    .filter((origin): origin is string => !!origin);
  return Array.from(new Set(origins));
}

export function canonicalAppOrigin(env: AppOriginEnv): string {
  const origin = normalizeHttpOrigin(env.PUBLIC_APP_URL);
  if (!origin) throw new Error("PUBLIC_APP_URL must be a valid HTTP(S) origin");
  return origin;
}
