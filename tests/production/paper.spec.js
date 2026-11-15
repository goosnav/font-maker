import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("downloaded sheets render complete labels and example without ink in empty cells", async ({
  page,
}) => {
  await page.route("**/api/recovery", (r) =>
    r.fulfill({ status: r.request().method() === "PUT" ? 204 : 404 }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Continue drawing" }).click();
  await page.getByRole("tab", { name: "Paper", exact: true }).click();
  await page.locator("#paper-set").selectOption("selected");
  for (const box of await page.locator("#paper-packs input").all())
    await box.uncheck();
  await page.locator('#paper-packs input[value="latin"]').check();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download sheets", exact: true })
    .click();
  const pdf = await downloaded;
  await page
    .locator("#scan-file")
    .setInputFiles({
      name: pdf.suggestedFilename(),
      mimeType: "application/pdf",
      buffer: await readFile(await pdf.path()),
    });
  await expect(
    page.getByRole("dialog", { name: "Align sheet 1", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const result = await page.locator("#corners").evaluate((c) => {
    const ctx = c.getContext("2d"),
      scale = c.width / 612;
    const count = (x, y, w, h) => {
      const pixels = ctx.getImageData(
        Math.round(x * scale),
        Math.round(y * scale),
        Math.round(w * scale),
        Math.round(h * scale),
      ).data;
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) n++;
      return n;
    };
    return {
      title: count(58, 40, 190, 18),
      example: count(295, 47, 58, 58),
      labels: Array.from({ length: 5 }, (_, i) =>
        count(42 + i * 108, 206, 100, 21),
      ),
      empty: count(44, 126, 78, 78),
    };
  });
  expect(result.title).toBeGreaterThan(400);
  expect(result.example).toBeGreaterThan(400);
  for (const label of result.labels) expect(label).toBeGreaterThan(80);
  expect(result.empty).toBe(0);
});
