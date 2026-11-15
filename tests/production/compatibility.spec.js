import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("missing randomUUID supports startup, styles, font imports, paper, scans and recovery", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  });
  // Keep the local recovery slot isolated from concurrently running browser tests.
  let recovery;
  await page.route("**/api/recovery", async route => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 204 });
    else await route.fulfill(recovery ? { body: recovery } : { status: 404 });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  await expect(page.locator(".welcome-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Continue drawing" }).click();
  await page.getByRole("button", { name: "+ Style", exact: true }).click();
  await page.getByRole("button", { name: "Create style", exact: true }).click();
  await expect(page.locator("#style-select option")).toHaveCount(2);
  await page.locator("#import-font-file").setInputFiles("public/fonts/liberation-sans.ttf");
  // Font inspection includes the first Pyodide load on a fresh browser.
  await expect(page.getByRole("radio", { name: "Reference only", exact: true })).toBeChecked({ timeout: 60000 });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator('[data-cp="65"]').click();
  await expect(page.locator(".paint-canvas")).toHaveAttribute("data-reference", "ready");
  const box = await page.locator(".paint-canvas").boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await expect(page.locator("#save-state")).toHaveText("Recovery saved");
  await page.evaluate(() => delete window.showSaveFilePicker);
  const saved = page.waitForEvent("download");
  await page.locator(".save-menu summary").click();
  await page.locator('.split [data-command="save"]').click();
  recovery = await readFile(await (await saved).path());
  await page.reload();
  await page.getByRole("button", { name: "Continue drawing" }).click();
  await expect(page.locator("#style-select option")).toHaveCount(2);
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute("data-status", "drawn");
  await page.getByRole("tab", { name: "Paper", exact: true }).click();
  await page.locator("#paper-set").selectOption("selected");
  for (const box of await page.locator("#paper-packs input").all()) await box.uncheck();
  await page.locator('#paper-packs input[value="currency"]').check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download sheets", exact: true }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  await page.locator("#scan-file").setInputFiles({
    name: pdf.suggestedFilename(), mimeType: "application/pdf", buffer: await readFile(await pdf.path()),
  });
  await expect(page.getByRole("dialog", { name: "Align sheet 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator(".save-menu summary").click();
  await page.locator('.split [data-command="export"]').click();
  await page.locator("#export-format").selectOption("ttf");
  const font = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await font).suggestedFilename()).toMatch(/\.ttf$/);
  await expect(page.getByRole("dialog", { name: "Could not finish" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
