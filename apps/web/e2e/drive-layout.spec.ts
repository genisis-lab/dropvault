import { expect, test, type Page } from "@playwright/test";

const now = Math.floor(Date.now() / 1000);
const files = [
  { id: "notes", filename: "notes.txt", contentType: "text/plain" },
  {
    id: "lease",
    filename: "Lease agreement 2026 - final signed copy (scanned).pdf",
    contentType: "application/pdf",
    shareToken: "share-1",
  },
  { id: "budget", filename: "budget.csv", contentType: "text/csv" },
  {
    id: "beach",
    filename: "beach-trip.jpg",
    contentType: "image/jpeg",
    folderId: "trips",
  },
].map((f, i) => ({
  sizeBytes: 2048,
  status: "ready",
  shareToken: null,
  folderId: null,
  createdAt: now - i,
  expiresAt: now + 5 * 86400,
  keepForever: false,
  ...f,
}));
const folders = [
  {
    id: "trips",
    name: "Trips",
    parentId: null,
    shareToken: null,
    createdAt: now,
    fileCount: 1,
    folderCount: 0,
    itemCount: 1,
    totalFileCount: 1,
    totalFolderCount: 0,
    totalItemCount: 1,
  },
];

async function mockApi(page: Page, signedIn = true) {
  await page.addInitScript(() => {
    localStorage.setItem("dropvault-view", "list");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = {
      id: "u1",
      name: "Olivia Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let body: unknown = {};
    if (path === "/api/auth/get-session")
      body = signedIn
        ? {
            user,
            session: {
              id: "s1",
              token: "demo",
              userId: "u1",
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          }
        : null;
    else if (path === "/api/account/me")
      body = {
        user,
        suspended: false,
        quotaBytes: null,
        isAdmin: false,
        adminRole: null,
        canKeepFilesForever: false,
      };
    else if (path === "/api/theme") body = { theme: "neubrutalism" };
    else if (path === "/api/files") body = { files, nextCursor: null };
    else if (path === "/api/folders") body = { folders };
    else if (path === "/api/files/capabilities") body = { e2eEncryption: true };
    else if (path === "/api/admin/access") body = { isAdmin: false, role: null };
    else if (path.includes("limit-requests")) body = { requests: [] };
    else if (path === "/api/notifications")
      body = { notifications: [], unread: 0 };
    else if (path === "/api/signup-policy") body = { approvalRequired: false };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

for (const width of [768, 1024, 1280]) {
  test(`list rows stay on screen beside the sidebar at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    await page.goto("/");
    const actions = page
      .locator('[data-ui="file-row"]')
      .getByRole("button", { name: "File actions" });
    await expect(actions).toHaveCount(3);
    const fits = await actions.evaluateAll((buttons) =>
      buttons.every((b) => b.getBoundingClientRect().right <= window.innerWidth),
    );
    expect(fits).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    // Narrow lists move size and expiry under the name instead of columns.
    const meta = page.locator('[data-ui="file-inline-meta"]').first();
    if (width === 768) await expect(meta).toBeVisible();
    else await expect(meta).toBeHidden();
  });
}

test("the drop zone becomes a compact bar once files are listed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page);
  await page.goto("/");
  const target = page.locator('[data-ui="upload-target"]');
  await expect(target).toHaveAttribute("data-compact", "true");
  await expect(
    target.getByRole("button", { name: "Choose files", exact: true }),
  ).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.height ?? 999).toBeLessThan(100);
});

test("search looks inside folders and labels the results", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Olivia" }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "Search in Dropvault" }).fill("beach");
  await expect(
    page.getByRole("heading", { name: "Search results" }),
  ).toBeVisible();
  await expect(page.getByText("1 result for “beach”")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "beach-trip.jpg", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Clear search" })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search in Dropvault" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Olivia" }),
  ).toBeVisible();
});

test("clicking a filename opens its details", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "budget.csv", exact: true }).click();
  await expect(page.locator('[data-ui="detail-panel"]')).toContainText(
    "budget.csv",
  );
});

test("/signup opens the sign-up form and the URL follows the toggle", async ({
  page,
}) => {
  await mockApi(page, false);
  await page.goto("/signup");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});
