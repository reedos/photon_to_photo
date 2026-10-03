import { describe,it,expect } from 'vitest';
import { filmReflectance,ghostPlate,platePowers,FILM_INDEX,PLATE_INDEX,type PlateSettings } from './ghost-plate';
const base:PlateSettings={angleDeg:0,nm:550,thicknessMm:3,coated:false,filmNm:550/(4*FILM_INDEX)};
describe('representative plate optics',()=>{
  it('matches the uncoated normal-incidence hand calculation, including entry and exit',()=>{
    const p=ghostPlate(base);expect(p.reflectance).toBeCloseTo(.04,12);expect(p.primary).toBeCloseTo(.9216,12);expect(p.ghost).toBeCloseTo(.00147456,12);expect(p.ghost/p.primary).toBeCloseTo(.0016,12);expect(p.separationMm).toBe(0);
  });
  it('zero film returns bare Fresnel and quarter-wave matching cancels reflection',()=>{
    for(const pol of ['s','p'] as const) {
      expect(filmReflectance(1,FILM_INDEX,1.5,0,550,0,pol)).toBeCloseTo(.04,12);
      const nf=Math.sqrt(1.5);expect(filmReflectance(1,nf,1.5,550/(4*nf),550,0,pol)).toBeCloseTo(0,12);
      const expected=((1.5-FILM_INDEX**2)/(1.5+FILM_INDEX**2))**2;
      expect(filmReflectance(1,FILM_INDEX,1.5,base.filmNm,550,0,pol)).toBeCloseTo(expected,12);
    }
  });
  it('obeys reciprocity, positive powers, and lossless interface budgets across controls',()=>{
    for(const angleDeg of [0,30,65])for(const nm of [400,550,700])for(const filmNm of [0,99.6,200]) {
      const p=platePowers({...base,angleDeg,nm,filmNm,coated:true});
      for(const c of p.channels) {expect(c.R).toBeCloseTo(c.reverse,12);expect(c.R).toBeGreaterThanOrEqual(0);expect(c.R).toBeLessThan(1);
        // Total transmitted incoherent passes plus all backward reflected passes.
        const T=1-c.R;expect(c.primary/(1-c.R*c.R)+c.R+T*T*c.R/(1-c.R*c.R)).toBeCloseTo(1,12);
      }
      expect(p.ghost).toBeLessThan(p.primary);
    }
  });
  it('computes each reflection on its plane and the correct Snell offset',()=>{
    const p=ghostPlate({...base,angleDeg:40}),tan=Math.tan(Math.asin(Math.sin(40*Math.PI/180)/PLATE_INDEX));
    expect(p.ghostPath.map(p=>p[2])).toEqual([-5,0,3,0,3,8]);
    expect(p.ghostPath[2][0]).toBeCloseTo(3*tan,12);expect(p.ghostPath[3][0]).toBeCloseTo(6*tan,12);expect(p.ghostPath[4][0]).toBeCloseTo(9*tan,12);expect(p.separationMm).toBeCloseTo(6*tan,12);
    const slopes=[p.primaryPath,p.ghostPath].map(path=>{const a=path.at(-2)!,b=path.at(-1)!;return (b[0]-a[0])/(b[2]-a[2]);});expect(slopes[0]).toBeCloseTo(Math.tan(40*Math.PI/180),12);expect(slopes[1]).toBeCloseTo(slopes[0],12);
  });
  it('averages path powers after s/p propagation and coating reduces reference ghost',()=>{
    const p=platePowers({...base,angleDeg:60});expect(p.ghost).toBe((p.channels[0].ghost+p.channels[1].ghost)/2);expect(Math.abs(p.ghost-(1-p.reflectance)**2*p.reflectance**2)).toBeGreaterThan(.001);
    const R=((PLATE_INDEX-FILM_INDEX**2)/(PLATE_INDEX+FILM_INDEX**2))**2;
    expect(platePowers({...base,coated:true}).ghost).toBeCloseTo((1-R)**2*R**2,12);
    expect(platePowers({...base,coated:true}).ghost).toBeLessThan(platePowers(base).ghost/7);
  });
});
