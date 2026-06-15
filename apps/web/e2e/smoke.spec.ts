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
