import type { FontProgress } from "../core/fonts";
import { esc } from "./dom";
export function progressMarkup(label: string) {
  return `<div class="progress-track" role="progressbar" aria-label="${esc(label)}"></div>`;
}
export function updateProgress(track: HTMLElement, progress?: FontProgress) {
  if (!progress) {
    delete track.dataset.determinate;
    track.removeAttribute("aria-valuenow");
    track.removeAttribute("aria-valuemax");
    track.removeAttribute("aria-valuemin");
    return;
  }
  const total = Math.max(1, progress.total);
  const completed = Math.max(0, Math.min(total, progress.completed));
  track.dataset.determinate = "true";
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(total));
  track.setAttribute("aria-valuenow", String(completed));
  track.style.setProperty("--progress", `${100 * completed / total}%`);
}
