import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, copyTextFrom } from "./clipboard";

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;
const originalClipboardItem = globalThis.ClipboardItem;
const originalPrompt = window.prompt;

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: originalExecCommand,
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: originalClipboardItem,
  });
  Object.defineProperty(window, "prompt", {
    configurable: true,
    value: originalPrompt,
  });
  document.querySelectorAll("textarea").forEach((element) => element.remove());
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyText("share link")).resolves.toBe("copied");

    expect(writeText).toHaveBeenCalledWith("share link");
  });

  it("falls back when the Clipboard API is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyText("encrypted share link")).resolves.toBe("copied");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("shows a selectable manual fallback when automatic copy is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    const prompt = vi.fn().mockReturnValue("share link");
    Object.defineProperty(window, "prompt", {
      configurable: true,
      value: prompt,
    });

    await expect(copyText("share link")).resolves.toBe("manual");
    expect(prompt).toHaveBeenCalledWith(
      expect.stringContaining("Automatic copying is blocked"),
      "share link",
    );
  });

  it("starts an async ClipboardItem write during the user action", async () => {
    let resolveText!: (text: string) => void;
    const textPromise = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    let clipboardData: Record<string, Promise<Blob>> | undefined;
    const write = vi.fn().mockImplementation(async (items: ClipboardItem[]) => {
      clipboardData = (
        items[0] as unknown as { data: Record<string, Promise<Blob>> }
      ).data;
    });
    class TestClipboardItem {
      constructor(
        public data: Record<string, Promise<Blob>>,
      ) {}
    }
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    const copying = copyTextFrom(() => textPromise);
    expect(write).toHaveBeenCalledTimes(1);
    resolveText("created share link");

    await expect(copying).resolves.toEqual({
      text: "created share link",
      result: "copied",
    });
    await expect(clipboardData?.["text/plain"]).resolves.toBeInstanceOf(Blob);
  });
});
