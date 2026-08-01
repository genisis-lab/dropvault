import { describe, expect, it } from "vitest";
import {
  createDuressVerifier,
  createPasswordVerifier,
  normalizeCredentialProof,
  normalizeCredentialSalt,
  normalizePasswordEnvelope,
  PASSWORD_RECOVERY_ITERATIONS,
  unwrapAccountFileKey,
  verifyDuressProof,
  verifyRecoveryProof,
  wrapAccountFileKey,
  type RecoveryKeyring,
} from "./vaultRecovery";

const keyring: RecoveryKeyring = {
  current: { id: "2026-08-v1", secret: "v".repeat(64) },
};
const encodedFileKey =
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const otherProof =
  "AQECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

describe("vault key recovery", () => {
  it("wraps account keys to the exact owner and file context", async () => {
    const wrapped = await wrapAccountFileKey(
      keyring,
      "owner-1",
      "file-1",
      encodedFileKey,
    );
    await expect(
      unwrapAccountFileKey(keyring, "owner-1", "file-1", wrapped),
    ).resolves.toBe(encodedFileKey);
    await expect(
      unwrapAccountFileKey(keyring, "owner-1", "file-2", wrapped),
    ).rejects.toThrow();
  });

  it("keeps old envelopes readable during an explicit key rotation", async () => {
    const wrapped = await wrapAccountFileKey(
      keyring,
      "owner-1",
      "file-1",
      encodedFileKey,
    );
    const rotated: RecoveryKeyring = {
      current: { id: "2026-09-v2", secret: "n".repeat(64) },
      previous: keyring.current,
    };
    await expect(
      unwrapAccountFileKey(rotated, "owner-1", "file-1", wrapped),
    ).resolves.toBe(encodedFileKey);
    await expect(
      unwrapAccountFileKey(
        { current: rotated.current },
        "owner-1",
        "file-1",
        wrapped,
      ),
    ).rejects.toThrow("version is unavailable");
  });

  it("accepts only the bounded password envelope and proof contracts", () => {
    const valid = {
      v: 1,
      kdf: "PBKDF2-SHA-256",
      iterations: PASSWORD_RECOVERY_ITERATIONS,
      salt: "AAAAAAAAAAAAAAAAAAAAAA",
      nonce: "AAAAAAAAAAAAAAAA",
      ciphertext:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    expect(normalizePasswordEnvelope(valid)).not.toBeNull();
    expect(normalizePasswordEnvelope({ ...valid, iterations: 1 })).toBeNull();
    expect(normalizePasswordEnvelope({ ...valid, nonce: "short" })).toBeNull();
    expect(normalizeCredentialSalt(valid.salt)).toBe(valid.salt);
    expect(normalizeCredentialSalt("short")).toBeNull();
    expect(normalizeCredentialProof(encodedFileKey)).toBe(encodedFileKey);
    expect(normalizeCredentialProof("short")).toBeNull();
  });

  it("uses versioned, file-scoped, constant-time proof verifiers", async () => {
    const stored = await createDuressVerifier(
      keyring,
      "owner-1",
      "file-1",
      encodedFileKey,
    );
    await expect(
      verifyDuressProof(
        keyring,
        "owner-1",
        "file-1",
        encodedFileKey,
        stored,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyDuressProof(
        keyring,
        "owner-1",
        "file-1",
        otherProof,
        stored,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyDuressProof(
        keyring,
        "owner-1",
        "file-2",
        encodedFileKey,
        stored,
      ),
    ).resolves.toBe(false);
  });

  it("keeps normal and duress verifier namespaces separate", async () => {
    const normal = await createPasswordVerifier(
      keyring,
      "owner-1",
      "file-1",
      encodedFileKey,
    );
    const duress = await createDuressVerifier(
      keyring,
      "owner-1",
      "file-1",
      otherProof,
    );
    expect(normal).not.toBe(duress);
    await expect(
      verifyRecoveryProof(
        keyring,
        "owner-1",
        "file-1",
        encodedFileKey,
        normal,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyDuressProof(
        keyring,
        "owner-1",
        "file-1",
        encodedFileKey,
        duress,
      ),
    ).resolves.toBe(false);
  });
});
