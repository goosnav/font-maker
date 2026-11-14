import { test, expect } from "@playwright/test";
test("paint, create a style referencing Regular, save and reopen the family", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New font", exact: true }).click();
  await page.locator("#new-name").fill("Family Test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Start drawing", exact: true })
    .click();
  await expect(page.locator(".glyph-cell")).toHaveCount(853);
  await page.locator('[data-cp="65"]').click();
  await page.waitForTimeout(500);
  const box = await page.locator(".paint-canvas").boundingBox();
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 450, { steps: 12 });
  await page.mouse.up();
  await page.getByRole("button", { name: "+ Style", exact: true }).click();
  await page.getByRole("button", { name: "Create style", exact: true }).click();
  await expect(page.locator("#style-select")).toHaveValue(/.+/);
  await expect(page.locator("#editor-reference")).toHaveValue(/^style:/);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await page.locator("#preview-text").fill("AA");
  await expect(page.locator("#preview-state")).toHaveText(
    "All characters are present",
    { timeout: 30000 },
  );
  // The download fallback is used on every browser for the same portable format.
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined;
  });
  // Delete the property because the application uses capability detection.
  await page.evaluate(() => delete window.showSaveFilePicker);
  const event = page.waitForEvent("download");
  await page.locator(".split>button").click();
  const download = await event;
  const path = await download.path();
  expect(download.suggestedFilename()).toBe("Family Test.goosnavfont");
  await page.locator("#open-project-file").setInputFiles(path);
  await expect(page.locator("#style-select option")).toHaveCount(2);
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute(
    "data-status",
    "drawn",
  );
  await expect(page.locator("#save-state")).toHaveText("Recovery saved");
  await page.reload();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator("#style-select option")).toHaveCount(2);
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute(
    "data-status",
    "drawn",
  );
});
test("custom fonts survive round trip and pixel conversion; both formats load", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const m = await import("/src/core/model.ts"),
      f = await import("/src/core/fonts.ts"),
      s = await import("/src/core/storage.ts");
    const data = new Uint8Array(
      await (await fetch("/fonts/liberation-sans.ttf")).arrayBuffer(),
    );
    const p = m.newProject("Imported Custom", [32, 65, 66, 937, 1046]);
    const id = "import-" + crypto.randomUUID();
    p.fonts.push({
      id,
      name: "Uploaded Sans",
      filename: "custom.ttf",
      data: f.toBase64(data),
      copyright: "Source notice",
      license: "OFL",
    });
    p.settings.reference = id;
    p.settings.mode = "detailed";
    p.settings.resolution = 1024;
    await f.seedProject(p, id);
    const original = p.glyphs[65].base;
    m.addStyle(p, "Bold", true);
    const regular = p.settings.reference;
    const converted = await f.convertResolution(p, {
      ...p.settings,
      mode: "pixel",
      resolution: 16,
    });
    const bytes = await s.encodeProject(converted),
      restored = s.decodeProject(bytes);
    const ttf = await f.buildFont(restored, "ttf"),
      otf = await f.buildFont(restored, "otf");
    for (const [i, data] of [ttf, otf].entries()) {
      const face = new FontFace("roundtrip" + i, data.buffer);
      await face.load();
      document.fonts.add(face);
    }
    return {
      styles: m.allStyles(restored).length,
      fonts: restored.fonts.length,
      original,
      regular,
      bitmap: restored.glyphs[65].bitmap.startsWith("data:image/png"),
      ttf: Array.from(ttf.slice(0, 4)),
      otf: new TextDecoder().decode(otf.slice(0, 4)),
      source: restored.fonts[0].data === f.toBase64(data),
    };
  });
  expect(result.styles).toBe(2);
  expect(result.fonts).toBe(1);
  expect(result.source).toBe(true);
  expect(result.regular).toMatch(/^style:/);
  expect(result.bitmap).toBe(true);
  expect(result.ttf).toEqual([0, 1, 0, 0]);
  expect(result.otf).toBe("OTTO");
});
test("letter PDF round trip identifies characters and removes empty guide cells", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const m = await import("/src/core/model.ts"),
      paper = await import("/src/core/paper.ts");
    const p = m.newProject("Scanned Test", [65, 66, 937, 1046]);
    const template = paper.makeTemplate(p, p.characters);
    const pdf = await paper.templatePdf(p, template);
    const pages = await paper.decodePages(new File([pdf], "sheets.pdf"));
    const source = pages[0],
      ctx = source.getContext("2d");
    const r = paper.cellRect(0),
      scale = source.width / 612;
    ctx.fillStyle = "black";
    ctx.fillRect((r.x + 30) * scale, (r.y + 30) * scale, 8 * scale, 40 * scale);
    const out = await paper.rectify(source, [
      [0, 0],
      [source.width, 0],
      [source.width, source.height],
      [0, source.height],
    ]);
    const code = paper.scanCode(out.canvas);
    const c = out.canvas.getContext("2d");
    const crop = (i) => {
      const r = paper.cellRect(i),
        scale = out.canvas.width / 612;
      return c.getImageData(
        Math.round(r.x * scale),
        Math.round(r.y * scale),
        Math.round(r.w * scale),
        Math.round(r.h * scale),
      );
    };
    return {
      code,
      ink: paper.inkWarnings(paper.cleanInk(crop(0))).count,
      empty: paper.inkWarnings(paper.cleanInk(crop(1))).count,
      pages: pages.length,
    };
  });
  expect(result.pages).toBe(1);
  expect(result.code.c).toEqual([65, 66, 937, 1046]);
  expect(result.ink).toBeGreaterThan(100);
  expect(result.empty).toBeLessThan(10);
});
test("help search and narrow layout remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Help", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search help" }).fill("styles");
  await expect(page.locator(".help-item")).not.toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("rotated and shadowed sheets retain their cell mapping", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const m = await import("/src/core/model.ts"),
      paper = await import("/src/core/paper.ts"),
      storage = await import("/src/core/storage.ts"),
      fonts = await import("/src/core/fonts.ts");
    const p = m.newProject("Photo test", [65, 66]),
      template = paper.makeTemplate(p, p.characters),
      pdf = await paper.templatePdf(p, template);
    p.templates.push(template);
    const [source] = await paper.decodePages(new File([pdf], "sheet.pdf"));
    const ctx = source.getContext("2d"),
      r = paper.cellRect(0),
      scale = source.width / 612;
    ctx.fillStyle = "black";
    ctx.fillRect(
      (r.x + 25) * scale,
      (r.y + 30) * scale,
      10 * scale,
      35 * scale,
    );
    const original = source.toDataURL().split(",")[1];
    p.scans.push({
      id: crypto.randomUUID(),
      name: "Original.png",
      mime: "image/png",
      data: original,
    });
    const recovered = storage.decodeProject(await storage.encodeProject(p));
    const grad = ctx.createLinearGradient(0, 0, source.width, 0);
    grad.addColorStop(0, "#0008");
    grad.addColorStop(1, "#0000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, source.width, source.height);
    const rotated = document.createElement("canvas");
    rotated.width = source.height;
    rotated.height = source.width;
    const rc = rotated.getContext("2d");
    rc.translate(rotated.width, 0);
    rc.rotate(Math.PI / 2);
    rc.drawImage(source, 0, 0);
    const aligned = await paper.rectify(rotated);
    const a = aligned.canvas.getContext("2d"),
      s = aligned.canvas.width / 612;
    const count = (i) => {
      const r = paper.cellRect(i);
      return paper.inkWarnings(
        paper.cleanInk(
          a.getImageData(
            Math.round(r.x * s),
            Math.round(r.y * s),
            Math.round(r.w * s),
            Math.round(r.h * s),
          ),
        ),
      ).count;
    };
    return {
      code: paper.scanCode(aligned.canvas),
      ink: count(0),
      empty: count(1),
      original: recovered.scans[0].data === original,
      template: recovered.templates[0].id === template.id,
    };
  });
  expect(result.code.c).toEqual([65, 66]);
  expect(result.ink).toBeGreaterThan(100);
  expect(result.empty).toBeLessThan(10);
  expect(result.original).toBe(true);
  expect(result.template).toBe(true);
});
