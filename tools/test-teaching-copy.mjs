// Teaching-copy gate (score loop r1, 10/11/2026): the copy a reader sees says what it means.
//  1. No uppercased caption turns a micro unit into "µM" or "ΜM" (the Focus inset read "458 ΜM ACROSS", 1000x off).
//  2. Every tour stop's line fits the phone band unclipped, and the band announces each stop through one live region.
//  3. The playback strips keep their honesty note on a phone ("not individual real-time photons"), at the text floor.
//  4. The Optics inset's caption and its part card state the same magnification.
// Score loop r2 (10/11/2026):
//  5. With the tour open at the Pixel stop on a phone, the photon note is not covered by the sheet bar.
//  6. The last stop offers Play the shot; the front-element card subtitle has balanced parentheses; the Optics
//     inset legend separates the color rainbow from the gaps between clusters; the reading dialog links glossary terms.
// Score loop r3: the inset legend names the red-to-violet shift and each color's own spread, the inset draws a bar
//  per color, and the inset card's magnification row is relative to the main view.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const open = async (page, piece) => {
  await page.goto(new URL(`?piece=${piece}`, url).href);
  await page.waitForFunction((p) => window.p2p?.pieces?.[p], piece, { timeout: 90000 });
  await page.evaluate((p) => window.p2p.pieces[p].ready?.(), piece);
  await page.waitForTimeout(1200);
};
const badMicro = (page) => page.evaluate(() => [...document.querySelectorAll('body *')]
  .filter((n) => !n.children.length && n.textContent.includes('µ') && n.checkVisibility())
  .map((n) => n.innerText).filter((t) => /µM|Μ/.test(t)));
try {
  for (const [width, height] of [[1440, 900], [390, 844], [360, 740]]) {
    const phone = width < 760;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    for (const piece of ['camera', 'lens', 'cone', 'loupe']) {
      await open(page, piece);
      assert.deepEqual(await badMicro(page), [], `${width} ${piece}: a micro unit keeps its lowercase unit letter`);
      if (piece === 'cone') assert.match(await page.locator('.piece-overlay[data-piece="cone"] .lv-inset-note').innerText(), /\d µm across/i);
      if (piece === 'loupe' || piece === 'lens') {
        const note = await page.evaluate(() => [...document.querySelectorAll('.light-playback')].filter((b) => !b.hidden && b.checkVisibility())
          .flatMap((b) => [...b.querySelectorAll('span, small')]).filter((s) => ![...s.children].some((c) => c.tagName !== 'BR') && s.checkVisibility() && s.getBoundingClientRect().width > 2)
          .map((s) => ({ text: s.innerText.replace(/\s+/g, ' '), px: parseFloat(getComputedStyle(s).fontSize) })));
        const want = piece === 'loupe' ? /not individual real-time photons/i : /computed paths/i;
        const shown = note.filter((n) => want.test(n.text));
        assert.ok(shown.length, `${width} ${piece}: the playback honesty note is visible ${JSON.stringify(note)}`);
        assert.ok(shown.every((n) => n.px >= 10.5), `${width} ${piece}: the note is at least 10.5 px ${JSON.stringify(shown)}`);
      }
      if (piece === 'lens' && !phone) {
        const legend = await page.locator('.piece-overlay[data-piece="lens"] .lv-inset-note').innerText();
        // The legend is worded from the larger part of the spread (r2-physics insetLegend); it must not blame it all on color.
        // Score loop r3: one explanation, worded from what is drawn (the red-to-violet shift, each color's own spread
        // in its bar), never the "clusters" the inset does not show.
        assert.ok(/^Colors land in different places/.test(legend) && /dot = one ray/.test(legend) && /red to violet [\d.]+ µm apart/i.test(legend) && /(own spread|lands in one point)/i.test(legend) && !/cluster|spread is chromatic aberration|color error|other blur|›/i.test(legend), `inset legend: ${legend}`);
        const bars = await page.evaluate(() => window.p2p.pieces.lens.probe().insetBars ?? null);
        assert.ok(bars && bars.count >= 2, `inset draws per-color spread bars: ${JSON.stringify(bars)}`);
        await page.evaluate(() => document.querySelector('#parts [data-part-id="front-element"]').click());
        await page.waitForTimeout(800);
        const { title, sub } = await page.evaluate(() => ({ title: document.querySelector('#card h2, #card-t, .card-t')?.textContent ?? '', sub: document.querySelector('#card-sub')?.textContent ?? '' }));
        const balanced = (t) => [...t].reduce((d, c) => d < 0 ? d : d + (c === '(' ? 1 : c === ')' ? -1 : 0), 0) === 0;
        assert.ok(balanced(title) && balanced(sub), `front-element card title "${title}" / sub "${sub}" have balanced parentheses`);
        assert.match(sub, /^L1 · /, `front-element subtitle names L1 first: "${sub}"`);
        await page.evaluate(() => document.querySelector('#parts [data-part-id="detail-inset"]').click());
        await page.waitForTimeout(1500);
        const { caption, card } = await page.evaluate(() => ({ caption: document.querySelector('.inset-frame')?.dataset.label ?? '', card: document.querySelector('#card')?.innerText ?? '' }));
        const a = /([\d,.]+)×/.exec(caption)?.[1], b = /MAGNIFIED VS\. THE MAIN VIEW\s+([\d,.]+)×/i.exec(card)?.[1];
        assert.ok(a && a === b, `inset caption "${caption}" and card magnification "${b}" agree`);
      }
      // Score loop r5: the Optics inset's caption and legend stay inside the view on a phone. The caption's widest unbreakable
      // run and every legend phrase end before the viewport's edge (before: "Edge, magnified 690×" was 130 px in a 100 px frame and
      // "bar = one color's spread ·" ran to 382 px in a 360 px view).
      if (piece === 'lens' && phone) {
        await page.waitForSelector('.inset-frame', { timeout: 30000 });
        const g = await page.evaluate(() => {
          const frame = document.querySelector('.inset-frame'), fr = frame.getBoundingClientRect(), cs = getComputedStyle(frame, '::after');
          const probe = document.createElement('span');
          probe.style.cssText = `position:fixed;left:-9999px;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform}`;
          document.body.append(probe);
          const widest = Math.max(...frame.dataset.label.split(/ /).map((t) => { probe.textContent = t; return probe.getBoundingClientRect().width; }));
          probe.remove();
          const note = document.querySelector('.piece-overlay[data-piece="lens"] .lv-inset-note');
          const spans = [...note.querySelectorAll('span')].map((x) => x.getBoundingClientRect());
          return { label: frame.dataset.label, captionRight: fr.left + 8 + widest, frameRight: fr.right, legendRight: Math.max(...spans.map((r) => r.right), note.getBoundingClientRect().right), legend: note.textContent, vw: innerWidth };
        });
        assert.ok(g.captionRight <= g.frameRight && g.captionRight <= g.vw - 4, `${width} inset caption "${g.label}" stays inside its frame: ${JSON.stringify(g)}`);
        assert.ok(g.legendRight <= g.vw - 4, `${width} inset legend "${g.legend}" stays inside the view: ${JSON.stringify(g)}`);
        assert.match(g.legend, /^Dot = ray · bar = one color’s spread|^Dot = ray · each color lands in one point/, `${width} phone legend is the short key: ${g.legend}`);
      }
      // Score loop r5: a card is headed by its list name at every level, with its own title (Nikon D850, 7-blade aperture, the
      // charge well) on the line under it.
      if (width === 1440 && piece !== 'camera') {
        const ids = await page.evaluate(() => [...document.querySelectorAll('#parts [data-part-id]')].map((b) => b.dataset.partId).filter((id) => id !== 'overview'));
        assert.ok(ids.length >= 5, `${piece}: parts listed`);
        for (const id of ids) {
          await page.evaluate((i) => document.querySelector(`#parts [data-part-id="${i}"]`).click(), id);
          await page.waitForTimeout(200);
          const { heading, listed } = await page.evaluate(() => ({ heading: document.querySelector('#card-t')?.textContent, listed: document.querySelector('#parts li.sel .pt')?.textContent }));
          assert.equal(heading, listed, `${piece}/${id}: the card heading is the list name`);
        }
        await page.evaluate(() => document.querySelector('#parts [data-part-id="overview"]').click());
      }
    }
    await open(page, 'camera');
    await page.locator('#learn-launch').click();
    const stops = await page.locator('#journey-stop option').count();
    assert.equal(stops, 10);
    for (let i = 0; i < stops; i++) {
      await page.locator('#journey-stop').selectOption(String(i)); await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const shown = [...document.querySelectorAll('#journey-text, #journey-caption')].find((e) => e.checkVisibility() && e.getBoundingClientRect().width > 2);
        return { live: document.querySelectorAll('#journey [role=status], #journey [aria-live]').length, liveText: document.querySelector('#journey [role=status]')?.textContent,
          sh: shown?.scrollHeight, ch: shown?.clientHeight, more: document.querySelector('#journey-more-text').textContent };
      });
      assert.equal(r.live, 1, `${width} stop ${i + 1}: one live region`);
      assert.ok(r.liveText && !r.more.includes(r.liveText), `${width} stop ${i + 1}: More adds its own words`);
      assert.ok(r.sh <= r.ch + 1, `${width} stop ${i + 1}: the band line is not clipped (${r.sh} > ${r.ch})`);
      // Score loop r5: the band's own words carry glossary notes (aperture stop: depth of field, diffraction; focus: blur disks)
      if (!phone && (i === 2 || i === 3)) {
        const terms = await page.evaluate(() => [...document.querySelectorAll('#journey-text button.gloss')].map((b) => b.dataset.term));
        assert.ok(i === 2 ? terms.includes('Depth of field') && terms.includes('Diffraction') : terms.includes('Blur disk'), `stop ${i + 1}: the band links its terms: ${terms}`);
      }
      assert.equal(await page.locator('#journey-shot').isVisible(), i === stops - 1, `${width} stop ${i + 1}: Play the shot shows on the last stop only`);
      if (i === 6 && phone) {
        await page.waitForTimeout(2500);
        const notes = await page.evaluate(() => [...document.querySelectorAll('.light-playback .packet-note')].filter((s) => s.checkVisibility()).map((s) => {
          const r = s.getBoundingClientRect();
          return [0.15, 0.5, 0.85].map((fx) => { const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2); return !!hit && (s.contains(hit) || hit.contains(s)); });
        }));
        assert.ok(notes.length && notes.every((pts) => pts.every(Boolean)), `${width} pixel stop: the photon note is not covered with the tour open ${JSON.stringify(notes)}`);
      }
      if (i === 6 && !phone) {
        await page.locator('#journey-physics').click();
        const glossed = await page.evaluate(() => [...document.querySelectorAll('#journey-reading button.gloss')].map((b) => b.dataset.term));
        assert.ok(glossed.includes('PRNU (pixel-to-pixel variation)') && glossed.includes('RMS (root mean square)'), `pixel reading dialog links PRNU and RMS: ${glossed}`);
        await page.locator('#journey-reading button.gloss').first().click();
        assert.ok(await page.locator('#gloss-pop').isVisible(), 'a glossary term opens its definition');
        assert.match(await page.locator('#journey-live').innerText(), /Green pixel, 18% gray/);
        await page.evaluate(() => { document.getElementById('gloss-pop')?.hidePopover?.(); const d = document.getElementById('journey-reading'); if (d.open) d.close(); });
        await page.waitForTimeout(200);
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`teaching copy ${width}: passed`);
  }
} finally { await browser.close(); await server?.close?.(); }
console.log('teaching copy: micro units, tour band fit and live region, playback notes, inset magnification passed');
