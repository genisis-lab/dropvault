import { expect, test } from "@playwright/test"

// Smoke test: the built app shell should serve and mount without crashing.
// This validates the production bundle + preview server end-to-end without
// depending on the API/auth backend.
test("serves the Dropvault app shell", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle(/Dropvault/i)
  await expect(page.locator("#root")).toBeAttached()
})

test("mounts something into the root element", async ({ page }) => {
  await page.goto("/")
  // Give the SPA a moment to hydrate, then assert the root is not empty.
  await page.waitForLoadState("networkidle")
  const childCount = await page.locator("#root > *").count()
  expect(childCount).toBeGreaterThan(0)
})

test("mobile workspace and theme controls apply without clipped wording", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const now = new Date().toISOString()
    let body: unknown = {}
    if (path === "/api/auth/get-session")
      body = {
        session: {
          id: "session-1",
          token: "test-token",
          userId: "user-1",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: now,
          updatedAt: now,
        },
        user: {
          id: "user-1",
          name: "Mobile Tester",
          email: "mobile@example.com",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      }
    else if (path === "/api/account/me")
      body = {
        user: {
          id: "user-1",
          name: "Mobile Tester",
          email: "mobile@example.com",
        },
        suspended: false,
        suspensionReason: null,
        quotaBytes: null,
        isAdmin: false,
        adminRole: null,
        keepFilesForever: true,
        canKeepFilesForever: true,
      }
    else if (path === "/api/theme") body = { theme: "neubrutalism" }
    else if (path === "/api/files/capabilities")
      body = { e2eEncryption: true }
    else if (path === "/api/files") body = { files: [], nextCursor: null }
    else if (path === "/api/folders")
      body = {
        folders: [
          {
            id: "projects",
            name: "Projects",
            parentId: null,
            shareToken: null,
            createdAt: 1,
            fileCount: 0,
            folderCount: 1,
            itemCount: 1,
            totalFileCount: 0,
            totalFolderCount: 1,
            totalItemCount: 1,
          },
          {
            id: "archive",
            name: "Archive",
            parentId: "projects",
            shareToken: null,
            createdAt: 1,
            fileCount: 0,
            folderCount: 0,
            itemCount: 0,
            totalFileCount: 0,
            totalFolderCount: 0,
            totalItemCount: 0,
          },
        ],
      }
    else if (path === "/api/admin/access")
      body = { isAdmin: false, role: null }
    else if (path === "/api/admin/limit-requests/mine")
      body = { requests: [] }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  })

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Welcome back, Mobile" })).toBeVisible()
  await expect(page.getByText("1 item", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("checkbox", { name: /Keep these uploads forever/ }),
  ).toBeChecked()

  await page.getByRole("button", { name: "More actions" }).click()
  const mobileMenu = page.locator('[data-ui="mobile-actions"]')
  await expect(mobileMenu).toBeVisible()
  await expect
    .poll(() =>
      mobileMenu.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth &&
          element.getBoundingClientRect().right <= window.innerWidth,
      ),
    )
    .toBe(true)

  await page.getByRole("button", { name: /Classic/ }).click()
  await expect(page.locator('[data-ui="dashboard-shell"]')).toHaveAttribute(
    "data-layout",
    "classic",
  )
  await expect(page.getByRole("heading", { name: "My Drive" })).toBeVisible()

  await page.getByRole("button", { name: "More actions" }).click()
  await page.getByLabel("Mobile theme").selectOption("dark")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  const favicon = page.locator('link[rel="icon"]')
  await expect(favicon).toHaveAttribute("href", "/favicon.svg")
  const faviconResponse = await page.request.get("/favicon.svg")
  expect(faviconResponse.ok()).toBe(true)
})
