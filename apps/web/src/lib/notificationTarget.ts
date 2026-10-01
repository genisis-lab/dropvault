// Where clicking a notification should take someone. Returns null for
// notifications that are informational only.
export type NotificationDestination =
  | { kind: "drive" }
  | { kind: "expiring" }
  | { kind: "admin"; section: string }
  | { kind: "security" };

export function notificationDestination(n: {
  type: string;
  targetType?: string | null;
}): NotificationDestination | null {
  switch (n.type) {
    case "upload_complete":
    case "public_upload":
      return { kind: "drive" };
    case "expiry_warning":
      return { kind: "expiring" };
    case "file_report":
    case "security.file_hash_banned":
      return { kind: "admin", section: "flags" };
    case "signup_approval":
      return { kind: "admin", section: "users" };
    case "limit_request":
      return n.targetType === "limit_request"
        ? { kind: "admin", section: "limit-requests" }
        : null;
    case "security.policy_changed":
      return { kind: "admin", section: "settings" };
    case "security.role_changed":
      return { kind: "admin", section: "admins" };
    case "keep_forever_request":
    case "keep_forever_permission":
    case "branded_portal":
      return { kind: "security" };
    default:
      return null;
  }
}
