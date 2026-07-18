export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Human countdown to an epoch-second expiry.
export function timeLeft(expiresAt: number): {
  label: string;
  urgent: boolean;
} {
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return { label: "expired", urgent: true };
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d >= 1) return { label: `${d}d ${h}h left`, urgent: d < 1 };
  if (h >= 1) return { label: `${h}h ${m}m left`, urgent: h < 6 };
  return { label: `${m}m left`, urgent: true };
}
