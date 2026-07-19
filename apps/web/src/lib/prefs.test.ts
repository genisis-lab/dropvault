import { afterEach, describe, expect, it } from "vitest";
import {
  hasStoredView,
  readSort,
  writeSort,
  readView,
  writeView,
} from "./prefs";

afterEach(() => localStorage.clear());

describe("prefs: sort", () => {
  it("defaults to newest", () => {
    expect(readSort()).toBe("newest");
  });
  it("round-trips a valid value", () => {
    writeSort("size");
    expect(readSort()).toBe("size");
  });
  it("falls back to newest for an unknown stored value", () => {
    localStorage.setItem("dropvault-sort", "bogus");
    expect(readSort()).toBe("newest");
  });
});

describe("prefs: view", () => {
  it("defaults to grid", () => {
    expect(readView()).toBe("grid");
    expect(hasStoredView()).toBe(false);
  });
  it("round-trips list", () => {
    writeView("list");
    expect(readView()).toBe("list");
    expect(hasStoredView()).toBe(true);
  });
  it("uses the supplied fallback for an unknown stored value", () => {
    localStorage.setItem("dropvault-view", "weird");
    expect(readView()).toBe("grid");
    expect(readView("list")).toBe("list");
    expect(hasStoredView()).toBe(false);
  });
});
