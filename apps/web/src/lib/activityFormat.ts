// Plain-language labels for activity and audit log actions. Unknown actions
// fall back to a readable version of their code so new events still display.
const ACTION_LABELS: Record<string, string> = {
  "file.upload": "Uploaded a file",
  "file.upload.cancel": "Cancelled an upload",
  "file.presign.duplicate": "Started a duplicate upload",
  "file.download": "Downloaded a file",
  "file.share": "Created a share link",
  "file.revoke": "Revoked a share link",
  "file.trash": "Moved a file to Trash",
  "file.restore": "Restored a file",
  "file.update": "Edited file details",
  "file.delete": "Deleted a file",
  "file.expire": "Expired a file",
  "file.content_view": "Viewed file contents",
  "file.version.upload": "Uploaded a new version",
  "file.version.restore": "Restored an older version",
  "file.recovery.account": "Set up signed-in recovery",
  "file.recovery.update": "Updated file recovery",
  "file_hash.ban": "Banned a file hash",
  "flag.resolve": "Resolved a report",
  "flag.delete": "Deleted a report",
  "flag.content_view": "Viewed reported content",
  "user.approve": "Approved an account",
  "user.suspend": "Suspended an account",
  "user.unsuspend": "Unsuspended an account",
  "user.verification_resend": "Resent a verification email",
  "admin.add": "Granted an admin role",
  "admin.remove": "Removed an admin role",
  "ip_ban.add": "Banned an IP address",
  "ip_ban.remove": "Lifted an IP ban",
  "notifications.test": "Sent a test notification",
};

export function activityLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action.replace(/[._]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Unknown action";
}

// "Mozilla/5.0 (X11; Linux x86_64) … Chrome/141 Safari/537.36" → "Chrome on Linux".
export function browserSummary(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown browser";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl\//i.test(ua)
              ? "curl"
              : "Unknown browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux|X11/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}
