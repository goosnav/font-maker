import {
  rm,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  cp,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = new URL("../", import.meta.url).pathname;
process.chdir(root);
await rm("public/engine/__pycache__", { recursive: true, force: true });
const manifest = [];
const pinned = JSON.parse(await readFile("assets.lock.json", "utf8"));
async function download(url, dest, expected) {
  await mkdir(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
  let data;
  try {
    data = await readFile(dest);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw Error(`${response.status}: ${url}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  const hash = createHash("sha256").update(data).digest("hex");
  expected = expected || pinned.files[dest.replace("public/", "")];
  if (expected && hash !== expected) throw Error(`Checksum mismatch: ${dest}`);
  await writeFile(dest, data);
  manifest.push({
    path: dest.replace("public/", ""),
    source: url,
    sha256: hash,
  });
  console.log(dest);
}
await mkdir("public/runtime/pyodide", { recursive: true });
for (const name of [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
])
  await copyFile(
    `node_modules/pyodide/${name}`,
    `public/runtime/pyodide/${name}`,
  );
const lock = JSON.parse(
  await readFile("node_modules/pyodide/pyodide-lock.json", "utf8"),
);
const pkg = lock.packages.fonttools;
await download(
  `https://cdn.jsdelivr.net/pyodide/v314.0.8/full/${pkg.file_name}`,
  `public/runtime/pyodide/${pkg.file_name}`,
  pkg.sha256,
);
await mkdir("public/runtime/opencv", { recursive: true });
await copyFile(
  "node_modules/@techstark/opencv-js/dist/opencv.js",
  "public/runtime/opencv/opencv.js",
);
await download(
  "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz",
  "node_modules/.cache/liberation.tar.gz",
);
execFileSync("tar", [
  "-xzf",
  "node_modules/.cache/liberation.tar.gz",
  "-C",
  "node_modules/.cache",
]);
for (const face of ["Serif", "Sans", "Mono"])
  await copyFile(
    `node_modules/.cache/liberation-fonts-ttf-2.1.5/Liberation${face}-Regular.ttf`,
    `public/fonts/liberation-${face.toLowerCase()}.ttf`,
  );
await copyFile(
  "node_modules/.cache/liberation-fonts-ttf-2.1.5/LICENSE",
  "public/fonts/Liberation-LICENSE.txt",
);
const google = { sha: pinned.googleFontsRevision };
if (!google.sha) throw Error("Could not resolve Google Fonts revision");
const base = `https://raw.githubusercontent.com/google/fonts/${google.sha}/ofl`;
for (const [id, dir, file] of [
  ["noto-sans", "notosans", "NotoSans[wdth,wght].ttf"],
  ["unifraktur", "unifrakturmaguntia", "UnifrakturMaguntia-Book.ttf"],
  ["comic-neue", "comicneue", "ComicNeue-Regular.ttf"],
  ["paprika", "paprika", "Paprika-Regular.ttf"],
]) {
  await download(
    `${base}/${dir}/${encodeURIComponent(file)}`,
    `public/fonts/${id}.ttf`,
  );
  await download(`${base}/${dir}/OFL.txt`, `public/fonts/${id}-OFL.txt`);
}
await download(
  "https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt",
  "node_modules/.cache/UnicodeData.txt",
);
const rows = (await readFile("node_modules/.cache/UnicodeData.txt", "utf8"))
  .trim()
  .split("\n")
  .map((l) => l.split(";"));
const ranges = [
  ["latin", 0x20, 0x7e, true],
  ["latin", 0xa0, 0xff, true],
  ["latin", 0x100, 0x17f, true],
  ["greek", 0x370, 0x3ff, true],
  ["cyrillic", 0x400, 0x4ff, true],
  ["latin-extended", 0x180, 0x24f, false],
  ["latin-extended", 0x1e00, 0x1eff, false],
  ["greek-extended", 0x1f00, 0x1fff, false],
  ["cyrillic-extended", 0x500, 0x52f, false],
  ["cyrillic-extended", 0x2de0, 0x2dff, false],
  ["cyrillic-extended", 0xa640, 0xa69f, false],
  ["marks", 0x300, 0x36f, false],
  ["punctuation", 0x2000, 0x206f, true],
  ["currency", 0x20a0, 0x20cf, true],
  ["symbols", 0x2100, 0x214f, false],
  ["arrows", 0x2190, 0x21ff, false],
  ["math", 0x2200, 0x22ff, false],
  ["box-drawing", 0x2500, 0x259f, false],
];
const chars = [];
const commonMath = new Set([
  0x2200, 0x2202, 0x2203, 0x2205, 0x2206, 0x2207, 0x2208, 0x2209, 0x220f,
  0x2211, 0x2212, 0x221a, 0x221e, 0x2220, 0x2227, 0x2228, 0x2229, 0x222a,
  0x222b, 0x2248, 0x2260, 0x2261, 0x2264, 0x2265,
]);
for (const [cp, name, category, ccc, bidi, decomposition] of rows) {
  const code = parseInt(cp, 16),
    range = ranges.find((r) => code >= r[1] && code <= r[2]);
  if (!range || !["L", "M", "N", "P", "S", "Z"].includes(category[0])) continue;
  chars.push({
    cp: code,
    name,
    category,
    pack: commonMath.has(code) ? "math-common" : range[0],
    paper: range[3] || commonMath.has(code),
    decomposition:
      decomposition && !decomposition.startsWith("<")
        ? decomposition.split(" ").map((x) => parseInt(x, 16))
        : [],
  });
}
await writeFile(
  "public/catalog.json",
  JSON.stringify({ version: 1, unicode: "17.0.0", characters: chars }),
);
for (const file of await readdir("public/fonts")) {
  const data = await readFile(`public/fonts/${file}`);
  manifest.push({
    path: `fonts/${file}`,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
await writeFile(
  "public/asset-manifest.json",
  JSON.stringify(
    { version: 1, googleFontsRevision: google.sha, files: manifest },
    null,
    2,
  ),
);
console.log(`${chars.length} catalog characters`);
