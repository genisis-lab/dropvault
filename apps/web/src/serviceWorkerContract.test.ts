import { describe, expect, it } from "vitest";
import serviceWorkerSource from "../public/service-worker.js?raw";
import mainSource from "./main.tsx?raw";

describe("service worker cache contract", () => {
  it("does not cache hashed build assets", () => {
    expect(serviceWorkerSource).toContain(
      'if (url.pathname.startsWith("/assets/")) return;',
    );
    expect(serviceWorkerSource).toContain(
      'if (!SHELL.includes(url.pathname)) return;',
    );
  });

  it("uses a new shell cache so poisoned asset responses are removed", () => {
    expect(serviceWorkerSource).toContain(
      'const CACHE = "dropvault-shell-v4";',
    );
    expect(mainSource).toContain(
      'serviceWorker.register("/service-worker.js?v=4")',
    );
  });
});
