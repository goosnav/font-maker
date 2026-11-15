import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
test("ultra-fine drawing retains resolution, zoom detail and loadable TTF/OTF curves", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.route("**/api/recovery", (r) =>
    r.fulfill({ status: r.request().method() === "PUT" ? 204 : 404 }),
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New font", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#setting-mode").selectOption("detailed");
  await expect(page.locator("#setting-resolution")).toHaveValue("2048");
  await page.locator("#setting-resolution").selectOption("4096");
  await expect(page.locator(".paint-canvas")).toHaveAttribute(
    "data-reference",
    "ready",
  );
  await page
    .getByRole("button", { name: "Start drawing", exact: true })
    .click();
  await page.locator('[data-cp="79"]').click();
  await expect(page.locator(".paint-canvas")).toHaveAttribute(
    "data-reference",
    "ready",
  );
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  const box = await page.locator(".paint-canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, {
    steps: 4,
  });
  await page.mouse.up();
  const before = await page.locator(".paint-canvas").evaluate((c) => c.width);
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(
    await page.locator(".paint-canvas").evaluate((c) => c.width),
  ).toBeGreaterThan(before);
  expect(
    await page
      .locator(".paint-canvas")
      .evaluate((c) => getComputedStyle(c).imageRendering),
  ).toBe("auto");
  await page.evaluate(() => delete window.showSaveFilePicker);
  const saved = page.waitForEvent("download");
  await page.locator(".save-menu summary").click();
  await page.locator('.split [data-command="save"]').click();
  const archive = unzipSync(
    new Uint8Array(await readFile(await (await saved).path())),
  );
  const project = JSON.parse(strFromU8(archive["project.json"]));
  expect(project.settings.resolution).toBe(4096);
  const imageName = project.glyphs[79].bitmap;
  // Portable archives store bitmap data as paths; inspect the actual PNG dimensions.
  const png = Buffer.from(archive[imageName.slice(1)]);
  expect(png.readUInt32BE(16)).toBe(6144);
  await page.locator(".save-menu summary").click();
  await page.locator('.split [data-command="export"]').click();
  await page.locator("#export-format").selectOption("both");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const files = unzipSync(
    new Uint8Array(await readFile(await (await download).path())),
  );
  const fonts = Object.entries(files).filter(([name]) =>
    /\.(ttf|otf)$/.test(name),
  );
  expect(fonts).toHaveLength(2);
  for (const [name, bytes] of fonts) {
    const fidelity = await page.evaluate(
      async ({ name, bytes, png }) => {
        const face = new FontFace(name, new Uint8Array(bytes));
        await face.load();
        document.fonts.add(face);
        const image = await createImageBitmap(
          new Blob([new Uint8Array(png)], { type: "image/png" }),
        );
        const size = 1024,
          a = document.createElement("canvas"),
          b = document.createElement("canvas");
        a.width = a.height = b.width = b.height = size;
        a.getContext("2d").drawImage(image, 0, 0, size, size);
        image.close();
        const ctx = b.getContext("2d");
        ctx.font = `${size / 1.5}px "${name}"`;
        ctx.fillText("O", size / 6, (size * 2) / 3);
        const aa = a.getContext("2d").getImageData(0, 0, size, size).data,
          bb = ctx.getImageData(0, 0, size, size).data;
        let intersection = 0,
          union = 0;
        for (let i = 3; i < aa.length; i += 4) {
          const x = aa[i] > 127,
            y = bb[i] > 127;
          if (x || y) union++;
          if (x && y) intersection++;
        }
        return {
          // Canvas and font rasterizers differ by up to two screen pixels in Firefox.
          // Assert bounded geometry on both sides, rather than exact antialiasing.
          outsideTolerance: (() => {
            let outside = 0;
            for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
              const i = (y * size + x) * 4 + 3;
              for (const [source, target] of [[aa, bb], [bb, aa]]) {
                if (source[i] <= 127) continue;
                let found = false;
                for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2; dx++)
                  if (target[((y + dy) * size + x + dx) * 4 + 3] > 127) { found = true; break; }
                if (!found) outside++;
              }
            }
            return outside;
          })(),
          loaded: face.status,
          iou: intersection / union,
          counter:
            bb[
              (Math.floor(size * 0.45) * size + Math.floor(size * 0.45)) * 4 + 3
            ],
        };
      },
      { name, bytes: Array.from(bytes), png: Array.from(png) },
    );
    expect(fidelity.loaded).toBe("loaded");
    expect(fidelity.iou).toBeGreaterThan(0.90);
    expect(fidelity.outsideTolerance).toBe(0);
    expect(fidelity.counter).toBe(0);
  }
  expect(errors).toEqual([]);
});
