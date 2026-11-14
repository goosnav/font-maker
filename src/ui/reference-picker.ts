import { allStyles, REFERENCES, type Project } from "../core/model";
import { glyphCanvas, loadFace } from "../core/fonts";
import { $, dialog, esc } from "./dom";

const roles: Record<string, string> = {
  "noto-sans": "Sans serif · Latin, Greek & Cyrillic",
  "liberation-serif": "Serif",
  "liberation-sans": "Sans serif",
  "liberation-mono": "Monospace",
  unifraktur: "Old English · blackletter",
  "comic-neue": "Comic",
  paprika: "Decorative",
};

/** Keep the native value/change contract while offering reliable font previews. */
export function mountReferencePicker(select: HTMLSelectElement, project?: Project) {
  const choices = [
    ...REFERENCES.map(r => ({ id: r.id, name: r.name, role: roles[r.id] })),
    ...(project?.fonts ?? []).map(f => ({ id: f.id, name: f.name, role: "Imported font" })),
    ...(project ? allStyles(project).filter(s => s.id !== project.styleId).map(s => ({
      id: "style:" + s.id, name: project.name + " — " + s.name, role: "Your drawing",
    })) : []),
  ];
  select.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reference-trigger";
  button.setAttribute("aria-label", "Choose reference font");
  button.setAttribute("aria-haspopup", "dialog");
  select.after(button);
  let generation = 0;
  const update = async () => {
    const current = ++generation;
    const choice = choices.find(c => c.id === select.value);
    button.innerHTML = `<span class="reference-name">${esc(choice?.name ?? "Choose font")}</span><span aria-hidden="true">▾</span>`;
    if (choice && !choice.id.startsWith("style:")) {
      try {
        const family = await loadFace(choice.id, project);
        if (generation === current) $(".reference-name", button).style.fontFamily = `"${family}"`;
      } catch { button.title = "Reference could not load. Choose again to retry."; }
    }
  };
  select.addEventListener("change", update);
  void update();
  button.onclick = () => {
    const d = dialog("Reference font", `<div class="reference-list">${choices.map(c =>
      `<button type="button" class="reference-choice" data-reference="${esc(c.id)}" aria-label="${esc(c.name + ", " + c.role)}" aria-pressed="${select.value === c.id}"><span class="reference-name">${esc(c.name)}</span><span class="reference-role">${esc(c.role)}</span><span class="reference-example" aria-hidden="true">Aa Bb 0123</span></button>`,
    ).join("")}</div>`);
    d.classList.add("reference-dialog");
    d.querySelectorAll<HTMLButtonElement>("[data-reference]").forEach(choice => {
      const id = choice.dataset.reference!;
      choice.onclick = () => {
        select.value = id;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        d.close();
        button.focus();
      };
      void (async () => {
        try {
          if (id.startsWith("style:") && project) {
            const style = allStyles(project).find(s => s.id === id.slice(6))!;
            const sample = $(".reference-example", choice);
            sample.textContent = "";
            const glyphs = Object.values(style.glyphs).filter(g => g.bitmap || g.base || g.components).slice(0, 6);
            if (!glyphs.length) sample.textContent = "No drawn characters yet";
            for (const g of glyphs) {
              const image = new Image();
              image.src = (await glyphCanvas(g, { ...project, ...style }, 48)).toDataURL();
              sample.append(image);
            }
          } else {
            const face = await loadFace(id, project);
            for (const text of choice.querySelectorAll<HTMLElement>(".reference-name,.reference-example")) text.style.fontFamily = `"${face}"`;
          }
          choice.dataset.loaded = "true";
        } catch {
          $(".reference-example", choice).textContent = "Preview unavailable";
        }
      })();
    });
    d.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  };
}
