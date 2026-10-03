/** Hand-picked regions in the published JPEGs, normalized from their top-left corner.
 * These are observations of the existing photographs, never a simulated refocus. */
interface Detail { label: string; rect: readonly [number, number, number, number]; note: string }
export const PHOTO_DETAILS: Record<string, readonly Detail[]> = {
  flycatcher: [
    { label: 'Bird & nest', rect: [.35, .43, .20, .30], note: 'Look at the feather edges and woven nest. They preserve much finer structure than the soft branches behind them. Focus selects a distance, not an entire object.' },
    { label: 'Soft branches', rect: [.63, .40, .18, .29], note: 'The soft branches and patches of sky spread into broad shapes. Out-of-focus points form blur disks; their overlap removes fine structure. This crop shows the captured blur, not a measurement of background distance.' },
  ],
  mallard: [
    { label: 'Duckling detail', rect: [.37, .44, .20, .23], note: 'Compare the duckling’s down with the bark below it. Sharpness changes with distance through the scene; a shallow focus zone does not make every animal equally sharp.' },
    { label: 'Water highlights', rect: [.59, .04, .27, .30], note: 'Bright reflections spread into overlapping soft shapes. Water motion and defocus can both affect their appearance; a single photograph cannot separate those contributions precisely.' },
  ],
  chipmunk: [
    { label: 'Fur & whiskers', rect: [.46, .35, .18, .22], note: 'The eye, fur and rock retain small-scale texture against an almost featureless backdrop. The narrow region of sharp focus makes the animal stand out.' },
    { label: 'Smooth backdrop', rect: [.16, .13, .29, .30], note: 'The background has become broad color gradients. Large defocus disks overlap here; enlarging the photograph cannot recover the original background detail.' },
  ],
  squirrel: [
    { label: 'Eye & fur', rect: [.18, .38, .31, .21], note: 'Inspect the eye and the individual hairs around the face. Close focusing with a long lens gives a thin zone of sharpness, so detail can soften across the depth of the animal itself.' },
    { label: 'Background bands', rect: [.05, .12, .52, .22], note: 'The surroundings become soft bands of color while the squirrel stays distinct. This is a crop of the recorded background, not an artificial blur filter.' },
  ],
  'sheep-village': [
    { label: 'Sheep on slope', rect: [.28, .47, .24, .25], note: 'Compare wool, horns and grass at nearby distances. A wide aperture limits depth of field, but the shorter focal length leaves more of the landscape recognizable than in the long-lens wildlife shots.' },
    { label: 'Distant village', rect: [.69, .04, .29, .30], note: 'The village remains recognizable even as fine edges soften. Recognizable does not mean critically sharp: depth of field depends on the sharpness criterion and the viewing size.' },
  ],
  'sheep-larches': [
    { label: 'Flock on slope', rect: [.39, .30, .28, .23], note: 'Wool and grass on the slope retain more structure than the closest sheep. The sharp region lies farther into the scene; focus is a distance, not simply the nearest subject.' },
    { label: 'Near sheep', rect: [.27, .77, .27, .23], note: 'The nearest sheep are visibly soft. Objects in front of the focus distance can blur just as objects behind it do. This crop preserves the original exposure and focus.' },
  ],
};

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
  let details: readonly Detail[] = [], active = -1, originalNote = '', ready = false, selectionVersion = 0;
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
    note.textContent = index < 0 ? originalNote : details[index].note;
    explanationCopy.textContent = note.textContent;
    crop.setAttribute('role', 'img'); crop.setAttribute('aria-label', index < 0 ? '' : `${details[index].label}: enlarged crop of the original photograph`);
    controls.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i - 1 === index)));
    if (index >= 0 && ready) {
      cropImage.src = img.currentSrc || img.src; mapImage.src = img.currentSrc || img.src;
      // Keep the complete photograph visible while the browser prepares the crop.
      // A late decode may never replace a newer selection or a different photo.
      void cropImage.decode().then(() => {
        if (version !== selectionVersion || !ready) return;
        layout(); crop.hidden = false; img.style.visibility = 'hidden';
      }).catch(() => { if (version === selectionVersion) select(-1); });
    }
  }
  function loaded() { ready = img.complete && img.naturalWidth > 0; controls.querySelectorAll('button').forEach(button => { button.disabled = !ready; }); if (ready) select(active); }
  img.addEventListener('load', loaded);
  img.addEventListener('error', () => { ready = false; select(-1); controls.querySelectorAll('button').forEach(button => { button.disabled = true; }); });
  new ResizeObserver(layout).observe(frame);
  frame.addEventListener('keydown', event => { if (event.key === 'Escape' && active >= 0) { select(-1); controls.querySelector('button')?.focus(); } });
  controls.addEventListener('keydown', event => { if (event.key === 'Escape') { select(-1); controls.querySelector('button')?.focus(); } });
  return {
    setPhoto(id: string, description: string, title: string) {
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
