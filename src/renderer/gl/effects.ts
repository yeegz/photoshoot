// The effect registry. Order here is the order shown in the Effects menu.
// `amount` feeds the u_amount uniform; `animated` marks effects that need a
// live u_time clock; `draggable` marks distortion effects whose center can be
// moved by dragging on the live preview.

export interface EffectDef {
  id: string;
  label: string;
  amount: number;
  animated: boolean;
  draggable?: boolean;
  face?: boolean; // needs face-landmark tracking
  hint?: string; // what to do to trigger it, shown when the effect is picked
}

// Ordered so "Normal" lands in the centre cell of the first page (index 4) — the
// home position the grid zooms out from. Page 1 = filters, page 2 = distortions.
export const EFFECTS: EffectDef[] = [
  { id: 'sepia', label: 'Sepia', amount: 1, animated: false },
  { id: 'bw', label: 'Black & White', amount: 1, animated: false },
  { id: 'plasticcamera', label: 'Plastic Camera', amount: 1, animated: false },
  { id: 'comic', label: 'Comic Book', amount: 1, animated: false },
  { id: 'normal', label: 'Normal', amount: 0, animated: false },
  { id: 'colorpencil', label: 'Color Pencil', amount: 1, animated: false },
  { id: 'glow', label: 'Glow', amount: 1, animated: false },
  { id: 'thermal', label: 'Thermal', amount: 1, animated: false },
  { id: 'xray', label: 'X‑Ray', amount: 1, animated: false },
  { id: 'bulge', label: 'Bulge', amount: 1, animated: false, draggable: true },
  { id: 'pinch', label: 'Dent', amount: 1, animated: false, draggable: true },
  { id: 'twirl', label: 'Twirl', amount: 1, animated: false, draggable: true },
  { id: 'squeeze', label: 'Squeeze', amount: 1, animated: false, draggable: true },
  { id: 'mirror', label: 'Mirror', amount: 1, animated: false },
  { id: 'kaleidoscope', label: 'Light Tunnel', amount: 1, animated: true, draggable: true },
  { id: 'fisheye', label: 'Fish Eye', amount: 1, animated: false, draggable: true },
  { id: 'stretch', label: 'Stretch', amount: 1, animated: false, draggable: true },
  { id: 'popart', label: 'Pop Art', amount: 1, animated: false },
  // Face-tracked effects (page 3).
  { id: 'bugeyes', label: 'Bug Out', amount: 1, animated: false, face: true },
  { id: 'chipmunk', label: 'Chipmunk', amount: 1, animated: false, face: true },
  { id: 'frog', label: 'Frog', amount: 1, animated: false, face: true },
  { id: 'dizzy', label: 'Dizzy', amount: 1, animated: true, face: true },
  { id: 'bighead', label: 'Blockhead', amount: 1, animated: false, face: true },
  { id: 'nosetwist', label: 'Nose Twirl', amount: 1, animated: false, face: true },
  { id: 'sweetheart', label: 'Lovestruck', amount: 1, animated: false, face: true },
  { id: 'alien', label: 'Space Alien', amount: 1, animated: false, face: true },
];

// The extended library: the looks people use most on social apps, two effects
// from earlier Photo Booth releases (Kaleidoscope, Edge Work) and cute face
// effects. Kept apart from EFFECTS (the Photo Booth set the landing page shows).
// Page 3 gets Doe Eyes in its last cell; then Looks, Fun, and Cute faces.
export const MORE_EFFECTS: EffectDef[] = [
  { id: 'doeeyes', label: 'Doe Eyes', amount: 1, animated: true, face: true, hint: 'Blink' },
  // Looks
  { id: 'film', label: 'Film', amount: 1, animated: true },
  { id: 'disposable', label: 'Disposable', amount: 1, animated: true },
  { id: 'softglam', label: 'Soft Glam', amount: 1, animated: false },
  { id: 'dreamy', label: 'Dreamy', amount: 1, animated: false },
  { id: 'goldenhour', label: 'Golden Hour', amount: 1, animated: false },
  { id: 'noir', label: 'Noir', amount: 1, animated: true },
  { id: 'vhs', label: 'VHS', amount: 1, animated: true },
  { id: 'duotone', label: 'Duotone', amount: 1, animated: false },
  { id: 'lomo', label: 'Lomo', amount: 1, animated: false },
  // Fun
  { id: 'sparkle', label: 'Sparkles', amount: 1, animated: true },
  { id: 'hearts', label: 'Hearts', amount: 1, animated: true },
  { id: 'rainbow', label: 'Rainbow', amount: 1, animated: true },
  { id: 'glitch', label: 'Glitch', amount: 1, animated: true },
  { id: 'neon', label: 'Neon', amount: 1, animated: true },
  { id: 'halftone', label: 'Halftone', amount: 1, animated: false },
  { id: 'pixel', label: 'Pixel', amount: 1, animated: false },
  { id: 'kaleido', label: 'Kaleidoscope', amount: 1, animated: false, draggable: true },
  { id: 'edgework', label: 'Edge Work', amount: 1, animated: false },
  // Cute faces
  { id: 'puppy', label: 'Puppy', amount: 1, animated: true, face: true, hint: 'Open your mouth' },
  { id: 'kitty', label: 'Kitty', amount: 1, animated: true, face: true, hint: 'Raise your eyebrows' },
  { id: 'rainbowmouth', label: 'Rainbow Mouth', amount: 1, animated: true, face: true, hint: 'Open your mouth' },
  { id: 'hearteyes', label: 'Heart Eyes', amount: 1, animated: true, face: true, hint: 'Smile' },
  { id: 'flowercrown', label: 'Flower Crown', amount: 1, animated: true, face: true, hint: 'Raise your eyebrows' },
  { id: 'starry', label: 'Seeing Stars', amount: 1, animated: true, face: true, hint: 'Raise your eyebrows' },
  { id: 'blush', label: 'Blush', amount: 1, animated: false, face: true, hint: 'Smile' },
  { id: 'glam', label: 'Glam', amount: 1, animated: false, face: true, hint: 'Smile' },
];

/** Everything the app offers, in Effects-browser order. */
export const ALL_EFFECTS: EffectDef[] = EFFECTS.concat(MORE_EFFECTS);

export const EFFECT_BY_ID = new Map(ALL_EFFECTS.map((e) => [e.id, e]));

export function effectLabel(id: string): string {
  return EFFECT_BY_ID.get(id)?.label ?? id;
}

export function isDraggable(id: string): boolean {
  return EFFECT_BY_ID.get(id)?.draggable ?? false;
}

export function isFaceEffect(id: string): boolean {
  return EFFECT_BY_ID.get(id)?.face ?? false;
}

export function isCustomFilter(id: string): boolean {
  return id.startsWith('custom:');
}
