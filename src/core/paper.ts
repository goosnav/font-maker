import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { isSpace, isScalar, type Project, type Template } from "./model";
import { sourceData, canvas, readImage } from "./fonts";
export const PAGE = {
  width: 612,
  height: 792,
  columns: 5,
  rows: 6,
  left: 42,
  top: 112,
  stepX: 108,
  stepY: 104,
  cell: 96,
};
export function cellRect(index: number) {
  return {
    x: PAGE.left + (index % 5) * PAGE.stepX,
    y: PAGE.top + Math.floor(index / 5) * PAGE.stepY,
    w: PAGE.cell,
    h: PAGE.cell,
  };
}
export function makeTemplate(p: Project, cps: number[]): Template {
  const characters = [...new Set(cps)].filter(
    (cp) => isScalar(cp) && !isSpace(cp),
  );
  return {
    id: crypto.randomUUID(),
    version: 1,
    characters,
    pages: Array.from({ length: Math.ceil(characters.length / 30) }, (_, i) =>
      characters.slice(i * 30, (i + 1) * 30),
    ),
    settings: structuredClone(p.settings),
  };
}
export async function templatePdf(
  p: Project,
  t: Template,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await sourceData("noto-sans"), {
    subset: true,
  });
  doc.setTitle(`${p.name} drawing sheets`);
  doc.setCreator("Goosnav Font");
  for (let index = 0; index < t.pages.length; index++) {
    const page = doc.addPage([612, 792]),
      codes = t.pages[index];
    page.drawText("Goosnav Font", { x: 42, y: 736, size: 16, font });
    page.drawText(`${p.name.slice(0, 45)} / ${p.styleName.slice(0, 25)}`, {
      x: 42,
      y: 718,
      size: 9,
      font,
    });
    const payload = JSON.stringify({ v: 1, id: t.id, page: index, c: codes });
    const qr = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 300,
    });
    const image = await doc.embedPng(qr);
    page.drawImage(image, { x: 486, y: 684, width: 72, height: 72 });
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
    codes.forEach((cp, i) => {
      const r = cellRect(i);
      page.drawText(
        `${String.fromCodePoint(cp)}  U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
        { x: r.x, y: 792 - r.y + 3, size: 8, font },
      );
      page.drawRectangle({
        x: r.x,
        y: 792 - r.y - r.h,
        width: r.w,
        height: r.h,
        borderWidth: 0.35,
        borderColor: rgb(0.77, 0.84, 0.9),
      });
      for (const y of [
        t.settings.ascender,
        t.settings.capHeight,
        t.settings.xHeight,
        0,
        -t.settings.descender,
      ]) {
        const py = 792 - (r.y + ((2048 - y) / 3072) * r.h);
        page.drawLine({
          start: { x: r.x, y: py },
          end: { x: r.x + r.w, y: py },
          thickness: y === 0 ? 0.55 : 0.3,
          color: rgb(0.72, 0.82, 0.9),
        });
      }
    });
    page.drawText(
      `Actual size / 100%   ·   Dark ink   ·   Keep corner marks visible`,
      { x: 58, y: 42, size: 8, font },
    );
    page.drawText(`${index + 1} / ${t.pages.length}`, {
      x: 514,
      y: 42,
      size: 8,
      font,
    });
  }
  return doc.save();
}
export type SheetCode = { v: 1; id: string; page: number; c: number[] };
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
      code.v === 1 &&
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
