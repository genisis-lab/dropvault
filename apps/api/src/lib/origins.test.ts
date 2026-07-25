import { describe, expect, it } from "vitest";
import { canonicalAppOrigin, trustedAppOrigins } from "./origins";

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
});
