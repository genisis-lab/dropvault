import { describe, expect, it } from "vitest";
import { fileContentHash, MULTIPART_THRESHOLD } from "./api";

describe("upload transport policy", () => {
  it("stops hashing before reading a cancelled file", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fileContentHash(new File(["original"], "photo.heic"), controller.signal)).rejects.toMatchObject({name: "AbortError"});
  });
  it("moves larger uploads to resumable multipart well below edge limits", () => {
    expect(MULTIPART_THRESHOLD).toBe(32 * 1024 * 1024);
    expect(MULTIPART_THRESHOLD).toBeLessThan(100_000_000);
  });

  it("calculates the stable SHA-256 used by file-hash bans", async () => {
    const file = new File(["dropvault"], "sample.txt", { type: "text/plain" });
    await expect(fileContentHash(file)).resolves.toBe(
      "6cf7eb75b036351f87246dbb815c69eb27aa7e49df88553fbf9e44b67d1b537c",
    );
  });
});
