# Photoshoot community filters

A **filter** is a small JSON file describing a color grade. It is pure data — it
contains only numbers (and an optional LUT image). Photoshoot applies it through
one fixed, audited shader, so a filter can never run code, reach the network, or
touch your files. The worst a bad filter can do is look ugly.

Import one in the app: **Settings → Custom Filters → Import Filter…**, then pick
the `*.filter.json`. (On the web, multi‑select the JSON **and** its LUT together.)

## Format

```jsonc
{
  "schemaVersion": 1,          // optional; must be <= the app's version (1)
  "name": "Golden Hour",       // shown on the tile; sanitized, <= 48 chars
  "author": "Jane Doe",        // sanitized, <= 48 chars
  "description": "…",          // optional, <= 200 chars
  "params": { … },             // see below — every value is clamped
  "lut": "golden-hour.png"     // optional; a 512x512 PNG beside this file
}
```

### Parameters

Every parameter is optional. Anything missing, non‑numeric, `NaN`, or `Infinity`
falls back to the default; values outside the range are clamped. Unknown keys are
ignored.

| key           | range        | default | effect                                   |
| ------------- | ------------ | ------- | ---------------------------------------- |
| `brightness`  | −1 … 1       | 0       | adds/subtracts light                     |
| `contrast`    | 0 … 2.5      | 1       | 1 = unchanged                            |
| `saturation`  | 0 … 2.5      | 1       | 0 = grayscale, 1 = unchanged             |
| `temperature` | −1 … 1       | 0       | − cooler (blue), + warmer (red)          |
| `tint`        | −1 … 1       | 0       | − magenta, + green                       |
| `gamma`       | 0.2 … 3      | 1       | midtone curve; 1 = unchanged             |
| `fade`        | 0 … 1        | 0       | lifts the blacks for a matte look        |
| `vignette`    | 0 … 1        | 0       | darkens the corners                      |
| `grain`       | 0 … 1        | 0       | adds film grain                          |
| `hue`         | −180 … 180   | 0       | rotates hue, in degrees                  |
| `lutAmount`   | 0 … 1        | 1       | how strongly the LUT (if any) is applied |

The grades are applied in order: brightness → contrast → saturation →
temperature → tint → gamma → fade → hue → LUT → vignette → grain.

### Optional LUT

A LUT (lookup table) is a full color grade baked into an image. Photoshoot uses
the common **512×512, 64‑level square LUT** layout (an 8×8 grid of 64×64 tiles).
Drop a neutral LUT into any image editor, grade it, export as PNG, and reference
it with `"lut": "your-lut.png"` beside the manifest.

The LUT must be a real PNG of **exactly 512×512** — verified by the PNG header,
not the file extension. The reference must be a plain file name (no `/`, no `..`).

## Why it's safe

The validator runs in the importer **and** again in the renderer. It coerces and
clamps every number, drops unknown keys, sanitizes the strings, and validates the
LUT by magic bytes and `IHDR` dimensions. None of the manifest ever becomes
shader source, JavaScript, CSS, or HTML. See `src/shared/filter-schema.ts`.
