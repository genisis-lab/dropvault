import { describe, expect, it } from "vitest";
import {
  decryptEncryptedPayload,
  encryptForUpload,
  MAX_BROWSER_ENCRYPTION_BYTES,
} from "./encryption";

describe("client-side encryption", () => {
  it("round-trips file bytes and private metadata", async () => {
    const source = new File(["top secret\n"], "private-note.txt", {
      type: "text/plain",
      lastModified: 123,
    });
    const encrypted = await encryptForUpload(source);
    const clear = await decryptEncryptedPayload(
      await encrypted.file.arrayBuffer(),
      encrypted.key,
      encrypted.nonce,
      encrypted.encryptedMetadata,
    );

    expect(new TextDecoder().decode(clear.bytes)).toBe("top secret\n");
    expect(clear.filename).toBe("private-note.txt");
    expect(clear.contentType).toBe("text/plain");
    // AES-GCM appends a 128-bit authentication tag to the encrypted payload.
    expect(encrypted.file.size).toBe(source.size + 16);
    expect(
      new TextDecoder().decode(await encrypted.file.arrayBuffer()),
    ).not.toContain("top secret");
    expect(encrypted.encryptedMetadata).not.toContain("private-note.txt");
  });

  it("rejects files above the browser encryption limit", async () => {
    const oversized = {
      size: MAX_BROWSER_ENCRYPTION_BYTES + 1,
    } as File;
    await expect(encryptForUpload(oversized)).rejects.toThrow(
      "limited to 256 MB",
    );
  });

  it("rejects a wrong key", async () => {
    const source = new File(["payload"], "payload.txt");
    const encrypted = await encryptForUpload(source);
    const other = await encryptForUpload(new File(["other"], "other.txt"));
    await expect(
      decryptEncryptedPayload(
        await encrypted.file.arrayBuffer(),
        other.key,
        encrypted.nonce,
        encrypted.encryptedMetadata,
      ),
    ).rejects.toThrow();
  });
});
