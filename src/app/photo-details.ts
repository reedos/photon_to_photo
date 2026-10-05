import catalog from "../../public/examples/examples.json";
/** Hand-picked regions in the published JPEGs, normalized from their top-left corner.
 * These are observations of the existing photographs, never a simulated refocus. */
interface Detail { label: string; rect: readonly [number, number, number, number]; note: string }
export const PHOTO_DETAILS: Record<string, readonly Detail[]> = Object.fromEntries(
  catalog.examples.map(photo => [photo.id, photo.details.map(detail => ({ ...detail, rect: detail.rect as [number, number, number, number] }))]),
);

/** No animation loop, new image assets, or physics-worker requests. Reuses the loaded JPEG. */
export function mountPhotoDetails(img: HTMLImageElement, frame: HTMLElement, note: HTMLElement) {
  const noteRow = document.createElement('div'); noteRow.className = 'rp-note-wrap'; note.before(noteRow);
  const readExplanation = document.createElement('button'); readExplanation.type = 'button'; readExplanation.className = 'btn rp-read-explanation'; readExplanation.textContent = 'Read explanation'; readExplanation.setAttribute('aria-haspopup', 'dialog');
  noteRow.append(note, readExplanation);
  const explanation = document.createElement('dialog'); explanation.className = 'rp-explanation-dialog'; explanation.setAttribute('aria-labelledby', 'rp-explanation-title'); explanation.setAttribute('aria-describedby', 'rp-explanation-copy');
  const explanationTitle = document.createElement('h2'); explanationTitle.id = 'rp-explanation-title';
  const explanationCopy = document.createElement('p'); explanationCopy.id = 'rp-explanation-copy';
  const closeExplanation = document.createElement('button'); closeExplanation.type = 'button'; closeExplanation.className = 'btn'; closeExplanation.textContent = 'Close explanation'; closeExplanation.autofocus = true;
  explanation.append(explanationTitle, explanationCopy, closeExplanation); document.body.append(explanation);
  readExplanation.onclick = () => explanation.showModal();
  closeExplanation.onclick = () => explanation.close();
  explanation.addEventListener('close', () => { if (readExplanation.checkVisibility()) readExplanation.focus({ preventScroll: true }); });
  const controls = document.createElement('div'); controls.className = 'rp-detail-controls'; controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Inspect details in this photograph');
  const crop = document.createElement('div'); crop.className = 'rp-detail-crop'; crop.hidden = true;
  const cropWindow = document.createElement('div'); cropWindow.className = 'rp-crop-window';
  const cropImage = document.createElement('img'); cropImage.alt = ''; cropImage.draggable = false;
  cropWindow.append(cropImage);
  const map = document.createElement('div'); map.className = 'rp-detail-map'; map.setAttribute('aria-hidden', 'true');
  const mapImage = document.createElement('img'); mapImage.alt = ''; const outline = document.createElement('span'); map.append(mapImage, outline);
  const badge = document.createElement('span'); badge.className = 'rp-detail-badge'; badge.textContent = 'Crop of original photo';
  crop.append(cropWindow, map, badge); frame.append(crop); frame.after(controls);
  const detailStatus = document.createElement('p'); detailStatus.className = 'rp-image-status'; detailStatus.hidden = true;
  detailStatus.setAttribute('role', 'status'); frame.append(detailStatus);
  let details: readonly Detail[] = [], active = -1, originalNote = '', ready = false, selectionVersion = 0, fullSource: string | undefined;
  note.setAttribute('aria-live', 'polite');

  function layout() {
    if (active < 0 || !ready) return;
    const [x, y, w, h] = details[active].rect;
    const width = frame.clientWidth, height = frame.clientHeight;
    const scale = Math.min(width / (w * img.naturalWidth), height / (h * img.naturalHeight));
    const fullWidth = img.naturalWidth * scale, fullHeight = img.naturalHeight * scale;
    Object.assign(cropWindow.style, { width: `${w * fullWidth}px`, height: `${h * fullHeight}px`, left: `${(width - w * fullWidth) / 2}px`, top: `${(height - h * fullHeight) / 2}px` });
    Object.assign(cropImage.style, { width: `${fullWidth}px`, height: `${fullHeight}px`, left: `${-x * fullWidth}px`, top: `${-y * fullHeight}px` });
    Object.assign(outline.style, { left: `${100 * x}%`, top: `${100 * y}%`, width: `${100 * w}%`, height: `${100 * h}%` });
  }
  function select(index: number) {
    const version = ++selectionVersion;
    active = index; crop.hidden = true; img.style.visibility = '';
    detailStatus.hidden = true;
    note.textContent = index < 0 ? originalNote : details[index].note;
    explanationCopy.textContent = note.textContent;
    crop.setAttribute('role', 'img'); crop.setAttribute('aria-label', index < 0 ? '' : `${details[index].label}: enlarged crop of the original photograph`);
    controls.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i - 1 === index)));
    if (index >= 0 && ready) {
      detailStatus.textContent = 'Loading full-resolution detail…'; detailStatus.hidden = false;
      cropImage.src = fullSource || img.currentSrc || img.src; mapImage.src = img.currentSrc || img.src;
      // Keep the complete photograph visible while the browser prepares the crop.
      // A late decode may never replace a newer selection or a different photo.
      void cropImage.decode().then(() => {
        if (version !== selectionVersion || !ready) return;
        layout(); crop.hidden = false; img.style.visibility = 'hidden'; detailStatus.hidden = true;
      }).catch(() => { if (version === selectionVersion) { select(-1); detailStatus.textContent = 'Detail could not load. Select the detail again to retry.'; detailStatus.hidden = false; } });
    }
  }
  function loaded() { ready = img.complete && img.naturalWidth > 0; controls.querySelectorAll('button').forEach(button => { button.disabled = !ready; }); if (ready) select(active); }
  img.addEventListener('load', loaded);
  img.addEventListener('error', () => { ready = false; select(-1); controls.querySelectorAll('button').forEach(button => { button.disabled = true; }); });
  new ResizeObserver(layout).observe(frame);
  frame.addEventListener('keydown', event => { if (event.key === 'Escape' && active >= 0) { select(-1); controls.querySelector('button')?.focus(); } });
  controls.addEventListener('keydown', event => { if (event.key === 'Escape') { select(-1); controls.querySelector('button')?.focus(); } });
  return {
    setPhoto(id: string, description: string, title: string, highResolutionSource?: string) {
      fullSource = highResolutionSource; cropImage.removeAttribute('src');
      explanationTitle.textContent = title;
      ready = false; details = PHOTO_DETAILS[id] ?? []; originalNote = description;
      controls.hidden = !details.length; controls.replaceChildren();
      ['Full photo', ...details.map(detail => detail.label)].forEach((label, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = label; button.disabled = true;
        button.onclick = () => select(i - 1); controls.append(button);
      });
      select(-1);
    },
  };
}
