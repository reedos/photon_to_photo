import '../styles/start-here.css';

/** Reopen the three first-visit choices without leaving the workspace. */
export function mountStartHere(): void {
  const entry = document.createElement('button');
  entry.type = 'button'; entry.className = 'navlink start-entry'; entry.textContent = 'Start here';
  entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-controls', 'start-here');
  document.getElementById('topnav')!.prepend(entry);
  const dialog = document.createElement('dialog');
  dialog.id = 'start-here'; dialog.setAttribute('aria-labelledby', 'start-here-title');
  dialog.innerHTML = `<header><div><p class="start-eyebrow">PHOTON TO PHOTO</p><h2 id="start-here-title">How does light become a photograph?</h2></div><button type="button" class="btn start-close" aria-label="Close introduction">×</button></header>
    <p class="start-intro">Choose a way in. You can switch paths anytime.</p>
    <div class="start-paths">
      <button type="button" data-start="model"><span class="start-art camera-art" aria-hidden="true"><i></i></span><strong>Explore the camera</strong><span>Rotate the model. Open it up. Try the controls.</span><b>Explore →</b></button>
      <button type="button" data-start="shot"><span class="start-art light-art" aria-hidden="true"><i></i></span><strong>Play a shot</strong><span>Follow light through glass, charge, and data to an image.</span><b>Follow the light →</b></button>
      <button type="button" data-start="photos"><span class="start-art photo-art" aria-hidden="true"><i></i></span><strong>Explore my photos</strong><span>Look closely at real photographs and the choices behind them.</span><b>See the photographs →</b></button>
    </div><p class="start-foot">Drag to orbit · Scroll or pinch to zoom · Select a numbered part</p>`;
  document.body.append(dialog);
  let source: HTMLElement | null = null;
  const close = () => dialog.close();
  const open = (from: HTMLElement | null) => {
    source = from ?? document.getElementById('workspace-model');
    document.getElementById('topnav')?.classList.remove('open');
    document.getElementById('menu-btn')?.setAttribute('aria-expanded', 'false');
    dialog.showModal(); dialog.querySelector<HTMLButtonElement>('[data-start="model"]')!.focus();
  };
  entry.addEventListener('click', () => open(entry));
  dialog.querySelector('.start-close')!.addEventListener('click', close);
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    const first = buttons[0], last = buttons.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  dialog.addEventListener('close', () => {
    if (source) (source.checkVisibility({visibilityProperty:true}) ? source : document.getElementById('menu-btn'))?.focus({preventScroll:true});
  });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-start]')) button.addEventListener('click', () => {
    // The next action owns focus, so closing the introduction must not steal it back.
    source = null; close();
    const choice = button.dataset.start;
    if (choice === 'photos') {
      const tab = document.getElementById('workspace-photos')!; tab.click(); tab.focus();
    } else if (choice === 'shot') {
      document.getElementById('workspace-model')!.click();
      document.querySelector<HTMLButtonElement>('.shot-launch')!.click();
    } else {
      const tab = document.getElementById('workspace-model')!; tab.click(); tab.focus();
    }
  });
}
