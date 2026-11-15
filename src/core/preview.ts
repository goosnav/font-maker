import { buildFont } from "./fonts";
import type { Project } from "./model";
const cache = new Map<Project, Promise<FontFace>>();
let serial = 0;
export function previewFont(project: Project) {
  const key = project;
  if (!cache.has(key)) {
    const snapshot = structuredClone(project);
    const promise = (async () => {
      const bytes = await buildFont(snapshot, "ttf");
      const face = new FontFace(`gfn-preview-${++serial}`, bytes as unknown as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      return face;
    })().catch(error => { cache.delete(key); throw error; });
    cache.set(key, promise);
    if (cache.size > 3) {
      const oldest = cache.keys().next().value!;
      const previous = cache.get(oldest)!;
      cache.delete(oldest);
      void previous.then(face => document.fonts.delete(face)).catch(() => {});
    }
  }
  return cache.get(key)!;
}
