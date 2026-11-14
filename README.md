# Goosnav Font

Draw a typeface on paper or on screen. Create Regular, Bold, Italic, and custom styles, use one style as another’s reference, import existing TTF/OTF fonts, and export TTF/OTF families.

The local and Cloudflare editions share one browser editor and process fonts and scans on the device. Save `.goosnavfont` files for durable storage and transferring projects. The in-app Help tab covers the workflow.

This is a development preview. Cross-built launchers do not establish native platform support. See the downloadable README for verification limits.

## Develop

Requires Node 22.12+ and Python 3.12+ for development.

```sh
npm ci
npm run assets
npm run dev
```

Assets are pinned in `assets.lock.json`. All browser runtimes and open fonts are bundled; production uses no runtime CDN.

```sh
npm test
uv run --with fonttools==4.62.1 python -m unittest discover -s tests -p 'test_*.py'
npm run test:browser
npm run build
python3 app/src/goosnav_font/start.py
```

Browser tests use Chrome, Playwright Firefox, and Playwright WebKit. Install the latter with `npx playwright install firefox webkit`.

## Cloudflare Workers

Connect this repository and select the `main` branch. Use these Workers Builds settings:

- Root directory: repository root (leave blank)
- Build command: `npm run build`
- Deploy command: `npm run deploy`

The build automatically downloads and verifies the pinned fonts and processing assets. It produces `app/static`; do not commit this generated directory. `wrangler.jsonc` configures Workers Static Assets and the OpenCV worker's security policy. No project content is sent to Cloudflare.

For a manual deployment:

```sh
npm ci
npm run build
npm run deploy:check
npx wrangler login
npm run deploy
```

A deleted/rotated build-token error requires selecting a valid token in the Worker's **Settings → Builds**. A repository-fetch error occurs before the build command: check that `main` exists and the Cloudflare GitHub installation can access `goosnav/font-maker`. Neither error is fixed by changing application code.

## Formats

`.goosnavfont` is a versioned ZIP containing all styles, metadata, artwork, original font files, scans, templates, and font notices. TTF uses TrueType outlines; OTF uses CFF outlines. Pixel mode traces exact cell boundaries. FontTools compiles font tables in a Pyodide worker.

TTF/OTF imports retain original source files and horizontal kerning. Variable fonts use their default instance. Complex-script shaping and variable-font authoring are not supported. Scripts beyond Latin, Greek, and Cyrillic may be used as visual references, but their shaping is not guaranteed.

Third-party notices are in `public/THIRD_PARTY.txt`, `public/licenses`, and downloaded font license files. Use imported fonts only with the rights needed to modify and distribute them.

## Package the local preview

On macOS, install Go, uv, and squashfs-tools as build tools, then run:

```sh
python3 tools/package_local.py
```

The script rebuilds all five launcher images, verifies the bundled uv and AppImage runtimes, copies the adjacent `app/` payload, and creates `dist/Goosnav-Font-0.1.1-preview.zip`. It does not certify cross-built launchers as tested on their target operating systems.
