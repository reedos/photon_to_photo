import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const url=process.env.P2P_URL||'http://127.0.0.1:47722/';
const browser=await chromium.launch({channel:'chrome',headless:true});
mkdirSync('shots/reference-uses',{recursive:true});
try{
 for(const [width,height] of [[1366,900],[390,844],[320,740]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url+'reference.html?page=evidence&q=D850%20full%20well');
  assert.equal(await page.locator('#ref-search').inputValue(),'D850 full well');
  assert.ok(await page.locator('.evidence-row:visible').count()>0,'camera plus parameter can be searched');
  await page.locator('.evidence-row:visible summary').first().click();
  assert.match(await page.locator('.evidence-row:visible').first().textContent(),/fullWell/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.screenshot({path:`shots/reference-uses/evidence-${width}.png`,fullPage:true});
  await page.locator('#ref-clear').click();assert.equal(new URL(page.url()).searchParams.has('q'),false);
  assert.equal(await page.locator('#ref-search').evaluate(e=>e===document.activeElement),true);
  await page.locator('#ref-search').fill('n50 Example 7');
  assert.ok(await page.locator('.evidence-row:visible').count()>0);
  await page.locator('.evidence-row:visible summary').first().click();
  assert.match(await page.locator('.evidence-row:visible').first().textContent(),/Table 7/);
  await page.reload();assert.equal(await page.locator('#ref-search').inputValue(),'n50 Example 7');
  await page.locator('#ref-search').fill('no matching field zzz');assert.equal(await page.locator('.evidence-row:visible').count(),0);
  assert.match(await page.locator('#search-count').textContent(),/try a different search/);
  await page.goto(url+'reference.html?page=glossary&q=shot%20noise');
  assert.equal(await page.locator('[data-search]:visible').count(),1);
  await page.locator('#ref-clear').click();assert.equal(await page.locator('[data-search]:visible').count(),16);
  assert.deepEqual(errors,[]);await page.close();console.log(`reference uses ${width}: passed`);
 }
}finally{await browser.close();}
