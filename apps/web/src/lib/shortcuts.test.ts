import { describe, expect, it } from "vitest";
import { isTypingTarget, shortcutFor } from "./shortcuts";

const idle = { typing: false, dialogOpen: false };

describe("keyboard shortcuts", () => {
  it("maps the supported keys", () => {
    expect(shortcutFor({ key: "/" }, idle)).toBe("search");
    expect(shortcutFor({ key: "u" }, idle)).toBe("upload");
    expect(shortcutFor({ key: "U" }, idle)).toBe("upload");
    expect(shortcutFor({ key: "Delete" }, idle)).toBe("trash");
    expect(shortcutFor({ key: "x" }, idle)).toBeNull();
  });
  it("stays out of the way while typing, with modifiers, or in dialogs", () => {
    expect(shortcutFor({ key: "u" }, { typing: true, dialogOpen: false })).toBeNull();
    expect(shortcutFor({ key: "u" }, { typing: false, dialogOpen: true })).toBeNull();
    expect(shortcutFor({ key: "u", metaKey: true }, idle)).toBeNull();
    expect(shortcutFor({ key: "/", ctrlKey: true }, idle)).toBeNull();
  });
  it("recognizes text fields", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
