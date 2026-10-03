import { describe,it,expect } from 'vitest';
import { birdShot,shotMoment,SHOT_DURATION,SHOT_TRACKS } from './shot-model';
import { compute } from './engine-api';
import { sceneFor, sceneSubjectDistanceMm } from '../engine/scenes';
import { flightCoverage } from '../engine/flight-pattern';
describe('one consistent gliding-bird exposure',()=>{
  it('holds nominal display exposure while changing physical blur and photons by sixteen times',()=>{
    const fast=compute(birdShot(false)),slow=compute(birdShot(true));
    expect(slow.scenario.shutter/fast.scenario.shutter).toBe(16);
    expect(fast.scenario.iso/slow.scenario.iso).toBe(16);
    expect(slow.motion!.blurPx/fast.motion!.blurPx).toBeCloseTo(16,8);
    expect(slow.exposure.photonsMidGray/fast.exposure.photonsMidGray).toBeCloseTo(16,8);
    expect(fast.motion!.speedMps*fast.scenario.shutter*1000).toBeCloseTo(3);
  });
  it('moves a fixed-size flight subject without moving the background or adding a perch',()=>{
    const a=sceneFor('flight',10),b=sceneFor('flight',30);
    expect(a.billboards[0].widthMm).toBe(900);expect(b.billboards[0].widthMm).toBe(900);
    expect(a.billboards[0].center[2]).toBe(10000);expect(b.billboards[0].center[2]).toBe(30000);
    expect(a.billboards[1].center).toEqual(b.billboards[1].center);
    expect(a.movingBillboardIds).toEqual(['flight-subject']);
    expect(sceneSubjectDistanceMm('flight',100)).toBe(60000);
    expect(flightCoverage(.1,0)).toBe(true);expect(flightCoverage(.49,.49)).toBe(false);
  });
  it('scrubs deterministically across boundaries and holds the completed shot',()=>{
    expect(shotMoment(-1)).toEqual({time:0,stage:0,progress:0});
    expect(shotMoment(8)).toEqual({time:8,stage:2,progress:0});
    expect(shotMoment(99)).toEqual({time:SHOT_DURATION,stage:5,progress:1});
    expect(shotMoment(NaN)).toEqual(shotMoment(0));
  });
  it('holds the selected process at its own endpoint instead of jumping into the next process',()=>{
    expect(shotMoment(SHOT_TRACKS.light.end,SHOT_TRACKS.light.end)).toEqual({time:12,stage:2,progress:1});
    expect(shotMoment(SHOT_TRACKS.charge.end,SHOT_TRACKS.charge.end)).toEqual({time:16,stage:3,progress:1});
    expect(shotMoment(12)).toEqual({time:12,stage:3,progress:0});
    expect(shotMoment(16)).toEqual({time:16,stage:4,progress:0});
  });
});
