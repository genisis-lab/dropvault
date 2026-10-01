import { describe, expect, it } from "vitest";
import { uploadBatchNotice, uploadBatchStart } from "./uploadEvents";

describe("upload batch notifications", () => {
  it("keeps the single-file wording for one upload", () => {
    expect(uploadBatchNotice(1, "notes.txt")).toEqual({
      title: "notes.txt is ready",
      message: "Your upload finished and is available in Dropvault.",
    });
  });

  it("summarizes a batch in one notification", () => {
    expect(uploadBatchNotice(2, "b.png")).toEqual({
      title: "2 uploads are ready",
      message:
        "b.png and 1 other file finished uploading and are available in Dropvault.",
    });
    expect(uploadBatchNotice(30, "z.pdf").message).toBe(
      "z.pdf and 29 other files finished uploading and are available in Dropvault.",
    );
  });

  it("anchors the batch at its earliest file", () => {
    expect(uploadBatchStart(null, 1_000)).toBe(1_000);
    expect(uploadBatchStart("not-a-number", 1_000)).toBe(1_000);
    expect(uploadBatchStart("1000", 990)).toBe(990);
    expect(uploadBatchStart("990", 1_000)).toBe(990);
  });
});
