// Tips: a Mac-style popover that points at one control at a time. Two tours —
// the first-launch tour of the window, and a tutorial the first time someone
// switches to four photos. Never modal: clicking anywhere else, taking a
// picture or pressing Escape puts the tour away for good. Settings → Help →
// Show Tips and the ? on the four-photo row bring them back.

import { app } from './app';
import { byId, el, clear } from './dom';
import { icon, type IconName } from './icons';

type Art = 'countdowns' | 'slots' | 'layouts';

interface Tip {
  anchor: string; // CSS selector
  title: string;
  text: string;
  side: 'top' | 'bottom';
  art?: Art;
}

type Tour = 'main' | 'strip';

const TOURS: Record<Tour, Tip[]> = {
  main: [
    {
      anchor: '#shutter',
      title: 'Take a Picture',
      text: 'Click the camera button or press Space. Option-click skips the countdown; Shift-click skips the flash.',
      side: 'top',
    },
    {
      anchor: '#modeSwitch',
      title: 'Four Photos, Single Photo or Video',
      text: 'Four photos takes a strip like a real photo booth, with a countdown and an effect for every picture.',
      side: 'top',
    },
    {
      anchor: '#btnEffects',
      title: 'Effects and Backdrops',
      text: 'Browse live effects and backdrops. Drag on the picture to move a distortion. Press Escape to go back.',
      side: 'top',
    },
    {
      anchor: '#btnSettings',
      title: 'Settings',
      text: 'Countdown length, flash, sounds, camera and themes. Help lists every shortcut and can show these tips again.',
      side: 'bottom',
    },
  ],
  strip: [
    {
      anchor: '#shutter',
      title: 'Four Photos in a Row',
      text: 'Press the camera button once. Photoshoot takes four photos, with a countdown before each one so you can change pose.',
      side: 'top',
      art: 'countdowns',
    },
    {
      anchor: '#stripPlan .plan-slot',
      title: 'A Look for Every Photo',
      text: 'Click a number to choose the effect for that photo. Photos you leave alone use the current effect.',
      side: 'bottom',
      art: 'slots',
    },
    {
      anchor: '#stripPlan [aria-label="Shuffle effects"]',
      title: 'Feeling Lucky?',
      text: 'Shuffle picks four different effects at once. The link button beside it makes all four the same again.',
      side: 'bottom',
    },
    {
      anchor: '#shutter',
      title: 'Then Make Your Print',
      text: 'After the fourth photo, choose a strip, grid, row or feature, the paper colour, the Photoshoot name, the date and a caption. Then save or share.',
      side: 'top',
      art: 'layouts',
    },
  ],
};

let tour: Tour = 'main';
let step = -1;
let wired = false;
let touched = false; // someone already started using the app: don't interrupt with tips

function art(kind: Art): HTMLElement {
  const box = el('div', { className: `tip-art tip-art-${kind}` });
  if (kind === 'countdowns') {
    const secs = app.settings.countdownSeconds;
    const count = secs > 0 ? Array.from({ length: secs }, (_, k) => secs - k).join('·') : 'Pose';
    for (let i = 1; i <= 4; i++) {
      box.append(el('span', { className: 'tip-cd' }, [el('b', { text: count }), el('span', { text: `Photo ${i}` })]));
    }
  } else if (kind === 'slots') {
    ['Normal', 'Thermal', 'Comic', 'Pop Art'].forEach((name, i) =>
      box.append(el('span', { className: `tip-slot${i === 1 ? ' is-picked' : ''}` }, [el('b', { text: String(i + 1) }), el('span', { text: name })]))
    );
  } else {
    const items: [IconName, string][] = [['layoutStrip', 'Strip'], ['layoutGrid', 'Grid'], ['layoutRow', 'Row'], ['layoutFeature', 'Feature']];
    for (const [name, label] of items) box.append(el('span', { className: 'tip-layout' }, [icon(name), el('span', { text: label })]));
  }
  return box;
}

function place(tip: Tip, anchorEl: Element): void {
  const pop = byId('tipPopover');
  const anchor = anchorEl.getBoundingClientRect();
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
  const tips = TOURS[tour];
  const tip = tips[i];
  const anchor = tip ? document.querySelector(tip.anchor) : null;
  if (!tip || !anchor || anchor.getClientRects().length === 0) {
    finish();
    return;
  }
  step = i;
  byId('tipTitle').textContent = tip.title;
  byId('tipText').textContent = tip.text;
  const artSlot = byId('tipArtSlot');
  clear(artSlot);
  if (tip.art) artSlot.appendChild(art(tip.art));
  byId('tipStep').textContent = `${i + 1} of ${tips.length}`;
  byId('tipNext').textContent = i === tips.length - 1 ? 'Done' : 'Next';
  const pop = byId('tipPopover');
  pop.dataset.tour = tour;
  // Replay the pop-in for each step, like a fresh popover.
  pop.style.animation = 'none';
  void pop.offsetWidth;
  pop.style.animation = '';
  place(tip, anchor);
}

function finish(): void {
  if (step < 0) return;
  step = -1;
  byId('tipPopover').hidden = true;
  if (tour === 'main' && !app.settings.tipsSeen) void app.updateSettings({ tipsSeen: true });
  if (tour === 'strip' && !app.settings.stripTourSeen) void app.updateSettings({ stripTourSeen: true });
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
    const tip = step >= 0 ? TOURS[tour][step] : null;
    const anchor = tip ? document.querySelector(tip.anchor) : null;
    if (tip && anchor) place(tip, anchor);
  });
}

function start(which: Tour): void {
  wire();
  if (step >= 0) finish();
  tour = which;
  show(0);
}

/** Show the window tour from the start (Settings → Help). */
export function showTips(): void {
  start('main');
}

/** Show the four-photo tutorial (the ? on the slot row). */
export function showStripTour(): void {
  start('strip');
}

/** The first time four-photo mode is chosen, once its slot row is on screen. */
export function maybeShowStripTour(): void {
  if (app.settings.stripTourSeen || app.busy) return;
  requestAnimationFrame(() => {
    if (!app.settings.stripTourSeen && app.mode === 'strip' && !app.busy) start('strip');
  });
}

/** First launch only, once the camera is up. */
export function initTips(): void {
  wire();
  if (app.settings.tipsSeen) return;
  const mark = () => (touched = true);
  window.addEventListener('pointerdown', mark, { capture: true, once: true });
  window.addEventListener('keydown', mark, { capture: true, once: true });
  window.setTimeout(() => {
    const busyElsewhere = app.busy || document.querySelector('.panel:not(.hidden), #effectsPanel.is-open, #stripSheet.is-open, #whatsNew:not([hidden])');
    if (!touched && !app.settings.tipsSeen && step < 0 && !busyElsewhere) start('main');
  }, 900);
}
