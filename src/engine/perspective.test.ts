import {describe,it,expect} from 'vitest';
import {perspectiveStudy} from './perspective';
describe('ideal focal length and dolly study',()=>{
  it('holds subject image size throughout a dolly sweep',()=>{
    for(const f of [20,35,50,85,200,500])expect(perspectiveStudy(f,true).subjectHeightMm).toBeCloseTo(8,10);
  });
  it('fixed camera changes framing but not relative perspective',()=>{
    const a=perspectiveStudy(20,false),b=perspectiveStudy(500,false);
    expect(a.backgroundRatio).toBe(b.backgroundRatio);
    expect(b.subjectHeightMm).toBeGreaterThan(a.subjectHeightMm*25);
    expect(a.project(0,2000,20000).y/a.subjectHeightMm).toBeCloseTo(a.backgroundRatio,12);
  });
  it('background grows relative to subject as dolly camera retreats',()=>{
    const a=perspectiveStudy(20,true),b=perspectiveStudy(500,true);
    expect(b.subjectMm).toBeGreaterThan(a.subjectMm);
    expect(b.backgroundRatio).toBeGreaterThan(a.backgroundRatio);
    expect(b.project(1000,2000,20000).y).toBeGreaterThan(a.project(1000,2000,20000).y);
  });
});
