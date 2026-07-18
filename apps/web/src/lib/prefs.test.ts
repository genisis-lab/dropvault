import { afterEach, describe, expect, it } from "vitest";
import { readSort, writeSort, readView, writeView } from "./prefs";

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
  });
  it("round-trips list", () => {
    writeView("list");
    expect(readView()).toBe("list");
  });
  it("only list is honored, anything else is grid", () => {
    localStorage.setItem("dropvault-view", "weird");
    expect(readView()).toBe("grid");
  });
});
