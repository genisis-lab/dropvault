// Persisted UI preferences (sort key + view mode) so a user's choices survive reloads.
export type SortKey = "newest" | "name" | "size" | "expiring";
export type ViewMode = "grid" | "list";

const SORT_KEY = "dropvault-sort";
const VIEW_KEY = "dropvault-view";
const SORTS: SortKey[] = ["newest", "name", "size", "expiring"];

export function readSort(): SortKey {
  const v = (
    typeof localStorage !== "undefined" ? localStorage.getItem(SORT_KEY) : null
  ) as SortKey | null;
  return v && SORTS.includes(v) ? v : "newest";
}
export function writeSort(v: SortKey) {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {}
}
export function hasStoredView(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ||
      localStorage.getItem(VIEW_KEY) === "grid";
  } catch {
    return false;
  }
}
export function readView(fallback: ViewMode = "grid"): ViewMode {
  if (typeof localStorage === "undefined") return fallback;
  const stored = localStorage.getItem(VIEW_KEY);
  return stored === "list" || stored === "grid" ? stored : fallback;
}
export function writeView(v: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
}
