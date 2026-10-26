// Drawn line icons for messages, toasts and small controls. Same grammar as the
// toolbar glyphs in index.html (24px grid, 1.7 stroke, round caps), so no emoji
// or text symbols ever stand in for an icon.

const NS = 'http://www.w3.org/2000/svg';

type Shape = ['path', string] | ['circle', number, number, number, boolean?] | ['rect', number, number, number, number, number];

const ICONS = {
  lock: [['rect', 5, 10.5, 14, 10, 2.6], ['path', 'M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7'], ['path', 'M12 14.6v2']],
  warning: [['path', 'M10.4 4.4a1.85 1.85 0 0 1 3.2 0l7.1 12.6a1.85 1.85 0 0 1-1.6 2.8H4.9a1.85 1.85 0 0 1-1.6-2.8Z'], ['path', 'M12 9.4v4.3'], ['circle', 12, 16.7, 0.4, true]],
  camera: [['path', 'M8.6 5.6 7.5 7.2H5a2 2 0 0 0-2 2v8.6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.2a2 2 0 0 0-2-2h-2.5l-1.1-1.6Z'], ['circle', 12, 13.2, 3.4]],
  cameraOff: [['path', 'M9.4 5.6h5.2l1.1 1.6H19a2 2 0 0 1 2 2v8.2M18.4 19.8H5a2 2 0 0 1-2-2V9.2a2 2 0 0 1 2-2h1.6'], ['path', 'M10 10.6a3.4 3.4 0 0 0 4.4 4.9'], ['path', 'M3.5 3.5l17 17']],
  cameraBusy: [['path', 'M8.6 5.6 7.5 7.2H5a2 2 0 0 0-2 2v8.6a2 2 0 0 0 2 2h7.2'], ['path', 'M15.4 5.6l1.1 1.6H19a2 2 0 0 1 2 2v1.4'], ['circle', 17.5, 17, 3.6], ['path', 'M17.5 15.4V17l1 .8']],
  globeLock: [['circle', 11, 11, 7.5], ['path', 'M3.5 11h15M11 3.5c2.1 2.2 3 4.7 3 7.5M11 3.5c-2.1 2.2-3 4.7-3 7.5s.9 5.3 3 7.5'], ['rect', 15, 16.4, 6.6, 5, 1.3], ['path', 'M16.4 16.4v-1.1a1.9 1.9 0 0 1 3.8 0v1.1']],
  graphics: [['rect', 3, 5, 18, 12, 2.2], ['path', 'M8 20.5h8M12 17v3.5'], ['path', 'M12 8.6v3.4'], ['circle', 12, 14.4, 0.4, true]],
  close: [['path', 'M6.5 6.5l11 11M17.5 6.5l-11 11']],
  play: [['path', 'M8.5 6.2v11.6a.8.8 0 0 0 1.2.7l9.2-5.8a.8.8 0 0 0 0-1.4L9.7 5.5a.8.8 0 0 0-1.2.7Z']],
  info: [['circle', 12, 12, 8.6], ['path', 'M12 11v5.2'], ['circle', 12, 7.9, 0.4, true]],
  check: [['path', 'M5.5 12.6l4.2 4.2 8.8-9.6']],
  shuffle: [['path', 'M3.5 7.5h3.2c2 0 3.2 1 4.3 2.7l2 3.6c1.1 1.7 2.3 2.7 4.3 2.7h3.2'], ['path', 'M3.5 16.5h3.2c1.4 0 2.4-.5 3.2-1.4M13.8 8.9c.8-.9 1.8-1.4 3.2-1.4h3.5'], ['path', 'M18.2 5.2l2.3 2.3-2.3 2.3M18.2 14.2l2.3 2.3-2.3 2.3']],
  link: [['path', 'M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2'], ['path', 'M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2']],
  share: [['path', 'M8.5 9.5H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5'], ['path', 'M12 14V3.5M8.5 7 12 3.5 15.5 7']],
  retake: [['path', 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3'], ['path', 'M4.2 4.2v3.6h3.6']],
  layoutGrid: [['rect', 4, 4, 7, 7, 1.4], ['rect', 13, 4, 7, 7, 1.4], ['rect', 4, 13, 7, 7, 1.4], ['rect', 13, 13, 7, 7, 1.4]],
  layoutStrip: [['rect', 8, 2.5, 8, 4.2, 1], ['rect', 8, 7.6, 8, 4.2, 1], ['rect', 8, 12.7, 8, 4.2, 1], ['path', 'M8 19.6h8'], ['rect', 8, 2.5, 8, 19, 1.4]],
  layoutRow: [['rect', 2.5, 8.5, 4.2, 6, 0.9], ['rect', 7.6, 8.5, 4.2, 6, 0.9], ['rect', 12.7, 8.5, 4.2, 6, 0.9], ['rect', 17.8, 8.5, 3.7, 6, 0.9]],
  layoutFeature: [['rect', 4, 3.5, 16, 10, 1.4], ['rect', 4, 15.5, 4.6, 4.6, 1], ['rect', 9.7, 15.5, 4.6, 4.6, 1], ['rect', 15.4, 15.5, 4.6, 4.6, 1]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** A new inline SVG for `name`, sized by CSS (1em by default). */
export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const shape of ICONS[name] as Shape[]) {
    let node: SVGElement;
    if (shape[0] === 'path') {
      node = document.createElementNS(NS, 'path');
      node.setAttribute('d', shape[1]);
    } else if (shape[0] === 'circle') {
      node = document.createElementNS(NS, 'circle');
      node.setAttribute('cx', String(shape[1]));
      node.setAttribute('cy', String(shape[2]));
      node.setAttribute('r', String(shape[3]));
      if (shape[4]) node.setAttribute('fill', 'currentColor');
    } else {
      node = document.createElementNS(NS, 'rect');
      node.setAttribute('x', String(shape[1]));
      node.setAttribute('y', String(shape[2]));
      node.setAttribute('width', String(shape[3]));
      node.setAttribute('height', String(shape[4]));
      node.setAttribute('rx', String(shape[5]));
    }
    svg.appendChild(node);
  }
  return svg;
}

/** Replace a container's content with an icon. */
export function setIcon(container: Element, name: IconName, className?: string): void {
  container.replaceChildren(icon(name, className));
}
