# Goosnav XP logo

The existing Goosnav mark rendered on a small pixel grid, with transparent backgrounds and four edge-coverage levels.

- `goosnav-logo-xp.png`: 48 × 48 welcome-screen mark.
- `goosnav-logo-xp-icon.png`: 24 × 24 title-bar and favicon mark.
- The matching SVG files contain square pixel paths and can be enlarged without smoothing.

The original vector artwork remains in `public/brand/`. Regenerate these assets with `node scripts/make-xp-logo.mjs`. Display the PNGs with `image-rendering: pixelated` to retain the slight crunch on high-density screens.

`cursors/` contains original XP-style arrow, link hand, text, and drawing pointers. The SVG sources use integer-grid shapes; `node scripts/render-cursors.mjs` creates the transparent PNGs used by the browser. Their hotspots are set in `src/cursors.css`. These are authored recreations, not extracted Windows system files.
