// The effect registry. Order here is the order shown in the Effects menu.
// `amount` feeds the u_amount uniform; `animated` marks effects that need a
// live u_time clock (so static effects can skip per-frame uniform churn).

export interface EffectDef {
  id: string;
  label: string;
  amount: number;
  animated: boolean;
}

// Ordered so that on the first effects page "Normal" lands in the centre cell
// (index 4 of the 3×3 grid) — the home position the grid zooms out from.
export const EFFECTS: EffectDef[] = [
  { id: 'sepia', label: 'Sepia', amount: 1, animated: false },
  { id: 'bw', label: 'Black & White', amount: 1, animated: false },
  { id: 'thermal', label: 'Thermal', amount: 1, animated: false },
  { id: 'xray', label: 'X‑Ray', amount: 1, animated: false },
  { id: 'normal', label: 'Normal', amount: 0, animated: false },
  { id: 'comic', label: 'Comic Book', amount: 1, animated: false },
  { id: 'popart', label: 'Pop Art', amount: 1, animated: false },
  { id: 'glow', label: 'Glow', amount: 1, animated: false },
  { id: 'bulge', label: 'Bulge', amount: 1, animated: false },
  { id: 'pinch', label: 'Dent / Pinch', amount: 1, animated: false },
  { id: 'twirl', label: 'Twirl', amount: 1, animated: false },
  { id: 'mirror', label: 'Mirror', amount: 1, animated: false },
  { id: 'fisheye', label: 'Fish Eye', amount: 1, animated: false },
  { id: 'stretch', label: 'Stretch', amount: 1, animated: false },
  { id: 'kaleidoscope', label: 'Light Tunnel', amount: 1, animated: true },
];

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));

export function effectLabel(id: string): string {
  return EFFECT_BY_ID.get(id)?.label ?? id;
}
