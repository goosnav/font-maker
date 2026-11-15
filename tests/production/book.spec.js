import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

async function openBook(page) {
  await page.route("**/api/recovery", r => r.fulfill({ status: r.request().method() === "PUT" ? 204 : 404 }));
  await page.goto("/");
  await page.getByRole("button", { name: "Continue drawing", exact: true }).click();
}
async function draw(page, cp) {
  await page.locator(`[data-cp="${cp}"]`).click();
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
  const b = await page.locator(".paint-canvas").boundingBox();
  await page.mouse.move(b.x + b.width * .35, b.y + b.height * .3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * .5, b.y + b.height * .6, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Back to characters", exact: true }).click();
}
async function loadedPreview(page) {
  await expect(page.locator("#quick-output")).toHaveAttribute("aria-busy", "false", { timeout: 60000 });
  await expect(page.locator("#quick-output")).toHaveCSS("font-family", /gfn-preview/);
  return page.locator("#quick-output").evaluate(e => ({ family: e.style.fontFamily, revision: e.dataset.revision }));
}

test("book sidebar updates the actual font, edits settings, confirms clear, and saves from one menu", async ({ page }) => {
  test.setTimeout(150000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await openBook(page);
  const sidebar = page.locator(".book-sidebar"), grid = page.locator(".book-main");
  expect((await sidebar.boundingBox()).x + (await sidebar.boundingBox()).width).toBeLessThanOrEqual((await grid.boundingBox()).x);
  await page.locator("#book-name").fill("Sidebar family");
  await page.locator("#quick-text").fill("AA B");
  await expect(page.locator("#title")).toContainText("Sidebar family");
  await expect(page.locator("#quick-output .missing")).toHaveCount(3);
  await draw(page, 65);
  const first = await loadedPreview(page);
  await expect(page.locator("#quick-output .missing")).toHaveCount(1);
  await page.locator("#quick-text").fill("AAA\nA");
  await expect(page.locator("#quick-output")).toHaveText("AAA\nA");
  expect(await loadedPreview(page)).toEqual(first); // Typing reuses the compiled current revision.
  await page.getByRole("button", { name: "Full preview…", exact: true }).click();
  await expect(page.locator(".specimen-line").first()).toHaveCSS("font-family", /gfn-preview/, { timeout: 60000 });
  await expect(page.locator("#refresh-preview")).toBeHidden();
  await page.getByRole("tab", { name: "Characters", exact: true }).click();
  await page.locator("#book-mode").selectOption("detailed");
  await expect(page.locator("#setting-resolution")).toHaveValue("2048");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#book-mode")).toHaveValue("pixel");
  await page.locator("#book-resolution").selectOption("32");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.locator("#book-resolution")).toHaveValue("32");
  await page.getByRole("button", { name: "+ Style", exact: true }).click();
  await page.getByRole("button", { name: "Create style", exact: true }).click();
  const bold = await loadedPreview(page);
  expect(bold.family).not.toBe(first.family);
  await page.getByRole("button", { name: "Clear all…", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Clear all", exact: true })).toContainText("Are you sure you want to clear all?");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute("data-status", "drawn");
  await page.getByRole("button", { name: "Clear all…", exact: true }).click();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute("data-status", "unfinished");
  await expect(page.locator("#quick-output .missing")).toHaveCount(4);
  await page.locator('.toolbar [data-command="undo"]').click();
  await loadedPreview(page);
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute("data-status", "drawn");
  await page.locator('.toolbar [data-command="redo"]').click();
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute("data-status", "unfinished");
  await page.locator('.toolbar [data-command="undo"]').click();
  await page.locator("#style-select").selectOption({ label: "Regular" });
  await loadedPreview(page);
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute("data-status", "drawn");
  await draw(page, 66);
  await page.locator("#quick-text").fill("AB");
  const latest = await loadedPreview(page);
  expect(latest.family).not.toBe(first.family);
  await expect(page.locator("#quick-output .missing")).toHaveCount(0);
  await page.evaluate(() => delete window.showSaveFilePicker);
  await expect(page.locator(".split > button")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".save-menu")).toHaveAttribute("open", "");
  const download = page.waitForEvent("download");
  await page.locator('.save-menu [data-command="save"]').click();
  const files = unzipSync(new Uint8Array(await readFile(await (await download).path())));
  const project = JSON.parse(strFromU8(files["project.json"]));
  expect(project.name).toBe("Sidebar family");
  expect(project.settings.resolution).toBe(32);
  expect(project.glyphs[65]).toBeTruthy();
  expect(project.glyphs[66]).toBeTruthy();
  expect(Object.values(project.styles)[0].glyphs[65]).toBeTruthy();
  expect(errors).toEqual([]);
});

for (const [name, width, height] of [["iPad", 834, 1194], ["phone", 390, 844], ["small phone", 320, 568]]) {
  test(`${name} book panel, style controls and Save stay usable`, async ({ browser, browserName }, info) => {
    test.skip(browserName === "firefox", "Firefox does not emulate mobile contexts.");
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await openBook(page);
      if (width <= 700) {
        await expect(page.locator(".book-sidebar")).toBeHidden();
        await page.locator("#toggle-book-panel").tap();
      }
      await expect(page.locator("#book-name")).toBeVisible();
      await page.locator("#book-name").fill("My lettering");
      await page.locator("#quick-text").fill("Hello world");
      await expect(page.locator("#quick-output .missing")).toHaveCount(10);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath("book-panel.png"), scale: "css" });
      if (width <= 700) await page.locator("#toggle-book-panel").tap();
      const style = await page.locator("#style-select").boundingBox();
      expect(style.x).toBeGreaterThanOrEqual(0);
      expect(style.x + style.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath("book.png"), scale: "css" });
      await page.getByRole("button", { name: "Save", exact: true }).tap();
      const menu = await page.locator(".save-menu .menu-pop").boundingBox();
      expect(menu.x).toBeGreaterThanOrEqual(0);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height);
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    } finally { await context.close(); }
  });
}
