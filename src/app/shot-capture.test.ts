import { describe,it,expect } from 'vitest';
import { captureSweep, CURTAIN_TRANSIT_S, assemblyRows } from './shot-capture';
describe('illustrative shutter transit',()=>{
  for(const exposure of [1/4000,1/500,1/320,1/250])it(`every row gets ${exposure}s, with a traveling slit when needed`,()=>{
    for(const row of [.05,.5,.95]){
      const openAt=row*CURTAIN_TRANSIT_S,closeAt=openAt+exposure,total=CURTAIN_TRANSIT_S+exposure;
      const opened=captureSweep(.12+.64*(openAt+1e-8)/total,exposure);
      const closed=captureSweep(.12+.64*(closeAt+1e-8)/total,exposure);
      expect(opened.front).toBeGreaterThan(row);expect(opened.rear).toBeLessThan(row);
      expect(closed.rear).toBeGreaterThan(row);
      expect(closeAt-openAt).toBeCloseTo(exposure,12);
    }
  });
  it('separates preparing, exposure, charge hold and preview reset',()=>{
    expect([0,.5,.8,1].map(p=>captureSweep(p,.001).phase)).toEqual(['prepare','expose','hold','preview']);
    expect(captureSweep(1,.001).preview).toBe(1);
  });
  it('readout and image assembly finish the last row and clamp invalid ranges',()=>{
    expect(assemblyRows(0)).toEqual({complete:0,active:0,fraction:0});
    expect(assemblyRows(.5).complete).toBe(16);
    expect(assemblyRows(1)).toEqual({complete:32,active:31,fraction:1});
    expect(assemblyRows(-1).complete).toBe(0);expect(assemblyRows(2).complete).toBe(32);
  });
});
