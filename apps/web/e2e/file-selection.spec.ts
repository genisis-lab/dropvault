import { expect, test, devices, type Page } from "@playwright/test"

const now = Math.floor(Date.now() / 1000)
const files = [
  { id: "file-1", filename: "one.png", createdAt: now - 1 },
  { id: "file-2", filename: "two.png", createdAt: now - 2 },
  { id: "file-3", filename: "three.png", createdAt: now - 3 },
].map((file) => ({
  ...file,
  sizeBytes: 1024,
  contentType: "image/png",
  status: "ready",
  shareToken: null,
  folderId: null,
  expiresAt: now + 86_400,
  keepForever: false,
  favorite: false,
  tags: [],
  deletedAt: null,
  encryptionMode: "none",
}))

test.use({ ...devices["iPhone 13"], defaultBrowserType: "chromium" })

async function mockDashboardApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {}
    if (path === "/api/auth/get-session")
      body = {
        session: {
          id: "session-1",
          token: "test-token",
          userId: "user-1",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        user: {
          id: "user-1",
          name: "Selection Tester",
          email: "selection@example.com",
          emailVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    else if (path === "/api/account/me")
      body = {
        user: {
          id: "user-1",
          name: "Selection Tester",
          email: "selection@example.com",
        },
        suspended: false,
        suspensionReason: null,
        quotaBytes: null,
        isAdmin: false,
        adminRole: null,
        keepFilesForever: false,
        canKeepFilesForever: false,
      }
    else if (path === "/api/theme") body = { theme: "light" }
    else if (path === "/api/files/capabilities")
      body = { e2eEncryption: true }
    else if (path === "/api/files") body = { files, nextCursor: null }
    else if (path === "/api/folders") body = { folders: [] }
    else if (path === "/api/admin/access") body = { isAdmin: false, role: null }
    else if (path === "/api/admin/limit-requests/mine") body = { requests: [] }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  })
}

test("opens an image on the first tap and long-presses into selection", async ({
  page,
}) => {
    await page.addInitScript(() => {
      localStorage.setItem("dropvault-layout", "classic")
      localStorage.setItem("dropvault-view", "grid")
    })
    await mockDashboardApi(page)
    await page.goto("/")

    const firstCard = page.locator('[data-ui="file-card"]').first()
    const preview = firstCard.locator("[data-file-preview]")
    await expect(preview).toBeVisible()
    await preview.tap()
    await expect(page.getByRole("button", { name: "Close preview" })).toBeVisible()
    await page.getByRole("button", { name: "Close preview" }).tap()

    await preview.dispatchEvent("pointerdown", {
      pointerId: 11,
      pointerType: "touch",
      isPrimary: true,
      clientX: 40,
      clientY: 160,
    })
    await expect(
      firstCard.getByRole("button", { name: "Deselect" }),
    ).toBeVisible()
    await expect(page.locator('[data-ui="selection-rectangle"]')).toBeVisible()
    const secondCard = page.locator('[data-ui="file-card"]').nth(1)
    const secondBox = await secondCard.boundingBox()
    expect(secondBox).not.toBeNull()
    if (secondBox) {
      await preview.dispatchEvent("pointermove", {
        pointerId: 11,
        pointerType: "touch",
        isPrimary: true,
        clientX: secondBox.x + secondBox.width / 2,
        clientY: secondBox.y + secondBox.height / 2,
      })
      await expect(
        secondCard.getByRole("button", { name: "Deselect" }),
      ).toBeVisible()
    }
    await preview.dispatchEvent("pointerup", {
      pointerId: 11,
      pointerType: "touch",
      isPrimary: true,
      clientX: 40,
      clientY: 160,
    })
})

test("supports shift-range selection and marquee selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem("dropvault-layout", "classic")
    localStorage.setItem("dropvault-view", "grid")
  })
  await mockDashboardApi(page)
  await page.goto("/")

  const cards = page.locator('[data-ui="file-card"]')
  await expect(cards).toHaveCount(3)
  await cards.nth(0).locator("[data-file-preview]").click({ button: "right" })
  await cards.nth(1).locator("[data-file-preview]").click({ modifiers: ["Shift"] })
  await expect(cards.nth(0).getByRole("button", { name: "Deselect" })).toBeVisible()
  await expect(cards.nth(1).getByRole("button", { name: "Deselect" })).toBeVisible()

  await page.getByRole("button", { name: "Clear selection" }).click()
  const surface = page.locator('[data-ui="file-selection-grid"]')
  const box = await surface.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3)
  await page.mouse.down()
  await page.mouse.move(box.x + 3, box.y + 3, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() =>
      cards.locator('button[aria-label="Deselect"]').count(),
    )
    .toBe(3)
})
