import bodyHardware from '../../data/hardware/body.json';

export type CaptureMechanism = 'mechanical' | 'electronic';
/** A representative mechanical transit from the existing body model, not EXIF. */
export const CURTAIN_TRANSIT_S = bodyHardware.shutter.curtainTravelMs.v / 1000;
export function captureSweep(progress: number, exposureS: number) {
  const p=Math.max(0,Math.min(1,progress));
  const duration=Math.max(.000001,exposureS),total=CURTAIN_TRANSIT_S+duration;
  const elapsed=Math.max(0,Math.min(1,(p-.12)/.64))*total;
  const clamp=(v:number)=>Math.max(0,Math.min(1,v));
  return {
    phase:p<.12?'prepare':p<.76?'expose':p<.88?'hold':'preview',
    front:clamp(elapsed/CURTAIN_TRANSIT_S),rear:clamp((elapsed-duration)/CURTAIN_TRANSIT_S),
    elapsed,total,preview:clamp((p-.88)/.12),prepare:clamp(p/.12),
  } as const;
}
/** Row coordinates share one readout/image-assembly clock, including the final row. */
export function assemblyRows(progress:number, rows=32) {
  const p=Math.max(0,Math.min(1,progress));
  return { complete:Math.floor(p*rows), active:Math.min(rows-1,Math.floor(p*rows)), fraction:p };
}
