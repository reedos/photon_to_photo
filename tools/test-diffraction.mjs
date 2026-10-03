import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
import { decodePng, pngPixel } from './accuracy/png.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/diffraction',{recursive:true});
const results=[];
try {
  for(const width of [1366,390,320]) {
    const page=await browser.newPage({viewport:{width,height:width===1366?900:844},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(new URL('?piece=camera',process.env.P2P_URL||server.url).href);
    await page.waitForFunction(()=>window.p2p?.pieces.camera);
    await page.evaluate(()=>{window.p2p.set({lens:'n50',fno:4,focusM:3});window.p2p.piece('lens');});
    await page.evaluate(()=>window.p2p.settle());
    await page.locator('.diffraction-launch:visible button').waitFor();
    await page.screenshot({path:`shots/diffraction/before-${width}.png`});
    await page.locator('.diffraction-launch:visible button').click();
    const dialog=page.locator('#diffraction-lens');
    await dialog.waitFor({state:'visible'});
    const initial=await page.evaluate(()=>window.p2p.pieces.lens.diffraction());
    assert.equal(initial.nm,550);assert.equal(initial.playing,false);assert.equal(initial.grid,17);
    const aperture=dialog.locator('.diffraction-aperture');
    if(width===1366){
      await dialog.evaluate(d=>{const a=d.querySelector('.diffraction-aperture'),w=d.querySelector('.diffraction-wavelength');a.value='8';a.dispatchEvent(new Event('input'));w.value='650';w.dispatchEvent(new Event('input'));});
      await page.waitForFunction(()=>window.p2p.model().scenario.fno===8&&window.p2p.pieces.lens.diffraction().nm===650);
      await dialog.locator('.diffraction-wavelength').fill('550');await page.waitForFunction(()=>window.p2p.pieces.lens.diffraction().nm===550);
    }
    await aperture.fill('16');
    await page.waitForFunction(()=>window.p2p.model().scenario.fno===16);
    const stopped=await page.evaluate(()=>window.p2p.pieces.lens.diffraction());
    assert.ok(Math.abs(stopped.radiusRaster/initial.radiusRaster-4)<1e-6);
    assert.ok(stopped.centerFraction<initial.centerFraction/3);
    assert.equal(stopped.spanMm,initial.spanMm);
    // Native keyboard control changes the live scenario, rather than a disconnected demo.
    await aperture.press('ArrowRight');
    await page.waitForFunction(()=>window.p2p.model().scenario.fno>16);
    await aperture.fill('16');await page.waitForFunction(()=>window.p2p.model().scenario.fno===16);
    await dialog.locator('.diffraction-ring input').uncheck();
    await dialog.evaluate(el=>el.scrollTop=0);
    const canvas=dialog.locator('.diffraction-pattern'),box=await canvas.boundingBox();
    const screenshot=await page.screenshot({path:`shots/diffraction/airy-${width}.png`});
    const png=decodePng(screenshot),expected=stopped.radiusRaster/stopped.size*box.width;
    const cx=box.x+box.width/2,cy=box.y+box.height/2;
    let darkest={value:Infinity,r:0};
    for(let r=Math.floor(expected*.80);r<=Math.ceil(expected*1.2);r++) {
      // Sample parallel to the grid through pixel centers, avoiding every grid intersection.
      const value=pngPixel(png,Math.round(cx+r),Math.round(cy))[1];
      if(value<darkest.value)darkest={value,r};
    }
    assert.ok(Math.abs(darkest.r-expected)<2.5,`rendered ring radius ${darkest.r}px, expected ${expected}px`);
    await dialog.locator('[data-mode="pixels"]').click();
    assert.equal(await dialog.getAttribute('data-mode'),'pixels');
    await dialog.locator('.diffraction-wavelength').fill('650');
    await page.waitForFunction(()=>window.p2p.pieces.lens.diffraction().nm===650);
    const red=await page.evaluate(()=>window.p2p.pieces.lens.diffraction());
    assert.ok(Math.abs(red.radiusRaster/stopped.radiusRaster-650/550)<1e-6);
    assert.ok(red.cells.every(c=>c.fraction>=0&&Number.isFinite(c.fraction)));
    await dialog.evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:`shots/diffraction/pixels-${width}.png`});
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await dialog.locator('.diffraction-play').click();
    await page.waitForFunction(()=>window.p2p.pieces.lens.diffraction().phase>0);
    await dialog.locator('.diffraction-play').click();
    const frozen=await page.evaluate(()=>window.p2p.pieces.lens.diffraction().phase);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>window.p2p.pieces.lens.diffraction().phase),frozen);
    await dialog.locator('.diffraction-close').click();
    assert.equal(await page.locator('.diffraction-launch:visible button').evaluate(el=>el===document.activeElement),true);
    await page.evaluate(()=>window.p2p.piece('cone'));await page.evaluate(()=>window.p2p.settle());
    await page.locator('.diffraction-launch:visible button').click();
    assert.equal(await page.locator('#diffraction-cone').isVisible(),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#diffraction-cone').isVisible(),false);
    assert.deepEqual(errors,[]);
    results.push({width,expectedRadiusCss:expected,renderedRadiusCss:darkest.r,centerAtF4:initial.centerFraction,centerAtF16:stopped.centerFraction});
    console.log(`PASS diffraction ${width}: actual ring ${darkest.r}px, engine ${expected.toFixed(2)}px; physical scale, keyboard, pixel integration, lifecycle`);
    await page.close();
  }
  writeFileSync('shots/diffraction/results.json',JSON.stringify(results,null,2));
} finally {await browser.close();await server?.close();}
