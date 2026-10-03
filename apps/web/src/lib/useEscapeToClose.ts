import { useEffect, useRef, type RefObject } from "react";

// Lets keyboard users dismiss a popover, panel or dialog with Escape and puts
// focus back on the control that opened it. Open layers form a stack so only
// the topmost one closes: Escape in a confirmation shown over the admin
// console closes the confirmation, not the console. The listener runs in the
// capture phase so an open layer handles the key before page-level handlers.
type Layer = {
  close: RefObject<() => void>;
  returnFocusTo?: RefObject<HTMLElement | null>;
};

const layers: Layer[] = [];

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const top = layers[layers.length - 1];
  if (!top) return;
  event.stopPropagation();
  top.close.current?.();
  top.returnFocusTo?.current?.focus();
}

export function useEscapeToClose(
  open: boolean,
  onClose: () => void,
  returnFocusTo?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const layer: Layer = { close: onCloseRef, returnFocusTo };
    if (layers.length === 0)
      window.addEventListener("keydown", onKeyDown, true);
    layers.push(layer);
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      if (layers.length === 0)
        window.removeEventListener("keydown", onKeyDown, true);
    };
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
