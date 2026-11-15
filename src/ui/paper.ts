import { createId } from "../core/id";
import {
  type Project,
  type Character,
  type Glyph,
  type ScanSource,
} from "../core/model";
import {
  makeTemplate,
  templatePdf,
  cellRect,
  scanCode,
  iteratePages,
  rectify,
  cleanInk,
  inkWarnings,
  type SheetCode,
} from "../core/paper";
import { canvas, toBase64, readImage } from "../core/fonts";
import { download, safeFilename } from "../core/storage";
import { $, esc, input, dialog, field } from "./dom";
type Callbacks = {
  commit: (fn: (p: Project) => void) => void;
  status: (s: string) => void;
  error: (e: unknown) => void;
  scan: () => void;
};
export function renderPaper(
  host: HTMLElement,
  p: Project,
  catalog: Character[],
  cb: Callbacks,
) {
  const packs = [...new Set(catalog.filter((c) => c.paper).map((c) => c.pack))];
  host.innerHTML = `<div class="paper-page"><div class="paper-columns"><div class="paper-actions"><section class="panel"><h3>Drawing sheets</h3><div class="panel-body">${field("Characters", '<select id="paper-set"><option value="standard">Standard paper packs</option><option value="unfinished">Unfinished in this project</option><option value="project">All project characters</option><option value="selected">Selected packs</option></select>')}<div class="pack-list" id="paper-packs" hidden>${packs.map((k) => `<label><input type="checkbox" value="${k}" checked> ${k.replaceAll("-", " ")}</label>`).join("")}</div><span id="paper-count" class="note"></span><button id="print-pdf" class="primary">Download sheets</button><p class="note">US Letter · 30 characters per page<br>Print at 100% / Actual size.</p></div></section><section class="panel"><h3>Bring drawings back</h3><div class="panel-body"><button id="import-scans">Import scans or photos…</button><p class="note">PDF, PNG, JPEG, WebP, TIFF, HEIC</p></div></section><div id="template-history" class="small"></div></div><div class="paper-sheet"><strong>Goosnav Font</strong><div class="note" style="margin-top:4px">${esc(p.name)}</div><div class="mini-cells"></div></div></div></div>`;
  function codes() {
    const mode = input("#paper-set").value;
    return mode === "unfinished"
      ? p.characters.filter((cp) => !p.glyphs[cp])
      : mode === "project"
        ? p.characters
        : catalog
            .filter(
              (c) =>
                c.paper &&
                (mode !== "selected" ||
                  [
                    ...host.querySelectorAll<HTMLInputElement>(
                      "#paper-packs input:checked",
                    ),
                  ].some((el) => el.value === c.pack)),
            )
            .map((c) => c.cp);
  }
  function update() {
    const t = makeTemplate(p, codes());
    $("#paper-packs").hidden = input("#paper-set").value !== "selected";
    $("#paper-count").textContent =
      `${t.characters.length} characters · ${t.pages.length} sheets`;
    $(".mini-cells").innerHTML = t.characters
      .slice(0, 30)
      .map(
        (cp) => `<div class="mini-cell">${esc(String.fromCodePoint(cp))}</div>`,
      )
      .join("");
    input("#print-pdf").disabled = !t.characters.length;
  }
  input("#paper-set").onchange = update;
  host
    .querySelectorAll<HTMLInputElement>("#paper-packs input")
    .forEach((el) => (el.onchange = update));
  $("#print-pdf").onclick = async () => {
    const b = input("#print-pdf");
    b.disabled = true;
    try {
      cb.status("Creating printable sheets…");
      const t = makeTemplate(p, codes()),
        bytes = await templatePdf(p, t, catalog);
      cb.commit((next) => next.templates.push(t));
      download(
        bytes,
        safeFilename(p.name) + "-drawing-sheets.pdf",
        "application/pdf",
      );
      cb.status("Drawing sheets ready.");
    } catch (e) {
      cb.error(e);
    } finally {
      b.disabled = false;
    }
  };
  $("#import-scans").onclick = cb.scan;
  $("#template-history").textContent = p.templates.length
    ? `${p.templates.length} template set${p.templates.length === 1 ? "" : "s"} saved in this project`
    : "";
  update();
}
type Review = {
  cp: number;
  raw: HTMLCanvasElement;
  clean: string;
  original: string;
  selected: boolean;
  warnings: string[];
  count: number;
  source: string;
  x: number;
  y: number;
  scale: number;
};
async function alignPage(
  source: HTMLCanvasElement,
  p: Project,
  index: number,
): Promise<{ page: HTMLCanvasElement; code: SheetCode } | "skip" | undefined> {
  const d = dialog(
    `Align sheet ${index + 1}`,
    `<canvas class="corner-canvas" id="corners"></canvas><p class="note">Check the page corners. Drag a blue handle to adjust.</p><div class="inline"><button id="rotate-page">Rotate 90°</button><button id="reset-corners">Reset corners</button></div><div id="page-map"></div><p class="note" id="align-notice">Finding the page…</p><div class="actions"><button id="skip-page">Skip page</button><button class="primary" id="use-page">Review characters</button></div>`,
  );
  d.classList.add("wide");
  const display = $("#corners", d) as HTMLCanvasElement;
  display.width = source.width;
  display.height = source.height;
  let corners = [
      [0, 0],
      [source.width, 0],
      [source.width, source.height],
      [0, source.height],
    ],
    result: { page: HTMLCanvasElement; code: SheetCode } | "skip" | undefined,
    drag = -1;
  let rotated = source,
    alignmentEdited = false;
  function paint() {
    display.width = rotated.width;
    display.height = rotated.height;
    const ctx = display.getContext("2d")!;
    ctx.drawImage(rotated, 0, 0);
    const size = Math.max(rotated.width, rotated.height) / 50;
    ctx.strokeStyle = "#0755d6";
    ctx.lineWidth = size / 6;
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    corners.forEach(([x, y], i) => {
      ctx.fillStyle = "#0755d6";
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `${size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x, y + size / 3);
    });
  }
  function point(e: PointerEvent) {
    const r = display.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * display.width) / r.width,
      ((e.clientY - r.top) * display.height) / r.height,
    ];
  }
  display.onpointerdown = (e) => {
    alignmentEdited = true;
    const pt = point(e);
    drag = corners
      .map((c) => Math.hypot(c[0] - pt[0], c[1] - pt[1]))
      .reduce((best, n, i, arr) => (n < arr[best] ? i : best), 0);
    display.setPointerCapture(e.pointerId);
  };
  display.onpointermove = (e) => {
    if (drag < 0) return;
    corners[drag] = point(e).map((v, i) =>
      Math.max(0, Math.min(i ? display.height : display.width, v)),
    );
    paint();
  };
  display.onpointerup = () => (drag = -1);
  $("#reset-corners", d).onclick = () => {
    alignmentEdited = true;
    corners = [
      [0, 0],
      [rotated.width, 0],
      [rotated.width, rotated.height],
      [0, rotated.height],
    ];
    paint();
  };
  $("#rotate-page", d).onclick = () => {
    alignmentEdited = true;
    const next = canvas(1);
    next.width = rotated.height;
    next.height = rotated.width;
    const ctx = next.getContext("2d")!;
    ctx.translate(next.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(rotated, 0, 0);
    rotated = next;
    corners = [
      [0, 0],
      [next.width, 0],
      [next.width, next.height],
      [0, next.height],
    ];
    paint();
  };
  function fallbackMap() {
    const choices = p.templates.flatMap((t) =>
      t.pages.map((page, i) => ({ id: t.id, version: t.version, page: i, codes: page })),
    );
    $("#page-map", d).innerHTML = `${field(
      "Sheet mapping",
      `<select id="manual-mapping"><option value="">Choose the printed sheet…</option>${choices
        .map(
          (c, i) =>
            `<option value="${i}">${c.id.slice(0, 8)} · page ${c.page + 1} · ${c.codes
              .slice(0, 5)
              .map((cp) => esc(String.fromCodePoint(cp)))
              .join(" ")}</option>`,
        )
        .join("")}</select>`,
    )}${!choices.length ? '<p class="warning">No saved sheet mapping. Open the project used to print these sheets, or ensure the QR code is readable.</p>' : ""}`;
    return choices;
  }
  const mappings = fallbackMap();
  $("#skip-page", d).onclick = () => {
    result = "skip";
    d.close();
  };
  $("#use-page", d).onclick = async () => {
    input("#use-page", d).disabled = true;
    try {
      const out = await rectify(rotated, corners);
      let code = scanCode(out.canvas);
      if (!code) {
        const v = input("#manual-mapping", d).value,
          m = v === "" ? undefined : mappings[Number(v)];
        if (!m) {
          $("#align-notice", d).textContent =
            "QR code was not readable. Choose the printed sheet mapping.";
          return;
        }
        code = { v: m.version, id: m.id, page: m.page, c: m.codes };
      }
      result = { page: out.canvas, code };
      d.close();
    } catch (e) {
      $("#align-notice", d).textContent = String(e);
    } finally {
      input("#use-page", d).disabled = false;
    }
  };
  paint();
  void rectify(source)
    .then((r) => {
      if (!d.open || alignmentEdited) return;
      corners = r.corners;
      paint();
      const code = scanCode(r.canvas);
      $("#align-notice", d).textContent = code
        ? `Sheet ${code.page + 1} identified · ${code.c.length} characters`
        : "Check all four page corners. The QR code is read after alignment.";
    })
    .catch(() => {
      $("#align-notice", d).textContent =
        "Automatic alignment unavailable. Position all four corners manually.";
    });
  return new Promise((resolve) =>
    d.addEventListener("close", () => resolve(result)),
  );
}
function cleanReview(
  item: Review,
  p: Project,
  threshold: number,
  cleanup: number,
) {
  const data = item.raw
      .getContext("2d")!
      .getImageData(0, 0, item.raw.width, item.raw.height),
    clean = cleanInk(data, threshold, cleanup);
  const details = inkWarnings(clean);
  const raw = canvas(item.raw.width);
  raw.getContext("2d")!.putImageData(clean, 0, 0);
  const glyph = canvas(p.settings.resolution * 1.5),
    ctx = glyph.getContext("2d")!;
  ctx.imageSmoothingEnabled = p.settings.mode === "detailed";
  const size = glyph.width * item.scale;
  ctx.drawImage(
    raw,
    (glyph.width - size) / 2 + (item.x * glyph.width) / 100,
    (glyph.height - size) / 2 - (item.y * glyph.height) / 100,
    size,
    size,
  );
  if (p.settings.mode === "pixel") {
    const d = ctx.getImageData(0, 0, glyph.width, glyph.height);
    for (let i = 3; i < d.data.length; i += 4)
      d.data[i] = d.data[i] > 127 ? 255 : 0;
    ctx.putImageData(d, 0, 0);
  }
  item.clean = glyph.toDataURL();
  item.warnings = details.warnings;
  item.count = details.count;
  if (!details.count) item.selected = false;
}
async function reviewSheet(
  page: HTMLCanvasElement,
  code: SheetCode,
  source: string,
  p: Project,
): Promise<Review[] | undefined> {
  const items: Review[] = code.c.map((cp, i) => {
    const r = cellRect(i, code.v),
      raw = canvas(Math.round((r.w * page.width) / 612)),
      ctx = raw.getContext("2d")!;
    ctx.drawImage(
      page,
      (r.x * page.width) / 612,
      (r.y * page.height) / 792,
      (r.w * page.width) / 612,
      (r.h * page.height) / 792,
      0,
      0,
      raw.width,
      raw.height,
    );
    return {
      cp,
      raw,
      clean: "",
      original: raw.toDataURL(),
      selected: true,
      warnings: [],
      count: 0,
      source,
      x: 0,
      y: 0,
      scale: 1,
    };
  });
  let threshold = 160,
    cleanup = 2,
    accepted: Review[] | undefined;
  items.forEach((i) => cleanReview(i, p, threshold, cleanup));
  const d = dialog(
    "Review characters",
    `<div class="inline">${field("Ink threshold", '<input id="scan-threshold" type="range" min="60" max="230" value="160">')}${field("Remove specks", '<input id="scan-cleanup" type="number" min="0" max="40" value="2">')}</div><div class="scan-grid"></div><div class="inline" style="margin-top:12px">${field("Existing characters", '<select id="replace-existing"><option value="keep">Keep existing</option><option value="replace">Replace selected</option></select>')}</div><div class="actions"><button id="cancel-review">Cancel</button><button class="primary" id="accept-review">Import selected</button></div>`,
  );
  d.classList.add("wide");
  function grid() {
    const host = $(".scan-grid", d);
    host.innerHTML = items
      .map(
        (item, i) =>
          `<div class="scan-card"><label><input type="checkbox" data-select="${i}" ${item.selected ? "checked" : ""} ${!item.count ? "disabled" : ""}> ${esc(String.fromCodePoint(item.cp))} <small>${p.glyphs[item.cp] ? "Existing" : ""}</small></label><div class="scan-images"><img src="${item.original}" alt="Original"><img src="${item.clean}" alt="Cleaned"></div><small>${esc(item.warnings.join(" · "))}</small><button data-adjust="${i}">Adjust…</button></div>`,
      )
      .join("");
    host
      .querySelectorAll<HTMLInputElement>("[data-select]")
      .forEach(
        (el) =>
          (el.onchange = () =>
            (items[Number(el.dataset.select)].selected = el.checked)),
      );
    host
      .querySelectorAll<HTMLButtonElement>("[data-adjust]")
      .forEach(
        (el) => (el.onclick = () => adjust(items[Number(el.dataset.adjust)])),
      );
  }
  function adjust(item: Review) {
    const a = dialog(
      `Adjust ${String.fromCodePoint(item.cp)}`,
      `<div class="review-detail"><img src="${item.original}" alt="Original crop"><img id="adjust-preview" src="${item.clean}" alt="Cleaned letter"></div><div class="form-grid">${field("Horizontal position (%)", `<input id="adjust-x" type="number" min="-50" max="50" value="${item.x}">`)}${field("Vertical position (%)", `<input id="adjust-y" type="number" min="-50" max="50" value="${item.y}">`)}${field("Scale", `<input id="adjust-scale" type="number" min="0.2" max="3" step="0.05" value="${item.scale}">`)}${field("Crop border (%)", '<input id="adjust-crop" type="number" min="0" max="25" value="0">')}</div><div class="actions"><button id="adjust-done">Apply</button></div>`,
    );
    const originalRaw = item.raw;
    function update() {
      item.x = Number(input("#adjust-x", a).value);
      item.y = Number(input("#adjust-y", a).value);
      item.scale = Number(input("#adjust-scale", a).value);
      const margin =
        (Number(input("#adjust-crop", a).value) / 100) * originalRaw.width;
      const c = canvas(originalRaw.width);
      c.getContext("2d")!.drawImage(originalRaw, 0, 0);
      if (margin) {
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, c.width, margin);
        ctx.fillRect(0, c.height - margin, c.width, margin);
        ctx.fillRect(0, 0, margin, c.height);
        ctx.fillRect(c.width - margin, 0, margin, c.height);
      }
      item.raw = c;
      cleanReview(item, p, threshold, cleanup);
      (input("#adjust-preview", a) as unknown as HTMLImageElement).src =
        item.clean;
    }
    a.querySelectorAll("input").forEach((el) => (el.oninput = update));
    $("#adjust-done", a).onclick = () => a.close();
    a.addEventListener("close", grid);
  }
  function reprocess() {
    threshold = Number(input("#scan-threshold", d).value);
    cleanup = Number(input("#scan-cleanup", d).value);
    items.forEach((i) => cleanReview(i, p, threshold, cleanup));
    grid();
  }
  input("#scan-threshold", d).onchange = reprocess;
  input("#scan-cleanup", d).onchange = reprocess;
  $("#cancel-review", d).onclick = () => d.close();
  $("#accept-review", d).onclick = () => {
    const replace = input("#replace-existing", d).value === "replace";
    accepted = items.filter(
      (i) => i.selected && i.count > 0 && (replace || !p.glyphs[i.cp]),
    );
    d.close();
  };
  grid();
  return new Promise((resolve) =>
    d.addEventListener("close", () => resolve(accepted)),
  );
}
export async function importScans(files: File[], p: Project, cb: Callbacks) {
  p = structuredClone(p);
  let pageIndex = 0;
  for (const file of files) {
    if (file.size > 80 * 1024 * 1024)
      throw Error("Scan files must be under 80 MB.");
    cb.status(`Reading ${file.name}…`);
    const source: ScanSource = {
      id: createId(),
      name: file.name,
      mime: file.type,
      data: toBase64(new Uint8Array(await file.arrayBuffer())),
    };
    for await (const image of iteratePages(file)) {
      const aligned = await alignPage(image, p, pageIndex++);
      if (aligned === "skip") continue;
      if (!aligned) return;
      const items = await reviewSheet(aligned.page, aligned.code, source.id, p);
      if (!items) return;
      if (!items.length) continue;
      cb.commit((next) => {
        if (!next.scans.some((s) => s.id === source.id))
          next.scans.push(source);
        for (const item of items) {
          const glyph: Glyph = {
            cp: item.cp,
            advance: next.glyphs[item.cp]?.advance ?? 1280,
            status: item.warnings.length ? "review" : "drawn",
            bitmap: item.clean,
            original: item.clean,
            source: source.id,
          };
          next.glyphs[item.cp] = glyph;
          if (!next.characters.includes(item.cp)) next.characters.push(item.cp);
        }
        next.characters.sort((a, b) => a - b);
      });
      for (const item of items)
        p.glyphs[item.cp] = {
          cp: item.cp,
          advance: 1280,
          status: "drawn",
          bitmap: item.clean,
        };
      cb.status(`Imported ${items.length} characters.`);
    }
  }
}
