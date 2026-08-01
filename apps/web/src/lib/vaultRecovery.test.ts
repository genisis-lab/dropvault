import { describe, expect, it } from "vitest";
import {
  createCredentialSalt,
  createPasswordKeyEnvelope,
  deriveRecoveryProof,
  unwrapPasswordKeyEnvelope,
} from "./vaultRecovery";

const fileKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

describe("password key recovery", () => {
  it("derives stable, salted proofs without exposing the password", async () => {
    const salt = createCredentialSalt();
    const proof = await deriveRecoveryProof("correct horse battery staple", salt);
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof).not.toContain("correct horse battery staple");
    await expect(
      deriveRecoveryProof("correct horse battery staple", salt),
    ).resolves.toBe(proof);
    await expect(
      deriveRecoveryProof("different password value", salt),
    ).resolves.not.toBe(proof);
  });

  it("round-trips a file key without storing the password", async () => {
    const envelope = await createPasswordKeyEnvelope(
      fileKey,
      "correct horse battery staple",
      "file-1",
    );
    expect(JSON.stringify(envelope)).not.toContain(
      "correct horse battery staple",
    );
    await expect(
      unwrapPasswordKeyEnvelope(
        envelope,
        "correct horse battery staple",
        "file-1",
      ),
    ).resolves.toBe(fileKey);
  });

  it("rejects a wrong password and a replay against another file", async () => {
    const envelope = await createPasswordKeyEnvelope(
      fileKey,
      "correct horse battery staple",
      "file-1",
    );
    await expect(
      unwrapPasswordKeyEnvelope(envelope, "wrong password value", "file-1"),
    ).rejects.toThrow();
    await expect(
      unwrapPasswordKeyEnvelope(
        envelope,
        "correct horse battery staple",
        "file-2",
      ),
    ).rejects.toThrow();
  });
});
