import { describe, expect, it, vi } from "vitest";
import { getDb } from "../db";
import { processUploadComplete } from "./uploadEvents";
import type { Bindings } from "../types";

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, getDb: vi.fn() };
});

describe("upload completion retry", () => {
  it("propagates database failure without deleting upload reservations", async () => {
    const get = vi.fn().mockRejectedValue(new Error("D1 temporarily unavailable"));
    vi.mocked(getDb).mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ get }) }) }) } as any);
    const batch = vi.fn();
    const env = { DB: { batch } } as unknown as Bindings;
    await expect(processUploadComplete(env, "file-123")).rejects.toThrow("D1 temporarily unavailable");
    expect(batch).not.toHaveBeenCalled();
  });
});
