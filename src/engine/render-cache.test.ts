import {describe,it,expect} from 'vitest';
import {compute} from '../app/engine-api';
import {renderSetup,traceSourceWithMotion} from './render';
import {birdShot} from '../app/shot-model';
import {BINS,V_LAMBDA} from './data';
import {getScene} from './scenes';
import {radiance,illuminantSpectralIrradiance} from './scene';
describe('render-local exact precomputation',()=>{
 for(const slow of [false,true]) for(const cct of [4200,7500]) it(`preserves temporal samples (${slow}, ${cct} K) exactly`,()=>{
  const s=renderSetup(compute({...birdShot(slow),cct,lux:cct}),60,40);
  for(const [x,y] of [[0,0],[29,19],[38,20],[15,14],[22.25,9.75],[44,34]]){
   const sample=(prepared:boolean)=>traceSourceWithMotion(x,y,60,40,s.blockPitchMm,s.efl,s.workingFno,s.sceneObj,s.spec,s.exposureS,s.motion,s.movingBillboardIds,prepared?s.prepared:undefined);
   expect(sample(true)).toEqual(sample(false));
  }
 });
 it('leaves background, highlights and misses unchanged',()=>{
  const scene=getScene('dusk'),e=illuminantSpectralIrradiance(scene.illuminant.spectrum,scene.illuminant.lux,BINS,V_LAMBDA),cached=BINS.centers.map(e);
  const points=[[0,0,1],[0,0,-1],...[...(scene.pointHighlights??[])].map(p=>p.position)];
  for(const p of points)expect(radiance(scene,[0,0,0],p as [number,number,number],BINS,V_LAMBDA,cached)).toEqual(radiance(scene,[0,0,0],p as [number,number,number],BINS,V_LAMBDA));
 });
});
