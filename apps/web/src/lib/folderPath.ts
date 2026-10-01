// Ancestors of a folder from the top level down to the folder itself, used for
// the "My Drive › Projects › 2026" breadcrumb. Stops on a missing parent or a
// cycle so a damaged tree can't hang the page.
export function folderPath<T extends { id: string; parentId?: string | null }>(
  folders: readonly T[],
  folderId: string | null,
): T[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: T[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
