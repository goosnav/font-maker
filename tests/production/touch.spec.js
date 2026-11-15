import { test, expect } from "@playwright/test";

const screens = [
  ["iPad portrait", 834, 1194],
  ["iPad landscape", 1194, 834],
  ["iPad mini", 768, 1024],
  ["phone", 390, 844],
  ["small phone", 320, 568],
];

async function inViewport(locator, page) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

// Guide labels change size with zoom; compare the drawn ink, not the overlays.
async function inkFingerprint(canvas) {
  return canvas.evaluate(async c => {
    const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const mask = new Uint8Array(c.width * c.height);
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      mask[i] = Number(pixels[i * 4] < 32 && pixels[i * 4 + 1] < 32 && pixels[i * 4 + 2] < 32);
      count += mask[i];
    }
    const digest = await crypto.subtle.digest("SHA-256", mask);
    return { count, hash: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("") };
  });
}

for (const [name, width, height] of screens) {
  test(`${name}: touch setup, drawing, controls, rotation and export`, async ({ browser, browserName }, info) => {
    test.skip(browserName === "firefox", "Mobile viewport emulation uses Chromium and WebKit; Firefox has desktop regression coverage.");
    const context = await browser.newContext({
      viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.route("**/api/recovery", route => route.request().method() === "GET"
      ? route.fulfill({ status: 404 }) : route.continue());
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:5183");
      await page.getByRole("button", { name: "New font", exact: true }).tap();
      await page.getByRole("textbox", { name: "Family name", exact: true }).fill("Touch test");
      await inViewport(page.getByRole("button", { name: "Continue", exact: true }), page);
      await page.getByRole("button", { name: "Choose reference font" }).tap();
      await expect(page.locator('.reference-choice[data-loaded="true"]')).toHaveCount(7);
      const oldEnglish = page.locator('[data-reference="unifraktur"]');
      await oldEnglish.scrollIntoViewIfNeeded();
      await oldEnglish.tap();
      await page.getByRole("button", { name: "Continue", exact: true }).tap();
      await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
      await inViewport(page.getByRole("button", { name: "Start drawing", exact: true }), page);
      if (width <= 700) {
        await page.getByRole("tab", { name: "Settings", exact: true }).tap();
        await expect(page.locator("#setting-family")).toHaveValue("Touch test");
        expect(await page.locator("#setting-family").evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
        await page.getByRole("tab", { name: "Draw", exact: true }).tap();
      }
      const sample = page.locator(".paint-canvas");
      const box = await sample.boundingBox();
      await page.touchscreen.tap(box.x + box.width * 0.35, box.y + box.height * 0.45);
      await page.locator("#sample-test").tap();
      await expect(page.locator("#sample-notice")).toHaveText("Font test passed.", { timeout: 60000 });
      await page.screenshot({ path: info.outputPath("setup.png"), scale: "css" });
      await page.getByRole("button", { name: "Start drawing", exact: true }).tap();
      await expect(page.locator('[data-cp="72"]')).toHaveAttribute("data-status", "drawn");
      await page.locator('[data-cp="65"]').tap();
      await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
      await expect.poll(async () => (await page.locator(".paint-canvas").boundingBox()).width).toBeGreaterThan(width > 700 ? 500 : 190);
      await inViewport(page.locator(".paint-canvas"), page);
      const canvas = page.locator(".paint-canvas");
      const drawBox = await canvas.boundingBox();
      await page.touchscreen.tap(drawBox.x + drawBox.width * 0.4, drawBox.y + drawBox.height * 0.45);
      const ink = await inkFingerprint(canvas);
      expect(ink.count).toBeGreaterThan(0);
      if (width <= 1024) {
        await page.getByRole("button", { name: "Controls", exact: true }).tap();
        await expect(page.locator("#toggle-controls")).toHaveAttribute("aria-expanded", "true");
        await inViewport(page.locator("#glyph-controls"), page);
        await page.getByRole("button", { name: "Close controls", exact: true }).tap();
        await expect(page.locator("#glyph-controls")).not.toBeVisible();
      }
      await page.screenshot({ path: info.outputPath("editor.png"), scale: "css" });
      if (width > 700) {
        await page.setViewportSize({ width: height, height: width });
        await expect.poll(async () => {
          const c = await canvas.boundingBox(), h = await page.locator(".canvas-host").boundingBox();
          return c.width <= h.width && c.height <= h.height;
        }).toBe(true);
        await inViewport(canvas, page);
        expect(await inkFingerprint(canvas)).toEqual(ink);
        await page.screenshot({ path: info.outputPath("rotated.png"), scale: "css" });
      }
      await page.locator('.save-menu summary').tap();
      await inViewport(page.locator('.save-menu .menu-pop'), page);
      await page.locator('.split [data-command="export"]').tap();
      await page.locator("#export-format").selectOption("ttf");
      await inViewport(page.getByRole("button", { name: "Export", exact: true }), page);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export", exact: true }).tap();
      expect((await download).suggestedFilename()).toMatch(/\.ttf$/);
      await page.getByRole("tab", { name: "Paper", exact: true }).tap();
      await inViewport(page.locator("#paper-set"), page);
      expect((await page.locator("#paper-set").boundingBox()).width).toBeGreaterThan(220);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
