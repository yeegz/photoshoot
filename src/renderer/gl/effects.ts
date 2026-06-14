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

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

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
