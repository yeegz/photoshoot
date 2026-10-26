// First-run tips: a Mac-style popover that points at one control at a time.
// Never modal — clicking anywhere else, taking a picture or pressing Escape puts
// the tips away for good. Settings → Help → Show Tips brings them back.

import { app } from './app';
import { byId } from './dom';

interface Tip {
  anchor: string;
  title: string;
  text: string;
  side: 'top' | 'bottom';
}

const TIPS: Tip[] = [
  {
    anchor: 'shutter',
    title: 'Take a Picture',
    text: 'Click the camera button or press Space. Option-click skips the countdown; Shift-click skips the flash.',
    side: 'top',
  },
  {
    anchor: 'modeSwitch',
    title: 'Four Photos, Single Photo or Video',
    text: 'Four photos gives each picture its own countdown. Use the numbered slots to give each one a different effect, then choose a layout for the print.',
    side: 'top',
  },
  {
    anchor: 'btnEffects',
    title: 'Effects and Backdrops',
    text: 'Browse live effects and backdrops. Drag on the picture to move a distortion. Press Escape to go back.',
    side: 'top',
  },
  {
    anchor: 'btnSettings',
    title: 'Settings',
    text: 'Countdown length, flash, sounds, camera and themes. Help lists every shortcut and can show these tips again.',
    side: 'bottom',
  },
];

let step = -1;
let wired = false;
let touched = false; // someone already started using the app: don't interrupt with tips

function place(tip: Tip): void {
  const pop = byId('tipPopover');
  const anchor = byId(tip.anchor).getBoundingClientRect();
  pop.dataset.side = tip.side;
  pop.hidden = false;
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const margin = 12;
  const cx = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(margin, cx - w / 2), window.innerWidth - w - margin);
  const top = tip.side === 'top' ? anchor.top - h - 12 : anchor.bottom + 12;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(margin, top)}px`;
  byId('tipArrow').style.left = `${Math.min(Math.max(14, cx - left - 7), w - 28)}px`;
}

function show(i: number): void {
  const tip = TIPS[i];
  const anchor = document.getElementById(tip?.anchor ?? '');
  if (!tip || !anchor || anchor.getClientRects().length === 0) {
    finish();
    return;
  }
  step = i;
  byId('tipTitle').textContent = tip.title;
  byId('tipText').textContent = tip.text;
  byId('tipStep').textContent = `${i + 1} of ${TIPS.length}`;
  byId('tipNext').textContent = i === TIPS.length - 1 ? 'Done' : 'Next';
  place(tip);
}

function finish(): void {
  if (step < 0) return;
  step = -1;
  byId('tipPopover').hidden = true;
  if (!app.settings.tipsSeen) void app.updateSettings({ tipsSeen: true });
}

function wire(): void {
  if (wired) return;
  wired = true;
  byId('tipNext').addEventListener('click', () => show(step + 1));
  byId('tipSkip').addEventListener('click', () => finish());
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (step >= 0 && !byId('tipPopover').contains(e.target as Node)) finish();
    },
    true
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (step < 0) return;
      if (e.key === 'Escape' || e.code === 'Space') finish();
    },
    true
  );
  window.addEventListener('resize', () => {
    if (step >= 0) place(TIPS[step]);
  });
}

/** Show the tips from the start (Settings → Help). */
export function showTips(): void {
  wire();
  show(0);
}

/** First launch only, once the camera is up. */
export function initTips(): void {
  wire();
  if (app.settings.tipsSeen) return;
  const mark = () => (touched = true);
  window.addEventListener('pointerdown', mark, { capture: true, once: true });
  window.addEventListener('keydown', mark, { capture: true, once: true });
  window.setTimeout(() => {
    const busyElsewhere = app.busy || document.querySelector('.panel:not(.hidden), #effectsPanel.is-open, #stripSheet.is-open');
    if (!touched && !app.settings.tipsSeen && step < 0 && !busyElsewhere) show(0);
  }, 900);
}
