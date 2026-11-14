import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
try {
  const page = await browser.newPage();
  for (const name of ["arrow", "link", "text", "crosshair"]) {
    const svg = await readFile(`assets/cursors/xp-${name}.svg`);
    const png = await page.evaluate(async source => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    }, `data:image/svg+xml;base64,${svg.toString("base64")}`);
    await writeFile(`assets/cursors/xp-${name}.png`, Buffer.from(png, "base64"));
  }
} finally {
  await browser.close();
}
