import { describe, expect, it } from "vitest";
import { folderPath } from "./folderPath";

const folders = [
  { id: "a", name: "Projects", parentId: null },
  { id: "b", name: "2026", parentId: "a" },
  { id: "c", name: "Drafts", parentId: "b" },
];

describe("folderPath", () => {
  it("lists ancestors from the top down", () => {
    expect(folderPath(folders, "c").map((f) => f.name)).toEqual([
      "Projects",
      "2026",
      "Drafts",
    ]);
    expect(folderPath(folders, "a").map((f) => f.id)).toEqual(["a"]);
    expect(folderPath(folders, null)).toEqual([]);
  });
  it("survives missing parents and cycles", () => {
    expect(
      folderPath([{ id: "x", parentId: "gone" }], "x").map((f) => f.id),
    ).toEqual(["x"]);
    expect(
      folderPath(
        [
          { id: "p", parentId: "q" },
          { id: "q", parentId: "p" },
        ],
        "p",
      ).map((f) => f.id),
    ).toEqual(["q", "p"]);
  });
});
