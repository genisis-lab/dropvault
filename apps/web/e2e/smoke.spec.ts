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

test("responsive controls and upload scheduling fit their layouts", async ({
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
    else if (path === "/api/theme") body = { theme: "light" }
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
  await expect(
    page.locator('[data-ui="folder-row"]').filter({ hasText: "Projects" }),
  ).toContainText("1 item")

  // Upload options live behind the New menu, in a dialog.
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "Upload settings…" }).click()
  const uploadOptions = page.getByRole("dialog", { name: "Upload options" })
  await expect(uploadOptions).toBeVisible()
  await expect(
    uploadOptions.getByRole("checkbox", { name: /Keep these uploads forever/ }),
  ).toBeChecked()
  const uploadSchedule = uploadOptions.locator('[data-ui="upload-schedule"]')
  await expect(uploadSchedule.getByText("Release at")).toBeVisible()
  await expect(
    uploadSchedule.locator('input[type="datetime-local"]'),
  ).toBeVisible()
  await expect
    .poll(() =>
      uploadOptions.evaluate(
        (element) => element.getBoundingClientRect().right <= window.innerWidth,
      ),
    )
    .toBe(true)
  await uploadOptions.getByRole("button", { name: "Done" }).click()
  await expect(uploadOptions).toBeHidden()

  // On phones the account menu also carries the display settings.
  await page.getByRole("button", { name: "Account menu", exact: true }).click()
  const accountMenu = page.locator('[data-ui="account-menu"]')
  await expect(accountMenu).toBeVisible()
  await expect
    .poll(() =>
      accountMenu.evaluate((element) => {
        const panel = element.closest('[role="menu"]') as HTMLElement
        return (
          panel.scrollWidth <= panel.clientWidth &&
          panel.getBoundingClientRect().right <= window.innerWidth
        )
      }),
    )
    .toBe(true)

  await accountMenu.getByRole("menuitemradio", { name: /Classic/ }).click()
  await expect(page.locator('[data-ui="dashboard-shell"]')).toHaveAttribute(
    "data-layout",
    "classic",
  )
  await expect(page.getByRole("heading", { name: "My Drive" })).toBeVisible()

  await page.getByRole("button", { name: "Account menu", exact: true }).click()
  await accountMenu.getByRole("menuitemradio", { name: /^Dark/ }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.locator("html")).toHaveClass(/dark/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await page.getByRole("button", { name: "Account menu", exact: true }).click()
  await accountMenu
    .getByRole("menuitemradio", { name: /Use workspace default/ })
    .click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await expect(page.locator("html")).not.toHaveClass(/dark/)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-ui="new-upload"]')).toBeVisible()
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible()

  const favicon = page.locator('link[rel="icon"]')
  await expect(favicon).toHaveAttribute("href", "/favicon.svg")
  const faviconResponse = await page.request.get("/favicon.svg")
  expect(faviconResponse.ok()).toBe(true)
})
