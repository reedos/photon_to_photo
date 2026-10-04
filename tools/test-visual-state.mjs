import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';

const server=await createServer({server:{host:'127.0.0.1',port:0,open:false,watch:null,hmr:false}});
await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/audit/visual-state',{recursive:true});
const results=[];
try {
  const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
  page.setDefaultTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',message=>{if(message.type()==='error'&&/WebGPU|GPUValidation|texture.*destroyed/i.test(message.text())){
    if(!errors.length)void page.evaluate(()=>({frame:window.p2p.framing(),detail:window.p2p.pieces.camera.detail(),exposure:window.p2p.pieces.camera.exposure()})).then(value=>console.log('First GPU error context',JSON.stringify(value))).catch(()=>{});
    errors.push(message.text());
  }});
  if(process.env.P2P_LABEL_GPU)await page.addInitScript(()=>{
    const create=GPUDevice.prototype.createTexture,records=[];window.gpuTextureRecords=records;
    GPUDevice.prototype.createTexture=function(descriptor){
      const id=records.length+1;records.push({id,size:descriptor.size,format:descriptor.format,stack:new Error().stack});
      return create.call(this,{...descriptor,label:`${descriptor.label||'texture'} #${id}`});
    };
  });
  await page.goto(url+'?lens=n50');
  await page.waitForFunction(()=>window.p2p?.pieces.camera?.state().loaded);
  await page.waitForFunction(()=>document.querySelector('#finalimg-canvas').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#compact-fire').getAttribute('aria-label'),'Fire shutter');
  assert.equal(await page.locator('#sc-focus').isVisible(),true);
  assert.equal(await page.locator('#sc-fno').isVisible(),true);
  // A tap on the still-visible previous photo must not open a stale pixel during the debounce.
  const staleTap=await page.evaluate(()=>{
    window.p2p.set({iso:200});
    const photo=document.querySelector('#finalimg-canvas');photo.click();
    return {piece:window.p2p.framing().piece,disabled:photo.getAttribute('aria-disabled')};
  });
  assert.deepEqual(staleTap,{piece:'camera',disabled:'true'});results.push('old-photo tap blocked during render');
  await page.waitForFunction(()=>document.querySelector('#finalimg-canvas').getAttribute('aria-disabled')==='false');
  // A failed obsolete body/lens request must not poison a newer completed rig.
  let obsolete;
  await page.route('**/models/lenses/m50.glb',route=>{obsolete=route;});
  await page.evaluate(()=>window.p2p.set({lens:'m50'}));
  await page.waitForFunction(()=>window.p2p.scenario().lens==='m50');
  for(let i=0;i<100&&!obsolete;i++)await page.waitForTimeout(50);
  assert.ok(obsolete,'intercepted old m50 request');
  await page.evaluate(()=>window.p2p.set({lens:'z35'}));
  await page.waitForFunction(()=>window.p2p.pieces.camera.state().lens==='z35');
  await page.evaluate(()=>window.p2p.pieces.camera.ready());
  await obsolete.abort();await page.waitForTimeout(250);
  assert.equal(await page.locator('#compact-fire').isEnabled(),true);
  assert.equal(await page.locator('#veil').evaluate(el=>el.classList.contains('err')),false);
  results.push('obsolete model failure leaves newer rig enabled');
  // A selected part's slow asset completion must not restore global camera detail chrome in Focus.
  let late;
  await page.route('**/models/lenses/n500.glb',route=>{late=route;});
  await page.evaluate(()=>window.p2p.set({lens:'n500'}));
  for(let i=0;i<100&&!late;i++)await page.waitForTimeout(50);
  assert.ok(late,'intercepted n500 request');
  await page.locator('#tab-explain').click();
  await page.locator('#parts [data-part-id="iris"]').click();
  await page.evaluate(()=>window.p2p.piece('cone'));
  await late.continue();await page.evaluate(()=>window.p2p.pieces.camera.ready());
  assert.equal(await page.evaluate(()=>document.body.classList.contains('rig-detail')),false);
  assert.equal(await page.locator('.hud-label').filter({hasText:'Entrance pupil'}).count(),0);
  results.push('late camera completion leaves Focus chrome clean');
  await page.unroute('**/models/lenses/n500.glb');
  await page.unroute('**/models/lenses/m50.glb');
  for(const width of (process.env.P2P_AUDIT_WIDTHS||'1366,390,320').split(',').map(Number)) {
    await page.setViewportSize({width,height:width===1366?768:844});
    await page.evaluate(()=>window.p2p.piece('camera'));
    await page.evaluate(()=>window.p2p.pieces.camera.ready());
    await page.locator('#part-overview').click();
    await page.locator('#tab-controls').click();
    for(const control of ['#compact-fire','#sc-focus','#sc-fno'])assert.equal(await page.locator(control).isVisible(),true);
    await page.locator('#sc-focus').press('End');
    await page.locator('#sc-focus').press('Home');
    assert.equal(await page.evaluate(()=>window.p2p.scenario().focusM*1000),await page.evaluate(()=>window.p2p.model().lens.closestFocusMm));
    await page.locator('#sc-focus').press('End');
    assert.equal(await page.evaluate(()=>window.p2p.scenario().focusM),null);
    assert.equal(await page.locator('#sc-focus').getAttribute('aria-valuetext'),'infinity');
    let box=await page.locator('#sc-focus').boundingBox();
    await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);
    assert.notEqual(await page.evaluate(()=>window.p2p.scenario().focusM),null);
    await page.locator('#sc-fno').press('End');
    assert.equal(await page.evaluate(()=>window.p2p.scenario().fno),22);
    assert.equal(await page.evaluate(()=>window.p2p.model().scenario.fno),22,'visible aperture slider updates the computed optical model');
    box=await page.locator('#sc-fno').boundingBox();
    await page.mouse.click(box.x+box.width*.4,box.y+box.height*.5);
    assert.ok(await page.evaluate(()=>window.p2p.scenario().fno<22));
    if(width<600)await page.locator('#phone-settings-close').click();
    await page.locator('#compact-fire').press('Enter');
    assert.equal(await page.evaluate(()=>window.p2p.pieces.camera.exposure().status),'paused');
    await page.evaluate(()=>window.p2p.set({iso:window.p2p.scenario().iso===100?200:100}));
    await page.evaluate(()=>window.p2p.settle());
    await page.screenshot({path:`shots/audit/visual-state/${width}-persistent-controls.png`});
    console.log('Controls',width,await page.evaluate(()=>({body:document.body.className,detail:window.p2p.pieces.camera.detail(),exp:window.p2p.pieces.camera.exposure().status,frame:window.p2p.framing(),marks:document.querySelectorAll('.rig-teach').length})));
    assert.equal(await page.evaluate(()=>document.body.classList.contains('rig-teaching')),false);
    assert.equal(await page.locator('.rig-teach').count(),3);
    if(width<600)await page.locator('#tab-controls').click();
    await page.locator('[data-view="cutaway"]').click();
    await page.evaluate(()=>window.p2p.settle());
    assert.equal(await page.locator('.rig-teach').count(),0);
    for(const control of ['#compact-fire','#sc-focus','#sc-fno'])assert.equal(await page.locator(control).isVisible(),true);
    await page.locator('[data-view="outside"]').click();
    if(width<600)await page.locator('#phone-settings-close').click();
    await page.evaluate(()=>window.p2p.settle());
    assert.equal(await page.locator('.rig-teach').count(),3);
    assert.ok((await page.locator('.pins .pin:visible').count())>=4);
    await page.screenshot({path:`shots/audit/visual-state/${width}-persistent-controls.png`});
    results.push(`${width}px: toolbar Fire and Controls sliders visible and operable by keyboard/pointer`);
    for(const lens of (process.env.P2P_AUDIT_LENSES||'n50,m50,n500,z800,s35,z35,n500fl').split(',')) {
      await page.evaluate(lens=>{window.p2p.piece('camera');window.p2p.set({lens});},lens);
      await page.evaluate(()=>window.p2p.pieces.camera.ready());
      for(const piece of ['camera','lens','cone']) {
        await page.evaluate(piece=>window.p2p.piece(piece),piece);
        await page.locator('#tab-explain').click();
        const parts=await page.locator('#parts button').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.partId,label:n.querySelector('.pt').textContent,number:n.querySelector('.pn').textContent})));
        assert.ok(parts.length>0);
        for(const part of parts) {
          await page.locator(`#parts [data-part-id="${part.id}"]`).click();
          await page.evaluate(()=>window.p2p.settle());
          const selected=await page.locator('#parts [aria-pressed="true"]').getAttribute('data-part-id');
          assert.equal(selected,part.id);
          assert.equal(await page.locator('#card').isVisible(),true);
          const pin=await page.evaluate(id=>window.p2p.pins().find(p=>p.id===id),part.id);
          assert.ok(pin,`${width}/${lens}/${piece}/${part.id}: pin exists`);
          assert.equal(pin.label,part.label);
          assert.equal(await page.locator(`.pin[data-pin-id="${part.id}"] .num`).textContent(),part.number);
          if(width===1366&&piece==='camera'&&['n50','m50'].includes(lens)&&['sensor','viewfinder'].includes(part.id))
            await page.screenshot({path:`shots/audit/visual-state/${width}-${lens}-${part.id}.png`});
        }
        await page.locator('#part-overview').click();
        await page.evaluate(()=>window.p2p.settle());
        await page.screenshot({path:`shots/audit/visual-state/${width}-${lens}-${piece}.png`});
      }
    }
    results.push(`${width}px: requested lenses, three inspections, every part selected and card shown`);
  }
  if(errors.length&&process.env.P2P_LABEL_GPU){const ids=errors.flatMap(e=>[...e.matchAll(/#(\d+)/g)].map(m=>Number(m[1])));console.log('Failed GPU textures',await page.evaluate(ids=>window.gpuTextureRecords.filter(r=>ids.includes(r.id)),ids));}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:results},null,2));
} finally {await browser.close();await server.close();}
