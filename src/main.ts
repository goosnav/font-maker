import "./style.css";
import {
  EM,
  History,
  REFERENCES,
  newProject,
  defaultSettings,
  allStyles,
  addStyle,
  activateStyle,
  currentStyle,
  isSpace,
  isMark,
  parseCharacters,
  label,
  type Project,
  type Character,
  type Glyph,
} from "./core/model";
import {
  buildFont,
  canvas,
  glyphCanvas,
  inspectFont,
  loadFace,
  seedProject,
  setFontNotice,
  toBase64,
  readImage,
} from "./core/fonts";
import {
  encodeProject,
  decodeProject,
  initializeStorage,
  loadRecovery,
  saveRecovery,
  download,
  safeFilename,
  isLocal,
  quit,
} from "./core/storage";
import { Painter, type Tool } from "./ui/painter";
import { editSettings, referenceOptions } from "./ui/settings";
import { icon } from "./ui/icons";
import { mountReferencePicker } from "./ui/reference-picker";
import { HELP } from "./ui/help";
import { $, input, esc, dialog, field, confirmAction } from "./ui/dom";
import { renderPaper, importScans } from "./ui/paper";
import { zipSync } from "fflate";

let catalog: Character[] = [],
  history: History | undefined,
  painter: Painter | undefined,
  tab = "characters",
  activeCP: number | undefined,
  search = "",
  pack = "",
  stateFilter = "",
  scrollTop = 0,
  renderId = 0;
let savedRevision = -1,
  saveHandle: any,
  autoTimer: ReturnType<typeof setTimeout>,
  autoChain = Promise.resolve(),
  busyDepth = 0;
const root = $("#app");
root.innerHTML = `<main class="window"><header class="titlebar"><img src="/brand/logo-icon.svg" alt=""><strong id="title">Goosnav Font</strong><span class="edition">On this device</span></header><nav class="menubar" aria-label="Application menu"><details class="menu"><summary>File</summary><div class="menu-pop"><button data-command="new">New project…</button><button data-command="open">Open project…</button><button data-command="import-font">Import font…</button><hr><button data-command="save">Save project</button><button data-command="save-as">Save project as…</button><button data-command="export">Export font…</button><hr><button data-command="quit">Quit</button></div></details><details class="menu"><summary>Edit</summary><div class="menu-pop"><button data-command="undo">Undo</button><button data-command="redo">Redo</button><hr><button data-command="copy">Copy selection</button><button data-command="paste">Paste selection</button><button data-command="clear">Clear character…</button></div></details><button data-command="settings">Settings</button><button data-command="help">Help</button></nav><div class="toolbar"><button data-command="new" title="New project">New</button><button data-command="open" title="Open project">Open</button><div class="split"><button data-command="save" title="Save project (⌘/Ctrl+S)">${icon("save")} Save</button><details><summary aria-label="Save options">▾</summary><div class="menu-pop"><button data-command="save">Save project</button><button data-command="save-as">Save project as…</button><button data-command="export">Export font…</button></div></details></div><span class="divider"></span><button data-command="undo" title="Undo" aria-label="Undo">↶</button><button data-command="redo" title="Redo" aria-label="Redo">↷</button><span class="spacer"></span><div class="family-bar" hidden><select class="family-select" id="style-select" aria-label="Font style"></select><button data-command="style">+ Style</button></div><div class="tabs" role="tablist" aria-label="Workspace"><button role="tab" data-tab="characters">Characters</button><button role="tab" data-tab="paper">Paper</button><button role="tab" data-tab="preview">Preview</button><button role="tab" data-tab="help">Help</button></div></div><section class="workspace" id="workspace"></section><footer class="statusbar"><span id="status" role="status">Ready</span><span id="save-state"></span><span id="mode-status"></span></footer></main><input id="open-project-file" type="file" accept=".goosnavfont" hidden><input id="import-font-file" type="file" accept=".ttf,.otf" hidden><input id="scan-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.heic,.heif" multiple hidden>`;
const workspace = $("#workspace");
function status(text: string) {
  $("#status").textContent = text;
  const live = document.querySelector(".busy-message");
  if (live) live.textContent = text;
}
setFontNotice(status);
function error(e: unknown) {
  console.error(e);
  const d = dialog(
    "Could not finish",
    `<p class="error">${esc(e instanceof Error ? e.message : String(e))}</p><div class="actions"><button data-close-error>OK</button></div>`,
  );
  $("[data-close-error]", d).onclick = () => d.close();
  status("Your current work has been kept.");
}
async function busy<T>(
  message: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (!busyDepth++) {
    const el = document.createElement("div");
    el.className = "busy";
    el.innerHTML =
      '<div class="busy-box"><div class="busy-message" role="status"></div><div class="progress-track"></div></div>';
    document.body.append(el);
  }
  status(message);
  try {
    return await fn();
  } catch (e) {
    error(e);
    return undefined;
  } finally {
    if (!--busyDepth) document.querySelector(".busy")?.remove();
  }
}
function notify(text: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
}
function project() {
  if (!history) throw Error("Create or open a project first.");
  return history.project;
}
function header() {
  const p = history?.project;
  $("#title").textContent = p
    ? `${p.name} — ${p.styleName} — Goosnav Font`
    : "Goosnav Font";
  $(".family-bar").hidden = !p;
  $("#style-select").innerHTML = p
    ? allStyles(p)
        .map(
          (s) =>
            `<option value="${esc(s.id)}" ${s.id === p.styleId ? "selected" : ""}>${esc(s.name)}</option>`,
        )
        .join("")
    : "";
  $("#mode-status").textContent = p
    ? `${p.settings.mode === "pixel" ? "Pixel" : "Detailed"} · ${p.settings.resolution} px/em`
    : "";
  document
    .querySelectorAll<HTMLButtonElement>("[data-command=undo]")
    .forEach((b) => (b.disabled = !history?.canUndo));
  document
    .querySelectorAll<HTMLButtonElement>("[data-command=redo]")
    .forEach((b) => (b.disabled = !history?.canRedo));
  document
    .querySelectorAll("[data-tab]")
    .forEach((el) =>
      el.setAttribute(
        "aria-selected",
        String((el as HTMLElement).dataset.tab === tab),
      ),
    );
}
function changed(p: Project) {
  header();
  $("#save-state").textContent = "Unsaved changes";
  clearTimeout(autoTimer);
  const snap = structuredClone(p);
  autoTimer = setTimeout(() => {
    autoChain = autoChain
      .catch(() => {})
      .then(async () => {
        try {
          const bytes = await encodeProject(snap);
          await saveRecovery(bytes);
          if (
            history?.project.id === snap.id &&
            history.project.revision === snap.revision
          )
            $("#save-state").textContent = "Recovery saved";
        } catch (e) {
          $("#save-state").textContent = "Autosave unavailable";
          notify(e instanceof Error ? e.message : String(e));
        }
      });
  }, 650);
}
function setProject(p: Project, saved = false) {
  history = new History(p, changed);
  savedRevision = saved ? p.revision : -1;
  saveHandle = undefined;
  activeCP = undefined;
  search = "";
  pack = "";
  stateFilter = "";
  scrollTop = 0;
  tab = "characters";
  changed(p);
  render();
  status("Ready");
}
function commit(edit: (p: Project) => void, redraw = true) {
  history!.commit(edit);
  if (redraw) render();
}
function guardedCommit() {
  const { id, styleId } = project();
  let revision = project().revision;
  return (edit: (p: Project) => void) => {
    const current = project();
    if (current.id !== id || current.styleId !== styleId || current.revision !== revision)
      throw Error("The project changed during processing. Please try the import again.");
    commit(edit);
    revision = project().revision;
  };
}
function go(next: string) {
  if (tab === "characters" && activeCP === undefined)
    scrollTop = document.querySelector(".grid-wrap")?.scrollTop ?? scrollTop;
  tab = next;
  painter?.destroy();
  painter = undefined;
  render();
}
function render() {
  renderId++;
  painter?.destroy();
  painter = undefined;
  header();
  if (tab === "help") {
    renderHelp();
    return;
  }
  if (!history) {
    renderStart();
    return;
  }
  if (tab === "characters") {
    activeCP === undefined ? renderGrid() : renderEditor();
  } else if (tab === "preview") void renderPreview();
  else if (tab === "paper")
    renderPaper(workspace, project(), catalog, {
      commit: guardedCommit(),
      status,
      error,
      scan: () => input("#scan-file").click(),
    });
}
function renderStart() {
  workspace.innerHTML =
    '<div class="start"><img class="mark" src="/brand/logo.svg" alt="Goosnav"><h1>Goosnav Font</h1><div class="start-actions"><button class="primary" data-command="new">New font</button><button data-command="open">Open project</button><button data-command="import-font">Import font</button></div><div class="recent" id="recovery-start" hidden></div></div>';
  void loadRecovery()
    .then((bytes) => {
      const target = document.querySelector("#recovery-start");
      if (!bytes || !target) return;
      target.innerHTML =
        '<div class="recovery-row"><span>Previous session available</span><button id="restore-project">Restore</button></div>';
      target.removeAttribute("hidden");
      $("#restore-project").onclick = () => {
        try {
          setProject(decodeProject(bytes));
        } catch (e) {
          error(e);
        }
      };
    })
    .catch((e) => {
      status("Recovery storage unavailable. Manual project files still work.");
      console.warn(e);
    });
}
function selectedCharacters() {
  return project().characters.map(
    (cp) =>
      catalog.find((c) => c.cp === cp) || {
        cp,
        name: label(cp),
        category: isMark(cp) ? "Mn" : "Lo",
        pack: "custom",
        paper: false,
        decomposition: [],
      },
  );
}
function renderGrid() {
  const p = project();
  workspace.innerHTML = `<div class="filters"><input id="character-search" type="search" aria-label="Search characters" placeholder="Find a character, name, or U+…" value="${esc(search)}"><select id="pack-filter" aria-label="Character pack"><option value="">All characters</option>${[...new Set(selectedCharacters().map((c) => c.pack))].map((k) => `<option value="${k}" ${pack === k ? "selected" : ""}>${esc(k.replaceAll("-", " "))}</option>`).join("")}</select><select id="state-filter" aria-label="Character status"><option value="">All states</option>${[
    ["unfinished", "Unfinished"],
    ["drawn", "Drawn"],
    ["inherited", "Inherited"],
    ["review", "Needs review"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${stateFilter === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select><button id="add-characters">+ Characters</button><span class="count" id="character-count"></span></div><div class="grid-wrap"><div class="glyph-grid"></div></div>`;
  function paintGrid() {
    const id = ++renderId;
    const q = search.toLowerCase();
    const chars = selectedCharacters().filter(
      (c) =>
        (!pack || c.pack === pack) &&
        (!stateFilter ||
          (p.glyphs[c.cp]?.status || "unfinished") === stateFilter) &&
        (!q ||
          String.fromCodePoint(c.cp).toLowerCase() === q ||
          c.name.toLowerCase().includes(q) ||
          label(c.cp).toLowerCase().includes(q)),
    );
    $("#character-count").textContent =
      `${Object.keys(p.glyphs).length} filled · ${chars.length} shown`;
    $(".glyph-grid").innerHTML =
      chars
        .map((c) => {
          const g = p.glyphs[c.cp];
          return `<button class="glyph-cell" data-cp="${c.cp}" data-status="${g?.status || "unfinished"}" aria-label="${esc(c.name)} ${label(c.cp)}" title="${esc(c.name)}"><span class="state">${g?.status === "drawn" ? "✓" : g?.status === "inherited" ? "●" : g?.status === "review" ? "!" : ""}</span><span class="thumb">${g?.bitmap ? `<img src="${g.bitmap}" alt="">` : `<span class="placeholder">${isSpace(c.cp) ? "␣" : esc(String.fromCodePoint(c.cp))}</span>`}</span><span class="caption">${esc(String.fromCodePoint(c.cp))} <span>${label(c.cp)}</span></span></button>`;
        })
        .join("") || '<p class="empty">No matching characters.</p>';
    document.querySelectorAll<HTMLButtonElement>(".glyph-cell").forEach(
      (b) =>
        (b.onclick = () => {
          scrollTop = $(".grid-wrap").scrollTop;
          activeCP = Number(b.dataset.cp);
          render();
        }),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            const cp = Number((entry.target as HTMLElement).dataset.cp),
              g = p.glyphs[cp];
            if (g && !g.bitmap)
              void glyphCanvas(g, p, 64)
                .then((c) => {
                  if (id !== renderId) return;
                  const img = new Image();
                  img.src = c.toDataURL();
                  img.alt = "";
                  entry.target.querySelector(".thumb")?.replaceChildren(img);
                })
                .catch(() => {});
          }
      },
      { root: $(".grid-wrap"), rootMargin: "100px" },
    );
    document
      .querySelectorAll(".glyph-cell")
      .forEach((e) => observer.observe(e));
    setTimeout(() => {
      if (id !== renderId) observer.disconnect();
    }, 30000);
  }
  input("#character-search").oninput = (e) => {
    search = (e.target as HTMLInputElement).value;
    paintGrid();
  };
  input("#pack-filter").onchange = (e) => {
    pack = (e.target as HTMLSelectElement).value;
    paintGrid();
  };
  input("#state-filter").onchange = (e) => {
    stateFilter = (e.target as HTMLSelectElement).value;
    paintGrid();
  };
  $("#add-characters").onclick = addCharacters;
  paintGrid();
  $(".grid-wrap").scrollTop = scrollTop;
}
function renderEditor() {
  const p = project(),
    cp = activeCP!,
    g = p.glyphs[cp];
  const name = catalog.find((c) => c.cp === cp)?.name || label(cp);
  workspace.innerHTML = `<div class="editor-nav"><button id="back-grid">‹ Characters</button><span class="char-symbol">${esc(String.fromCodePoint(cp))}</span><span class="char-name">${esc(name)} <small>${label(cp)}</small></span><button id="prev-char" aria-label="Previous character">‹</button><button id="next-char" aria-label="Next character">›</button><button id="editor-settings">Settings…</button></div><div class="editor"><div class="tools" role="toolbar" aria-label="Drawing tools">${[
    ["pencil", "✎", "Pencil"],
    ["brush", "▰", "Brush"],
    ["eraser", "▱", "Eraser"],
    ["fill", "▨", "Fill"],
    ["line", "╱", "Line"],
    ["rect", "□", "Rectangle"],
    ["ellipse", "○", "Ellipse"],
    ["select", "⬚", "Select / move"],
  ]
    .map(
      ([id, , name]) =>
        `<button class="tool" data-tool="${id}" aria-label="${name}" title="${name}" aria-pressed="${id === "pencil"}">${icon(id)}</button>`,
    )
    .join(
      "",
    )}<label class="tool-size">Size<input id="brush-size" type="number" value="${p.settings.mode === "pixel" ? 1 : 8}" min="1" max="128"></label></div><div class="canvas-host"></div><aside class="side"><section class="panel"><h3>Character</h3><div class="panel-body">${field("Advance width", `<input id="advance" type="number" min="0" max="8192" step="${EM / p.settings.resolution}" value="${g?.advance ?? (isSpace(cp) ? p.settings.space : 1280)}">`)}<div class="inline"><button id="auto-space">Fit width</button><button data-command="clear">Clear</button></div><button id="compose">Compose accent…</button><details class="advanced"><summary>Mark anchor</summary><div class="form-grid">${field("X", `<input id="anchor-x" type="number" value="${g?.anchor?.[0] ?? 640}">`)}${field("Y", `<input id="anchor-y" type="number" value="${g?.anchor?.[1] ?? p.settings.capHeight}">`)}</div></details></div></section><section class="panel"><h3>Reference</h3><div class="panel-body"><select id="editor-reference" aria-label="Reference font">${referenceOptions(p)}</select><div class="inline"><label><input id="ref-visible" type="checkbox" ${p.settings.referenceOverlay.visible ? "checked" : ""}> Show</label><input id="ref-color" type="color" aria-label="Reference color" value="${p.settings.referenceOverlay.color}"></div><input id="ref-opacity" aria-label="Reference opacity" type="range" min="0" max="1" step="0.01" value="${p.settings.referenceOverlay.opacity}"><button data-command="import-font">Import font…</button></div></section><section class="panel"><h3>Guidelines</h3><div class="panel-body"><div class="inline"><label><input id="guides-visible" type="checkbox" ${p.settings.guideOverlay.visible ? "checked" : ""}> Show</label><input id="guides-color" type="color" aria-label="Guide color" value="${p.settings.guideOverlay.color}"></div><input id="guides-opacity" aria-label="Guide opacity" type="range" min="0" max="1" step="0.01" value="${p.settings.guideOverlay.opacity}"><label><input id="pixel-grid" type="checkbox" checked> Pixel grid</label></div></section><section class="panel"><h3>View</h3><div class="panel-body"><div class="inline"><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-label">100%</span><button id="zoom-in" aria-label="Zoom in">+</button></div><button id="restore-original">Restore original</button></div></section></aside></div>`;
  painter = new Painter($(".canvas-host"), p, cp, (bitmap) => {
    commit((next) => {
      next.glyphs[cp] = {
        ...next.glyphs[cp],
        cp,
        advance: isMark(cp) ? 0 : (next.glyphs[cp]?.advance ?? 1280),
        status: "drawn",
        original: next.glyphs[cp]?.original ?? next.glyphs[cp]?.bitmap,
        bitmap,
      };
      delete next.glyphs[cp].components;
    }, false);
    painter!.project = project();
  }, message => { if (message) status(message); });
  mountReferencePicker($("#editor-reference") as HTMLSelectElement, p);
  const host = $(".canvas-host");
  const available = Math.max(192, Math.min(host.clientWidth, host.clientHeight) - 26);
  const fitted = p.settings.mode === "pixel"
    ? Math.floor(available / painter.ink.width) * painter.ink.width
    : available;
  painter.setZoom(fitted / 768);
  $("#zoom-label").textContent = Math.round(painter.zoom * 100) + "%";
  painter.size = p.settings.mode === "pixel" ? 1 : 8;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(
    (b) =>
      (b.onclick = () => {
        painter!.setTool(b.dataset.tool as Tool);
        document
          .querySelectorAll("[data-tool]")
          .forEach((t) => t.setAttribute("aria-pressed", String(t === b)));
      }),
  );
  input("#brush-size").onchange = () =>
    (painter!.size = Math.max(
      1,
      Math.min(128, Number(input("#brush-size").value) || 1),
    ));
  $("#back-grid").onclick = () => {
    activeCP = undefined;
    render();
  };
  $("#prev-char").onclick = () => {
    const index = p.characters.indexOf(cp);
    activeCP = p.characters[Math.max(0, index - 1)];
    render();
  };
  $("#next-char").onclick = () => {
    const index = p.characters.indexOf(cp);
    activeCP = p.characters[Math.min(p.characters.length - 1, index + 1)];
    render();
  };
  $("#editor-settings").onclick = () => void command("settings");
  input("#advance").onchange = () =>
    commit((next) => {
      const advance = Math.max(
        0,
        Math.min(8192, Number(input("#advance").value)),
      );
      if (isSpace(cp)) next.settings.space = advance;
      next.glyphs[cp] = {
        ...next.glyphs[cp],
        cp,
        advance,
        status: next.glyphs[cp]?.status ?? "drawn",
      };
    });
  const overlay = (
    which: "referenceOverlay" | "guideOverlay",
    prefix: string,
  ) => {
    for (const kind of ["visible", "color", "opacity"])
      input("#" + prefix + "-" + kind).oninput = () => {
        commit((next) => {
          const o = next.settings[which];
          o.visible = input("#" + prefix + "-visible").checked;
          o.color = input("#" + prefix + "-color").value;
          o.opacity = Number(input("#" + prefix + "-opacity").value);
        }, false);
        painter!.project = project();
        painter!.render();
      };
  };
  overlay("referenceOverlay", "ref");
  overlay("guideOverlay", "guides");
  input("#pixel-grid").onchange = () => {
    painter!.grid = input("#pixel-grid").checked;
    painter!.render();
  };
  input("#editor-reference").onchange = () =>
    commit(
      (next) => (next.settings.reference = input("#editor-reference").value),
    );
  $("#zoom-in").onclick = () => {
    painter!.setZoom(painter!.zoom * 1.25);
    $("#zoom-label").textContent = Math.round(painter!.zoom * 100) + "%";
  };
  $("#zoom-out").onclick = () => {
    painter!.setZoom(painter!.zoom / 1.25);
    $("#zoom-label").textContent = Math.round(painter!.zoom * 100) + "%";
  };
  $("#auto-space").onclick = () => {
    const c = painter!.ink,
      d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let max = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 127) max = Math.max(max, x);
    commit((next) => {
      const step = EM / next.settings.resolution;
      next.glyphs[cp] = {
        ...next.glyphs[cp],
        cp,
        status: next.glyphs[cp]?.status ?? "drawn",
        advance: Math.max(
          step,
          Math.round(
            (-512 + ((max + 1) * 3072) / c.width + next.settings.spacing) /
              step,
          ) * step,
        ),
      };
    });
  };
  $("#restore-original").onclick = async () => {
    if (g?.original) {
      if (
        await confirmAction(
          "Restore original",
          "Replace this character with its preserved original drawing?",
          "Restore",
        )
      )
        commit((next) => {
          next.glyphs[cp].bitmap = g.original;
        });
    } else if (g?.base) {
      if (
        await confirmAction(
          "Restore imported character",
          "Restore this character from the original font?",
          "Restore",
        )
      )
        commit((next) => {
          delete next.glyphs[cp].bitmap;
          next.glyphs[cp].status = "inherited";
        });
    } else notify("This character has no earlier source.");
  };
  for (const id of ["anchor-x", "anchor-y"])
    input("#" + id).onchange = () =>
      commit((next) => {
        next.glyphs[cp] = {
          ...next.glyphs[cp],
          cp,
          advance: next.glyphs[cp]?.advance ?? 1280,
          status: next.glyphs[cp]?.status ?? "drawn",
          anchor: [
            Number(input("#anchor-x").value),
            Number(input("#anchor-y").value),
          ],
        };
      });
  $("#compose").onclick = composeAccent;
}
function composeAccent() {
  const p = project(),
    cp = activeCP!;
  const original = p.glyphs[cp]?.components;
  const decomp = catalog.find((c) => c.cp === cp)?.decomposition;
  const base = original?.[0]?.cp ?? decomp?.[0] ?? 65,
    mark = original?.[1]?.cp ?? decomp?.[1] ?? 769;
  const d = dialog(
    "Compose accent",
    `<form><div class="form-grid">${field("Base character", `<input id="compose-base" value="${esc(String.fromCodePoint(base))}">`)}${field("Accent", `<input id="compose-mark" value="${esc(String.fromCodePoint(mark))}">`)}${field("Accent X", `<input id="compose-x" type="number" value="${original?.[1]?.x ?? 0}">`)}${field("Accent Y", `<input id="compose-y" type="number" value="${original?.[1]?.y ?? 0}">`)}</div><div class="actions"><button type="submit" class="primary">Compose</button></div></form>`,
  );
  d.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    const b = Array.from(input("#compose-base", d).value)[0]?.codePointAt(0),
      m = Array.from(input("#compose-mark", d).value)[0]?.codePointAt(0);
    if (!b || !m || b === cp || m === cp || !p.glyphs[b] || !p.glyphs[m]) {
      notify(
        "Draw the base and accent first. A character cannot contain itself.",
      );
      return;
    }
    commit((next) => {
      next.glyphs[cp] = {
        cp,
        status: "drawn",
        advance: p.glyphs[b].advance,
        components: [
          { cp: b, x: 0, y: 0 },
          {
            cp: m,
            x: Number(input("#compose-x", d).value),
            y: Number(input("#compose-y", d).value),
          },
        ],
      };
    });
    d.close();
  };
}
async function renderPreview() {
  const p = project();
  workspace.innerHTML = `<div class="preview-page"><div><textarea class="preview-editor" id="preview-text" aria-label="Preview text">${esc(sessionStorage.getItem("gfn-preview") || "The quick brown fox jumps over the lazy dog.\nΑλφάβητο · Алфавит · 0123456789")}</textarea><div class="inline" style="margin-top:10px"><button class="primary" id="refresh-preview">Refresh preview</button><span id="preview-state" class="note"></span></div><div id="specimens"></div></div><aside><section class="panel"><h3>Spacing</h3><div class="panel-body">${field("Space width", `<input id="preview-space" type="number" value="${p.settings.space}" min="0" max="4096">`)}<label><input id="preview-mono" type="checkbox" ${p.settings.monospace ? "checked" : ""}> Monospace</label><button id="apply-spacing">Apply</button></div></section><section class="panel" style="margin-top:12px"><h3>Kerning pair</h3><div class="panel-body">${field("Two characters", '<input id="kern-pair" value="AV">')}${field("Adjustment", '<input id="kern-value" type="number" value="0" min="-2048" max="2048" step="16">')}<button id="set-kern">Set pair</button><div id="kern-list" class="small"></div></div></section><div class="actions"><button data-command="export">Export font…</button></div></aside></div>`;
  let family = "";
  function specimens() {
    const text = input("#preview-text").value;
    sessionStorage.setItem("gfn-preview", text);
    const missing = [
      ...new Set(
        Array.from(text).filter(
          (c) => !/[\s\n]/.test(c) && !p.glyphs[c.codePointAt(0)!],
        ),
      ),
    ];
    $("#preview-state").textContent = missing.length
      ? `Missing: ${missing.join(" ")}`
      : "All characters are present";
    $("#specimens").innerHTML = [16, 24, 48, 72]
      .map(
        (size) =>
          `<section class="specimen"><span class="note">${size} px</span><div class="specimen-line" style="font-size:${size}px;font-family:'${family}',sans-serif">${Array.from(
            text,
          )
            .map((c) =>
              p.glyphs[c.codePointAt(0)!] || /\s/.test(c)
                ? esc(c)
                : `<span class="missing" title="Not drawn">□</span>`,
            )
            .join("")}</div></section>`,
      )
      .join("");
  }
  async function refresh() {
    const id = renderId;
    $("#preview-state").textContent = "Building preview…";
    try {
      const bytes = await buildFont(project(), "ttf");
      family = "preview-" + Date.now();
      const f = new FontFace(family, bytes as unknown as ArrayBuffer);
      await f.load();
      document.fonts.add(f);
      if (id === renderId) specimens();
    } catch (e) {
      if (id === renderId) $("#preview-state").textContent = String(e);
    }
  }
  $("#refresh-preview").onclick = () => void refresh();
  input("#preview-text").oninput = specimens;
  $("#apply-spacing").onclick = () =>
    commit((next) => {
      next.settings.space = Number(input("#preview-space").value);
      next.settings.monospace = input("#preview-mono").checked;
    });
  $("#set-kern").onclick = () => {
    const chars = Array.from(input("#kern-pair").value);
    if (chars.length !== 2) {
      notify("Enter exactly two characters.");
      return;
    }
    const key = chars.map((c) => c.codePointAt(0)).join(",");
    commit(
      (next) =>
        (next.kerning[key] = Math.max(
          -2048,
          Math.min(2048, Number(input("#kern-value").value)),
        )),
    );
  };
  $("#kern-list").textContent = Object.entries(p.kerning)
    .map(
      ([k, v]) =>
        k
          .split(",")
          .map((cp) => String.fromCodePoint(Number(cp)))
          .join("") +
        ": " +
        v,
    )
    .join(" · ");
  specimens();
  await refresh();
}
function renderHelp() {
  workspace.innerHTML =
    '<div class="help-page"><input type="search" class="help-search" id="help-search" placeholder="Search features and help…" aria-label="Search help"><div class="help-list"></div></div>';
  const update = () => {
    const q = input("#help-search").value.toLowerCase();
    $(".help-list").innerHTML =
      HELP.filter((h) => (h.title + " " + h.text).toLowerCase().includes(q))
        .map(
          (h) =>
            `<article class="help-item"><h3>${h.title}</h3><p>${h.text}</p><button data-command="${h.action}">${h.label}</button></article>`,
        )
        .join("") || "<p>No matching topics.</p>";
  };
  input("#help-search").oninput = update;
  update();
}
async function newFont() {
  if (
    history &&
    history.project.revision !== savedRevision &&
    !(await confirmAction(
      "New project",
      "Save a project file first if you want to keep this font. Start a new project?",
      "New project",
    ))
  )
    return;
  const packs = [...new Set(catalog.map((c) => c.pack))];
  const d = dialog(
    "New font",
    `<form>${field("Family name", '<input id="new-name" value="My Font" maxlength="100" required>')}<div class="radio-row"><label><input type="radio" name="start" value="blank" checked> Blank</label><label><input type="radio" name="start" value="seed"> Start from font</label></div>${field("Reference", `<select id="new-reference">${REFERENCES.map((r) => `<option value="${r.id}">${r.name}</option>`).join("")}</select>`)}<fieldset><legend>Character packs</legend><div class="pack-list">${packs.map((k) => `<label><input type="checkbox" name="pack" value="${k}" ${catalog.some((c) => c.pack === k && c.paper) ? "checked" : ""}> ${k.replaceAll("-", " ")}</label>`).join("")}</div></fieldset><div class="actions"><button type="submit" class="primary">Try settings</button></div></form>`,
  );
  mountReferencePicker($("#new-reference", d) as HTMLSelectElement);
  d.querySelector("form")!.onsubmit = async (e) => {
    e.preventDefault();
    const selected = [
      ...d.querySelectorAll<HTMLInputElement>("[name=pack]:checked"),
    ].map((x) => x.value);
    if (!selected.length) {
      notify("Select at least one character pack.");
      return;
    }
    const p = newProject(
      input("#new-name", d).value,
      catalog.filter((c) => selected.includes(c.pack)).map((c) => c.cp),
    );
    p.settings.reference = input("#new-reference", d).value;
    const seed =
      d.querySelector<HTMLInputElement>("[name=start]:checked")!.value ===
      "seed";
    d.close();
    if (seed) {
      const ok = await busy("Preparing starting font…", async () => {
        await seedProject(p, p.settings.reference, status);
        return true;
      });
      if (!ok) return;
    }
    const ready = await editSettings(p, true);
    if (ready) setProject(ready);
  };
}
function addCharacters() {
  const d = dialog(
    "Add characters",
    `<form>${field("Characters or Unicode values", '<input id="additional-chars" placeholder="é Ω Ж → or U+2192">')}<div class="actions"><button type="button" id="add-all">Add expanded catalog</button><button type="submit" class="primary">Add</button></div></form>`,
  );
  d.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    const chars = parseCharacters(input("#additional-chars", d).value);
    commit(
      (p) =>
        (p.characters = [...new Set([...p.characters, ...chars])].sort(
          (a, b) => a - b,
        )),
    );
    d.close();
  };
  $("#add-all", d).onclick = () => {
    commit(
      (p) =>
        (p.characters = [
          ...new Set([...p.characters, ...catalog.map((c) => c.cp)]),
        ].sort((a, b) => a - b)),
    );
    d.close();
  };
}
function styleDialog() {
  if (!history) {
    notify("Create a project first.");
    return;
  }
  const p = project();
  const d = dialog(
    "Add style",
    `<form>${field("Style name", '<input id="style-name" value="Bold" required maxlength="60">')}<div class="radio-row"><label><input type="radio" name="style-start" value="copy" checked> Duplicate ${esc(p.styleName)}</label><label><input type="radio" name="style-start" value="blank"> Blank</label></div><p class="note">${esc(p.styleName)} will be the translucent reference.</p><div class="form-grid">${field("Weight", '<select id="style-weight"><option value="300">Light · 300</option><option value="400">Regular · 400</option><option value="500">Medium · 500</option><option value="600">Semibold · 600</option><option value="700" selected>Bold · 700</option><option value="900">Black · 900</option></select>')}<label class="field"><span>Slant</span><span><input id="style-italic" type="checkbox"> Italic</span></label></div><div class="actions"><button type="submit" class="primary">Create style</button></div></form>`,
  );
  input("#style-name", d).oninput = () => {
    input("#style-italic", d).checked = /italic|oblique/i.test(
      input("#style-name", d).value,
    );
  };
  d.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    const name = input("#style-name", d).value.trim();
    if (allStyles(p).some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      notify("Use a different style name.");
      return;
    }
    commit((next) => {
      addStyle(
        next,
        name,
        d.querySelector<HTMLInputElement>("[name=style-start]:checked")!
          .value === "copy",
      );
      next.weight = Number(input("#style-weight", d).value);
      next.italic = input("#style-italic", d).checked;
    });
    d.close();
  };
}
async function importFontFile(file: File) {
  if (file.size > 25 * 1024 * 1024)
    throw Error("Font files must be under 25 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = "import-" + crypto.randomUUID();
  const holder = history
    ? structuredClone(project())
    : newProject("Imported Font", []);
  holder.fonts.push({
    id,
    name: file.name,
    filename: file.name,
    data: toBase64(bytes),
    copyright: "",
    license: "",
  });
  const info = await busy("Reading font…", () => inspectFont(id, holder));
  if (!info) return;
  const source = holder.fonts.at(-1)!;
  source.name = info.name || file.name;
  source.copyright = info.copyright;
  source.license = info.license;
  await loadFace(id, holder);
  const d = dialog(
    "Import font",
    `<div class="font-swatch" style="font-family:'gfn-${id}'">Aa Bb Cc 0123</div><p><strong>${esc(source.name)}</strong> · ${Object.keys(info.metrics).length} characters</p><form><label><input type="radio" name="import-use" value="reference" ${history ? "checked" : ""} ${history ? "" : "disabled"}> Reference only</label><label><input type="radio" name="import-use" value="style" ${history ? "" : "disabled"}> Editable style in this project</label><label><input type="radio" name="import-use" value="project" ${history ? "" : "checked"}> New editable font project</label>${field("Family name", `<input id="import-family" value="${esc(source.name + " Custom")}" maxlength="100" required>`)}${field("Style name", `<input id="import-style" value="${esc(info.style || "Regular")}" maxlength="60">`)}<p class="note">Use a font you have permission to modify and distribute. Its original file and notices stay in the project.</p><div class="actions"><button type="submit" class="primary">Import</button></div></form>`,
  );
  d.querySelector("form")!.onsubmit = async (e) => {
    e.preventDefault();
    const use = d.querySelector<HTMLInputElement>(
        "[name=import-use]:checked",
      )!.value,
      styleName = input("#import-style", d).value.trim() || "Regular",
      familyName = input("#import-family", d).value.trim() || "Imported Font";
    if (
      use === "style" &&
      allStyles(project()).some(
        (s) => s.name.toLowerCase() === styleName.toLowerCase(),
      )
    ) {
      notify("Choose a different style name for this imported font.");
      return;
    }
    d.close();
    if (use === "reference") {
      commit((p) => {
        p.fonts.push(source);
        p.settings.reference = id;
      });
      return;
    }
    const next =
      use === "project"
        ? newProject(familyName, Object.keys(info.metrics).map(Number))
        : structuredClone(project());
    if (use === "project") {
      next.settings.mode = "detailed";
      next.settings.resolution = 1024;
    }
    if (!next.fonts.some((f) => f.id === id)) next.fonts.push(source);
    if (use === "style") addStyle(next, styleName, false);
    next.styleName = styleName;
    next.weight = info.weight;
    next.italic = info.italic;
    next.characters = [
      ...new Set([
        ...next.characters,
        ...Object.keys(info.metrics).map(Number),
      ]),
    ].sort((a, b) => a - b);
    next.settings.reference = id;
    next.settings.ascender = info.ascender;
    next.settings.descender = info.descender;
    next.settings.capHeight = info.capHeight;
    next.settings.xHeight = info.xHeight;
    const ok = await busy("Importing editable characters…", async () => {
      await seedProject(next, id, status);
      return true;
    });
    if (!ok) return;
    const ready = await editSettings(next, true);
    if (!ready) return;
    if (use === "project") setProject(ready);
    else commit((p) => Object.assign(p, ready));
  };
}
async function saveProject(as = false) {
  if (!history) {
    notify("Create a project first.");
    return;
  }
  const p = structuredClone(project()),
    name = safeFilename(p.name) + ".goosnavfont";
  try {
    if (
      typeof (window as any).showSaveFilePicker === "function" &&
      (as || !saveHandle)
    ) {
      saveHandle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: "Goosnav Font project",
            accept: { "application/zip": [".goosnavfont"] },
          },
        ],
      });
    }
    await busy("Saving project…", async () => {
      const bytes = await encodeProject(p);
      if (saveHandle) {
        const writer = await saveHandle.createWritable();
        await writer.write(bytes);
        await writer.close();
      } else download(bytes, name, "application/zip");
      if (
        history?.project.id === p.id &&
        history.project.revision === p.revision
      ) {
        savedRevision = p.revision;
        $("#save-state").textContent = saveHandle
          ? "Project saved"
          : "Project download ready";
      }
      status(name);
    });
  } catch (e) {
    if ((e as DOMException).name !== "AbortError") error(e);
  }
}
function exportDialog() {
  if (!history) {
    notify("Create a font first.");
    return;
  }
  const p = project(),
    filled = Object.keys(p.glyphs).length,
    gaps = p.characters.filter((cp) => !p.glyphs[cp] && !isSpace(cp)).length;
  const d = dialog(
    "Export font",
    `<form>${field("Format", '<select id="export-format"><option value="both">TTF + OTF</option><option value="ttf">TrueType (.ttf)</option><option value="otf">OpenType (.otf)</option></select>')}${field("Styles", `<select id="export-styles"><option value="current">${esc(p.styleName)}</option><option value="all">Whole family (${allStyles(p).length} styles)</option></select>`)}<p class="note">${filled} characters filled${gaps ? ` · ${gaps} unfinished characters will be omitted` : ""}.</p><div class="actions"><button class="primary" type="submit">Export</button></div></form>`,
  );
  d.querySelector("form")!.onsubmit = async (e) => {
    e.preventDefault();
    const format = input("#export-format", d).value,
      whole = input("#export-styles", d).value === "all";
    d.close();
    const snap = structuredClone(p);
    await busy("Building font…", async () => {
      const styles = whole ? allStyles(snap) : [currentStyle(snap)],
        formats = format === "both" ? ["ttf", "otf"] : [format],
        files: Record<string, Uint8Array> = {};
      for (const style of styles)
        for (const kind of formats) {
          if (!Object.keys(style.glyphs).length) continue;
          const bytes = await buildFont(snap, kind as "ttf" | "otf", style);
          const stem = `${safeFilename(snap.name)}-${safeFilename(style.name)}`;
          const filename = `${stem}.${kind}`;
          files[
            files[filename]
              ? `${stem}-${style.id.slice(0, 8)}.${kind}`
              : filename
          ] = bytes;
        }
      const entries = Object.entries(files);
      if (!entries.length)
        throw Error("Draw or import at least one character first.");
      if (entries.length === 1)
        download(entries[0][1], entries[0][0], "font/" + formats[0]);
      else
        download(
          zipSync(files),
          safeFilename(snap.name) + "-fonts.zip",
          "application/zip",
        );
      status("Font export ready.");
    });
  };
}
async function command(cmd: string) {
  document
    .querySelectorAll<HTMLDetailsElement>("details.menu,.split details")
    .forEach((d) => (d.open = false));
  try {
    switch (cmd) {
      case "new":
        await newFont();
        break;
      case "open":
        input("#open-project-file").click();
        break;
      case "import-font":
        input("#import-font-file").click();
        break;
      case "save":
        await saveProject();
        break;
      case "save-as":
        await saveProject(true);
        break;
      case "export":
        exportDialog();
        break;
      case "settings":
        if (history) {
          const ready = await editSettings(project());
          if (ready) commit((p) => Object.assign(p, ready));
        } else await newFont();
        break;
      case "undo":
        history?.undo();
        render();
        break;
      case "redo":
        history?.redo();
        render();
        break;
      case "style":
        styleDialog();
        break;
      case "copy":
        painter?.copy();
        break;
      case "paste":
        painter?.paste();
        break;
      case "clear":
        if (
          painter &&
          (await confirmAction(
            "Clear character",
            "Clear the current character? You can undo this change.",
            "Clear",
          ))
        ) {
          commit((p) => delete p.glyphs[activeCP!]);
        }
        break;
      case "scan":
        if (history) input("#scan-file").click();
        else await newFont();
        break;
      case "quit":
        if (
          await confirmAction(
            "Quit Goosnav Font",
            "Save your project before closing the app.",
            "Quit",
          )
        ) {
          clearTimeout(autoTimer);
          await autoChain.catch(() => {});
          if (history) await saveRecovery(await encodeProject(project()));
          await quit();
          workspace.innerHTML =
            '<div class="start">Goosnav Font is closed. You can close this tab.</div>';
        }
        break;
      default:
        if (["characters", "paper", "preview", "help"].includes(cmd)) go(cmd);
    }
  } catch (e) {
    error(e);
  }
}
root.addEventListener("click", (e) => {
  const target = (e.target as Element).closest<HTMLElement>(
    "[data-command],[data-tab]",
  );
  if (target?.dataset.command) void command(target.dataset.command);
  if (target?.dataset.tab) go(target.dataset.tab);
});
input("#style-select").onchange = () => {
  const id = input("#style-select").value;
  commit((p) => activateStyle(p, id));
};
input("#open-project-file").onchange = async () => {
  const file = input("#open-project-file").files?.[0];
  if (!file) return;
  input("#open-project-file").value = "";
  if (
    history &&
    project().revision !== savedRevision &&
    !(await confirmAction(
      "Open project",
      "Replace the current project? Save a project file first to keep it.",
      "Open",
    ))
  )
    return;
  await busy("Opening project…", async () =>
    setProject(decodeProject(new Uint8Array(await file.arrayBuffer())), true),
  );
};
input("#import-font-file").onchange = async () => {
  const file = input("#import-font-file").files?.[0];
  input("#import-font-file").value = "";
  if (file)
    try {
      await importFontFile(file);
    } catch (e) {
      error(e);
    }
};
input("#scan-file").onchange = async () => {
  const files = [...(input("#scan-file").files || [])];
  input("#scan-file").value = "";
  if (files.length && history)
    try {
      await importScans(files, project(), {
        commit: guardedCommit(),
        status,
        error,
        scan: () => {},
      });
    } catch (e) {
      error(e);
    }
};
document.addEventListener("keydown", (e) => {
  if (busyDepth || !(e.ctrlKey || e.metaKey) || document.querySelector("dialog[open]"))
    return;
  const target = e.target as HTMLElement;
  if (
    ["INPUT", "TEXTAREA"].includes(target.tagName) &&
    !["s", "o"].includes(e.key.toLowerCase())
  )
    return;
  if (e.key.toLowerCase() === "s") {
    e.preventDefault();
    void saveProject(e.shiftKey);
  }
  if (e.key.toLowerCase() === "o") {
    e.preventDefault();
    input("#open-project-file").click();
  }
  if (e.key.toLowerCase() === "z") {
    e.preventDefault();
    void command(e.shiftKey ? "redo" : "undo");
  }
});
window.addEventListener("beforeunload", (e) => {
  if (history && project().revision !== savedRevision) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function start() {
  try {
    await initializeStorage();
    const r = await fetch("/catalog.json");
    if (!r.ok)
      throw Error(
        "Character catalog is missing. Run npm run assets before building.",
      );
    catalog = (await r.json()).characters;
    header();
    render();
    status("Ready");
    if (isLocal()) $(".edition").textContent = "Local app";
  } catch (e) {
    error(e);
  }
}
void start();
