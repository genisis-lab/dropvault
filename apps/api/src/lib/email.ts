import type { Bindings } from "../types";

export type ResendEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function plain(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailAddress(value: unknown): string | null {
  const email = plain(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

function httpsUrl(value: unknown): string | null {
  try {
    const parsed = new URL(plain(value));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function layout(input: {
  eyebrow: string;
  title: string;
  body: string;
  action?: { label: string; url: string };
  detail?: string;
}): string {
  const action = input.action
    ? `<a href="${escapeHtml(input.action.url)}" style="display:inline-block;margin-top:24px;border-radius:12px;background:#4f46e5;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">${escapeHtml(input.action.label)}</a>`
    : "";
  const detail = input.detail
    ? `<p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.6">${escapeHtml(input.detail)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b"><div style="padding:40px 16px"><div style="max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:20px;background:#fff;padding:36px"><p style="margin:0 0 12px;color:#4f46e5;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p><h1 style="margin:0;font-size:28px;line-height:1.2">${escapeHtml(input.title)}</h1><p style="margin:16px 0 0;color:#475569;font-size:16px;line-height:1.65">${escapeHtml(input.body)}</p>${action}${detail}</div><p style="margin:16px auto 0;max-width:560px;text-align:center;color:#94a3b8;font-size:12px">Dropvault · drive.builtwai.com</p></div></body></html>`;
}

export function resendConfigured(env: Bindings): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM_EMAIL?.trim());
}

export function emailDeliveryConfigured(env: Bindings): boolean {
  return resendConfigured(env) || Boolean(env.NOTIFICATION_WEBHOOK_URL?.trim());
}

export function resendEmailForEvent(
  env: Pick<Bindings, "PUBLIC_APP_URL">,
  type: string,
  payload: Record<string, unknown>,
): ResendEmail | null {
  const to = emailAddress(payload.email);
  if (!to) return null;
  const name = plain(payload.name);

  if (type === "verify_email") {
    const url = httpsUrl(payload.url);
    if (!url) return null;
    const body = `${name ? `${name}, confirm` : "Confirm"} this email address to finish setting up your Dropvault account. After verification, an administrator will review your access request.`;
    return {
      to,
      subject: "Verify your email for Dropvault",
      text: `${body}\n\nVerify your email: ${url}\n\nIf you didn't create this account, you can ignore this email.`,
      html: layout({
        eyebrow: "Email verification",
        title: "Verify your email",
        body,
        action: { label: "Verify email", url },
        detail: "If you didn't create this account, you can safely ignore this email.",
      }),
    };
  }

  if (type === "password_reset") {
    const url = httpsUrl(payload.url);
    if (!url) return null;
    const body = "Use this secure link to choose a new Dropvault password.";
    return {
      to,
      subject: "Reset your Dropvault password",
      text: `${body}\n\nReset your password: ${url}\n\nIf you didn't request this, you can ignore this email.`,
      html: layout({
        eyebrow: "Account security",
        title: "Reset your password",
        body,
        action: { label: "Reset password", url },
        detail: "If you didn't request this, you can safely ignore this email.",
      }),
    };
  }

  if (type === "guest_access_code") {
    const code = plain(payload.code);
    const url = httpsUrl(payload.shareUrl);
    if (!/^\d{6}$/.test(code) || !url) return null;
    const minutes = Math.max(1, Number(payload.expiresInMinutes) || 10);
    const body = `Your Dropvault guest access code is ${code}. It expires in ${minutes} minutes.`;
    return {
      to,
      subject: `${code} is your Dropvault access code`,
      text: `${body}\n\nReturn to the shared item: ${url}`,
      html: layout({
        eyebrow: "Guest access",
        title: code,
        body,
        action: { label: "Return to shared item", url },
        detail: `This code expires in ${minutes} minutes.`,
      }),
    };
  }

  if (type === "account_approved") {
    const url = httpsUrl(payload.url) ?? httpsUrl(env.PUBLIC_APP_URL);
    if (!url) return null;
    const body = `${name ? `${name}, your` : "Your"} Dropvault profile has been approved. You can now sign in and start using your drive.`;
    return {
      to,
      subject: "Your Dropvault account is approved",
      text: `${body}\n\nOpen Dropvault: ${url}`,
      html: layout({
        eyebrow: "Access approved",
        title: "You're approved",
        body,
        action: { label: "Open Dropvault", url },
      }),
    };
  }

  return null;
}

export async function sendWithResend(
  env: Bindings,
  eventId: string,
  email: ResendEmail,
): Promise<void> {
  if (!resendConfigured(env)) throw new Error("Resend is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": eventId,
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}`);
}
