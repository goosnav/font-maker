import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Keep the Goosnav vector silhouette, sampled onto a small XP-era icon grid.
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
try {
  const page = await browser.newPage();
  await mkdir("assets", { recursive: true });
  for (const [name, source, size] of [
    ["goosnav-logo-xp", "public/brand/logo.svg", 48],
    ["goosnav-logo-xp-icon", "public/brand/logo-icon.svg", 24],
  ]) {
    const sourceUrl = `data:image/svg+xml;base64,${Buffer.from(await readFile(source)).toString("base64")}`;
    const result = await page.evaluate(async ({ sourceUrl, size }) => {
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      const pixels = ctx.getImageData(0, 0, size, size);
      const levels = [0, 85, 170, 255];
      const paths = new Map();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const alpha = levels[Math.round(pixels.data[i + 3] / 85)];
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 17;
          pixels.data[i + 3] = alpha;
          if (alpha) paths.set(alpha, (paths.get(alpha) || "") + `M${x} ${y}h1v1h-1z`);
        }
      }
      ctx.putImageData(pixels, 0, 0);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><title>Goosnav XP logo</title>${[...paths].map(([alpha, d]) => `<path fill="#111" fill-opacity="${alpha / 255}" d="${d}"/>`).join("")}</svg>\n`;
      return { png: canvas.toDataURL("image/png").split(",")[1], svg };
    }, { sourceUrl, size });
    await writeFile(`assets/${name}.png`, Buffer.from(result.png, "base64"));
    await writeFile(`assets/${name}.svg`, result.svg);
    console.log(`${name}: ${size} × ${size}, transparent, four coverage levels`);
  }
} finally {
  await browser.close();
}
