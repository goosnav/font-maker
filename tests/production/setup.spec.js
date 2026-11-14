import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  // Each independent test starts with an empty local recovery slot.
  await page.route("**/api/recovery", route => route.request().method() === "GET"
    ? route.fulfill({ status: 404 }) : route.continue());
});
async function setup(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New font", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
}
async function draw(page) {
  const box = await page.locator(".paint-canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6, { steps: 10 });
  await page.mouse.up();
}
const pixels = page => page.locator(".paint-canvas").evaluate(c => Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data).reduce((n, v, i, a) => n + (i % 4 === 0 && a[i+2] > v + 8 ? 1 : 0), 0));
test("built local app shows reference independently of engine and retries a failed font test without losing ink", async ({ page }) => {
  const outbound = [];
  page.on("request", r => { if (!r.url().startsWith("http://127.0.0.1:5183") && !/^(data|blob):/.test(r.url())) outbound.push(r.url()); });
  await page.route("**/engine/font.worker.js", route => route.abort());
  await setup(page);
  expect(await pixels(page)).toBeGreaterThan(1000);
  await draw(page);
  const before = await page.locator(".paint-canvas").evaluate(c => c.toDataURL());
  await page.locator("#sample-test").click();
  await expect(page.locator("#sample-notice")).toContainText("could not start", { timeout: 15000 });
  expect(await page.locator(".paint-canvas").evaluate(c => c.toDataURL())).toBe(before);
  await page.unroute("**/engine/font.worker.js");
  await page.locator("#sample-test").click();
  await expect(page.locator("#sample-notice")).toHaveText("Font test passed.", { timeout: 60000 });
  await expect(page.locator("#sample-text")).toHaveText("HHH");
  const family = await page.locator("#sample-text").evaluate(e => getComputedStyle(e).fontFamily);
  expect(family).toContain("settings-preview-");
  expect(await page.evaluate(f => document.fonts.check(`32px ${f}`), family)).toBe(true);
  expect(outbound).toEqual([]);
});
test("reference picker renders actual font faces and supports Old English and overlay toggles", async ({ page }) => {
  await setup(page);
  const shown = await pixels(page);
  await page.locator("#setting-ref-visible").uncheck();
  expect(await pixels(page)).toBeLessThan(shown / 4);
  await page.locator("#setting-ref-visible").check();
  await page.getByRole("button", { name: "Choose reference font" }).click();
  const choice = page.locator('[data-reference="unifraktur"]');
  await expect(choice).toHaveAttribute("data-loaded", "true");
  await expect(choice).toContainText("Old English");
  await expect(choice.locator(".reference-name svg")).toHaveAttribute("data-font", "unifraktur");
  await choice.click();
  await expect(page.locator("#setting-reference")).toHaveValue("unifraktur");
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
  expect(await pixels(page)).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Start drawing", exact: true }).click();
  await page.locator('[data-cp="65"]').click();
  await expect(page.locator("#editor-reference")).toHaveValue("unifraktur");
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
});


test("every reference has distinct rendered outlines even when native font loading fails", async ({ page }) => {
  await page.addInitScript(() => { window.FontFace = class { constructor() { throw Error("Native font loading unavailable"); } }; });
  await setup(page);
  await page.getByRole("button", { name: "Choose reference font" }).click();
  await expect(page.locator('.reference-choice[data-loaded="true"]')).toHaveCount(7);
  const samples = await page.locator(".reference-example svg").evaluateAll(async elements => {
    return Promise.all(elements.map(async svg => {
      const image = new Image();
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 60;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 200, 60).data;
      return { raster: canvas.toDataURL(), ink: pixels.filter((v, i) => i % 4 === 3 && v > 0).length };
    }));
  });
  expect(samples).toHaveLength(7);
  expect(new Set(samples.map(sample => sample.raster)).size).toBe(7);
  expect(samples.every(sample => sample.ink > 300)).toBe(true);
  await expect(page.locator('.reference-name svg[data-font="unifraktur"]')).toHaveCount(1);
});

test("preview failure is visible and retry loads the real font", async ({ page }) => {
  await page.route("**/fonts/liberation-serif.ttf", route => route.fulfill({ body: "damaged font" }));
  await page.goto("/");
  await page.getByRole("button", { name: "New font", exact: true }).click();
  await page.getByRole("button", { name: "Choose reference font" }).click();
  const serif = page.locator('[data-reference="liberation-serif"]');
  await expect(serif).toHaveAttribute("data-loaded", "error");
  await expect(serif).toContainText("Click to retry");
  await expect(serif.locator("svg")).toHaveCount(0);
  await page.unroute("**/fonts/liberation-serif.ttf");
  await serif.click();
  await expect(serif).toHaveAttribute("data-loaded", "true");
  await expect(serif.locator("svg")).toHaveCount(2);
  await serif.click();
  await expect(page.locator("#new-reference")).toHaveValue("liberation-serif");
});

test("Continue opens seeded settings immediately and a failed import preserves the draft for retry", async ({ page }) => {
  await page.route("**/engine/font.worker.js", route => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "New font", exact: true }).click();
  await page.locator("#new-name").fill("Draft survives");
  await page.getByRole("radio", { name: "Start from font", exact: true }).check();
  for (const box of await page.locator('[name="pack"]').all()) await box.uncheck();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#new-error")).toHaveText("Select at least one character pack.");
  await page.locator('[name="pack"]').first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#setting-family")).toHaveValue("Draft survives");
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
  await draw(page);
  const before = await page.locator(".paint-canvas").evaluate(c => c.toDataURL());
  await page.getByRole("button", { name: "Start drawing", exact: true }).click();
  await expect(page.locator("#sample-notice")).toContainText("could not start", { timeout: 15000 });
  await expect(page.locator("#setting-family")).toHaveValue("Draft survives");
  expect(await page.locator(".paint-canvas").evaluate(c => c.toDataURL())).toBe(before);
  await page.unroute("**/engine/font.worker.js");
  await page.getByRole("button", { name: "Start drawing", exact: true }).click();
  await expect(page.locator(".settings-dialog")).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator(".glyph-grid")).toBeVisible({ timeout: 60000 });
  await expect(page.locator('[data-cp="72"]')).toHaveAttribute("data-status", "drawn");
  expect(await page.locator('[data-status="inherited"]').count()).toBeGreaterThan(20);
});
