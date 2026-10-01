// Single-key shortcuts for the file view: "/" search, "u" upload, Delete to
// move the selection to Trash. They never fire while someone is typing, holds
// a modifier, or has a dialog open.
export type Shortcut = "search" | "upload" | "trash";

export function shortcutFor(
  event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
  context: { typing: boolean; dialogOpen: boolean },
): Shortcut | null {
  if (context.typing || context.dialogOpen) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "/") return "search";
  if (event.key === "u" || event.key === "U") return "upload";
  if (event.key === "Delete") return "trash";
  return null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
