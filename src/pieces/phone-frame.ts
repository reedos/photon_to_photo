// Shared by levels 2-4. Two small layout helpers the three deep dives need on a phone (design review R1-13).

/** The scale badge's text, joined so a narrow view only ever breaks before a "·", never inside a phrase and never
 *  right after one, which would leave the dot dangling alone at the end of the old line (R3-06): each phrase keeps
 *  its own spaces as no-break spaces, the ordinary (breakable) space sits before each separator, and the dot is
 *  glued to the phrase that follows it by a no-break space of its own. */
export function badgeJoin(...phrases: string[]): string {
  const nbsp = String.fromCharCode(0xa0);
  return phrases.map((p) => p.replace(/ /g, nbsp)).join(` ·${nbsp}`);
}

export const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;

/**
 * An empty box in the piece's overlay over an inset's rectangle, plus an optional one-line note sitting on the
 * inset's top edge, outside the picture (the inset's own caption is inside it, and what the inset draws stays
 * clean for the accuracy gates that read its pixels). The stage's pin pass treats every child of a piece overlay
 * as chrome (stage.ts measure()), so a pin under the inset or its note hides and a label never lands on them
 * (R2-06). `update(null)` takes both away.
 */
export interface InsetGuard {
  update(rect: { left: number; bottom: number; width: number; height: number } | null, note?: string): void;
  dispose(): void;
}
const NOTE_H = 18; // the note's line above the inset, included in the box so the pins keep off it too
export function insetGuard(overlay: HTMLElement): InsetGuard {
  const box = document.createElement('div');
  box.className = 'lv-inset-guard';
  box.setAttribute('aria-hidden', 'true');
  box.hidden = true;
  const note = document.createElement('span');
  note.className = 'lv-inset-note';
  box.append(note);
  overlay.appendChild(box);
  let last = '';
  return {
    update(rect, text = '') {
      const key = rect ? `${rect.left},${rect.bottom},${rect.width},${rect.height},${text}` : '';
      if (key === last) return;
      last = key;
      box.hidden = !rect;
      if (!rect) return;
      box.style.left = `${rect.left}px`;
      box.style.bottom = `${rect.bottom}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height + (text ? NOTE_H : 0)}px`;
      note.hidden = !text;
      note.textContent = text;
    },
    dispose() { box.remove(); },
  };
}
