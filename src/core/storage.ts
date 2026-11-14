import { createId } from "./id";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateProject, REFERENCES, type Project } from "./model";
import { fromBase64, toBase64 } from "./fonts";
const MAX = 512 * 1024 * 1024;
export async function encodeProject(project: Project): Promise<Uint8Array> {
  const p = structuredClone(project),
    files: Record<string, Uint8Array> = {};
  const add = (path: string, data: string, prefix = "") => {
    files[path] = fromBase64(prefix ? data.slice(prefix.length) : data);
    return "@" + path;
  };
  for (const style of [
    { id: p.styleId, glyphs: p.glyphs },
    ...Object.values(p.styles),
  ])
    for (const g of Object.values(style.glyphs))
      for (const key of ["bitmap", "original"] as const)
        if (g[key])
          g[key] = add(
            `art/${style.id}/${g.cp}-${key}.png`,
            g[key]!,
            "data:image/png;base64,",
          );
  for (const f of p.fonts) f.data = add(`fonts/${f.id}.bin`, f.data);
  for (const s of p.scans) s.data = add(`scans/${s.id}.bin`, s.data);
  for (const id of p.licenses) {
    const ref = REFERENCES.find((r) => r.id === id);
    if (ref) {
      const response = await fetch(`/fonts/${ref.license}`);
      if (!response.ok) throw Error("Font license could not be saved.");
      files[`licenses/${ref.license}`] = strToU8(await response.text());
    } else {
      const f = p.fonts.find((f) => f.id === id);
      if (f)
        files[`licenses/${f.id}.txt`] = strToU8(f.copyright + "\n" + f.license);
    }
  }
  files["project.json"] = strToU8(JSON.stringify(p));
  return zipSync(files, { level: 6 });
}
export function decodeProject(bytes: Uint8Array): Project {
  if (bytes.length > MAX) throw Error("Project exceeds the 512 MB limit.");
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (
        f.name.startsWith("/") ||
        f.name.includes("..") ||
        f.name.includes("\\")
      )
        throw Error("Unsafe path in project.");
      total += f.originalSize;
      if (total > MAX) throw Error("Expanded project exceeds 512 MB.");
      return true;
    },
  });
  if (!files["project.json"]) throw Error("Project metadata is missing.");
  const p = JSON.parse(strFromU8(files["project.json"]));
  // Version 1 without styles was the early single-style development format.
  if (p.format === "goosnavfont" && p.version === 1 && !p.styleId) {
    p.styleId = createId();
    p.styleName = "Regular";
    p.weight = 400;
    p.italic = false;
    p.styles = {};
    p.fonts = [];
  }
  const resolve = (value: unknown, prefix = "") => {
    if (typeof value !== "string") throw Error("Invalid project asset.");
    if (!value.startsWith("@")) return value;
    const bytes = files[value.slice(1)];
    if (!bytes) throw Error("A project asset is missing.");
    return prefix + toBase64(bytes);
  };
  if (
    !p.glyphs ||
    !p.styles ||
    !Array.isArray(p.fonts) ||
    !Array.isArray(p.scans)
  )
    throw Error("Incomplete project.");
  for (const style of [
    { glyphs: p.glyphs },
    ...Object.values(p.styles),
  ] as any[])
    for (const g of Object.values(style.glyphs) as any[])
      for (const key of ["bitmap", "original"])
        if (g[key]) g[key] = resolve(g[key], "data:image/png;base64,");
  for (const f of p.fonts) f.data = resolve(f.data);
  for (const s of p.scans) s.data = resolve(s.data);
  validateProject(p);
  return p;
}
let token: string | undefined;
let local = false;
export async function initializeStorage() {
  if (location.hostname !== "127.0.0.1") return;
  try {
    const r = await fetch("/api/session");
    if (r.ok && r.headers.get("content-type")?.includes("application/json")) {
      const j = await r.json();
      if (typeof j.token === "string") {
        token = j.token;
        local = true;
      }
    }
  } catch {}
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("goosnav-font", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("recovery");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveRecovery(bytes: Uint8Array) {
  if (local) {
    const r = await fetch("/api/recovery", {
      method: "PUT",
      headers: { "X-Goosnav-Token": token! },
      body: new Blob([bytes as BlobPart]),
    });
    if (!r.ok)
      throw Error("Autosave failed. Save a project file to keep your work.");
    return;
  }
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction("recovery", "readwrite");
    tx.objectStore("recovery").put(bytes, "latest");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  d.close();
}
export async function loadRecovery(): Promise<Uint8Array | undefined> {
  if (local) {
    const r = await fetch("/api/recovery");
    if (r.status === 404) return;
    if (!r.ok) throw Error("Recovery could not be read.");
    return new Uint8Array(await r.arrayBuffer());
  }
  const d = await db();
  const out = await new Promise<Uint8Array | undefined>((resolve, reject) => {
    const r = d.transaction("recovery").objectStore("recovery").get("latest");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  d.close();
  return out;
}
export async function quit() {
  if (local) {
    const r = await fetch("/api/quit", {
      method: "POST",
      headers: { "X-Goosnav-Token": token! },
    });
    if (!r.ok) throw Error("Could not close the local app.");
  } else window.close();
}
export function isLocal() {
  return local;
}
export function download(
  data: Uint8Array | Blob,
  name: string,
  mime = "application/octet-stream",
) {
  const blob =
    data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function safeFilename(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "Untitled Font"
  );
}
