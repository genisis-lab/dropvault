// Account status lives outside lib/api.ts because /api/account/me is one of the
// few endpoints that works even when the user is suspended (suspended users are
// blocked from every requireAuth route).
const API = import.meta.env.VITE_API_URL ?? "";

export type AccountStatus = {
  user: { id: string; name: string; email: string };
  suspended: boolean;
  suspensionReason: string | null;
  // null means unlimited storage (admins and the owner).
  quotaBytes: number | null;
  isAdmin: boolean;
  adminRole?: string | null;
  keepFilesForever?: boolean;
  canKeepFilesForever?: boolean;
};

export async function accountStatus(): Promise<AccountStatus> {
  const res = await fetch(`${API}/api/account/me`, { credentials: "include" });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? res.statusText,
    );
  return res.json() as Promise<AccountStatus>;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).error ?? response.statusText,
    );
  return response.json() as Promise<T>;
}

export type NotificationPreferences = {
  emailEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  expiryWarnings: boolean;
  uploadEvents: boolean;
  securityEvents: boolean;
};

export type PortalBrand = {
  slug: string;
  name: string;
  logoUrl: string | null;
  accentColor: string;
  welcomeMessage: string | null;
};

export async function notificationPreferences(): Promise<NotificationPreferences> {
  return (
    await json<{ preferences: NotificationPreferences }>(
      await fetch(`${API}/api/account/notifications/preferences`, {
        credentials: "include",
      }),
    )
  ).preferences;
}

export async function saveNotificationPreferences(
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  return (
    await json<{ preferences: NotificationPreferences }>(
      await fetch(`${API}/api/account/notifications/preferences`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    )
  ).preferences;
}

export async function portalBrand(): Promise<PortalBrand | null> {
  return (
    await json<{ brand: PortalBrand | null }>(
      await fetch(`${API}/api/account/portal`, { credentials: "include" }),
    )
  ).brand;
}

export async function savePortalBrand(
  input: PortalBrand,
): Promise<PortalBrand> {
  return (
    await json<{ brand: PortalBrand }>(
      await fetch(`${API}/api/account/portal`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    )
  ).brand;
}

export async function downloadAccountExport(): Promise<void> {
  const response = await fetch(`${API}/api/account/export`, {
    credentials: "include",
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).error ?? response.statusText,
    );
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dropvault-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function deleteAccount(confirmation: string): Promise<void> {
  await json(
    await fetch(`${API}/api/account/me`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation }),
    }),
  );
}
