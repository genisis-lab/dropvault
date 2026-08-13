import { describe, expect, it } from "vitest";
import {
  canonicalAppOrigin,
  isTrustedBrowserMutation,
  trustedAppOrigins,
} from "./origins";

describe("application origin allowlist", () => {
  it("keeps the canonical custom domain first and includes exact aliases", () => {
    const env = {
      PUBLIC_APP_URL: "https://drive.builtwai.com/",
      TRUSTED_ORIGINS:
        "https://drop-vault.pages.dev, https://drive.builtwai.com",
    };
    expect(trustedAppOrigins(env)).toEqual([
      "https://drive.builtwai.com",
      "https://drop-vault.pages.dev",
    ]);
    expect(canonicalAppOrigin(env)).toBe("https://drive.builtwai.com");
  });

  it("rejects non-HTTP origins and embedded credentials", () => {
    expect(
      trustedAppOrigins({
        PUBLIC_APP_URL: "https://drive.builtwai.com",
        TRUSTED_ORIGINS:
          "javascript:alert(1),https://user:pass@example.com,not-a-url",
      }),
    ).toEqual(["https://drive.builtwai.com"]);
  });

  it("fails closed when the canonical origin is invalid", () => {
    expect(() =>
      canonicalAppOrigin({ PUBLIC_APP_URL: "not-a-url" }),
    ).toThrow("PUBLIC_APP_URL");
  });

  it("allows only configured browser origins for mutations", () => {
    const env = {
      PUBLIC_APP_URL: "https://drive.builtwai.com",
      TRUSTED_ORIGINS: "https://drop-vault.pages.dev",
    };
    expect(
      isTrustedBrowserMutation(
        "POST",
        "https://drive.builtwai.com",
        "same-origin",
        env,
      ),
    ).toBe(true);
    expect(
      isTrustedBrowserMutation(
        "DELETE",
        "https://drop-vault.pages.dev",
        "same-site",
        env,
      ),
    ).toBe(true);
    expect(
      isTrustedBrowserMutation(
        "POST",
        "https://evil.example",
        "cross-site",
        env,
      ),
    ).toBe(false);
    expect(isTrustedBrowserMutation("POST", "null", "cross-site", env)).toBe(
      false,
    );
  });

  it("keeps safe methods and non-browser clients compatible", () => {
    const env = { PUBLIC_APP_URL: "https://drive.builtwai.com" };
    expect(isTrustedBrowserMutation("GET", "https://evil.example", "cross-site", env)).toBe(true);
    expect(isTrustedBrowserMutation("POST", undefined, undefined, env)).toBe(true);
    expect(isTrustedBrowserMutation("POST", undefined, "cross-site", env)).toBe(false);
  });
});
