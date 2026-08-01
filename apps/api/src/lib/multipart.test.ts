import { describe, expect, it } from "vitest";
import { multipartFailureKind, storedMultipartParts } from "./multipart";

describe("multipart session recovery", () => {
  it("recognizes R2 NoSuchUpload as a stale resumable session", () => {
    expect(
      multipartFailureKind(
        new Error("10024 NoSuchUpload: multipart upload does not exist"),
      ),
    ).toBe("stale");
    expect(
      multipartFailureKind(new Error("The uploadId was aborted")),
    ).toBe("stale");
  });

  it("separates invalid completion state from retryable service failures", () => {
    expect(multipartFailureKind(new Error("10025 InvalidPart"))).toBe(
      "invalid",
    );
    expect(multipartFailureKind(new Error("10043 ServiceUnavailable"))).toBe(
      "transient",
    );
  });

  it("sanitizes, de-duplicates, and orders persisted progress", () => {
    expect(
      storedMultipartParts(
        JSON.stringify([
          { partNumber: 2, etag: "second-old" },
          { partNumber: 1, etag: "first" },
          { partNumber: 2, etag: "second-new" },
          { partNumber: 0, etag: "bad" },
          { partNumber: 3, etag: "" },
        ]),
      ),
    ).toEqual([
      { partNumber: 1, etag: "first" },
      { partNumber: 2, etag: "second-new" },
    ]);
    expect(storedMultipartParts("not json")).toEqual([]);
  });
});
