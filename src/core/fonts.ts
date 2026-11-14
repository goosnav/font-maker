import {
  allStyles,
  EM,
  EXTENT,
  ORIGIN_X,
  TOP,
  REFERENCES,
  isSpace,
  isMark,
  glyphAdvance,
  type Project,
  type Glyph,
  type Style,
} from "./model";
import { traceMask, simplify } from "./contours";
import type { Font } from "@pdf-lib/fontkit";
export type FontInfo = {
  name: string;
  style: string;
  metrics: Record<string, number>;
  copyright: string;
  license: string;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  weight: number;
  italic: boolean;
  kerning: Record<string, number>;
};
let worker: Worker | undefined;
let serial = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
let notice = (s: string) => {};
export function setFontNotice(fn: (s: string) => void) {
  notice = fn;
}
const fontData = new Map<string, ArrayBuffer>(),
  fontInfo = new Map<string, FontInfo>(),
  faces = new Map<string, Promise<string>>(),
  references = new Map<string, Promise<Font>>();
export function fromBase64(data: string) {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
export function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
export async function sourceData(id: string, p?: Project) {
  if (!fontData.has(id)) {
    const imported = p?.fonts.find((f) => f.id === id);
    if (imported) fontData.set(id, fromBase64(imported.data).buffer);
    else {
      if (!REFERENCES.some((r) => r.id === id))
        throw Error("Reference font is unavailable.");
      const r = await fetch(`/fonts/${id}.ttf`);
      if (!r.ok) throw Error("Reference font could not be loaded.");
      fontData.set(id, await r.arrayBuffer());
    }
  }
  return fontData.get(id)!;
}
async function call(
  request: unknown,
  ids: string[],
  p?: Project,
): Promise<any> {
  // Fetch before starting the worker so a startup failure cannot strand a job.
  const sources = await Promise.all(
    [...new Set(ids)].map(async (id) => ({ id, data: await sourceData(id, p) })),
  );
  if (!worker) {
    worker = new Worker("/engine/font.worker.js", { type: "module" });
    worker.onmessage = (e) => {
      if (e.data.progress) {
        notice(e.data.progress);
        return;
      }
      const item = pending.get(e.data.id);
      if (item) {
        pending.delete(e.data.id);
        e.data.error
          ? item.reject(Error(e.data.error))
          : item.resolve(e.data.result);
      }
    };
    worker.onerror = (e) => {
      for (const item of pending.values())
        item.reject(Error(e.message || "The font engine could not start. Reopen Goosnav Font with its launcher, then retry. Your drawing is kept."));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = ++serial;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, request, sources });
  });
}
export async function inspectFont(id: string, p?: Project): Promise<FontInfo> {
  if (!fontInfo.has(id))
    fontInfo.set(id, await call({ op: "inspect", source: id }, [id], p));
  return fontInfo.get(id)!;
}
export async function loadFace(id: string, p?: Project) {
  if (!faces.has(id)) {
    faces.set(id, (async () => {
      const face = new FontFace(`gfn-${id}`, await sourceData(id, p));
      await face.load();
      document.fonts.add(face);
      return face.family;
    })().catch(error => { faces.delete(id); throw error; }));
  }
  return faces.get(id)!;
}
async function referenceFont(id: string, p: Project) {
  if (!references.has(id)) references.set(id, (async () => {
    const [{ create }, data] = await Promise.all([import("@pdf-lib/fontkit"), sourceData(id, p)]);
    return create(new Uint8Array(data));
  })().catch(error => { references.delete(id); throw error; }));
  return references.get(id)!;
}
export function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(size);
  return c;
}
export async function readImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error("Image could not be read."));
    image.src = url;
  });
}
export async function glyphCanvas(
  g: Glyph | undefined,
  p: Project,
  resolution = p.settings.resolution,
  seen = new Set<number>(),
): Promise<HTMLCanvasElement> {
  const size = Math.round(resolution * 1.5),
    c = canvas(size),
    ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = p.settings.mode === "detailed";
  if (!g) return c;
  if (seen.has(g.cp)) throw Error("Circular accent components.");
  seen.add(g.cp);
  if (g.bitmap) {
    ctx.drawImage(await readImage(g.bitmap), 0, 0, size, size);
  } else if (g.base) {
    const face = await loadFace(g.base, p);
    ctx.font = `${resolution}px "${face}"`;
    ctx.fillStyle = "#000";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      String.fromCodePoint(g.cp),
      (-ORIGIN_X / EM) * resolution,
      (TOP / EM) * resolution,
    );
  }
  if (g.components)
    for (const part of g.components) {
      const child = await glyphCanvas(
        p.glyphs[part.cp],
        p,
        resolution,
        new Set(seen),
      );
      ctx.drawImage(
        child,
        (part.x / EM) * resolution,
        (-part.y / EM) * resolution,
      );
    }
  if (p.settings.mode === "pixel") {
    const pixels = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0;
      pixels.data[i + 3] = pixels.data[i + 3] > 127 ? 255 : 0;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return c;
}
export async function referenceCanvas(cp: number, p: Project) {
  const ref = p.settings.reference;
  if (ref.startsWith("style:")) {
    const style = allStyles(p).find((s) => s.id === ref.slice(6));
    if (!style) return canvas(p.settings.resolution * 1.5);
    return glyphCanvas(
      style.glyphs[cp],
      { ...p, settings: style.settings, glyphs: style.glyphs },
      Math.max(p.settings.resolution, 128),
    );
  }
  const font = await referenceFont(ref, p);
  if (!font.hasGlyphForCodePoint(cp))
    throw Error("This reference has no drawing for this character.");
  return glyphCanvas(
    { cp, advance: font.glyphForCodePoint(cp).advanceWidth * EM / font.unitsPerEm, status: "inherited", base: ref },
    { ...p, settings: { ...p.settings, mode: "detailed" } },
    Math.max(p.settings.resolution, 128),
  );
}
export async function seedProject(
  p: Project,
  source: string,
  onProgress = (s: string) => {},
) {
  const info = await inspectFont(source, p);
  const entries = p.characters.filter((cp) => info.metrics[cp] !== undefined);
  let n = 0;
  if (info.metrics[32] !== undefined) {
    const step = EM / p.settings.resolution;
    p.settings.space =
      p.settings.mode === "pixel"
        ? Math.round(info.metrics[32] / step) * step
        : info.metrics[32];
  }
  for (const cp of entries) {
    const step = EM / p.settings.resolution;
    const g: Glyph = {
      cp,
      advance: isMark(cp)
        ? 0
        : p.settings.mode === "pixel"
          ? Math.round(info.metrics[cp] / step) * step
          : info.metrics[cp],
      status: "inherited",
      base: source,
    };
    if (p.settings.mode === "pixel" && !isSpace(cp)) {
      g.bitmap = (await glyphCanvas(g, p)).toDataURL();
      g.original = g.bitmap;
    }
    p.glyphs[cp] = g;
    if (++n % 30 === 0) {
      onProgress(`Preparing ${n} / ${entries.length} characters…`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  for (const [pair, value] of Object.entries(info.kerning || {})) {
    const [left, right] = pair.split(",").map(Number);
    if (p.characters.includes(left) && p.characters.includes(right)) {
      const step = EM / p.settings.resolution;
      p.kerning[pair] =
        p.settings.mode === "pixel" ? Math.round(value / step) * step : value;
    }
  }
  if (!p.licenses.includes(source)) p.licenses.push(source);
}
export async function convertResolution(
  p: Project,
  settings: Project["settings"],
  progress = (s: string) => {},
) {
  const next = structuredClone(p);
  next.settings = settings;
  if (
    settings.resolution === p.settings.resolution &&
    settings.mode === p.settings.mode
  )
    return next;
  let i = 0;
  for (const g of Object.values(next.glyphs)) {
    if (!g.bitmap && !g.base) continue;
    const old = await glyphCanvas(g, p);
    const target = canvas(settings.resolution * 1.5);
    const ctx = target.getContext("2d")!;
    ctx.imageSmoothingEnabled =
      settings.mode === "detailed" && p.settings.mode === "detailed";
    ctx.drawImage(old, 0, 0, target.width, target.height);
    g.original = g.original || g.bitmap || old.toDataURL();
    g.bitmap = target.toDataURL();
    if (settings.mode === "pixel")
      g.bitmap = (await glyphCanvas(g, next)).toDataURL();
    if (++i % 20 === 0) {
      progress(`Converting ${i} characters…`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return next;
}
export async function buildFont(
  p: Project,
  format: "ttf" | "otf",
  style?: Style,
): Promise<Uint8Array> {
  if (style)
    p = {
      ...p,
      styleId: style.id,
      styleName: style.name,
      weight: style.weight,
      italic: style.italic,
      settings: style.settings,
      glyphs: style.glyphs,
      kerning: style.kerning,
    };
  for (const g of Object.values(p.glyphs))
    for (const part of g.components || [])
      if (!p.glyphs[part.cp])
        throw Error(
          `Draw the missing accent component ${String.fromCodePoint(part.cp)} before exporting.`,
        );
  const glyphs: any[] = [];
  const sources: string[] = [];
  for (const cp of p.characters) {
    const g = p.glyphs[cp];
    if (!g && !isSpace(cp)) continue;
    const record: any = { ...g, cp, advance: glyphAdvance(p, cp) };
    if (g?.bitmap) {
      const c = await glyphCanvas({ ...g, components: undefined }, p);
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const alpha = new Uint8Array(c.width * c.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
      record.contours = traceMask(alpha, c.width, c.height).map((points) =>
        p.settings.mode === "detailed"
          ? simplify(points, (EM / p.settings.resolution) * 0.5)
          : points,
      );
      if (
        record.contours.reduce((n: number, c: any[]) => n + c.length, 0) > 60000
      )
        throw Error(
          `Character ${String.fromCodePoint(cp)} has too much detail. Reduce its resolution.`,
        );
      delete record.bitmap;
      delete record.original;
      delete record.base;
    } else if (g?.base) sources.push(g.base);
    glyphs.push(record);
  }
  const used = [...new Set([...p.licenses, ...sources])];
  const notices = await Promise.all(
    used.map(async (id) => {
      const ref = REFERENCES.find((f) => f.id === id);
      if (ref) return (await fetch("/fonts/" + ref.license)).text();
      const font = p.fonts.find((f) => f.id === id);
      return font ? font.copyright + "\n" + font.license : "";
    }),
  );
  notice(`Building ${format.toUpperCase()}…`);
  return await call(
    {
      op: "build",
      project: {
        id: p.id,
        revision: p.revision,
        name: p.name,
        styleId: p.styleId,
        styleName: p.styleName,
        weight: p.weight,
        italic: p.italic,
        settings: p.settings,
        kerning: p.kerning,
      },
      glyphs,
      format,
      license: notices.join("\n\n"),
      copyright: notices.length
        ? "Contains modified font material. See license description."
        : "",
    },
    sources,
    p,
  );
}
