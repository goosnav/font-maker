import {
  allStyles,
  REFERENCES,
  type Project,
  type Settings,
} from "../core/model";
import { convertResolution, buildFont, seedProject } from "../core/fonts";
import { Painter } from "./painter";
import { mountReferencePicker } from "./reference-picker";
import { dialog, esc, $, input, field } from "./dom";
export function referenceOptions(p: Project, selected = p.settings.reference) {
  return [
    ...REFERENCES.map((r) => ({ id: r.id, name: r.name })),
    ...p.fonts.map((f) => ({ id: f.id, name: f.name + " (imported)" })),
    ...allStyles(p)
      .filter((s) => s.id !== p.styleId)
      .map((s) => ({ id: "style:" + s.id, name: p.name + " — " + s.name })),
  ]
    .map(
      (r) =>
        `<option value="${esc(r.id)}" ${r.id === selected ? "selected" : ""}>${esc(r.name)}</option>`,
    )
    .join("");
}
export function editSettings(
  project: Project,
  start = false,
  seedSource?: string,
): Promise<Project | undefined> {
  const d = dialog(
    start ? "Font settings" : "Project settings",
    `<div class="setup-tabs" role="tablist" aria-label="Font setup"><button type="button" role="tab" id="setup-draw-tab" aria-controls="setup-draw" data-setup="draw">Draw</button><button type="button" role="tab" id="setup-settings-tab" aria-controls="setup-settings" data-setup="settings">Settings</button></div><div class="settings-layout"><div class="settings-controls" id="setup-settings">${field("Family name", `<input id="setting-family" value="${esc(project.name)}" maxlength="100">`)}${field("Drawing mode", '<select id="setting-mode"><option value="pixel">Pixel</option><option value="detailed">Detailed</option></select>')}${field("Pixels per em", '<select id="setting-resolution"></select>')}${field("Reference", `<select id="setting-reference">${referenceOptions(project)}</select>`)}<div class="overlay-row"><label><input id="setting-ref-visible" type="checkbox"> Reference</label><input id="setting-ref-opacity" type="range" min="0" max="1" step="0.01" aria-label="Reference opacity"><input id="setting-ref-color" type="color" aria-label="Reference color"></div><div class="overlay-row"><label><input id="setting-guide-visible" type="checkbox"> Guides</label><input id="setting-guide-opacity" type="range" min="0" max="1" step="0.01" aria-label="Guide opacity"><input id="setting-guide-color" type="color" aria-label="Guide color"></div><label><input id="setting-mono" type="checkbox"> Monospace</label><div class="form-grid">${field("Letter gap", '<input id="setting-spacing" type="number" min="0" max="1024" step="16">')}${field("Space width", '<input id="setting-space" type="number" min="0" max="4096" step="16">')}</div><details class="advanced"><summary>Guidelines and pen</summary><div>${[
      ["ascender", "Ascender"],
      ["descender", "Descender"],
      ["capHeight", "Cap height"],
      ["xHeight", "x-height"],
      ["slant", "Slant angle"],
    ]
      .map(([k, l]) =>
        field(l, `<input id="setting-${k}" type="number" min="0" max="4096">`),
      )
      .join(
        "",
      )}<label><input id="setting-pressure" type="checkbox"> Pen pressure</label>${field("Stroke smoothing", '<input id="setting-smoothing" type="range" min="0" max="0.8" step="0.05">')}</div></details><p class="note">${start ? "Try drawing H. Keep the sample when you start." : "Changes are previewed here. Original artwork is retained."}</p></div><div class="settings-sample" id="setup-draw"><p class="sample-hint">Draw H to test your font.</p><div class="sample-host"></div><div id="reference-notice" class="note" role="status"></div><div class="inline" style="margin-top:8px"><button type="button" id="sample-clear">Clear sample</button><button type="button" id="sample-test">Test font</button></div><div id="sample-text" class="font-swatch" style="margin-top:10px" aria-label="Sample font preview">Font preview</div><p id="sample-notice" class="note" role="status"></p></div></div><div class="actions"><button data-cancel>Cancel</button><button class="primary" id="apply-settings">${start ? "Start drawing" : "Apply settings"}</button></div>`,
  );
  d.classList.add("wide", "settings-dialog");
  const showPane = (pane: string) => {
    $(".settings-layout", d).dataset.pane = pane;
    d.querySelectorAll<HTMLButtonElement>("[data-setup]").forEach(button => {
      const selected = button.dataset.setup === pane;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };
  showPane(start ? "draw" : "settings");
  d.querySelectorAll<HTMLButtonElement>("[data-setup]").forEach(button => {
    button.onclick = () => showPane(button.dataset.setup!);
    button.onkeydown = event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const pane = event.key === "Home" ? "draw" : event.key === "End" ? "settings" : button.dataset.setup === "draw" ? "settings" : "draw";
      showPane(pane);
      $(`[data-setup="${pane}"]`, d).focus();
    };
  });
  let sample = structuredClone(project),
    painter: Painter,
    accepted: Project | undefined,
    seq = 0;
  const cp = 72;
  function mount() {
    painter?.destroy();
    painter = new Painter($(".sample-host", d), sample, cp, (bitmap) => {
      sample.glyphs[cp] = {
        ...sample.glyphs[cp],
        cp,
        advance: sample.glyphs[cp]?.advance ?? 1280,
        status: "drawn",
        bitmap,
      };
      delete sample.glyphs[cp].components;
    }, message => { $("#reference-notice", d).textContent = message; });
    painter.fitToHost(440);
  }
  function resolutions() {
    const mode = input("#setting-mode", d).value;
    $("#setting-resolution", d).innerHTML = (
      mode === "pixel" ? [16, 24, 32, 48, 64] : [256, 512, 1024, 2048]
    )
      .map((n) => `<option>${n}</option>`)
      .join("");
    input("#setting-resolution", d).value = String(
      sample.settings.mode === mode
        ? sample.settings.resolution
        : mode === "pixel"
          ? 16
          : 1024,
    );
  }
  input("#setting-mode", d).value = sample.settings.mode;
  resolutions();
  for (const k of [
    "spacing",
    "space",
    "ascender",
    "descender",
    "capHeight",
    "xHeight",
    "slant",
    "smoothing",
  ] as const)
    input("#setting-" + k, d).value = String(sample.settings[k]);
  input("#setting-mono", d).checked = sample.settings.monospace;
  input("#setting-pressure", d).checked = sample.settings.pressure;
  for (const [prefix, key] of [["ref", "referenceOverlay"], ["guide", "guideOverlay"]] as const) {
    const overlay = sample.settings[key];
    input(`#setting-${prefix}-visible`, d).checked = overlay.visible;
    input(`#setting-${prefix}-opacity`, d).value = String(overlay.opacity);
    input(`#setting-${prefix}-color`, d).value = overlay.color;
  }
  mountReferencePicker($("#setting-reference", d) as HTMLSelectElement, sample);
  function read(): Settings {
    const s = structuredClone(sample.settings);
    s.mode = input("#setting-mode", d).value as Settings["mode"];
    s.resolution = Number(input("#setting-resolution", d).value);
    s.reference = input("#setting-reference", d).value;
    s.monospace = input("#setting-mono", d).checked;
    s.pressure = input("#setting-pressure", d).checked;
    for (const k of [
      "spacing",
      "space",
      "ascender",
      "descender",
      "capHeight",
      "xHeight",
      "slant",
      "smoothing",
    ] as const)
      s[k] = Number(input("#setting-" + k, d).value);
    for (const [prefix, key] of [["ref", "referenceOverlay"], ["guide", "guideOverlay"]] as const) {
      s[key] = {
        visible: input(`#setting-${prefix}-visible`, d).checked,
        opacity: Number(input(`#setting-${prefix}-opacity`, d).value),
        color: input(`#setting-${prefix}-color`, d).value,
      };
    }
    return s;
  }
  async function changed() {
    const id = ++seq,
      settings = read();
    const single: Project = {
      ...sample,
      glyphs: sample.glyphs[cp] ? { [cp]: sample.glyphs[cp] } : {},
    };
    const next = await convertResolution(single, settings);
    if (id !== seq || !d.open) return;
    sample = {
      ...sample,
      settings,
      glyphs: { ...sample.glyphs, ...next.glyphs },
    };
    mount();
  }
  input("#setting-mode", d).onchange = () => {
    resolutions();
    void changed();
  };
  d.querySelectorAll<HTMLInputElement>("input,select").forEach((el) => {
    if (el.id !== "setting-mode") el.onchange = () => void changed();
  });
  for (const prefix of ["ref", "guide"]) for (const kind of ["visible", "opacity", "color"]) {
    const control = input(`#setting-${prefix}-${kind}`, d);
    control.onchange = null;
    control.oninput = () => { sample.settings = read(); painter.project = sample; painter.render(); };
  }
  $("#sample-clear", d).onclick = () => painter.clear();
  $("#sample-test", d).onclick = async () => {
    const button = input("#sample-test", d);
    button.disabled = true;
    try {
      if (!Object.values(sample.glyphs).some(g => g.bitmap || g.base || g.components)) throw Error("Draw a sample first.");
      $("#sample-notice", d).textContent = "Building preview…";
      const bytes = await buildFont(sample, "ttf");
      const face = new FontFace(
        "settings-preview-" + Date.now(),
        bytes as unknown as ArrayBuffer,
      );
      await face.load();
      document.fonts.add(face);
      const characters = [cp, ...sample.characters.filter(code => code !== cp)]
        .filter(code => { const g = sample.glyphs[code]; return g?.bitmap || g?.base || g?.components; })
        .slice(0, 24);
      $("#sample-text", d).dataset.tested = "true";
      $("#sample-text", d).textContent = characters.length === 1 ? String.fromCodePoint(characters[0]).repeat(3) : String.fromCodePoint(...characters);
      $("#sample-text", d).style.fontFamily = `"${face.family}"`;
      $("#sample-notice", d).textContent =
        "Font test passed.";
    } catch (e) {
      $("#sample-notice", d).textContent = e instanceof Error ? e.message : String(e);
    } finally { button.disabled = false; }
  };
  $("#apply-settings", d).onclick = async () => {
    const button = input("#apply-settings", d);
    button.disabled = true;
    const controls = [...d.querySelectorAll<HTMLInputElement>(".settings-layout input, .settings-layout select, .settings-layout button")];
    controls.forEach(control => control.disabled = true);
    $(".sample-host", d).inert = true;
    try {
      const settings = read();
      const candidate = await convertResolution(project, settings, (s) => {
        $("#sample-notice", d).textContent = s;
      });
      candidate.name =
        input("#setting-family", d).value.trim() || "Untitled Font";
      if (seedSource) {
        $("#sample-notice", d).textContent = "Preparing starting font…";
        await seedProject(candidate, seedSource, message => {
          if (d.open) $("#sample-notice", d).textContent = message;
        });
      }
      if (!d.open) return;
      if (sample.glyphs[cp]?.bitmap) {
        candidate.glyphs[cp] = sample.glyphs[cp];
        if (!candidate.characters.includes(cp)) candidate.characters.push(cp);
      }
      accepted = candidate;
      d.close();
    } catch (e) {
      $("#sample-notice", d).textContent = String(e);
      button.disabled = false;
      controls.forEach(control => control.disabled = false);
      $(".sample-host", d).inert = false;
    }
  };
  $("[data-cancel]", d).onclick = () => d.close();
  mount();
  return new Promise((resolve) =>
    d.addEventListener("close", () => {
      painter.destroy();
      resolve(accepted);
    }),
  );
}
