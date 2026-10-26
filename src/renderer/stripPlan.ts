// The four-photo plan: a row of four numbered slots over the viewfinder in
// four-photo mode. Linked (the default), every photo uses the live effect.
// Click a slot to give that photo its own effect, or Shuffle for four different
// ones. During the run each slot lights up in turn and fills with its photo.

import { app } from './app';
import { byId, el, clear } from './dom';
import { icon } from './icons';
import { sound } from './sound';
import { ALL_EFFECTS, effectLabel } from './gl/effects';
import { effectDisplayLabel } from './customFilters';
import { openEffectsForSlot } from './effectsMenu';
import { showStripTour } from './tips';

const COUNT = 4;
let slots: string[] | null = null; // null = linked to the live effect
let shooting = -1;
const thumbs: (string | null)[] = [null, null, null, null];
// One-shot motion cues, consumed by the next render.
let landed = -1;
let shuffled = false;

/** The effect photo `i` will be taken with. */
export function planEffect(i: number): string {
  return slots?.[i] ?? app.effect;
}

export function isPlanMixed(): boolean {
  return slots !== null;
}

function setSlots(next: string[] | null): void {
  slots = next;
  render();
}

function assign(i: number, id: string): void {
  const next = slots ? [...slots] : Array.from({ length: COUNT }, () => app.effect);
  next[i] = id;
  setSlots(next.every((e) => e === app.effect) ? null : next);
}

/** Four different effects, never Normal twice. */
export function shufflePlan(random: () => number = Math.random): void {
  const pool = ALL_EFFECTS.map((e) => e.id).filter((id) => id !== 'normal');
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  shuffled = true;
  setSlots(pool.slice(0, COUNT));
  sound.play('button');
}

export function linkPlan(): void {
  setSlots(null);
  sound.play('button');
}

/** Show the row only where it means something: four-photo mode on the live camera. */
export function updatePlanVisibility(): void {
  const visible = app.mode === 'strip' && app.renderer?.supportsEffects !== false;
  byId('stripPlan').classList.toggle('hidden', !visible);
}

/** Re-read the live effect (linked slots follow it). */
export function refreshPlan(): void {
  render();
}

export function beginShoot(): void {
  thumbs.fill(null);
  shooting = 0;
  byId('stripPlan').classList.add('is-shooting');
  render();
}

export function markShot(i: number): void {
  shooting = i;
  render();
}

export function setShotThumb(i: number, dataUrl: string): void {
  thumbs[i] = dataUrl;
  landed = i;
  render();
}

export function endShoot(): void {
  shooting = -1;
  thumbs.fill(null);
  byId('stripPlan').classList.remove('is-shooting');
  render();
}

function render(): void {
  const row = byId('stripPlan');
  clear(row);
  const mixed = slots !== null;
  row.classList.toggle('is-mixed', mixed);
  for (let i = 0; i < COUNT; i++) {
    const id = planEffect(i);
    const name = effectDisplayLabel(id) || effectLabel(id);
    const slot = el('button', {
      className: 'plan-slot',
      type: 'button',
      title: shooting >= 0 ? `Photo ${i + 1}` : `Photo ${i + 1}: ${name}. Click to choose its effect.`,
      ariaLabel: `Photo ${i + 1}, ${name}`,
      dataset: { i: String(i) },
    });
    if (thumbs[i]) {
      const img = el('img');
      img.src = thumbs[i]!;
      img.alt = '';
      slot.appendChild(img);
      slot.classList.add('is-done');
      if (i === landed) slot.classList.add('is-landed'); // the photo pops into its slot
    }
    if (shuffled) {
      slot.classList.add('is-shuffled');
      slot.style.animationDelay = `${i * 55}ms`;
    }
    slot.append(el('span', { className: 'plan-num', text: String(i + 1) }), el('span', { className: 'plan-name', text: name }));
    if (i === shooting && !thumbs[i]) slot.classList.add('is-current');
    slot.disabled = shooting >= 0;
    slot.addEventListener('click', () => {
      if (app.busy) return;
      openEffectsForSlot(id, `Choose the effect for photo ${i + 1}`, (picked) => assign(i, picked));
    });
    row.appendChild(slot);
  }
  const shuffle = el('button', { className: 'plan-tool', type: 'button', title: 'Four different effects', ariaLabel: 'Shuffle effects' }, [icon('shuffle')]);
  shuffle.addEventListener('click', () => shufflePlan());
  const link = el('button', {
    className: `plan-tool${mixed ? '' : ' is-on'}`,
    type: 'button',
    title: mixed ? 'Use the same effect for all four' : 'All four use the current effect',
    ariaLabel: 'Same effect for all four',
  }, [icon('link')]);
  link.setAttribute('aria-pressed', String(!mixed));
  link.addEventListener('click', () => linkPlan());
  const help = el('button', { className: 'plan-tool', type: 'button', title: 'How four photos work', ariaLabel: 'How four photos work' }, [icon('question')]);
  help.addEventListener('click', () => showStripTour());
  shuffle.disabled = link.disabled = help.disabled = shooting >= 0;
  row.append(el('span', { className: 'plan-sep' }), shuffle, link, help);
  landed = -1;
  shuffled = false;
}

export function initStripPlan(): void {
  document.addEventListener('photoshoot:effect', () => {
    if (shooting < 0) render();
  });
  render();
  updatePlanVisibility();
}
