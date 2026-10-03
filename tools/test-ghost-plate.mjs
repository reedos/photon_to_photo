import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startPreview} from './preview.mjs';
import {decodePng,pngPixel} from './accuracy/png.mjs';

const server=process.env.P2P_URL?null:await startPreview();
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/ghost-plate',{recursive:true});const results=[];
try {
  for(const width of [1366,390,320]) {
    const page=await browser.newPage({viewport:{width,height:width===1366?900:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(new URL('?piece=camera',process.env.P2P_URL||server.url).href);await page.waitForFunction(()=>window.p2p?.pieces.camera);
    await page.evaluate(()=>window.p2p.piece('lens'));await page.evaluate(()=>window.p2p.settle());
    await page.locator('.ghost-launch:visible button').click();const dialog=page.locator('#ghost-plate');await dialog.waitFor({state:'visible'});
    const state=()=>page.evaluate(()=>window.p2p.pieces.lens.ghosts());
    const bare=await state();assert.equal(bare.playing,false);assert.equal(bare.settings.coated,false);
    const tan=Math.tan(Math.asin(Math.sin(Math.PI/6)/1.5));assert.ok(Math.abs(bare.separationMm-6*tan)<1e-10);
    await page.screenshot({path:`shots/ghost-plate/bare-${width}.png`});
    await dialog.locator('.ghost-coated').check();const coated=await state();assert.ok(coated.ghost<bare.ghost/5);
    await dialog.evaluate(el=>el.scrollTop=0);const shot=await page.screenshot({path:`shots/ghost-plate/coated-${width}.png`});
    // The displayed SVG contains the same multi-bounce geometry, including both glass faces.
    const actual=(await dialog.locator('.ghost-double-path').getAttribute('d')).match(/-?[\d.]+/g).map(Number);
    assert.equal(actual.length,12);coated.screenPath.flat().forEach((n,i)=>assert.ok(Math.abs(actual[i]-n)<.001));
    assert.deepEqual(coated.ghostPath.map(p=>p[2]),[-5,0,3,0,3,8]);
    // Pixel evidence that the computed orange ghost is visibly rendered, not merely a state hook.
    const box=await dialog.locator('.ghost-rays').boundingBox(),png=decodePng(shot);let orange=0;
    for(let y=Math.ceil(box.y);y<Math.min(png.height,box.y+box.height);y++)for(let x=Math.ceil(box.x);x<Math.min(png.width,box.x+box.width);x++){const c=pngPixel(png,x,y);if(c[0]>180&&c[1]>90&&c[1]<230&&c[2]<150)orange++;}
    assert.ok(orange>50,`ghost rendered ${orange} pixels`);
    const angle=dialog.locator('[data-key="angleDeg"]');await angle.fill('0');await dialog.locator('.ghost-coated').uncheck();const normal=await state();
    assert.ok(Math.abs(normal.ghost-.00147456)<1e-12);assert.equal(normal.separationMm,0);assert.ok(normal.screenPath.every(p=>p[1]===normal.screenPath[0][1]));
    assert.ok((await dialog.locator('.ghost-stats').innerText()).includes('0.1475%'));
    await angle.press('ArrowRight');assert.equal((await state()).settings.angleDeg,1);
    await angle.fill('65');await dialog.locator('[data-key="filmNm"]').fill('200');await dialog.locator('.ghost-coated').check();const edge=await state();assert.ok(Number.isFinite(edge.ghost)&&edge.ghost>=0);assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await angle.fill('30');await dialog.locator('[data-key="filmNm"]').fill('99.6');await dialog.locator('.ghost-play').click();await page.waitForFunction(()=>window.p2p.pieces.lens.ghosts().progress>.02);
    await dialog.locator('.ghost-play').click();const paused=await state();await page.waitForTimeout(120);assert.equal((await state()).progress,paused.progress);
    await dialog.locator('.ghost-play').click();await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.p2p.pieces.lens.ghosts().open&&!window.p2p.pieces.lens.ghosts().playing);assert.equal(await page.locator('.ghost-launch:visible button').evaluate(el=>el===document.activeElement),true);
    await page.locator('.ghost-launch:visible button').click();await page.evaluate(()=>window.p2p.piece('cone'));await page.evaluate(()=>window.p2p.settle());assert.equal((await state()).open,false);assert.equal(await page.locator('.ghost-launch').isVisible(),false);
    assert.deepEqual(errors,[]);results.push({width,bareGhost:bare.ghost,coatedGhost:coated.ghost,separationMm:bare.separationMm,visibleGhostPixels:orange});console.log(`PASS ghosts ${width}: exact plane bounces, Fresnel powers, ${orange} rendered ghost pixels, coating/keyboard/pause/Escape/piece lifecycle`);await page.close();
  }
  writeFileSync('shots/ghost-plate/results.json',JSON.stringify(results,null,2));
}finally{await browser.close();await server?.close();}
