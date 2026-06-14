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
];

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

export function effectLabel(id: string): string {
  return EFFECT_BY_ID.get(id)?.label ?? id;
}

export function isDraggable(id: string): boolean {
  return EFFECT_BY_ID.get(id)?.draggable ?? false;
}
