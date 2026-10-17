# Photo Booth parity: design

**Intent.** Photoshoot should look and behave like the current macOS Photo Booth
(the Liquid Glass era) as closely as original art allows: the same window
anatomy, placement, sizing, depth and motion, plus the functions Photo Booth
has that Photoshoot lacks. The owner supplied a reference screenshot of Photo
Booth (window 1190×972 px at 2×, i.e. 595×486 pt); every number below was
measured from it and is expressed in CSS px (= pt).

**Why.** The app is a "clean-room homage"; the owner wants it to pass as the
real thing on a Windows PC where Photo Booth does not exist.

## Goals

- Window anatomy and proportions identical to the reference at any size.
- Liquid Glass chrome: dark translucent pills with a specular edge, a glossy
  red shutter, a dark unified titlebar, a photo tray band.
- Photo Booth's behaviours: centre countdown numerals, whole-window screen
  flash, 3×3 effects browser with black gutters and page dots, backdrops
  browsed as extra effect pages, review actions on a selected photo.
- Keep everything that already works (effects, strips, video, imports).

## Non-goals and anti-goals

- No Apple assets: no copied icons, sounds, images, fonts or text. Glyphs are
  redrawn, sounds stay synthesized. (Anti-goal: anything that could be taken
  for Apple's files.)
- No light-mode replica. The reference is the dark chrome; it becomes the
  default theme "Photo Booth" (`booth`). Existing themes stay selectable.
- No window-size change for Electron beyond proportions; the viewfinder keeps
  `object-fit: cover`.

## Constraints

- All of `npm run verify` stays green; the `win-d3d11` project stays green.
- No new dependencies. CSS stays CSP-safe (no inline styles, tokens via CSSOM).
- Every colour/size lives in design tokens so imported themes keep working.
- Reduced-motion rules keep applying.

## Measured anatomy (reference → CSS px)

| Region | Reference | Spec |
|---|---|---|
| Titlebar | 57 px tall, bg `#2b2b2d`, traffic lights at x 13, title at x 165 | height **28**, bg token `--app-bg-2: #2b2b2d`, title left-aligned, 15px/600, `rgba(255,255,255,.9)`, 17px after the lights (web: 16px from the left edge), no app mark, no centred title |
| Viewfinder | full width, square corners, black letterbox | `--viewfinder-radius: 0`, `object-fit: cover`, bg `#000` |
| Photo tray band | 120 px tall, bg `#343436`, thumbnails 180×120 flush right, 2 px gaps, 38 px right inset | height **60**, gradient `#3a3a3c → #2e2e30`, thumbnails **90×60** (3:2, `object-fit: cover`, square corners), **1px** gaps, right padding **19**, vertically filling the band (58 tall, 1px top/bottom), scroll horizontally, newest on the right |
| Toolbar | 117 px tall, bg `#1d1d1f` | height **58**, bg `--toolbar-bg: #1d1d1f`, side padding **15** left / **17** right |
| Mode control | pill 188×56 at x 30, cells ~58×47, selected blue `#1b7bf3`, radius ≈ 18 px | pill **94×28**, padding 2, radius **9**; cells **30×24**, radius **7**; selected `--accent: #1b7bf3`; glyphs 18px white (`.85` unselected, `1` selected) |
| Shutter | ⌀100 px, glossy red, white camera glyph ~44 px | **⌀50**, glyph **22**, gradient top `#ff5146` → base `#d61f16` → bottom `#b41109`, 1px rim `rgba(255,255,255,.28)` inset, highlight `inset 0 1px 0 rgba(255,255,255,.45)`, shadow `0 3px 8px rgba(0,0,0,.55)`, press `scale(.94)` |
| Effects pill | 192×54 at right, "Effects" ~17 pt | **96×28**, radius **9**, label 15px/500 white `.92` |
| Liquid Glass pill | translucent, bright 1px edge | fill `rgba(255,255,255,.10)`, hover `.15`, active `.07`; edge `inset 0 0 0 1px rgba(255,255,255,.14)`, specular `inset 0 1px 0 rgba(255,255,255,.22)`; `backdrop-filter: blur(18px) saturate(1.4)` |

## Behaviours (owner's call: match Photo Booth)

- **Countdown:** large white numerals (`clamp(120px, 26vh, 260px)`, 700) in
  the centre of the viewfinder, one per second with the tick sound; the
  toolbar does not turn red (the red bar is removed).
- **Screen flash:** the flash element covers the whole window (fixed, inset 0,
  z above the toolbar), white, 320 ms. A setting "Screen flash" (default on)
  can turn it off; the shutter sound still plays.
- **Effects browser:** 3×3 grid, **2px black** gutters, label centred in each
  tile (white, shadow), active tile 3px blue inset. Page dots **8px**, active
  blue, arrows either side; **←/→ keys** flip pages while open.
- **Backdrops as effect pages:** after the effect pages, the six backdrops are
  shown as tiles (backdrop art, label), nine per page with the centre tile
  "Normal". Picking one runs the existing background flow and closes the
  browser. The Backgrounds titlebar button opens the browser on that page.
- **Review:** clicking a thumbnail shows it in the viewfinder (existing). While
  reviewing, the toolbar right zone shows two glass pills, **Share** (export)
  and **Delete**, in place of Effects; clicking the greyed shutter returns.
- **Full screen:** the titlebar zoom button and **F11 / ⌃⌘F** toggle full
  screen (Electron `setFullScreen`, web Fullscreen API).

## Decided for the builder

- New theme id `booth` (name "Photo Booth", sub "Dark glass") is the default
  (`DEFAULT_SETTINGS.theme`, `deviceTheme()` dark branch, fallback id). `modern`
  remains as "Studio".
- Mode glyphs redrawn: 2×2 rounded squares; person inside a rounded frame;
  video camera (rounded body + lens wedge). Shutter glyph: filled camera.
- The tray is a grid row of the app shell (not an overlay), hidden with no
  captures; the "print" fly animation lands in it.
- Status text ("Camera unavailable") moves to the right side of the titlebar.

## Left to the builder

Exact SVG paths, animation curves beyond the tokens above, the settings copy
for the new switch, and how the backdrop tile art is rendered (reuse
`backgrounds.ts` draw functions at tile size).
