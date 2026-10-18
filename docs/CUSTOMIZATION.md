# Customizing Photoshoot

[Back to the README](../README.md)

## Themes

Six built‑in themes ship with the app and are switchable in Settings:

- **Photo Booth** — the default: dark unified titlebar, a 60 px photo tray, Liquid Glass mode and Effects pills, and the glossy red shutter, all sized from a reference Photo Booth window
- **Studio** — bright, neutral light look
- **Studio Dark** — clean macOS‑style dark mode
- **Classic Metal** — brushed‑aluminium hardware nostalgia
- **Retro Film** — warm vintage photo‑print palette
- **Darkroom** — warm photo‑paper chrome with a deep safelight‑red shutter

Your selected theme persists locally and is restored on restart. Themes are built
on a shared vocabulary of design tokens (colors, spacing, radius, shadow, font,
textures), so they restyle the entire UI — not just a color swap.

### Importing community themes (and the security model)

Photoshoot can import community‑made themes, and treats them as **fully
untrusted** using a zero‑trust model.

A theme "package" is a folder containing a `theme.json` manifest and optional
image files beside it. In Settings → Appearance → **Import Theme…**, choose the
`theme.json`. Example manifest:

```json
{
  "schemaVersion": 1,
  "name": "Sunset Booth",
  "author": "Jane Doe",
  "base": "modern",
  "tokens": {
    "--app-bg": "#1a1030",
    "--accent": "#ff8a5b",
    "--accent-2": "#ffd23f",
    "--radius": "20px",
    "--shadow": "0 18px 50px rgba(0,0,0,0.5)"
  },
  "textures": {
    "--app-bg-texture": "backdrop.png"
  }
}
```

**Imported themes can only ever set validated design tokens.** They are parsed as
data — never executed. The validator (shared by the main process and the
renderer, run twice) enforces:

- A strict **whitelist** of allowed token names and per‑token value types
  (color / length / shadow / font / texture).
- **Forbidden** anywhere: `javascript:`, `expression()`, `url()` to remote/file
  resources, `@import`, HTML/`<script>`, `http(s)://`, `file:`, CSS escapes,
  `;{}` injection, event handlers — rejected.
- Image assets must be **plain leaf filenames** beside the manifest (no `..`, no
  absolute paths, no traversal), within strict **size limits**, and are verified
  by **magic bytes** (PNG/JPEG/WebP) — not by extension. Valid images are inlined
  as `data:` URIs; the renderer never touches the file system.
- Tokens are applied via the CSSOM (`element.style.setProperty`), so a strict
  CSP with **no `unsafe-inline`** is preserved. Invalid tokens are skipped with a
  warning; the rest still apply.

Imported themes live in a controlled app‑data folder. Settings provides
**Remove imported theme** and **Reset to Studio**.

No software can honestly promise zero exploits, but this design eliminates the
obvious paths: no code execution, no remote/network resources, no file access,
no HTML injection, no CSP escape.

---

## Effects & community filters

Effects are organized in a Photo Booth‑style grid (Settings → **Effects**),
paged with dots. **Distortion** effects (Bulge, Dent, Twirl, Squeeze, Fish Eye,
Stretch, Light Tunnel) have a **draggable center** — click‑drag on the preview to
move where the warp is anchored. The **fun‑face** effects use an on‑device
MediaPipe face mesh (the model + WASM are bundled and served locally over a
private `app://` origin in Electron; nothing is ever uploaded), and fall back to
the plain image when no face is detected or the mesh can't load.

### Custom community filters (and the security model)

Beyond themes, Photoshoot can import community **filters** — and treats them, like
themes, as **fully untrusted data, never code.** A filter is a `filter.json`
manifest of clamped numeric color grades plus an **optional** LUT image. In
Settings → **Custom Filters → Import Filter…**, choose the `filter.json` (select
the LUT alongside it on the web). Example manifest:

```json
{
  "schemaVersion": 1,
  "name": "Golden Hour",
  "author": "Jane Doe",
  "params": {
    "brightness": 0.05,
    "contrast": 1.15,
    "saturation": 1.25,
    "temperature": 0.4,
    "tint": -0.05,
    "gamma": 1.0,
    "fade": 0.15,
    "vignette": 0.3,
    "grain": 0.08,
    "hue": 0,
    "lutAmount": 1.0
  },
  "lut": "golden-hour.png"
}
```

The imported filter appears as a tile in the Effects grid. The validator (shared
by the main process, the web app, and the renderer) enforces:

- **Every parameter is coerced to a finite number and hard‑clamped** to a fixed
  range. Unknown keys are ignored; `NaN`/`Infinity` fall back to the default.
  The full, fixed vocabulary is the eleven grades above — nothing else is read.
- The optional **LUT must be a real PNG of exactly 512×512** (a 64‑level cube),
  checked by **magic bytes _and_ the PNG `IHDR` dimensions** — not the extension.
  Its reference must be a **plain leaf filename** beside the manifest (no `..`, no
  absolute paths). Valid LUTs are inlined as a `data:` URI.
- Filters are applied by **one fixed, audited GLSL shader** that only reads those
  numbers and (optionally) samples the LUT texture. **No part of a manifest ever
  becomes shader source, JavaScript, CSS, or HTML.** The worst a malicious filter
  can do is make an ugly picture.

A documented example manifest lives in [`examples/filters/`](../examples/filters/).
Imported filters live in a controlled app‑data folder; Settings provides
**Remove** per filter.

