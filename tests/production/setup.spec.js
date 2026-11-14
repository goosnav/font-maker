import { test, expect } from "@playwright/test";
async function setup(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New font", exact: true }).click();
  await page.getByRole("button", { name: "Try settings", exact: true }).click();
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
  expect(await choice.locator(".reference-name").evaluate(e => getComputedStyle(e).fontFamily)).toContain("gfn-unifraktur");
  await choice.click();
  await expect(page.locator("#setting-reference")).toHaveValue("unifraktur");
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
  expect(await pixels(page)).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Start drawing", exact: true }).click();
  await page.locator('[data-cp="65"]').click();
  await expect(page.locator("#editor-reference")).toHaveValue("unifraktur");
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
});
