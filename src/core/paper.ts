import { createId } from "./id";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  isSpace,
  isScalar,
  isMark,
  type Character,
  type Project,
  type Template,
} from "./model";
import { sourceData, canvas, readImage } from "./fonts";
// Version 1 geometry stays available for sheets printed before the label correction.
export const PAGE = {
  width: 612,
  height: 792,
  columns: 5,
  rows: 6,
  left: 42,
  top: 124,
  stepX: 108,
  stepY: 104,
  cell: 82,
};
export function cellRect(index: number, version: 1 | 2 = 2) {
  return {
    x: PAGE.left + (index % 5) * PAGE.stepX,
    y: (version === 1 ? 112 : PAGE.top) + Math.floor(index / 5) * PAGE.stepY,
    w: version === 1 ? 96 : PAGE.cell,
    h: version === 1 ? 96 : PAGE.cell,
  };
}
export function makeTemplate(p: Project, cps: number[]): Template {
  const characters = [...new Set(cps)].filter(
    (cp) => isScalar(cp) && !isSpace(cp),
  );
  return {
    id: createId(),
    version: 2,
    characters,
    pages: Array.from({ length: Math.ceil(characters.length / 30) }, (_, i) =>
      characters.slice(i * 30, (i + 1) * 30),
    ),
    settings: structuredClone(p.settings),
  };
}
export function paperName(cp: number, name?: string) {
  if (!name) return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  if (/^LATIN (CAPITAL|SMALL) LETTER /.test(name)) {
    const rest = name
      .replace(/^LATIN (CAPITAL|SMALL) LETTER /, "")
      .toLowerCase();
    return `${name.includes("CAPITAL") ? "Uppercase" : "Lowercase"} ${name.includes("CAPITAL") ? rest.charAt(0).toUpperCase() + rest.slice(1) : rest}`;
  }
  return name.charAt(0) + name.slice(1).toLowerCase();
}
function labelLines(text: string, font: PDFFont, width: number, size: number) {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.at(-1);
    if (last && font.widthOfTextAtSize(last + " " + word, size) <= width)
      lines[lines.length - 1] += " " + word;
    else lines.push(word);
  }
  return lines;
}
function guides(
  page: PDFPage,
  r: { x: number; y: number; w: number; h: number },
  t: Template,
) {
  page.drawRectangle({
    x: r.x,
    y: 792 - r.y - r.h,
    width: r.w,
    height: r.h,
    borderWidth: 0.4,
    borderColor: rgb(0.76, 0.84, 0.94),
  });
  for (const y of [
    t.settings.ascender,
    t.settings.capHeight,
    t.settings.xHeight,
    0,
    -t.settings.descender,
  ]) {
    const py = 792 - (r.y + ((2048 - y) / 3072) * r.h);
    if (py < 792 - r.y - r.h || py > 792 - r.y) continue;
    page.drawLine({
      start: { x: r.x, y: py },
      end: { x: r.x + r.w, y: py },
      thickness: y === 0 ? 0.7 : 0.3,
      color: rgb(0.64, 0.77, 0.94),
      dashArray: y === 0 ? undefined : [2, 2],
    });
  }
}
export async function templatePdf(
  p: Project,
  t: Template,
  catalog?: Character[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Variable Noto Sans loses outlines with fontkit's subset encoder. Embed it intact.
  const data = await sourceData("noto-sans");
  const font = await doc.embedFont(data, { subset: false });
  const mathResponse = await fetch("/fonts/noto-sans-math.ttf");
  if (!mathResponse.ok)
    throw Error(
      "The printed symbol font could not be loaded. Retry the download.",
    );
  const sources = [
    data,
    await sourceData("liberation-sans"),
    await mathResponse.arrayBuffer(),
  ];
  const sourceFonts = sources.map((bytes) =>
    fontkit.create(new Uint8Array(bytes)),
  );
  const pdfFonts = new Map<number, PDFFont>([[0, font]]);
  if (!catalog) {
    const response = await fetch("/catalog.json");
    if (!response.ok)
      throw Error("Character names could not be loaded. Retry the download.");
    catalog = (await response.json()).characters;
  }
  const names = new Map(catalog!.map((c) => [c.cp, c.name]));
  doc.setTitle(`${p.name} drawing sheets`);
  doc.setCreator("Goosnav Font");
  for (let index = 0; index < t.pages.length; index++) {
    const page = doc.addPage([612, 792]),
      codes = t.pages[index];
    page.drawText("Goosnav Font", { x: 58, y: 738, size: 15, font });
    const family = `${p.name} / ${p.styleName}`;
    page.drawText(family, {
      x: 58,
      y: 724,
      size: Math.min(8, 195 / font.widthOfTextAtSize(family, 1)),
      font,
    });
    page.drawText("Draw the character named below each box.", {
      x: 42,
      y: 704,
      size: 8,
      font,
    });
    page.drawText("Use dark ink. Keep strokes inside the box.", {
      x: 42,
      y: 691,
      size: 8,
      font,
    });
    page.drawText("Print at 100%. Keep all four corner marks.", {
      x: 42,
      y: 678,
      size: 8,
      font,
    });
    const example = { x: 294, y: 46, w: 60, h: 60 };
    page.drawText("EXAMPLE", { x: 294, y: 754, size: 7, font });
    guides(page, example, t);
    const baseline = 792 - (example.y + (example.h * 2) / 3);
    const cap = (t.settings.capHeight * example.h) / 3072;
    const xheight = (t.settings.xHeight * example.h) / 3072;
    // Separate sizes align the capital and lowercase examples with this project's guides.
    page.drawText("A", {
      x: 298,
      y: baseline,
      size: cap / (sourceFonts[0].capHeight / sourceFonts[0].unitsPerEm),
      font,
    });
    page.drawText("g", {
      x: 324,
      y: baseline,
      size: xheight / (sourceFonts[0].xHeight / sourceFonts[0].unitsPerEm),
      font,
    });
    for (const [label, value] of [
      ["Cap height", t.settings.capHeight],
      ["x-height", t.settings.xHeight],
      ["Baseline", 0],
      ["Descender", -t.settings.descender],
    ] as [string, number][]) {
      page.drawText(label, {
        x: 360,
        y: 792 - (example.y + ((2048 - value) / 3072) * example.h) - 2,
        size: 7,
        font,
      });
    }
    const payload = JSON.stringify({
      v: t.version,
      id: t.id,
      page: index,
      c: codes,
    });
    const qr = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 300,
    });
    page.drawImage(await doc.embedPng(qr), {
      x: 486,
      y: 684,
      width: 72,
      height: 72,
    });
    page.drawText(`Sheet ${index + 1} of ${t.pages.length}`, {
      x: 486,
      y: 674,
      size: 8,
      font,
    });
    for (const [x, y] of [
      [42, 750],
      [570, 750],
      [42, 42],
      [570, 42],
    ])
      page.drawRectangle({
        x: x - 4,
        y: y - 4,
        width: 8,
        height: 8,
        color: rgb(0, 0, 0),
      });
    for (let i = 0; i < codes.length; i++) {
      const cp = codes[i],
        r = cellRect(i, t.version);
      guides(page, r, t);
      const face = sourceFonts.findIndex((f) => f.hasGlyphForCodePoint(cp));
      let text = paperName(cp, names.get(cp));
      if (face >= 0) {
        if (!pdfFonts.has(face))
          pdfFonts.set(
            face,
            await doc.embedFont(sources[face], { subset: false }),
          );
        const sampleFont = pdfFonts.get(face)!;
        const sample =
          (isMark(cp) && sourceFonts[face].hasGlyphForCodePoint(0x25cc)
            ? "◌"
            : "") + String.fromCodePoint(cp);
        const size = Math.min(13, 16 / sampleFont.widthOfTextAtSize(sample, 1));
        page.drawText(sample, {
          x: r.x + 2,
          y: 792 - r.y - r.h - 14,
          size,
          font: sampleFont,
        });
      } else text = `U+${cp.toString(16).toUpperCase()} - ${text}`;
      let size = 7.5,
        lines = labelLines(text, font, 80, size);
      while (lines.length > 2 && size > 6) {
        size -= 0.25;
        lines = labelLines(text, font, 80, size);
      }
      for (let j = 0; j < lines.length; j++)
        page.drawText(lines[j], {
          x: r.x + 21,
          y: 792 - r.y - r.h - (lines.length > 2 ? 4.5 : 7) - j * (size + (lines.length > 2 ? 0.5 : 1)),
          size,
          font,
        });
    }
  }
  return doc.save();
}
export type SheetCode = { v: 1 | 2; id: string; page: number; c: number[] };
function readSheetCode(
  c: HTMLCanvasElement,
): { code: SheetCode; turns: number } | undefined {
  const small = canvas(1);
  small.width = Math.min(c.width, 1800);
  small.height = Math.round((c.height * small.width) / c.width);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, small.width, small.height);
  const d = ctx.getImageData(0, 0, small.width, small.height),
    qr = jsQR(d.data, d.width, d.height);
  if (!qr) return;
  try {
    const code = JSON.parse(qr.data);
    if (
      (code.v === 1 || code.v === 2) &&
      typeof code.id === "string" &&
      Number.isInteger(code.page) &&
      code.page >= 0 &&
      Array.isArray(code.c) &&
      code.c.length <= 30 &&
      code.c.every(isScalar)
    ) {
      const a = qr.location.topLeftCorner,
        b = qr.location.topRightCorner;
      return {
        code,
        turns:
          (Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 2)) + 4) %
          4,
      };
    }
  } catch {}
  return;
}
export function scanCode(c: HTMLCanvasElement): SheetCode | undefined {
  return readSheetCode(c)?.code;
}
export function cleanInk(
  data: ImageData,
  threshold = 160,
  cleanup = 2,
): ImageData {
  const out = new ImageData(data.width, data.height),
    w = data.width,
    h = data.height;
  // Blue channel ignores the pale blue printed guides. A local paper estimate reduces shadows.
  const block = 32,
    cols = Math.ceil(w / block),
    rows = Math.ceil(h / block),
    background = new Float32Array(cols * rows);
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < cols; bx++) {
      const values: number[] = [];
      for (let y = by * block; y < Math.min(h, (by + 1) * block); y += 3)
        for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x += 3)
          values.push(data.data[(y * w + x) * 4 + 2]);
      values.sort((a, b) => a - b);
      background[by * cols + bx] =
        values[Math.floor(values.length * 0.85)] || 255;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4,
        bg = Math.max(
          40,
          background[Math.floor(y / block) * cols + Math.floor(x / block)],
        );
      const value = (data.data[i + 2] / bg) * 255;
      out.data[i + 3] = value < threshold ? 255 : 0;
    }
  if (cleanup > 0) {
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < seen.length; i++)
      if (out.data[i * 4 + 3] && !seen[i]) {
        const group = [i];
        seen[i] = 1;
        for (let j = 0; j < group.length; j++) {
          const n = group[j],
            x = n % w,
            y = Math.floor(n / w);
          for (const k of [
            x > 0 ? n - 1 : -1,
            x < w - 1 ? n + 1 : -1,
            y > 0 ? n - w : -1,
            y < h - 1 ? n + w : -1,
          ])
            if (k >= 0 && !seen[k] && out.data[k * 4 + 3]) {
              seen[k] = 1;
              group.push(k);
            }
        }
        if (group.length <= cleanup)
          for (const k of group) out.data[k * 4 + 3] = 0;
      }
  }
  return out;
}
export function inkWarnings(data: ImageData) {
  let count = 0,
    edge = false;
  for (let y = 0; y < data.height; y++)
    for (let x = 0; x < data.width; x++)
      if (data.data[(y * data.width + x) * 4 + 3]) {
        count++;
        if (x < 2 || y < 2 || x >= data.width - 2 || y >= data.height - 2)
          edge = true;
      }
  const warnings: string[] = [];
  if (count < Math.max(3, data.width * data.height * 0.0002))
    warnings.push("Empty or faint");
  if (edge) warnings.push("Touches cell edge");
  if (count > data.width * data.height * 0.55)
    warnings.push("Heavy background");
  return { count, warnings };
}
let scanWorker: Worker | undefined,
  serial = 0;
const pending = new Map<
  number,
  { resolve: (r: any) => void; reject: (e: Error) => void }
>();
async function rectifyRaw(
  source: HTMLCanvasElement,
  corners?: number[][],
): Promise<{ canvas: HTMLCanvasElement; corners: number[][] }> {
  if (!scanWorker) {
    scanWorker = new Worker("/engine/scan.worker.js");
    scanWorker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data);
      }
    };
    scanWorker.onerror = () => {
      for (const p of pending.values())
        p.reject(Error("Page correction engine failed."));
      pending.clear();
      scanWorker?.terminate();
      scanWorker = undefined;
    };
  }
  const image = source
    .getContext("2d")!
    .getImageData(0, 0, source.width, source.height);
  const id = ++serial;
  const result = await new Promise<any>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    scanWorker!.postMessage(
      {
        id,
        width: image.width,
        height: image.height,
        data: image.data,
        corners,
      },
      [image.data.buffer],
    );
  });
  const c = canvas(1);
  c.width = result.width;
  c.height = result.height;
  c.getContext("2d")!.putImageData(
    new ImageData(
      new Uint8ClampedArray(result.data),
      result.width,
      result.height,
    ),
    0,
    0,
  );
  return { canvas: c, corners: result.corners };
}
export async function rectify(
  source: HTMLCanvasElement,
  corners?: number[][],
): Promise<{ canvas: HTMLCanvasElement; corners: number[][] }> {
  const out = await rectifyRaw(source, corners),
    sheet = readSheetCode(out.canvas);
  if (sheet?.turns) {
    const ordered = [
      ...out.corners.slice(sheet.turns),
      ...out.corners.slice(0, sheet.turns),
    ];
    return rectifyRaw(source, ordered);
  }
  return out;
}
export async function* iteratePages(
  file: File,
): AsyncGenerator<HTMLCanvasElement> {
  if (file.size > 80 * 1024 * 1024)
    throw Error("Scan files must be under 80 MB.");
  const ext = file.name.split(".").pop()!.toLowerCase(),
    bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const task = pdfjs.getDocument({ data: bytes });
    const pdf = await task.promise;
    if (pdf.numPages > 100)
      throw Error("Import PDFs in batches of at most 100 pages.");
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i),
        vp = page.getViewport({ scale: 2.5 });
      if (vp.width * vp.height > 30_000_000)
        throw Error("PDF page is too large.");
      const c = canvas(1);
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      await page.render({
        canvas: c,
        canvasContext: c.getContext("2d")!,
        viewport: vp,
      }).promise;
      yield c;
      page.cleanup();
    }
    await task.destroy();
    return;
  }
  if (ext === "tif" || ext === "tiff") {
    const UTIF = await import("utif");
    const api = UTIF.default || UTIF;
    const ifds = api.decode(bytes.buffer);
    for (const ifd of ifds) {
      if (ifd.t256?.[0] * ifd.t257?.[0] > 40_000_000)
        throw Error("TIFF page exceeds 40 megapixels.");
      api.decodeImage(bytes.buffer, ifd);
      const c = canvas(1);
      c.width = ifd.width;
      c.height = ifd.height;
      c.getContext("2d")!.putImageData(
        new ImageData(
          new Uint8ClampedArray(api.toRGBA8(ifd)),
          c.width,
          c.height,
        ),
        0,
        0,
      );
      yield c;
    }
    return;
  }
  if (ext === "heic" || ext === "heif") {
    const lib = await import("libheif-js/wasm-bundle");
    const heif = (lib.default || lib) as any;
    const decoder = new heif.HeifDecoder();
    const images = decoder.decode(bytes);
    for (const image of images) {
      const w = image.get_width(),
        h = image.get_height();
      if (w * h > 40_000_000) throw Error("Photo exceeds 40 megapixels.");
      const data = new ImageData(w, h);
      await new Promise<void>((resolve, reject) =>
        image.display(data, (result: ImageData) =>
          result
            ? resolve()
            : reject(Error("HEIC image could not be decoded.")),
        ),
      );
      const c = canvas(1);
      c.width = w;
      c.height = h;
      c.getContext("2d")!.putImageData(data, 0, 0);
      yield c;
      image.free();
    }
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await readImage(url);
    if (img.width * img.height > 40_000_000)
      throw Error("Photo exceeds 40 megapixels.");
    const c = canvas(1);
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    yield c;
    return;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodePages(file: File): Promise<HTMLCanvasElement[]> {
  const pages: HTMLCanvasElement[] = [];
  for await (const page of iteratePages(file)) pages.push(page);
  return pages;
}
