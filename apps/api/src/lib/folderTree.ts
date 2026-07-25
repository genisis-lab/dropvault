export type FolderNode = {
  id: string;
  parentId: string | null;
};

export type FolderContentSummary = {
  fileCount: number;
  folderCount: number;
  itemCount: number;
  totalFileCount: number;
  totalFolderCount: number;
  totalItemCount: number;
};

export function descendantFolderIds(
  folders: readonly FolderNode[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const ids = children.get(folder.parentId) ?? [];
    ids.push(folder.id);
    children.set(folder.parentId, ids);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}

export function summarizeFolderContents(
  folders: readonly FolderNode[],
  fileFolderIds: readonly (string | null)[],
): Map<string, FolderContentSummary> {
  const children = new Map<string, string[]>();
  const directFiles = new Map<string, number>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const ids = children.get(folder.parentId) ?? [];
    ids.push(folder.id);
    children.set(folder.parentId, ids);
  }
  for (const folderId of fileFolderIds) {
    if (!folderId) continue;
    directFiles.set(folderId, (directFiles.get(folderId) ?? 0) + 1);
  }

  const memo = new Map<string, FolderContentSummary>();
  const visiting = new Set<string>();
  const summarize = (id: string): FolderContentSummary => {
    const cached = memo.get(id);
    if (cached) return cached;
    const fileCount = directFiles.get(id) ?? 0;
    const childIds = children.get(id) ?? [];
    if (visiting.has(id)) {
      return {
        fileCount,
        folderCount: childIds.length,
        itemCount: fileCount + childIds.length,
        totalFileCount: fileCount,
        totalFolderCount: 0,
        totalItemCount: fileCount,
      };
    }
    visiting.add(id);
    let totalFileCount = fileCount;
    let totalFolderCount = 0;
    for (const childId of childIds) {
      const child = summarize(childId);
      totalFileCount += child.totalFileCount;
      totalFolderCount += 1 + child.totalFolderCount;
    }
    visiting.delete(id);
    const summary = {
      fileCount,
      folderCount: childIds.length,
      itemCount: fileCount + childIds.length,
      totalFileCount,
      totalFolderCount,
      totalItemCount: totalFileCount + totalFolderCount,
    };
    memo.set(id, summary);
    return summary;
  };

  for (const folder of folders) summarize(folder.id);
  return memo;
}
