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
import { traceMask } from "./contours";
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
        item.reject(Error("The font engine could not start. Keep this window open and retry. For the local edition, reopen the launcher first."));
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
async function referenceFont(id: string, p?: Project) {
  if (!references.has(id)) references.set(id, (async () => {
    const [{ default: fontkit }, data] = await Promise.all([import("@pdf-lib/fontkit"), sourceData(id, p)]);
    return fontkit.create(new Uint8Array(data));
  })().catch(error => { references.delete(id); fontData.delete(id); throw error; }));
  return references.get(id)!;
}
/** Render source outlines directly; CSS font fallback must never impersonate a reference. */
export async function fontPreviewSvg(id: string, text: string, p?: Project, size = 21) {
  const font = await referenceFont(id, p);
  const run = font.layout(text);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const height = font.ascent - font.descent;
  svg.setAttribute("viewBox", `0 ${-font.ascent} ${Math.max(1, run.advanceWidth)} ${height}`);
  svg.setAttribute("width", String(run.advanceWidth * size / font.unitsPerEm));
  svg.setAttribute("height", String(height * size / font.unitsPerEm));
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.font = id;
  let x = 0, y = 0;
  run.glyphs.forEach((glyph, i) => {
    const position = run.positions[i];
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", glyph.path.toSVG());
    path.setAttribute("fill", "currentColor");
    path.setAttribute("transform", `translate(${x + position.xOffset} ${-y - position.yOffset}) scale(1 -1)`);
    svg.append(path);
    x += position.xAdvance;
    y += position.yAdvance;
  });
  return svg;
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
    const image = await createImageBitmap(new Blob([fromBase64(g.bitmap.split(",")[1]) as BlobPart], {type:"image/png"}), {
      resizeWidth:size, resizeHeight:size, resizeQuality:p.settings.mode === "pixel" ? "pixelated" : "high",
    });
    ctx.drawImage(image,0,0); image.close();
  } else if (g.base) {
    const font = await referenceFont(g.base, p);
    if (font.hasGlyphForCodePoint(g.cp)) {
      ctx.save();
      ctx.translate((-ORIGIN_X / EM) * resolution, (TOP / EM) * resolution);
      ctx.scale(resolution / font.unitsPerEm, -resolution / font.unitsPerEm);
      ctx.fill(new Path2D(font.glyphForCodePoint(g.cp).path.toSVG()));
      ctx.restore();
    }
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
    if (!style?.glyphs[cp]) throw Error("This style has no drawing for this character yet.");
    return glyphCanvas(
      style.glyphs[cp],
      { ...p, settings: style.settings, glyphs: style.glyphs },
      Math.max(Math.min(p.settings.resolution, 1024), 128),
    );
  }
  const font = await referenceFont(ref, p);
  if (!font.hasGlyphForCodePoint(cp))
    throw Error("This reference has no drawing for this character.");
  return glyphCanvas(
    { cp, advance: font.glyphForCodePoint(cp).advanceWidth * EM / font.unitsPerEm, status: "inherited", base: ref },
    { ...p, settings: { ...p.settings, mode: "detailed" } },
    Math.max(Math.min(p.settings.resolution, 1024), 128),
  );
}
export type FontProgress = { completed: number; total: number };
export type FontProgressCallback = (message: string, progress?: FontProgress) => void;
export async function seedProject(
  p: Project,
  source: string,
  onProgress: FontProgressCallback = () => {},
) {
  const info = await inspectFont(source, p);
  const entries = p.characters.filter((cp) => info.metrics[cp] !== undefined);
  let n = 0;
  onProgress(`Preparing 0 / ${entries.length} characters…`, {completed:0,total:entries.length});
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
      const image = await glyphCanvas(g, p);
      g.bitmap = image.toDataURL();
      image.width = image.height = 1;
      g.original = g.bitmap;
    }
    p.glyphs[cp] = g;
    if (++n % 30 === 0 || n === entries.length) {
      onProgress(`Preparing ${n} / ${entries.length} characters…`, {completed:n,total:entries.length});
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
  progress: FontProgressCallback = () => {},
) {
  const next = structuredClone(p);
  next.settings = settings;
  if (
    settings.resolution === p.settings.resolution &&
    settings.mode === p.settings.mode
  )
    return next;
  let i = 0;
  const glyphs = Object.values(next.glyphs).filter(g => g.bitmap || (g.base && settings.mode !== "detailed"));
  progress(`Converting 0 / ${glyphs.length} characters…`, {completed:0,total:glyphs.length});
  for (const g of glyphs) {
    const old = await glyphCanvas(g, p);
    const target = canvas(settings.resolution * 1.5);
    const ctx = target.getContext("2d")!;
    ctx.imageSmoothingEnabled =
      settings.mode === "detailed" && p.settings.mode === "detailed";
    ctx.drawImage(old, 0, 0, target.width, target.height);
    g.original = g.original || g.bitmap || old.toDataURL();
    g.bitmap = target.toDataURL();
    old.width = old.height = target.width = target.height = 1;
    if (settings.mode === "pixel") {
      const snapped=await glyphCanvas(g,next);
      g.bitmap=snapped.toDataURL();
      snapped.width=snapped.height=1;
    }
    if (++i % 20 === 0 || i === glyphs.length) {
      progress(`Converting ${i} / ${glyphs.length} characters…`, {completed:i,total:glyphs.length});
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
      // Release the large bitmap before fitting outlines off the UI thread.
      const width=c.width,height=c.height;
      c.width=c.height=1;
      const outline = new Worker(new URL("./outline.worker.ts", import.meta.url), {type:"module"});
      try {
        Object.assign(record, await new Promise((resolve,reject)=>{
          outline.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
          outline.onerror=()=>reject(Error("The outline engine could not start. Retry the export."));
          outline.postMessage({alpha:alpha.buffer,width,height,detailed:p.settings.mode==="detailed"},[alpha.buffer]);
        }));
      } finally { outline.terminate(); }
      const points=record.contours?.reduce((n:number,c:any[])=>n+c.length,0)
        ?? record.curves?.reduce((n:number,c:any)=>n+c.segments.length*3,0) ?? 0;
      if(points>60000) throw Error(`Character ${String.fromCodePoint(cp)} has too much detail. Reduce its resolution.`);
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
