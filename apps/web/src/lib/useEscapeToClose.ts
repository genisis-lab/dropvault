import { useEffect, useRef, type RefObject } from "react";

// Lets keyboard users dismiss a popover menu with Escape and puts focus back on
// the control that opened it. The listener runs in the capture phase so an
// open menu handles the key before any page-level handler sees it.
export function useEscapeToClose(
  open: boolean,
  onClose: () => void,
  returnFocusTo?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
      returnFocusTo?.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, returnFocusTo]);
}

// When a menu was opened from the keyboard (Enter/Space report click
// detail 0), move focus to its first item so arrow-free Tab navigation starts
// inside the menu instead of behind it.
export function focusFirstMenuItem(panel: HTMLElement | null) {
  panel
    ?.querySelector<HTMLElement>("button:not(:disabled), a[href]")
    ?.focus();
}
