export function esc(value: unknown) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function $(selector: string, root: ParentNode = document) {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw Error(`Missing control: ${selector}`);
  return el;
}
export function input(selector: string, root: ParentNode = document) {
  return $(selector, root) as HTMLInputElement;
}
let dialogSerial = 0;
export function dialog(title: string, html: string) {
  const d = document.createElement("dialog");
  d.className = "dialog";
  d.setAttribute("aria-label", title);
  d.innerHTML = `<div class="dialog-title"><strong>${esc(title)}</strong><button type="button" data-close aria-label="Close dialog">×</button></div><div class="dialog-body">${html}</div>`;
  const actions = d.querySelector<HTMLElement>(".dialog-body > .actions, .dialog-body > form > .actions");
  if (actions) {
    const form = actions.closest("form");
    if (form) {
      form.id ||= `dialog-form-${++dialogSerial}`;
      actions.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
        button.setAttribute("form", form.id);
      });
    }
    actions.classList.add("dialog-footer");
    d.append(actions);
  }
  document.body.append(d);
  d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
export async function confirmAction(
  title: string,
  text: string,
  yes = "Continue",
): Promise<boolean> {
  const d = dialog(
    title,
    `<p>${esc(text)}</p><div class="actions"><button data-no>Cancel</button><button class="primary" data-yes>${esc(yes)}</button></div>`,
  );
  return new Promise((resolve) => {
    let answer = false;
    $("[data-yes]", d).onclick = () => {
      answer = true;
      d.close();
    };
    $("[data-no]", d).onclick = () => d.close();
    d.addEventListener("close", () => resolve(answer));
  });
}
export function field(label: string, control: string) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}
