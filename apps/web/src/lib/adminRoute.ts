// The admin console is addressed by URL hash (#admin or #admin/<section>) so a
// reload, bookmark or the browser's back button behaves like a real page.
export const ADMIN_HASH_PREFIX = "#admin";

export function isAdminHash(hash: string): boolean {
  return hash === ADMIN_HASH_PREFIX || hash.startsWith(`${ADMIN_HASH_PREFIX}/`);
}

export function adminSectionFromHash(hash: string): string | null {
  return hash.startsWith(`${ADMIN_HASH_PREFIX}/`)
    ? hash.slice(ADMIN_HASH_PREFIX.length + 1) || null
    : null;
}

export function urlWithoutHash(location: Pick<Location, "pathname" | "search">) {
  return `${location.pathname}${location.search}`;
}
