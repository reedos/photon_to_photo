import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const base = process.env.P2P_URL || server.url;
const out = process.env.P2P_AUDIT_OUTPUT || 'shots/guided-layout';
mkdirSync(out, { recursive: true });
let browser;
const report = { base, checks: [], findings: [], tour: {}, playback: {}, ghosts: {}, consoleErrors: [], pageErrors: [] };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  for (const viewport of [{ width: 1440, height: 900, key: 'desktop' }, { width: 390, height: 844, key: 'phone' }, { width: 320, height: 568, key: 'phone-short' }]) {
    const isPhone = viewport.key.startsWith('phone');
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'no-preference', deviceScaleFactor: isPhone ? 2 : 1, isMobile: isPhone, hasTouch: isPhone });
    page.on('pageerror', error => report.pageErrors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.goto(new URL('?piece=camera&lens=m50', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.p2p?.pieces?.camera?.state?.().loaded === true, null, { timeout: 60000 });
    await page.locator('#learn-launch').click();
    await page.waitForFunction(() => !document.querySelector('#journey').hidden);
    const records = [];
    for (let index = 0; index < 8; index++) {
      await page.locator('#journey-stop').selectOption(String(index));
      await page.waitForTimeout(120);
      const fast = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom }; };
        const view=box('#view'), viewer=box('.viewer'), body=box('.stage .body'), nav=box('.hud-btns-phone'), sidebar=box('.studio-sidebar');
        const overlaps=r=>r.width&&r.height?Math.max(0,Math.min(view.bottom,r.bottom)-Math.max(view.y,r.y)):0;
        return { view, visibleHeight:Math.max(0,Math.min(view.bottom,viewer.bottom,body.bottom,innerHeight)-Math.max(view.y,viewer.y,body.y,0)), navOverlap:overlaps(nav), sidebarOverlap:overlaps(sidebar), text:document.querySelector('#journey-text').textContent, caption:document.querySelector('#journey-caption').textContent,
          stop:document.querySelector('#journey-stop').value, tour:box('#journey') };
      });
      await page.waitForTimeout(750);
      const settled = await page.locator('#view').boundingBox();
      records.push({ index, ...fast, settledHeight:settled?.height });
      if (index === 0) await page.screenshot({ path:`${out}/${viewport.key}-tour-step-1.png` });
      if(index===0&&isPhone){
        const caption=await page.evaluate(()=>{const c=document.querySelector('#journey-caption'),s=document.querySelector('#journey-stop'),m=document.querySelector('#journey-more > summary'),r=c.getBoundingClientRect(),mr=m.getBoundingClientRect();return {height:r.height,line:parseFloat(getComputedStyle(c).lineHeight),top:r.top,selectBottom:s.getBoundingClientRect().bottom,moreHeight:mr.height,moreHit:m.contains(document.elementFromPoint(mr.x+mr.width/2,mr.y+mr.height/2))}});
        if(caption.height<caption.line||caption.top<caption.selectBottom-1||caption.moreHeight<30||!caption.moreHit) report.findings.push(`${viewport.key}: tour caption is vertically clipped or More is not reachable`);
      }
      if (index === 7) await page.screenshot({ path:`${out}/${viewport.key}-tour-step-8.png` });
    }
    const heights = records.map(record => record.view.height);
    const spread = Math.max(...heights) - Math.min(...heights);
    const phoneGeometry = !isPhone ? null : await page.evaluate(() => {
      const rect = element => { const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
      const view=document.querySelector('#view'), viewer=document.querySelector('.viewer'), body=document.querySelector('.stage .body'), nav=document.querySelector('.hud-btns-phone'), sidebar=document.querySelector('.studio-sidebar');
      const v=rect(view), vr=rect(viewer), br=rect(body), nr=rect(nav), sr=rect(sidebar), clippedTop=Math.max(v.y,vr.y,br.y,0), clippedBottom=Math.min(v.bottom,vr.bottom,br.bottom,innerHeight);
      return { view:v, viewer:vr, body:br, nav:nr, sidebar:sr, visibleCanvasHeight:Math.max(0,clippedBottom-clippedTop), viewNavOverlap:Math.max(0,Math.min(v.bottom,nr.bottom)-Math.max(v.y,nr.y)), viewSidebarOverlap:Math.max(0,Math.min(v.bottom,sr.bottom)-Math.max(v.y,sr.y)) };
    });
    report.tour[viewport.key] = { stops:records, heightSpread:spread, phoneGeometry };
    // Very short screens give the 2D readout lessons space reclaimed from the
    // Parts dock. Require usable, unobstructed frames there rather than wasting
    // that space to match the smaller 3D frame.
    if (viewport.key !== 'phone-short' && spread >= 4) report.findings.push(`${viewport.key}: #view height changes by ${spread}px across tour stops`);
    if (isPhone) {
      const minFrame = viewport.key === 'phone' ? 320 : 100;
      if (phoneGeometry.visibleCanvasHeight < minFrame) report.findings.push(`${viewport.key}: only ${phoneGeometry.visibleCanvasHeight}px of #view is visible; expected at least ${minFrame}px`);
      if (phoneGeometry.viewNavOverlap > 0 || phoneGeometry.viewSidebarOverlap > 0) report.findings.push(`${viewport.key}: #view overlaps navigation or the Parts inspector`);
      for(const record of records) if(record.visibleHeight < minFrame || record.navOverlap>0 || record.sidebarOverlap>0) report.findings.push(`${viewport.key} stop ${record.index}: model frame is clipped or covered (${record.visibleHeight}px visible)`);
    }
    {
      await page.locator('#journey-stop').selectOption('1');
      if (isPhone) await page.locator('#journey-more > summary').click();
      await page.locator('#journey-physics').click();
      await page.locator('#journey-reading').waitFor({state:'visible'});
      const reading = await page.locator('#journey-reading').evaluate(dialog => {
        const r=dialog.getBoundingClientRect(), body=dialog.querySelector('.journey-reading-body');
        return {top:r.top,bottom:r.bottom,right:r.right,bodyHeight:body.clientHeight,horizontalOverflow:body.scrollWidth>body.clientWidth};
      });
      await page.locator('#journey-use').scrollIntoViewIfNeeded();
      const reachable=await page.locator('#journey-use').evaluate(e=>{const r=e.getBoundingClientRect(),b=e.closest('.journey-reading-body').getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1});
      report.tour[viewport.key].reading={...reading,reachable};
      if(reading.bodyHeight<300||reading.top<0||reading.bottom>viewport.height||reading.right>viewport.width||reading.horizontalOverflow||!reachable) report.findings.push(`${viewport.key}: physics reading sheet is clipped or too small`);
      await page.screenshot({path:`${out}/${viewport.key}-tour-more-physics.png`});
      await page.keyboard.press('Escape');
      if(await page.locator('#journey-reading').isVisible()||await page.evaluate(()=>document.activeElement.id)!=='journey-physics') report.findings.push(`${viewport.key}: reading sheet did not close and return keyboard focus`);
    }
    if (isPhone) {
      await page.locator('#journey-close').click();
      await page.waitForFunction(() => document.querySelector('#journey').hidden);
      await page.close();
      report.checks.push(`${viewport.key}: all tour stops share a stable frame (${phoneGeometry.visibleCanvasHeight}px visible), with no navigation or Parts overlap.`);
      if (viewport.key === 'phone') report.checks.push('Physics opens in a spacious reading sheet with accessible closing and focus return.');
      continue;
    }
    report.checks.push(`Desktop: all eight tour stops sampled; #view height spread ${spread}px.`);
    await page.locator('#journey-close').click();
    await page.waitForFunction(() => document.querySelector('#journey').hidden);
    await page.locator('#tab-controls').click();
    const summary = page.locator('.studio-advanced > summary');
    await summary.waitFor({state:'visible'});
    const fire = page.locator('#compact-fire');
    await fire.waitFor({ state:'visible' });
    await page.waitForFunction(() => !document.querySelector('#compact-fire').disabled);
    const bbox = async () => { const r=await summary.boundingBox(); return r && {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.y+r.height}; };
    report.playback.before = await bbox();
    if (!report.playback.before) report.findings.push('More settings summary has no measurable visible bounds before playback.');
    await page.screenshot({ path:`${out}/desktop-playback-before.png` });
    await fire.click();
    await page.waitForFunction(() => ['playing','paused','complete'].includes(document.querySelector('#studio-exposure .rig-exposure')?.dataset.playback));
    await page.waitForTimeout(120);
    report.playback.during = await bbox();
    if (!report.playback.during) report.findings.push('More settings summary has no measurable visible bounds during playback.');
    report.playback.duringState = await page.locator('#studio-exposure .rig-exposure').getAttribute('data-playback');
    const badge = await page.locator('#scale-badge').boundingBox();
    const badgeAnchor = await page.locator('#scale-badge').evaluate(el => { const r=el.getBoundingClientRect(), host=el.closest('.hud.bl').getBoundingClientRect(); return {text:el.textContent,x:r.x,right:r.right,y:r.y,hostLeft:host.x,hostRight:host.right,align:getComputedStyle(el.closest('.hud.bl')).textAlign}; });
    const viewRight = await page.locator('#view').evaluate(el=>el.getBoundingClientRect().right);
    report.playback.badge = { box:badge, ...badgeAnchor, viewRight };
    if (badgeAnchor.align !== 'right' || Math.abs(badgeAnchor.hostRight - (viewRight - 12)) > 2) report.findings.push('Playback scale badge did not land right-aligned at the view’s lower-right inset.');
    await page.screenshot({ path:`${out}/desktop-playback-during.png` });
    await page.waitForFunction(() => document.querySelector('#studio-exposure .rig-exposure')?.dataset.playback === 'complete', null, { timeout:20000 });
    report.playback.after = await bbox();
    if (!report.playback.after) report.findings.push('More settings summary has no measurable visible bounds after playback.');
    await page.screenshot({ path:`${out}/desktop-playback-after.png` });
    const tops = [report.playback.before?.y,report.playback.during?.y,report.playback.after?.y].filter(Number.isFinite);
    report.playback.maxTopSpread = Math.max(...tops)-Math.min(...tops);
    if (tops.length !== 3) report.findings.push('More settings bounds were not measured in all three playback states.');
    else if (report.playback.maxTopSpread > 1) report.findings.push(`More settings moves ${report.playback.maxTopSpread}px across playback states`);
    else report.checks.push(`Desktop: More settings y-position measured before, during and after playback; spread ${report.playback.maxTopSpread}px.`);

    // The launch affordance is scoped to the lens explanation. Navigate there
    // explicitly so a missing/unreachable affordance cannot be mistaken for
    // a passing modal test.
    const lens = page.locator('#steps .step[data-piece="lens"]');
    await lens.waitFor({ state:'visible', timeout:10000 });
    await lens.click();
    await page.waitForTimeout(900);
    const ghostButton = page.locator('.ghost-launch button');
    await ghostButton.waitFor({state:'visible',timeout:10000});
    await ghostButton.click();
    const dialog=page.locator('#ghost-plate');
    await dialog.waitFor({state:'visible'});
    await page.waitForFunction(() => document.querySelector('#ghost-plate .ghost-graph')?.getBoundingClientRect().height > 0);
    const geometry = await page.evaluate(() => {
      const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
      const d=document.querySelector('#ghost-plate'), graph=document.querySelector('#ghost-plate .ghost-graph'), rays=document.querySelector('#ghost-plate .ghost-rays'), layout=document.querySelector('#ghost-plate .ghost-layout');
      const drect=rect(d), grect=rect(graph), clientBottom=drect.y+d.clientTop+d.clientHeight;
      const text=graph.querySelector('text');
      const transform=text?.getScreenCTM();
      return {dialog:drect,graph:grect,rays:rect(rays),layout:rect(layout),graphBottomInsideDialog:clientBottom-grect.bottom,scrollHeight:d.scrollHeight,clientHeight:d.clientHeight,scrollable:d.scrollHeight>d.clientHeight,graphFontPx:text&&transform?parseFloat(getComputedStyle(text).fontSize)*Math.hypot(transform.a,transform.b):null,figureLayout:getComputedStyle(document.querySelector('#ghost-plate figure')).display};
    });
    report.ghosts=geometry;
    await page.screenshot({path:`${out}/desktop-ghosts.png`});
    if (!geometry.graph.width || !geometry.rays.width || geometry.graphFontPx === null) report.findings.push('Ghosts ray/reflectance diagram bounds or chart labels were missing.');
    if (geometry.graphBottomInsideDialog < 8) report.findings.push(`Ghost reflectance chart bottom is clipped by ${-geometry.graphBottomInsideDialog}px`);
    if (geometry.rays.y < geometry.dialog.y || geometry.graph.bottom > geometry.dialog.bottom || geometry.dialog.bottom > 900) report.findings.push('Ghosts modal or one of its diagrams extends beyond the visible desktop frame.');
    if (geometry.graph.width < 500 || geometry.graphFontPx < 12) report.findings.push('Ghost reflectance labels or chart are too small to read at desktop size.');
    report.checks.push(`Ghosts modal: full ray diagram and reflectance chart fit at ${geometry.graph.width.toFixed(0)}px chart width; labels render at ${geometry.graphFontPx}px.`);
    await page.close();
  }
  if (report.consoleErrors.length || report.pageErrors.length) report.findings.push('Browser console/page errors were recorded');
  report.status=report.findings.length?'FAIL':'PASS';
} catch (error) {
  report.status='FAIL'; report.failure=String(error.stack||error);
} finally {
  writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  if (browser) await browser.close();
  if (server) await server.close();
  console.log(JSON.stringify(report,null,2));
}
if (report.status !== 'PASS' || report.findings.length) process.exitCode = 1;
