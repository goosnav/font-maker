import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/recovery", route => route.request().method() === "GET"
    ? route.fulfill({ status: 404 }) : route.continue());
});

test("welcome opens over a usable character book and closing it preserves the default project", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".welcome-dialog")).toBeVisible();
  await expect(page.locator(".glyph-cell")).toHaveCount(853);
  await expect(page.locator('[data-cp="65"] .glyph-label')).toHaveText("Capital A");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".welcome-dialog")).toHaveCount(0);
  await expect(page.locator("#style-select")).toBeVisible();
  await page.locator('[data-cp="65"]').click();
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
  await page.getByRole("button", { name: "Back to characters" }).click();
  await page.getByRole("button", { name: "+ Style", exact: true }).click();
  await page.getByRole("button", { name: "Create style", exact: true }).click();
  await expect(page.locator("#style-select option")).toHaveText(["Regular", "Bold"]);
});

test("desktop dialogs keep the form visible and all four menu items aligned", async ({ page }) => {
  for (const height of [563, 900]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto("/");
    await page.getByRole("button", { name: "New font", exact: true }).click();
    const body = page.locator(".new-project-dialog .dialog-body");
    expect((await body.boundingBox()).height).toBeGreaterThan(250);
    await expect(page.locator("#new-name")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Choose reference font" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    const items = await page.locator(".menubar > .menu > summary, .menubar > button").evaluateAll(els => els.map(e => {
      const r = e.getBoundingClientRect();
      return { y: r.y, height: r.height, lineHeight: getComputedStyle(e).lineHeight };
    }));
    expect(items).toHaveLength(4);
    expect(new Set(items.map(i => i.y)).size).toBe(1);
    expect(new Set(items.map(i => i.height)).size).toBe(1);
    expect(new Set(items.map(i => i.lineHeight)).size).toBe(1);
  }
});
