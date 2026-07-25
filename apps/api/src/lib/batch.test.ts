import { describe, expect, it } from "vitest";
import { chunkValues, D1_IN_CLAUSE_BATCH_SIZE } from "./batch";

describe("chunkValues", () => {
  it("keeps D1 IN clauses below the bounded batch size", () => {
    const values = Array.from({ length: 172 }, (_, index) => `${index}`);
    const chunks = chunkValues(values);

    expect(chunks.map((chunk) => chunk.length)).toEqual([
      D1_IN_CLAUSE_BATCH_SIZE,
      D1_IN_CLAUSE_BATCH_SIZE,
      22,
    ]);
    expect(chunks.flat()).toEqual(values);
  });

  it("rejects invalid batch sizes", () => {
    expect(() => chunkValues(["a"], 0)).toThrow(RangeError);
  });
});
