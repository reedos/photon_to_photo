import { glossaryEntry, glossSegments } from './glossary';
import '../styles/gloss.css';

// Glossary notes where the reader works (score loop r2, 10/11/2026): a term in a card, the tour's reading dialog or
// a lesson note becomes a small button that opens its glossary definition in one shared popover, with a link to the
// Glossary page. The button's text is the term exactly as written, so the element's text reads the same as before.

let pop: HTMLElement | null = null;
let openFor: HTMLElement | null = null;

function popover(): HTMLElement {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'gloss-pop'; pop.className = 'gloss-pop'; pop.setAttribute('popover', 'auto'); pop.setAttribute('role', 'note');
  pop.innerHTML = '<b></b><p></p><a href="./reference.html?page=glossary" target="_blank" rel="noopener">Open the glossary ↗</a>';
  pop.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed') { openFor?.setAttribute('aria-expanded', 'false'); openFor = null; }
  });
  // a dialog's top layer would sit above a body-level popover; keep the popover beside its button's dialog
  document.body.append(pop);
  return pop;
}

function show(button: HTMLElement): void {
  const entry = glossaryEntry(button.dataset.term ?? '');
  if (!entry) return;
  const p = popover();
  const host = button.closest('dialog') ?? document.body;
  if (p.parentElement !== host) host.append(p);
  if (openFor === button && p.matches(':popover-open')) { p.hidePopover(); return; }
  if (p.matches(':popover-open')) p.hidePopover();
  p.querySelector('b')!.textContent = entry[0];
  p.querySelector('p')!.textContent = entry[1];
  p.querySelector('a')!.setAttribute('href', `./reference.html?page=glossary&q=${encodeURIComponent(entry[0].replace(/\s*\(.*$/, ''))}`);
  p.showPopover();
  openFor = button; button.setAttribute('aria-expanded', 'true');
  const r = button.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
  p.style.width = `${w}px`;
  const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
  const h = p.getBoundingClientRect().height;
  const top = r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 8 - h);
  p.style.left = `${left}px`; p.style.top = `${top}px`;
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('button.gloss');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    show(button);
  }, true);
}

/** Set `el`'s text to `text`, with each glossary term's first appearance as a note button. */
export function glossify(el: HTMLElement, text: string, seen = new Set<string>()): void {
  wire();
  const segs = glossSegments(text, seen);
  const nodes: Node[] = [];
  segs.forEach((seg, i) => {
    if (!seg.term) { nodes.push(document.createTextNode(seg.text)); return; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'gloss'; b.dataset.term = seg.term; b.textContent = seg.text;
    b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'gloss-pop');
    b.title = `What is ${seg.term.replace(/\s*\(.*$/, '').toLowerCase()}?`;
    // A term set in parentheses keeps its brackets with it (score loop r5: a line could end with a lone "(" and the
    // term and ")" begin the next one): the "(" before the button and the ")" after it join it in one unbreakable
    // wrapper. The text reads the same.
    const before = nodes.at(-1), next = segs[i + 1];
    const open = before?.nodeType === Node.TEXT_NODE && before.textContent!.endsWith('(');
    const close = next && !next.term && next.text.startsWith(')');
    if (!open && !close) { nodes.push(b); return; }
    const wrap = document.createElement('span');
    wrap.className = 'gloss-keep';
    if (open) { before!.textContent = before!.textContent!.slice(0, -1); wrap.append('('); }
    wrap.append(b);
    if (close) { wrap.append(')'); segs[i + 1] = { ...next, text: next.text.slice(1) }; }
    nodes.push(wrap);
  });
  el.replaceChildren(...nodes);
}
