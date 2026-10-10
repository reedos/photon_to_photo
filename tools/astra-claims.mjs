// Inventory actual model/card values, plus every prose-sized UI literal for review.
// No listener, remote fetch, or publishing: Vite only transforms the existing TS modules.
import {createServer} from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import {API} from 'typescript/unstable/sync';
import {SyntaxKind} from 'typescript/unstable/ast';
const server=await createServer({server:{middlewareMode:true,watch:null},appType:'custom'});
const records=[];
try {
  const {compute,LINEUP,bodyForLens}=await server.ssrLoadModule('/src/app/engine-api.ts');
  const {partCard,PART_IDS}=await server.ssrLoadModule('/src/app/rig-cards.ts');
  for(const lens of [...LINEUP.dslr,...LINEUP.mirrorless]) for(const focusM of [null,3]) for(const fno of [2,8,16]) {
    const model=compute({lens,focusM,fno});
    records.push({scenario:model.scenario,figures:model.figs,cards:PART_IDS.map(id=>({id,...partCard(id,model,{body:bodyForLens(lens),ringAngle:0,elementShift:[]})}))});
  }
} finally {await server.close();}
const prose=[];
const families = {
  optics: ['src/engine/trace.test.ts','src/engine/paraxial.test.ts','src/engine/lenses.test.ts','src/engine/glass.test.ts','src/engine/doe.test.ts','data/lenses/'],
  focus: ['src/engine/camera.test.ts','src/engine/focus-sharp.test.ts','src/engine/dof.test.ts','src/engine/focus-travel.test.ts'],
  diffraction: ['src/engine/diffraction.test.ts','src/engine/iris.test.ts'],
  exposure: ['src/engine/exposure.test.ts','src/app/exposure-eq.test.ts','src/engine/spectrum.test.ts'],
  sensor: ['src/engine/sensor.test.ts','src/engine/data.test.ts','src/pieces/pixel-sample.test.ts','data/sensors.json','data/d850.json','data/z8.json','data/read-noise.json'],
  color: ['src/engine/color.test.ts','src/engine/pipeline.test.ts','src/app/pipeline-sample.test.ts'],
  ghosts: ['src/engine/ghost-plate.test.ts'],
  perspective: ['src/engine/perspective.test.ts','src/engine/formats.test.ts'],
  hardware: ['data/hardware/dslr.json','data/hardware/body.json','data/hardware/mounts.json','data/hardware/lens-exteriors.json'],
  photos: ['public/examples/examples.json','src/app/connected-story.test.ts','src/app/photo-shot.test.ts','src/app/photo-opening.test.ts'],
  interface: ['src/app/units.test.ts','src/app/inspection.test.ts','src/app/part-navigation.test.ts','tools/test-studio-workspace.mjs'],
};
function basis(text,file='') {
  const hits=[];
  for(const [key,re] of Object.entries({optics:/lens|glass|ray|refract|surface|pupil|focal/i,focus:/focus|blur|bokeh|sharp|confusion|CoC\b/i,diffraction:/diffract|airy|aperture|blade|iris|stop/i,exposure:/photon|exposure|shutter|lux|illumin|energy|light|EV100/i,sensor:/pixel|sensor|electron|charge|noise|well|\bISO\b|readout|\bQE\b/i,color:/color|colour|sRGB|Bayer|demosaic|balance|spectrum/i,ghosts:/ghost|coating|film|reflect twice/i,perspective:/perspective|field of view|format|crop/i,hardware:/mirror|mount|flange|barrel|mechan|contact|lug|prism|finder|button/i,photos:/photograph|recorded|metadata|JPEG|bird|example/i})) if(re.test(text+' '+file))hits.push(key);
  return hits.length?hits:['interface'];
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const api=new API();
try {
 const snapshot=api.updateSnapshot({openProjects:[path.resolve('tsconfig.json')]});
 const program=snapshot.getProjects()[0].program;
 for(const file of [...walk('src/app'),...walk('src/pieces'),'src/reference.ts'].filter(f=>f.endsWith('.ts')&&!f.endsWith('.test.ts'))){
  const source=fs.readFileSync(file,'utf8'),ast=program.getSourceFile(path.resolve(file));
  if(!ast)throw new Error(`Missing AST: ${file}`);
  function visit(node){
    if([SyntaxKind.StringLiteral,SyntaxKind.NoSubstitutionTemplateLiteral,SyntaxKind.TemplateExpression].includes(node.kind)) {
      const text=source.slice(node.pos,node.end).trim();
      if(text.length>2)prose.push({file:file.replaceAll('\\','/'),line:source.slice(0,node.pos).split('\n').length,text,basis:basis(text,file)});
      return;
    }
    node.forEachChild(visit);
  }
  visit(ast);
 }
 snapshot.dispose();
} finally {api.close();}
fs.mkdirSync('docs/audits',{recursive:true});
fs.writeFileSync('docs/audits/EX-1-claim-inventory.json',JSON.stringify({date:'10/07/2026',scope:'42 lineup scenarios; All UI string/template literals longer than two characters, including hidden study copy, retained without causal-keyword filtering. Basis tags are a review index into the proof families, not automated assertions that a sentence is true. Source ledger pointers are provenance, not a claim that every external source was re-opened today.',families,records,prose},null,2)+'\n');
console.log(`${records.length} scenarios, ${prose.length} prose literals inventoried`);
