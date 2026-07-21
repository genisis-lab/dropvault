import { describe, expect, it } from "vitest";
import { isSafeWebhookUrl } from "./url";

describe("webhook URL safety", () => {
  it("allows public HTTPS webhook targets on the standard port", () => {
    expect(isSafeWebhookUrl("https://hooks.example.com/dropvault")).toBe(true);
    expect(isSafeWebhookUrl("https://203.0.113.10:443/events")).toBe(true);
  });

  it("blocks plaintext HTTP, credentials, non-web protocols, and unusual ports", () => {
    expect(isSafeWebhookUrl("http://example.com:80/events")).toBe(false);
    expect(isSafeWebhookUrl("https://user:pass@example.com/hook")).toBe(false);
    expect(isSafeWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeWebhookUrl("https://example.com:8443/hook")).toBe(false);
  });

  it("blocks loopback, metadata, private, link-local, and reserved targets", () => {
    for (const target of [
      "http://localhost/hook",
      "http://metadata.google.internal/hook",
      "http://127.0.0.1/hook",
      "http://10.0.0.1/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://172.16.4.2/hook",
      "http://192.168.1.1/hook",
      "http://100.64.0.1/hook",
      "http://[::1]/hook",
      "http://[fd00::1]/hook",
    ]) {
      expect(isSafeWebhookUrl(target), target).toBe(false);
    }
  });

  it("fails closed for malformed input", () => {
    expect(isSafeWebhookUrl(undefined)).toBe(false);
    expect(isSafeWebhookUrl("not a URL")).toBe(false);
    expect(isSafeWebhookUrl("https://999.1.1.1/hook")).toBe(false);
  });
});
