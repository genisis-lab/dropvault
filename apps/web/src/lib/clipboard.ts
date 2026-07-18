export type CopyResult = "copied" | "manual";

function manualCopy(text: string): CopyResult {
  const shortcut = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
    ? "Command+C"
    : "Ctrl+C";
  window.prompt(
    `Automatic copying is blocked by your browser. Press ${shortcut} to copy this link, then close this box.`,
    text,
  );
  return "manual";
}

export async function copyText(text: string): Promise<CopyResult> {
  if (!text) throw new Error("There is nothing to copy.");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // Some browsers expose the Clipboard API but block it. Fall back to the
      // selection-based copy path while this call still has user activation.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    if (
      typeof document.execCommand === "function" &&
      document.execCommand("copy")
    )
      return "copied";
  } finally {
    textarea.remove();
  }

  return manualCopy(text);
}

// Creating a share URL can require a network request. Chromium-style browsers
// revoke transient clipboard permission once that await completes. Start a
// ClipboardItem write during the original click and let its Blob resolve when
// the URL is ready; fall back to the regular/manual paths elsewhere.
export async function copyTextFrom(
  getText: () => Promise<string>,
): Promise<{ text: string; result: CopyResult }> {
  const textPromise = getText();
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const item = new ClipboardItem({
        "text/plain": textPromise.then(
          (text) => new Blob([text], { type: "text/plain" }),
        ),
      });
      await navigator.clipboard.write([item]);
      return { text: await textPromise, result: "copied" };
    } catch {
      // Safari and restricted embeds may reject promised ClipboardItems.
    }
  }
  const text = await textPromise;
  return { text, result: await copyText(text) };
}
