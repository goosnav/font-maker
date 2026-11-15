import { createId } from "./id";
export const EM = 2048;
export const ORIGIN_X = -512,
  TOP = 2048,
  EXTENT = 3072;
export type Mode = "pixel" | "detailed";
export type Status = "drawn" | "inherited" | "review";
export type Point = [number, number];
export type Character = {
  cp: number;
  name: string;
  category: string;
  pack: string;
  paper: boolean;
  decomposition: number[];
};
export type Glyph = {
  cp: number;
  advance: number;
  status: Status;
  bitmap?: string;
  base?: string;
  original?: string;
  source?: string;
  components?: { cp: number; x: number; y: number }[];
  anchor?: Point;
};
export type Overlay = { visible: boolean; opacity: number; color: string };
export type Settings = {
  mode: Mode;
  resolution: number;
  reference: string;
  monospace: boolean;
  spacing: number;
  space: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  slant: number;
  pressure: boolean;
  smoothing: number;
  referenceOverlay: Overlay;
  guideOverlay: Overlay;
};
export type Template = {
  id: string;
  version: 1 | 2;
  characters: number[];
  pages: number[][];
  settings: Settings;
};
export type ScanSource = {
  id: string;
  name: string;
  mime: string;
  data: string;
};
export type FontSource = {
  id: string;
  name: string;
  filename: string;
  data: string;
  copyright: string;
  license: string;
};
export type Style = {
  id: string;
  name: string;
  weight: number;
  italic: boolean;
  settings: Settings;
  glyphs: Record<string, Glyph>;
  kerning: Record<string, number>;
};
export type Project = {
  format: "goosnavfont";
  version: 1;
  id: string;
  revision: number;
  name: string;
  created: string;
  modified: string;
  settings: Settings;
  characters: number[];
  glyphs: Record<string, Glyph>;
  kerning: Record<string, number>;
  templates: Template[];
  scans: ScanSource[];
  licenses: string[];
  styleId: string;
  styleName: string;
  weight: number;
  italic: boolean;
  styles: Record<string, Style>;
  fonts: FontSource[];
};
export const REFERENCES = [
  { id: "noto-sans", name: "Noto Sans", license: "noto-sans-OFL.txt" },
  {
    id: "liberation-serif",
    name: "Liberation Serif",
    license: "Liberation-LICENSE.txt",
  },
  {
    id: "liberation-sans",
    name: "Liberation Sans",
    license: "Liberation-LICENSE.txt",
  },
  {
    id: "liberation-mono",
    name: "Liberation Mono",
    license: "Liberation-LICENSE.txt",
  },
  {
    id: "unifraktur",
    name: "UnifrakturMaguntia",
    license: "unifraktur-OFL.txt",
  },
  { id: "comic-neue", name: "Comic Neue", license: "comic-neue-OFL.txt" },
  { id: "paprika", name: "Paprika", license: "paprika-OFL.txt" },
];
export function defaultSettings(): Settings {
  return {
    mode: "pixel",
    resolution: 16,
    reference: "noto-sans",
    monospace: false,
    spacing: 128,
    space: 640,
    ascender: 1536,
    descender: 512,
    capHeight: 1408,
    xHeight: 1024,
    slant: 0,
    pressure: false,
    smoothing: 0.2,
    referenceOverlay: { visible: true, opacity: 0.22, color: "#316ac5" },
    guideOverlay: { visible: true, opacity: 0.5, color: "#b76963" },
  };
}
export function newProject(
  name: string,
  characters: number[],
  settings = defaultSettings(),
): Project {
  const now = new Date().toISOString();
  return {
    format: "goosnavfont",
    version: 1,
    id: createId(),
    revision: 0,
    name: name.trim() || "Untitled Font",
    created: now,
    modified: now,
    settings,
    characters: [...new Set(characters)].sort((a, b) => a - b),
    glyphs: {},
    kerning: {},
    templates: [],
    scans: [],
    licenses: [],
    styleId: createId(),
    styleName: "Regular",
    weight: 400,
    italic: false,
    styles: {},
    fonts: [],
  };
}
export function currentStyle(p: Project): Style {
  return {
    id: p.styleId,
    name: p.styleName,
    weight: p.weight,
    italic: p.italic,
    settings: p.settings,
    glyphs: p.glyphs,
    kerning: p.kerning,
  };
}
export function allStyles(p: Project): Style[] {
  return [
    ...Object.values(p.styles).filter((s) => s.id !== p.styleId),
    currentStyle(p),
  ];
}
export function activateStyle(p: Project, id: string) {
  if (id === p.styleId) return;
  const target = p.styles[id];
  if (!target) throw Error("Style not found.");
  p.styles[p.styleId] = structuredClone(currentStyle(p));
  p.styleId = target.id;
  p.styleName = target.name;
  p.weight = target.weight;
  p.italic = target.italic;
  p.settings = structuredClone(target.settings);
  p.glyphs = structuredClone(target.glyphs);
  p.kerning = structuredClone(target.kerning);
  delete p.styles[id];
}
export function addStyle(p: Project, name: string, duplicate: boolean) {
  const id = createId();
  p.styles[id] = {
    id,
    name,
    weight: /bold/i.test(name) ? 700 : 400,
    italic: /italic|oblique/i.test(name),
    settings: {
      ...structuredClone(p.settings),
      reference: `style:${p.styleId}`,
    },
    glyphs: duplicate ? structuredClone(p.glyphs) : {},
    kerning: duplicate ? structuredClone(p.kerning) : {},
  };
  activateStyle(p, id);
}
export function sourceKnown(p: Project, id: string) {
  return (
    REFERENCES.some((r) => r.id === id) ||
    p.fonts.some((f) => f.id === id) ||
    (id.startsWith("style:") && allStyles(p).some((s) => s.id === id.slice(6)))
  );
}
export function isScalar(cp: number) {
  return (
    Number.isInteger(cp) &&
    cp >= 32 &&
    cp <= 0x10ffff &&
    !(cp >= 0xd800 && cp <= 0xdfff)
  );
}
export function parseCharacters(text: string) {
  const tokens = text.trim().split(/[\s,]+/);
  if (tokens.every((t) => /^U\+[0-9a-f]{2,6}$/i.test(t)))
    return [
      ...new Set(tokens.map((t) => parseInt(t.slice(2), 16)).filter(isScalar)),
    ];
  return [
    ...new Set(
      Array.from(text)
        .map((c) => c.codePointAt(0)!)
        .filter(isScalar),
    ),
  ];
}
export function isSpace(cp: number) {
  return /\p{Zs}/u.test(String.fromCodePoint(cp));
}
export function isMark(cp: number) {
  return /\p{M}/u.test(String.fromCodePoint(cp));
}
export function label(cp: number) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
export function glyphAdvance(project: Project, cp: number) {
  return isMark(cp)
    ? 0
    : isSpace(cp)
      ? project.settings.space
      : project.settings.monospace
        ? 1280
        : (project.glyphs[cp]?.advance ?? 1280);
}
export function validateProject(p: unknown): asserts p is Project {
  if (!p || typeof p !== "object")
    throw Error("This is not a Goosnav Font project.");
  const v = p as Project;
  if (v.format !== "goosnavfont" || v.version !== 1)
    throw Error(
      "Unsupported project version. The current project has been kept.",
    );
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const record = (o: unknown) =>
    !!o && typeof o === "object" && !Array.isArray(o);
  if (
    typeof v.id !== "string" ||
    !uuid.test(v.id) ||
    typeof v.name !== "string" ||
    v.name.length > 128 ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !Array.isArray(v.characters) ||
    v.characters.length > 20000 ||
    !v.characters.every(isScalar) ||
    new Set(v.characters).size !== v.characters.length
  )
    throw Error("Invalid project metadata.");
  if (
    !Array.isArray(v.fonts) ||
    v.fonts.length > 100 ||
    !record(v.styles) ||
    !uuid.test(v.styleId) ||
    typeof v.styleName !== "string" ||
    v.styleName.length > 60 ||
    !Number.isInteger(v.weight) ||
    v.weight < 100 ||
    v.weight > 900 ||
    typeof v.italic !== "boolean"
  )
    throw Error("Invalid font family.");
  if (
    !Array.isArray(v.templates) ||
    !Array.isArray(v.scans) ||
    !Array.isArray(v.licenses)
  )
    throw Error("Incomplete project.");
  const fontIds = new Set<string>();
  for (const f of v.fonts) {
    if (
      !f ||
      typeof f.id !== "string" ||
      !f.id.startsWith("import-") ||
      !uuid.test(f.id.slice(7)) ||
      fontIds.has(f.id) ||
      typeof f.name !== "string" ||
      f.name.length > 256 ||
      typeof f.filename !== "string" ||
      typeof f.data !== "string" ||
      f.data.length > 40_000_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data) ||
      typeof f.copyright !== "string" ||
      typeof f.license !== "string"
    )
      throw Error("Invalid imported font.");
    fontIds.add(f.id);
  }
  const fontKnown = (id: unknown) =>
    typeof id === "string" &&
    (REFERENCES.some((r) => r.id === id) || fontIds.has(id));
  const scanIds = new Set<string>();
  for (const scan of v.scans) {
    if (
      !scan ||
      !uuid.test(scan.id) ||
      scanIds.has(scan.id) ||
      typeof scan.name !== "string" ||
      typeof scan.mime !== "string" ||
      typeof scan.data !== "string" ||
      scan.data.length > 120_000_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(scan.data)
    )
      throw Error("Invalid scan source.");
    scanIds.add(scan.id);
  }
  if (Object.keys(v.styles).length > 100)
    throw Error("Too many styles in this project.");
  for (const [key, style] of Object.entries(v.styles))
    if (
      !style ||
      key !== style.id ||
      !uuid.test(key) ||
      key === v.styleId ||
      typeof style.name !== "string" ||
      style.name.length > 60 ||
      !Number.isInteger(style.weight) ||
      style.weight < 100 ||
      style.weight > 900 ||
      typeof style.italic !== "boolean"
    )
      throw Error("Invalid saved style.");
  function settings(s: Settings) {
    if (
      !s ||
      !["pixel", "detailed"].includes(s.mode) ||
      !Number.isInteger(s.resolution) ||
      s.resolution < 8 ||
      s.resolution > 4096 ||
      typeof s.reference !== "string" ||
      !sourceKnown(v, s.reference)
    )
      throw Error("Invalid drawing settings.");
    for (const n of [
      "spacing",
      "space",
      "ascender",
      "descender",
      "capHeight",
      "xHeight",
    ] as const)
      if (!Number.isFinite(s[n]) || s[n] < 0 || s[n] > 8192)
        throw Error("Invalid font metrics.");
    if (
      !Number.isFinite(s.slant) ||
      Math.abs(s.slant) > 80 ||
      !Number.isFinite(s.smoothing) ||
      s.smoothing < 0 ||
      s.smoothing > 0.8 ||
      typeof s.monospace !== "boolean" ||
      typeof s.pressure !== "boolean"
    )
      throw Error("Invalid pen settings.");
    for (const o of [s.referenceOverlay, s.guideOverlay])
      if (
        !o ||
        typeof o.visible !== "boolean" ||
        !/^#[0-9a-f]{6}$/i.test(o.color) ||
        !Number.isFinite(o.opacity) ||
        o.opacity < 0 ||
        o.opacity > 1
      )
        throw Error("Invalid overlay settings.");
  }
  const position = (n: number) => Number.isFinite(n) && Math.abs(n) <= 8192;
  for (const style of allStyles(v)) {
    settings(style.settings);
    if (
      !record(style.glyphs) ||
      !record(style.kerning) ||
      Object.keys(style.glyphs).length > 20000
    )
      throw Error("Invalid saved style.");
    for (const [key, g] of Object.entries(style.glyphs)) {
      if (
        !g ||
        g.cp !== Number(key) ||
        !isScalar(g.cp) ||
        !v.characters.includes(g.cp) ||
        !Number.isFinite(g.advance) ||
        g.advance < 0 ||
        g.advance > 8192 ||
        !["drawn", "inherited", "review"].includes(g.status)
      )
        throw Error("Invalid character data.");
      if (g.base !== undefined && !fontKnown(g.base))
        throw Error("Unknown source font.");
      if (g.source !== undefined && !scanIds.has(g.source))
        throw Error("Unknown source scan.");
      for (const b of [g.bitmap, g.original])
        if (
          b !== undefined &&
          (typeof b !== "string" ||
            !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(b) ||
            b.length > 30_000_000)
        )
          throw Error("Invalid character image.");
      if (
        g.anchor &&
        (!Array.isArray(g.anchor) ||
          g.anchor.length !== 2 ||
          !g.anchor.every(position))
      )
        throw Error("Invalid mark anchor.");
      if (
        g.components &&
        (!Array.isArray(g.components) ||
          g.components.length > 8 ||
          g.components.some(
            (c) => !c || !isScalar(c.cp) || !position(c.x) || !position(c.y),
          ))
      )
        throw Error("Invalid accent components.");
    }
    const done = new Set<number>();
    function visit(cp: number, ancestors = new Set<number>()) {
      if (ancestors.has(cp) || ancestors.size > 8)
        throw Error("Circular or overly deep accent components.");
      if (done.has(cp)) return;
      const path = new Set(ancestors);
      path.add(cp);
      for (const part of style.glyphs[cp]?.components || [])
        visit(part.cp, path);
      done.add(cp);
    }
    for (const cp of Object.keys(style.glyphs)) visit(Number(cp));
    for (const [pair, value] of Object.entries(style.kerning))
      if (
        !/^\d+,\d+$/.test(pair) ||
        !pair.split(",").map(Number).every(isScalar) ||
        !Number.isFinite(value) ||
        Math.abs(value) > 2048
      )
        throw Error("Invalid kerning.");
  }
  for (const t of v.templates) {
    if (
      !t ||
      ![1, 2].includes(t.version) ||
      !uuid.test(t.id) ||
      !Array.isArray(t.characters) ||
      !t.characters.every(isScalar) ||
      !Array.isArray(t.pages) ||
      t.pages.length > 1000 ||
      t.pages.some(
        (page) =>
          !Array.isArray(page) || page.length > 30 || !page.every(isScalar),
      )
    )
      throw Error("Invalid paper template.");
    settings(t.settings);
  }
  if (v.licenses.some((id) => !fontKnown(id)))
    throw Error("Unknown license source.");
}
export class History {
  private past: Project[] = [];
  private future: Project[] = [];
  constructor(
    public project: Project,
    private changed: (p: Project) => void,
  ) {}
  commit(edit: (p: Project) => void) {
    const next = structuredClone(this.project);
    edit(next);
    this.past.push(this.project);
    if (this.past.length > 40) this.past.shift();
    this.future = [];
    next.revision = this.project.revision + 1;
    next.modified = new Date().toISOString();
    this.project = next;
    this.changed(next);
  }
  undo() {
    const p = this.past.pop();
    if (p) {
      this.future.push(this.project);
      this.project = { ...p, revision: this.project.revision + 1 };
      this.changed(this.project);
    }
  }
  redo() {
    const p = this.future.pop();
    if (p) {
      this.past.push(this.project);
      this.project = { ...p, revision: this.project.revision + 1 };
      this.changed(this.project);
    }
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
}
