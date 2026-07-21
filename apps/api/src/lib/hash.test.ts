import { describe, expect, it } from "vitest";
import { hashSecret, sha256Hex, verifySecret } from "./hash";

describe("secret hashing", () => {
  it("uses the hardened PBKDF2 format and verifies the right password", async () => {
    const stored = await hashSecret("correct horse battery staple");

    expect(stored).toMatch(/^pbkdf2\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    await expect(
      verifySecret("correct horse battery staple", stored),
    ).resolves.toBe(true);
    await expect(verifySecret("wrong", stored)).resolves.toBe(false);
  });

  it("rejects malformed and excessive work factors before deriving a key", async () => {
    await expect(
      verifySecret(
        "secret",
        `pbkdf2$2000001$${"a".repeat(32)}$${"b".repeat(64)}`,
      ),
    ).resolves.toBe(false);
    await expect(
      verifySecret("secret", `pbkdf2$600000$not-hex$${"b".repeat(64)}`),
    ).resolves.toBe(false);
  });

  it("continues to verify legacy SHA-256 values", async () => {
    await expect(
      verifySecret("legacy", await sha256Hex("legacy")),
    ).resolves.toBe(true);
    await expect(
      verifySecret("legacy", `a1b2$${await sha256Hex("a1b2legacy")}`),
    ).resolves.toBe(true);
  });
});
