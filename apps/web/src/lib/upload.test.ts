import { describe, expect, it } from "vitest";
import { MULTIPART_THRESHOLD } from "./api";

describe("upload transport policy", () => {
  it("moves larger uploads to resumable multipart well below edge limits", () => {
    expect(MULTIPART_THRESHOLD).toBe(32 * 1024 * 1024);
    expect(MULTIPART_THRESHOLD).toBeLessThan(100_000_000);
  });
});
