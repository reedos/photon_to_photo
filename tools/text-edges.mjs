// Visible text that runs out of where it must stay (score loop r5, WCAG 1.4.4 and 1.4.10: information lost). Used by
// tools/test-accessibility.mjs and docs/score-loop/r5-access/probe.mjs.
//
// textEdges(page) returns a list of problems, empty when there are none:
//   - any visible text whose line box passes the viewport's left or right edge (text beside the screen inside a scroller or a
//     clipping box, and the visually hidden page head, are not on the screen and are left out);
//   - any inset frame's caption (a ::after, which has no box of its own to measure) that has a word wider than its room, or
//     more lines than the band the inset reserves above its picture;
//   - any phrase of the inset's legend that sticks out of the legend's own box.
// `notes: true` also lists each caption with its room and height (evidence for a report).
export const textEdges = (page, { notes = false } = {}) => page.evaluate((notes) => {
  const out = [];
  const skip = (e) => !e || e.closest('svg,canvas,select,.sr-only,[inert],script,style') || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || skip(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      let aside = false;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const c = getComputedStyle(a);
        if (c.clipPath !== 'none') aside = true;
        if (c.overflowX !== 'visible') { const ar = a.getBoundingClientRect(); if (r.left >= ar.right - 0.5 || r.right <= ar.left + 0.5) aside = true; }
      }
      if (aside) continue;
      if (r.right > innerWidth + 0.5 || r.left < -0.5) out.push(`"${n.textContent.trim().slice(0, 40)}" (${el.className || el.tagName}) runs to ${Math.round(r.left)}..${Math.round(r.right)} on a ${innerWidth} px screen`);
    }
  }
  for (const f of document.querySelectorAll('.inset-frame')) {
    if (!f.checkVisibility()) continue;
    const fr = f.getBoundingClientRect(), cs = getComputedStyle(f, '::after'), label = f.dataset.label || '';
    const room = fr.width - 2 - parseFloat(cs.left) - parseFloat(cs.right);
    const probe = document.createElement('div');
    probe.textContent = label;
    // overflow-wrap normal: a word wider than the room shows as a scrollWidth over the width, not as a word broken mid-way
    probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform};white-space:${cs.whiteSpace};overflow-wrap:normal;line-height:${cs.lineHeight};width:${room}px`;
    document.body.appendChild(probe);
    const wide = probe.scrollWidth > probe.clientWidth + 1, h = probe.offsetHeight, line = parseFloat(cs.lineHeight) || 13;
    probe.remove();
    const lines = Math.round(h / line);
    if (wide) out.push(`inset caption "${label}" has a word wider than its ${Math.round(room)} px room`);
    else if (lines > 2) out.push(`inset caption "${label}" takes ${lines} lines in ${Math.round(room)} px`);
    else if (notes) out.push(`note: inset caption "${label}" fits ${Math.round(room)} px on ${lines} line${lines === 1 ? '' : 's'}`);
  }
  for (const nt of document.querySelectorAll('.lv-inset-note')) {
    if (!nt.checkVisibility()) continue;
    const nr = nt.getBoundingClientRect();
    for (const sp of nt.querySelectorAll('span')) {
      if (!sp.checkVisibility()) continue; // the separator dots are in the text but not drawn (score loop r6)
      const sr = sp.getBoundingClientRect();
      if (sr.right > nr.right + 1 || sr.left < nr.left - 1) out.push(`legend phrase "${sp.textContent}" ${Math.round(sr.left)}..${Math.round(sr.right)} sticks out of its ${Math.round(nr.left)}..${Math.round(nr.right)} box`);
    }
  }
  return out;
}, notes);

// Two pieces of visible text printed on top of each other (score loop r6, WCAG 1.4.4 and 1.4.12: the Focus inset's caption ran over the
// "Center" value of the Off center slider at 320 to 360 px). Measures every line box of every visible text node inside `root`
// (default the 3D view), plus each inset frame's caption (a ::after, which has no box of its own), and lists every pair of boxes from
// different elements that share more than a 2x2 px area. A box and its own ancestor's other text do not count as a pair when they are
// the same node; boxes of separate nodes are always a pair.
export const textOverlaps = (page, { root = '.view' } = {}) => page.evaluate((root) => {
  const boxes = [];
  const skip = (e) => !e || e.closest('svg,canvas,select,.sr-only,[inert],script,style') || !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const rootEl = document.querySelector(root);
  if (!rootEl) return [`no ${root}`];
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let id = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || skip(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const mine = id++;
    // what the text's own clipping ancestors leave of it (a visually hidden heading, a collapsed drawer): only that part is on the screen
    let clip = { l: -Infinity, r: Infinity, t: -Infinity, b: Infinity }, hidden = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (c.clipPath !== 'none' || (c.position === 'absolute' && c.clip !== 'auto')) hidden = true;
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        clip = { l: Math.max(clip.l, c.overflowX !== 'visible' ? ar.left : -Infinity), r: Math.min(clip.r, c.overflowX !== 'visible' ? ar.right : Infinity), t: Math.max(clip.t, c.overflowY !== 'visible' ? ar.top : -Infinity), b: Math.min(clip.b, c.overflowY !== 'visible' ? ar.bottom : Infinity) };
      }
    }
    if (hidden) continue;
    for (const r of range.getClientRects()) {
      const l = Math.max(r.left, clip.l), rr = Math.min(r.right, clip.r), t = Math.max(r.top, clip.t), b = Math.min(r.bottom, clip.b);
      if (rr - l < 2 || b - t < 2) continue;
      boxes.push({ id: mine, text: n.textContent.trim().slice(0, 36), cls: (el.className && String(el.className)) || el.tagName, l, r: rr, t, b });
    }
  }
  for (const f of rootEl.querySelectorAll('.inset-frame')) {
    if (!f.checkVisibility()) continue;
    const fr = f.getBoundingClientRect(), cs = getComputedStyle(f, '::after');
    const label = f.dataset.label || '';
    if (!label) continue;
    const left = fr.left + 1 + parseFloat(cs.left), right = fr.right - 1 - parseFloat(cs.right);
    const probe = document.createElement('div');
    probe.textContent = label;
    probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform};white-space:${cs.whiteSpace};overflow-wrap:${cs.overflowWrap};line-height:${cs.lineHeight};width:${right - left}px`;
    document.body.appendChild(probe);
    const h = probe.offsetHeight, wide = Math.min(right - left, probe.scrollWidth);
    probe.remove();
    boxes.push({ id: id++, text: `[caption] ${label}`.slice(0, 36), cls: 'inset-label', l: left, r: left + wide, t: fr.top + 1 + parseFloat(cs.top), b: fr.top + 1 + parseFloat(cs.top) + h });
  }
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.id === b.id) continue;
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (w > 2 && h > 2) out.push(`"${a.text}" (${a.cls}) over "${b.text}" (${b.cls}) by ${Math.round(w)}x${Math.round(h)} px`);
  }
  return out;
}, root);
