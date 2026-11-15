import { previewFont } from "../core/preview";
import { isSpace, type Project } from "../core/model";
import { esc } from "./dom";
export function previewMarkup(text: string, p: Project) {
  return Array.from(text).map(c => p.glyphs[c.codePointAt(0)!] || isSpace(c.codePointAt(0)!) || c === "\n"
    ? esc(c) : `<span class="missing" title="Not drawn: ${esc(c)}" aria-label="Not drawn: ${esc(c)}">□</span>`).join("");
}
export function missingCharacters(text: string, p: Project) {
  return [...new Set(Array.from(text).filter(c => !/\s/.test(c) && !p.glyphs[c.codePointAt(0)!]))];
}
export function mountLivePreview(host: HTMLElement, project: Project, onReady = () => {}) {
  host.innerHTML = `<label class="quick-text-label" for="quick-text">Preview text</label><textarea id="quick-text" rows="3" spellcheck="false" placeholder="Type to preview…">${esc(sessionStorage.getItem("gfn-preview") ?? "The quick brown fox\n0123456789")}</textarea><div class="quick-output" id="quick-output" aria-label="Live font preview" aria-busy="false"></div><div id="quick-state" class="note" role="status"></div><button type="button" id="quick-retry" hidden>Retry preview</button><button type="button" data-command="preview">Full preview…</button>`;
  const text=host.querySelector<HTMLTextAreaElement>("#quick-text")!, output=host.querySelector<HTMLElement>("#quick-output")!, state=host.querySelector<HTMLElement>("#quick-state")!, retry=host.querySelector<HTMLButtonElement>("#quick-retry")!;
  let p=project,serial=0,ready=false;
  function paint() {
    sessionStorage.setItem("gfn-preview",text.value);
    if(!ready && Object.keys(p.glyphs).length) return;
    output.innerHTML=previewMarkup(text.value,p);
    const missing=missingCharacters(text.value,p);
    state.textContent=missing.length?`Not drawn: ${missing.slice(0,18).join(" ")}${missing.length>18?" …":""}`:"";
    output.dataset.revision=String(p.revision);
  }
  async function update(next:Project) {
    p=next;const id=++serial;ready=false;retry.hidden=true;
    if(!Object.keys(p.glyphs).length){output.style.fontFamily="";output.setAttribute("aria-busy","false");paint();return}
    output.setAttribute("aria-busy","true");output.replaceChildren();state.textContent="Updating preview…";
    try {
      const face=await previewFont(p);
      if(id!==serial||!host.isConnected)return;
      output.style.fontFamily=`"${face.family}"`;
      output.setAttribute("aria-busy","false");ready=true;paint();onReady();
    }catch(error){if(id===serial&&host.isConnected){output.setAttribute("aria-busy","false");state.textContent=error instanceof Error?error.message:String(error);retry.hidden=false}}
  }
  text.oninput=paint;retry.onclick=()=>void update(p);
  void update(project);
  return {update,dispose:()=>{serial++}};
}
