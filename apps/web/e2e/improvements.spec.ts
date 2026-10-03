import { expect, test, type Page } from "@playwright/test";
const now = Math.floor(Date.now() / 1000);
const files = [
  {
    id: "photo",
    filename: "Local photo.heic",
    contentType: "image/heic",
    expiresAt: now + 3600,
  },
  {
    id: "video",
    filename: "Clip.mp4",
    contentType: "video/mp4",
    expiresAt: now + 7200,
  },
  {
    id: "forever",
    filename: "Permanent.jpg",
    contentType: "image/jpeg",
    expiresAt: 253402300799,
    keepForever: true,
  },
].map((f, i) => ({
  sizeBytes: 100,
  status: "ready",
  shareToken: null,
  folderId: null,
  createdAt: now - i,
  keepForever: false,
  ...f,
}));
async function setup(page: Page, role: string | null = null) {
  await page.addInitScript(() => {
    localStorage.setItem("dropvault-layout", "classic");
    localStorage.setItem("dropvault-view", "grid");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: "u1",
      name: "Demo Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let body: unknown = {};
    if (path === "/api/auth/get-session")
      body = {
        user,
        session: {
          id: "s1",
          token: "demo",
          userId: "u1",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      };
    else if (path === "/api/account/me")
      body = {
        user,
        suspended: false,
        quotaBytes: 1073741824,
        isAdmin: !!role,
        adminRole: role,
        canKeepFilesForever: !!role,
      };
    else if (path === "/api/theme") body = { theme: "light" };
    else if (path === "/api/files") body = { files, nextCursor: null };
    else if (path === "/api/folders") body = { folders: [] };
    else if (path === "/api/files/capabilities")
      body = { e2eEncryption: true, accountRecovery: true };
    else if (path === "/api/admin/access") body = { isAdmin: !!role, role };
    else if (path === "/api/admin/stats")
      body = {
        userCount: 1,
        fileCount: 3,
        totalBytes: 300,
        adminCount: 1,
        flagCount: 0,
      };
    else if (path === "/api/admin/settings")
      body = {
        settings: {
          defaultExpiryDays: "7",
          maxExpiryDays: "30",
          defaultQuotaBytes: "1073741824",
          adminMaxQuotaBytes: "10737418240",
          trashRetentionDays: "30",
          defaultTheme: "light",
          signupMode: "open",
        },
        revision: null,
      };
    else if (path === "/api/admin/settings/history") body = { versions: [] };
    else if (path === "/api/admin/settings/impact")
      body = {
        impacts: [
          {
            key: "trashRetentionDays",
            count: 3,
            unit: "trashed files eligible for cleanup",
            effect:
              "These files can be permanently removed by the next expiration sweep.",
          },
        ],
        asOf: now,
      };
    else if (path.includes("limit-requests")) body = { requests: [] };
    else if (path === "/api/notifications")
      body = { notifications: [], unread: 0 };
    else if (path === "/api/operations/health")
      body = {
        runs: [
          {
            name: "expiration-sweep",
            status: "ok",
            last_success_at: now,
            detail: "3 items processed",
          },
        ],
        stuckUploads: 2,
        abandonedMultipart: 1,
        thumbnailFailures: 1,
        storageReachable: true,
        thresholds: {
          failurePercent: 15,
          minAttempts: 10,
          staleHours: 3,
          storageGrowthGiB: 10,
        },
        alerts: [],
      };
    else if (path === "/api/operations/diagnostics")
      body = {
        rows: [
          {
            outcome: "failed",
            stage: "uploading",
            category: "network",
            browser: "Safari",
            os: "iOS",
            size_band: "100 MiB+",
            count: 2,
            duration_ms: 30000,
          },
        ],
        totals: [
          { outcome: "success", count: 18 },
          { outcome: "failed", count: 2 },
        ],
      };
    else if (path === "/api/operations/reconciliation")
      body = {
        direction: "orphans",
        scanned: 100,
        items: [{ key: "old/orphan", sizeBytes: 1234 }],
        nextCursor: null,
      };
    else if (path === "/api/files/presign")
      body = { id: "new-file", uploadUrl: "/api/files/new-file/upload" };
    else if (path.endsWith("/inline")) {
      await route.fulfill({ status: 415, body: "Unsupported preview" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(page.getByText("Permanent.jpg").first()).toBeVisible();
}
async function openUploadOptions(page: Page) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upload settings…" }).click();
}
test("gallery navigates to video and unsupported originals have a clear fallback", async ({
  page,
}) => {
  await setup(page);
  await page
    .locator('[data-ui="file-card"]')
    .first()
    .locator("[data-file-preview]")
    .click();
  await expect(
    page.getByRole("dialog", { name: "File preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Preview unavailable", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/files/video/inline", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 415, body: "unsupported" }).catch(() => {});
  });
  await page.getByRole("button", { name: "Next file" }).click();
  await expect(page.locator("video")).toBeAttached();
  await expect(page.locator("video")).toHaveAttribute("playsinline", "");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog")).toContainText("Local photo.heic");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("queue remains while browsing Trash and cancellation stops the transfer", async ({
  page,
}) => {
  await setup(page);
  let transferStarted = false;
  await page.route("**/api/files/new-file/upload", async (route) => {
    transferStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fulfill({ status: 200, body: "{}" }).catch(() => {});
  });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("local upload"),
    });
  const tray = page.getByRole("region", { name: "Upload queue" });
  await expect.poll(() => transferStarted).toBe(true);
  await expect(tray).toContainText("Uploading");
  await page
    .getByRole("button", { name: "Trash", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect(tray).toBeVisible();
  await tray.getByRole("button", { name: "Cancel notes.txt" }).click();
  await expect(tray).toContainText("Cancelled");
});
test("mobile options are collapsed and the expiring view excludes permanent files", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator("#upload-options")).toBeHidden();
  await openUploadOptions(page);
  await expect(page.locator("#upload-options")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#upload-options")).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Expiring soon", exact: true })
    .first()
    .click();
  await expect(page.locator('[data-ui="file-card"]')).toHaveCount(2);
});
test("owner can inspect operations and cleanup requires review", async ({
  page,
}) => {
  await setup(page, "owner");
  await page
    .getByRole("button", { name: "Admin console", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.getByText("90%", { exact: true })).toBeVisible();
  await expect(page.getByText("Safari / iOS", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Scan orphan objects" }).click();
  await expect(
    page.getByRole("button", { name: "Delete reviewed objects" }),
  ).toBeDisabled();
  await page
    .getByLabel("Type DELETE REVIEWED ORPHANS")
    .fill("DELETE REVIEWED ORPHANS");
  await expect(
    page.getByRole("button", { name: "Delete reviewed objects" }),
  ).toBeEnabled();
  await page
    .locator('[data-ui="admin-operations"]')
    .getByRole("heading", { name: "Operations", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/operations-desktop.png" });
});
test("policy review displays affected files before save", async ({ page }) => {
  await setup(page, "owner");
  await page
    .getByRole("button", { name: "Admin console", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Policies", exact: true }).click();
  await page.getByRole("button", { name: "Save workspace settings" }).click();
  await expect(
    page.getByText("Impact on this workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/3 trashed files eligible for cleanup/),
  ).toBeVisible();
});

for (const theme of ["light", "dark", "system"]) {
  test(`upload controls fit the ${theme} appearance on mobile`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(
      (theme) => localStorage.setItem("dropvault-theme", theme),
      theme,
    );
    await setup(page);
    await expect(page.locator("html")).toHaveClass(
      theme === "light" ? /^(?!.*\bdark\b)/ : /\bdark\b/,
    );
    await openUploadOptions(page);
    await expect(page.locator("#upload-options")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/upload-${theme}-mobile.png` });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("#upload-options")).toBeHidden();
  });
}

test("retired themes fall back to the new appearances", async ({ page }) => {
  // Seed only the first load so the reload below keeps the second value.
  await page.addInitScript(() => {
    if (localStorage.getItem("dropvault-theme") == null)
      localStorage.setItem("dropvault-theme", "sunset");
  });
  await setup(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.evaluate(() => localStorage.setItem("dropvault-theme", "neubrutalism"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});
