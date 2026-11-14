import {
  EM,
  EXTENT,
  ORIGIN_X,
  TOP,
  type Project,
  type Glyph,
} from "../core/model";
import { canvas, glyphCanvas, referenceCanvas } from "../core/fonts";
let sharedClipboard: HTMLCanvasElement | undefined;
export type Tool =
  | "pencil"
  | "brush"
  | "eraser"
  | "fill"
  | "line"
  | "rect"
  | "ellipse"
  | "select";
export class Painter {
  ink: HTMLCanvasElement;
  display: HTMLCanvasElement;
  tool: Tool = "pencil";
  size = 1;
  zoom = 1;
  grid = true;
  private context: CanvasRenderingContext2D;
  private active = false;
  private origin = [0, 0];
  private last = [0, 0];
  private before?: ImageData;
  private ref?: HTMLCanvasElement;
  private selection?: { x: number; y: number; w: number; h: number };
  private clipboard?: HTMLCanvasElement;
  private pan?: { x: number; y: number; l: number; t: number };
  private space = false;
  private alive = true;
  private moving = false;
  private ready = false;
  constructor(
    private host: HTMLElement,
    public project: Project,
    public cp: number,
    private commit: (bitmap: string) => void,
    private referenceStatus: (message: string) => void = () => {},
  ) {
    this.ink = canvas(project.settings.resolution * 1.5);
    this.context = this.ink.getContext("2d", { willReadFrequently: true })!;
    this.display = canvas(768);
    this.display.tabIndex = 0;
    this.display.setAttribute(
      "aria-label",
      `Drawing canvas for ${String.fromCodePoint(cp)}`,
    );
    this.display.className = "paint-canvas";
    host.append(this.display);
    this.display.addEventListener("pointerdown", this.down);
    this.display.addEventListener("pointermove", this.move);
    this.display.addEventListener("pointerup", this.up);
    this.display.addEventListener("pointercancel", this.cancel);
    this.display.addEventListener("keydown", this.keydown);
    this.display.addEventListener("keyup", this.keyup);
    this.display.addEventListener("wheel", this.wheel, { passive: false });
    this.load();
  }
  async load() {
    this.render();
    try {
      const g = await glyphCanvas(this.project.glyphs[this.cp], this.project);
      if (!this.alive) return;
      this.ink = g;
      this.context = g.getContext("2d", { willReadFrequently: true })!;
      this.ready = true;
      this.render();
      this.referenceStatus("Loading reference…");
      this.ref = await referenceCanvas(this.cp, this.project);
      if (this.alive) {
        this.display.dataset.reference = "ready";
        this.referenceStatus("");
        this.render();
      }
    } catch (error) {
      if (this.alive) this.referenceStatus(error instanceof Error ? error.message : String(error));
    }
  }
  destroy() {
    this.alive = false;
    this.display.remove();
  }
  setZoom(z: number) {
    this.zoom = Math.max(0.25, Math.min(8, z));
    this.display.style.width = `${768 * this.zoom}px`;
    this.display.style.height = `${768 * this.zoom}px`;
    this.render();
  }
  setTool(tool: Tool) {
    this.tool = tool;
    this.selection = undefined;
    this.render();
  }
  private point(e: PointerEvent) {
    const r = this.display.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(
          this.ink.width - 1,
          ((e.clientX - r.left) / r.width) * this.ink.width,
        ),
      ),
      Math.max(
        0,
        Math.min(
          this.ink.height - 1,
          ((e.clientY - r.top) / r.height) * this.ink.height,
        ),
      ),
    ];
  }
  private stamp(x: number, y: number, pressure = 1) {
    const ctx = this.context;
    ctx.globalCompositeOperation =
      this.tool === "eraser" ? "destination-out" : "source-over";
    ctx.fillStyle = "#000";
    const radius = Math.max(
      1,
      this.size * (this.project.settings.pressure ? pressure : 1),
    );
    if (this.project.settings.mode === "pixel") {
      ctx.fillRect(
        Math.floor(x) - Math.floor(radius / 2),
        Math.floor(y) - Math.floor(radius / 2),
        Math.ceil(radius),
        Math.ceil(radius),
      );
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  private stroke(a: number[], b: number[], pressure: number) {
    const d = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])),
      steps = Math.max(1, Math.ceil(d * 2));
    for (let i = 0; i <= steps; i++)
      this.stamp(
        a[0] + ((b[0] - a[0]) * i) / steps,
        a[1] + ((b[1] - a[1]) * i) / steps,
        pressure,
      );
  }
  private fill(x: number, y: number) {
    const w = this.ink.width,
      h = this.ink.height,
      d = this.context.getImageData(0, 0, w, h);
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const start = y * w + x,
      target = d.data[start * 4 + 3] > 127;
    if (target) return;
    const stack = [start];
    d.data[start * 4 + 3] = 255;
    while (stack.length) {
      const n = stack.pop()!,
        px = n % w,
        py = Math.floor(n / w);
      for (const k of [
        px > 0 ? n - 1 : -1,
        px < w - 1 ? n + 1 : -1,
        py > 0 ? n - w : -1,
        py < h - 1 ? n + w : -1,
      ])
        if (k >= 0 && d.data[k * 4 + 3] <= 127) {
          d.data[k * 4] = d.data[k * 4 + 1] = d.data[k * 4 + 2] = 0;
          d.data[k * 4 + 3] = 255;
          stack.push(k);
        }
    }
    this.context.putImageData(d, 0, 0);
  }
  private down = (e: PointerEvent) => {
    if (!this.ready) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    this.display.focus();
    this.display.setPointerCapture(e.pointerId);
    if (this.space || e.button === 1) {
      this.pan = {
        x: e.clientX,
        y: e.clientY,
        l: this.host.scrollLeft,
        t: this.host.scrollTop,
      };
      return;
    }
    this.active = true;
    this.origin = this.last = this.point(e);
    this.before = this.context.getImageData(
      0,
      0,
      this.ink.width,
      this.ink.height,
    );
    this.moving = !!(
      this.tool === "select" &&
      this.selection &&
      this.selection.w > 0 &&
      this.selection.h > 0 &&
      this.origin[0] >= this.selection.x &&
      this.origin[0] <= this.selection.x + this.selection.w &&
      this.origin[1] >= this.selection.y &&
      this.origin[1] <= this.selection.y + this.selection.h
    );
    if (["pencil", "brush", "eraser"].includes(this.tool))
      this.stamp(...(this.origin as [number, number]), e.pressure || 1);
    if (this.tool === "fill") this.fill(this.origin[0], this.origin[1]);
    this.render();
  };
  private move = (e: PointerEvent) => {
    if (this.pan) {
      this.host.scrollLeft = this.pan.l - (e.clientX - this.pan.x);
      this.host.scrollTop = this.pan.t - (e.clientY - this.pan.y);
      return;
    }
    if (!this.active) return;
    let p = this.point(e);
    if (["pencil", "brush", "eraser"].includes(this.tool)) {
      const s =
        this.project.settings.mode === "detailed"
          ? this.project.settings.smoothing
          : 0;
      p = [
        p[0] * (1 - s) + this.last[0] * s,
        p[1] * (1 - s) + this.last[1] * s,
      ];
      this.stroke(this.last, p, e.pressure || 1);
    } else if (["line", "rect", "ellipse"].includes(this.tool)) {
      this.context.putImageData(this.before!, 0, 0);
      const [x, y] = this.origin;
      if (this.tool === "line") this.stroke(this.origin, p, 1);
      else if (this.tool === "rect") {
        this.stroke([x, y], [p[0], y], 1);
        this.stroke([p[0], y], p, 1);
        this.stroke(p, [x, p[1]], 1);
        this.stroke([x, p[1]], [x, y], 1);
      } else {
        const cx = (x + p[0]) / 2,
          cy = (y + p[1]) / 2,
          rx = Math.abs(p[0] - x) / 2,
          ry = Math.abs(p[1] - y) / 2,
          steps = Math.max(16, Math.ceil(Math.PI * Math.max(rx, ry) * 4));
        for (let i = 0; i < steps; i++)
          this.stamp(
            cx + rx * Math.cos((i / steps) * Math.PI * 2),
            cy + ry * Math.sin((i / steps) * Math.PI * 2),
          );
      }
    } else if (this.tool === "select") {
      if (this.moving && this.selection) {
        this.context.putImageData(this.before!, 0, 0);
        const { x, y, w, h } = this.selection;
        const tmp = canvas(Math.max(w, h));
        tmp
          .getContext("2d")!
          .putImageData(this.context.getImageData(x, y, w, h), 0, 0);
        this.context.clearRect(x, y, w, h);
        this.context.drawImage(
          tmp,
          0,
          0,
          w,
          h,
          Math.round(x + p[0] - this.origin[0]),
          Math.round(y + p[1] - this.origin[1]),
          w,
          h,
        );
      } else {
        this.selection = {
          x: Math.floor(Math.min(p[0], this.origin[0])),
          y: Math.floor(Math.min(p[1], this.origin[1])),
          w: Math.ceil(Math.abs(p[0] - this.origin[0])),
          h: Math.ceil(Math.abs(p[1] - this.origin[1])),
        };
      }
    }
    this.last = p;
    this.render();
  };
  private up = (e: PointerEvent) => {
    if (this.pan) {
      this.pan = undefined;
      return;
    }
    if (!this.active) return;
    this.active = false;
    if (this.tool !== "select" || this.moving) {
      if (this.moving && this.selection) {
        this.selection.x += Math.round(this.last[0] - this.origin[0]);
        this.selection.y += Math.round(this.last[1] - this.origin[1]);
      }
      this.commit(this.ink.toDataURL());
    }
    this.before = undefined;
    this.render();
  };
  private cancel = () => {
    if (this.active && this.before)
      this.context.putImageData(this.before, 0, 0);
    this.active = false;
    this.pan = undefined;
    this.render();
  };
  private keydown = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      this.space = true;
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      this.copy();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      this.paste();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.clearSelection();
    }
  };
  private keyup = (e: KeyboardEvent) => {
    if (e.code === "Space") this.space = false;
  };
  private wheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }
  };
  copy() {
    const s = this.selection || {
      x: 0,
      y: 0,
      w: this.ink.width,
      h: this.ink.height,
    };
    if (s.w < 1 || s.h < 1) return;
    this.clipboard = document.createElement("canvas");
    this.clipboard.width = s.w;
    this.clipboard.height = s.h;
    this.clipboard
      .getContext("2d")!
      .drawImage(this.ink, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    sharedClipboard = this.clipboard;
  }
  paste() {
    this.clipboard = sharedClipboard;
    if (!this.clipboard) return;
    const x = this.selection?.x ?? 0,
      y = this.selection?.y ?? 0;
    this.context.drawImage(this.clipboard, x, y);
    this.commit(this.ink.toDataURL());
    this.render();
  }
  clearSelection() {
    const s = this.selection;
    if (s) {
      this.context.clearRect(s.x, s.y, s.w, s.h);
      this.commit(this.ink.toDataURL());
      this.render();
    }
  }
  clear() {
    this.context.clearRect(0, 0, this.ink.width, this.ink.height);
    this.commit(this.ink.toDataURL());
    this.render();
  }
  render() {
    const c = this.display.getContext("2d")!,
      w = this.display.width,
      s = this.project.settings,
      scale = w / EXTENT;
    c.clearRect(0, 0, w, w);
    c.fillStyle = "#fff";
    c.fillRect(0, 0, w, w);
    if (this.ref && s.referenceOverlay.visible) {
      const temp = canvas(this.ref.width),
        t = temp.getContext("2d")!;
      t.drawImage(this.ref, 0, 0);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = s.referenceOverlay.color;
      t.fillRect(0, 0, temp.width, temp.height);
      c.globalAlpha = s.referenceOverlay.opacity;
      c.drawImage(temp, 0, 0, w, w);
      c.globalAlpha = 1;
    }
    if (s.guideOverlay.visible) {
      c.globalAlpha = s.guideOverlay.opacity;
      c.strokeStyle = s.guideOverlay.color;
      c.fillStyle = s.guideOverlay.color;
      c.lineWidth = 1;
      c.font = "11px sans-serif";
      for (const [name, value] of [
        ["Ascender", s.ascender],
        ["Cap", s.capHeight],
        ["x-height", s.xHeight],
        ["Baseline", 0],
        ["Descender", -s.descender],
      ] as [string, number][]) {
        const y = (TOP - value) * scale;
        c.beginPath();
        c.setLineDash(name === "Baseline" ? [] : [4, 4]);
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
        c.fillText(name, 5, y - 4);
      }
      c.setLineDash([]);
      for (const x of [0, this.project.glyphs[this.cp]?.advance ?? 1280]) {
        c.beginPath();
        c.moveTo((x - ORIGIN_X) * scale, 0);
        c.lineTo((x - ORIGIN_X) * scale, w);
        c.stroke();
      }
      if (s.slant) {
        const d = Math.tan((s.slant * Math.PI) / 180) * w;
        c.setLineDash([3, 6]);
        for (let x = -w; x < w * 2; x += w / 6) {
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x - d, w);
          c.stroke();
        }
      }
      c.setLineDash([]);
      c.globalAlpha = 1;
    }
    c.imageSmoothingEnabled = s.mode === "detailed";
    c.drawImage(this.ink, 0, 0, w, w);
    if (this.grid && s.mode === "pixel") {
      c.strokeStyle = "#18324916";
      c.lineWidth = 1;
      const step = w / this.ink.width;
      for (let i = 0; i <= this.ink.width; i++) {
        c.beginPath();
        c.moveTo(i * step, 0);
        c.lineTo(i * step, w);
        c.moveTo(0, i * step);
        c.lineTo(w, i * step);
        c.stroke();
      }
    }
    if (this.selection) {
      const k = w / this.ink.width,
        { x, y, w: sw, h } = this.selection;
      c.strokeStyle = "#0755d6";
      c.setLineDash([5, 4]);
      c.strokeRect(x * k, y * k, sw * k, h * k);
      c.setLineDash([]);
    }
  }
}
