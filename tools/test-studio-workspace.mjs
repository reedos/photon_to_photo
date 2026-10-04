// Independent viewport/interaction review of the fixed-height camera and photo workspaces.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const output = process.env.P2P_AUDIT_OUTPUT || 'shots/studio-workspace';
mkdirSync(output, { recursive: true });
const base = process.env.P2P_URL || 'http://127.0.0.1:47743/';
const entry = new URL('?piece=camera&lens=m50', base);
if (process.env.P2P_BACKEND === 'webgl2') entry.searchParams.set('gl', 'webgl2');
const report = { url: entry.href, samples: [], errors: [], checks: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'no-preference' });
page.setDefaultTimeout(25000);
page.on('pageerror', e => report.errors.push(String(e)));
let injectingCatalog = false;
page.on('console', m => { if (m.type() === 'error' && !(injectingCatalog && m.location().url.includes('examples/examples.json'))) report.errors.push(m.text()); });
async function rest() {
  await page.waitForFunction(() => window.p2p && !window.p2p.framing().moving && document.querySelector('#veil').classList.contains('off') && getComputedStyle(document.querySelector('#veil')).opacity === '0');
}
async function sample(name) {
  if(await page.locator('#photo-study-panel').isVisible()) await page.locator('#rp-img').evaluate(img=>img.decode());
  await page.waitForTimeout(180);
  const data = await page.evaluate(() => {
    const rect = selector => {
      const el = document.querySelector(selector); if (!el || !el.checkVisibility()) return null;
      const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom };
    };
    return { viewport:[innerWidth,innerHeight], scroll:[scrollX,scrollY],
      document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],
      view:document.body.dataset.workspaceView, frame:window.p2p.framing(),
      boxes:Object.fromEntries(['#gl','#compact-fire','#zoom-in','#zoom-out','#part-next','#part-prev','#workspace-model','#workspace-photos','#rp-img','#rp-play','#rp-match','#rp-picks','.studio-sidebar'].map(s=>[s,rect(s)])) };
  });
  report.samples.push({name,...data});
  await page.screenshot({ path:`${output}/${name}.png` });
  assert.ok(data.document[0] <= data.viewport[0]+1 && data.document[1] <= data.viewport[1]+1, `${name}: document must fit viewport`);
  assert.deepEqual(data.scroll,[0,0], `${name}: no document displacement`);
  const selectors = data.view === 'photos' ? ['#rp-img','#rp-play','#rp-match','#rp-picks'] : ['#gl','#zoom-in','#zoom-out','#part-next','#part-prev'];
  if(data.view==='model' && data.frame.piece==='camera') selectors.push('#compact-fire');
  for (const selector of selectors) {
    const r = data.boxes[selector];
    assert.ok(r && r.x>=-1 && r.y>=-1 && r.right<=data.viewport[0]+1 && r.bottom<=data.viewport[1]+1 && r.w>0 && r.h>0, `${name}: ${selector} is in viewport`);
    if(selector!=='#gl' && selector!=='#rp-img' && selector!=='#rp-picks') {
      assert.ok(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);}),`${name}: ${selector} is not clipped or covered`);
    }
  }
  if(data.view === 'model') assert.ok(data.boxes['#gl'].w >= Math.min(260,data.viewport[0]-30) && data.boxes['#gl'].h>=100, `${name}: usable canvas area`);
  if(data.view === 'model') {
    const clipped=await page.locator('.light-playback button, .light-playback input, #model-experiments .btn, .rain-launch').evaluateAll(nodes=>nodes.filter(el=>el.checkVisibility()).filter(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit!==el&&!el.contains(hit);}).map(el=>el.textContent?.trim()||el.getAttribute('aria-label')));
    assert.deepEqual(clipped,[],`${name}: animation controls and experiments are not clipped or covered`);
  }
  console.log(name, data.boxes['#gl'] || data.boxes['#rp-img']);
}
async function distance() { return page.evaluate(() => {const f=window.p2p.framing();return Math.hypot(...f.position.map((n,i)=>n-f.target[i]));}); }
try {
  await page.goto(entry.href); await page.waitForFunction(()=>window.p2p?.pieces.camera);
  await page.evaluate(()=>window.p2p.pieces.camera.ready()); await rest();
  assert.equal(await page.locator('#finalimg,#fi-dock,#kit-scene,#sc-scene,#compare-photo,#compare-dialog,#rp-canvas,.rp-render,.rp-prediction').count(),0,'removed synthetic previews and scene controls stay absent');
  report.backend = await page.evaluate(()=>window.p2p.backend());
  if(process.env.P2P_BACKEND) assert.equal(report.backend,process.env.P2P_BACKEND);
  await sample('00-desktop-camera');
  await page.locator('#compact-fire').click();
  await page.waitForFunction(()=>window.p2p.pieces.camera.exposure().running);
  await page.waitForFunction(()=>window.p2p.pieces.camera.exposure().status==='complete');
  await rest();
  let before=await distance(); await page.locator('#zoom-in').click(); await page.waitForTimeout(200);
  assert.ok(await distance()<before*.98,'zoom-in button moves camera closer');
  before=await distance(); await page.locator('#zoom-out').click(); await page.waitForTimeout(200);
  assert.ok(await distance()>before*1.02,'zoom-out button moves camera away');
  const canvas=await page.locator('#gl').boundingBox(); await page.mouse.move(canvas.x+canvas.width*.25,canvas.y+canvas.height*.5);
  before=await distance(); await page.mouse.wheel(0,-240); await page.waitForTimeout(400);
  assert.ok(await distance()<before*.98,'plain wheel zooms without Ctrl');
  const original=await page.evaluate(()=>window.p2p.framing());
  await page.locator('#workspace-model').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#workspace-photos').getAttribute('aria-selected'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'workspace-photos');
  await page.waitForFunction(()=>document.querySelector('#rp-img')?.complete && document.querySelector('#rp-img')?.naturalWidth>0);
  await sample('01-desktop-photos');
  const exposureBefore=await page.evaluate(()=>window.p2p.pieces.camera.exposure());
  await page.keyboard.press('f'); await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(()=>window.p2p.pieces.camera.exposure()),exposureBefore,'F cannot fire hidden model from Photos tab');
  await page.keyboard.press('Home'); await rest();
  const returned=await page.evaluate(()=>window.p2p.framing());
  assert.equal(returned.piece,original.piece);
  assert.ok(Math.hypot(...returned.position.map((v,i)=>v-original.position[i]))<.001,'tab return preserves manual camera position');
  await page.keyboard.press('End'); await page.locator('#rp-picks button').nth(2).click();
  const selected=await page.locator('#rp-picks [aria-pressed="true"]').getAttribute('data-id');
  await page.locator('#workspace-model').click(); await page.locator('#workspace-photos').click();
  assert.equal(await page.locator('#rp-picks [aria-pressed="true"]').getAttribute('data-id'),selected);
  await page.locator('#rp-match').click(); await rest();
  assert.equal(await page.locator('#workspace-model').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#tab-controls').getAttribute('aria-selected'),'true');
  report.checks.push('wheel and button zoom; keyboard workspace tabs; preserved framing and photo; settings action returns to model');
  for(const [name,width,height] of [['short',1280,600],['phone',390,844],['small-phone',320,568]]) {
    await page.setViewportSize({width,height}); await page.locator('#workspace-model').click();
    if(width<=390) {
      assert.equal(await page.locator('#equipment-toggle').getAttribute('aria-expanded'),'false');
      assert.equal(await page.locator('#kit-body').isVisible(),false,'equipment editor starts manually collapsed');
      await page.locator('#equipment-toggle').click();
      const previousLens=await page.locator('#kit-lens').inputValue();
      const lens=await page.locator('#kit-lens option').evaluateAll(nodes=>nodes.map(n=>n.value).find(value=>value!==document.querySelector('#kit-lens').value));
      assert.ok(lens,'equipment editor offers another lens');
      await page.locator('#kit-lens').selectOption(lens);
      assert.ok((await page.locator('#equipment-summary').textContent()).includes((await page.locator('#kit-lens option:checked').textContent()).replace(/\s*·\s*/g,' ').trim()));
      await page.screenshot({path:`${output}/${name}-equipment-editor.png`});
      await page.locator('#kit-lens').selectOption(previousLens); await page.locator('#phone-settings-close').click();
      assert.equal(await page.locator('#equipment-toggle').getAttribute('aria-expanded'),'false');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'equipment-toggle');
    }
    for(const piece of ['camera','lens','cone','loupe']) {
      await page.locator(`#steps [data-piece="${piece}"]`).click(); await rest(); await sample(`${name}-${piece}`);
      if(width===320 && ['lens','loupe'].includes(piece)) {
        const button=page.locator('.light-playback:visible button');
        await button.click(); assert.equal(await button.getAttribute('aria-pressed'),'true');
        await page.waitForTimeout(250); await button.click(); assert.equal(await button.getAttribute('aria-pressed'),'false');
        assert.match(await button.textContent(),/Resume/);
      }
      if(width<=390) {
        await page.locator('#expand-model').click(); await rest(); await sample(`${name}-${piece}-expanded`);
        assert.equal(await page.locator('#expand-model').getAttribute('aria-pressed'),'true');
        await page.locator('#expand-model').click(); await rest();
      }
    }
    if(height<680 && width<600) {
      const before=await page.locator('.studio-sidebar').boundingBox();
      await page.locator('#inspector-size').click();
      assert.ok((await page.locator('.studio-sidebar').boundingBox()).height>before.height*1.5,'explicit inspector expansion exposes more controls');
      assert.equal(await page.locator('#tab-explain').isVisible(),true,'Parts remains apparent');
      await page.screenshot({path:`${output}/${name}-expanded-inspector.png`});
      await page.locator('#inspector-size').click();
      assert.equal(await page.locator('#inspector-size').getAttribute('aria-expanded'),'false');
    }
    await page.locator('#workspace-photos').click(); await sample(`${name}-photos`);
    assert.equal(await page.locator('#rp-canvas,.rp-render,.rp-prediction').count(),0,'photo tab contains no synthetic companion preview');
  }
  await page.setViewportSize({width:320,height:568});
  injectingCatalog=true; let requests=0;
  await page.route('**/examples/examples.json', async route => { requests++; if(requests===1) await route.fulfill({status:503,body:'unavailable'}); else await route.continue(); });
  entry.hash='rp-card'; await page.goto(entry.href);
  await page.getByRole('button',{name:'Retry photographs',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#rp-img')?.complete && document.querySelector('#rp-img')?.naturalWidth>0);
  assert.equal(requests,2,'catalog retry makes new request'); injectingCatalog=false;
  await sample('catalog-recovered-small-phone');
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  report.passed=true;
} catch(error) { report.failure=String(error.stack||error); await page.screenshot({path:`${output}/failure.png`}).catch(()=>{}); throw error;
} finally { writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)); await browser.close(); }
