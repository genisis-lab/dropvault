import { describe, expect, it } from "vitest";
import {
  descendantFolderIds,
  summarizeFolderContents,
  type FolderNode,
} from "./folderTree";

const folders: FolderNode[] = [
  { id: "root", parentId: null },
  { id: "child", parentId: "root" },
  { id: "grandchild", parentId: "child" },
  { id: "other", parentId: null },
];

describe("folder tree helpers", () => {
  it("counts child folders as real folder items", () => {
    const summaries = summarizeFolderContents(folders, [
      "child",
      "grandchild",
      "grandchild",
      null,
    ]);

    expect(summaries.get("root")).toEqual({
      fileCount: 0,
      folderCount: 1,
      itemCount: 1,
      totalFileCount: 3,
      totalFolderCount: 2,
      totalItemCount: 5,
    });
    expect(summaries.get("child")?.itemCount).toBe(2);
  });

  it("returns the complete subtree for recursive deletion", () => {
    expect(new Set(descendantFolderIds(folders, "root"))).toEqual(
      new Set(["root", "child", "grandchild"]),
    );
  });
});
