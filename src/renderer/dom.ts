// Tiny DOM helpers. We never use innerHTML with dynamic data — elements are
// built with createElement and textContent so there is no HTML-injection path,
// which matters because gallery/theme metadata is user-influenced.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function maybe<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function qsa<T extends Element = Element>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}

type ElProps = Partial<{
  className: string;
  text: string;
  title: string;
  type: string;
  ariaLabel: string;
  role: string;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  onClick: (e: MouseEvent) => void;
}>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.type && 'type' in node) (node as HTMLButtonElement).type = props.type as 'button';
  if (props.ariaLabel) node.setAttribute('aria-label', props.ariaLabel);
  if (props.role) node.setAttribute('role', props.role);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  if (props.onClick) node.addEventListener('click', props.onClick as EventListener);
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function show(node: Element): void {
  node.classList.remove('hidden');
}

export function hide(node: Element): void {
  node.classList.add('hidden');
}

/** Resolves after the next animation frame — handy for triggering transitions. */
export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
