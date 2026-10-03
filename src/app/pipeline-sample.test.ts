import { describe, expect, it } from 'vitest';
import { pipelineSample } from './pipeline-sample';
describe('pipeline magnified sample',()=>{
  it('keeps the selected sample inside all four edges',()=>{
    expect(pipelineSample(600,400,0,0)).toEqual({x:0,y:0,width:16,height:16});
    expect(pipelineSample(600,400,1,1)).toEqual({x:584,y:384,width:16,height:16});
    expect(pipelineSample(600,400,.5,.5)).toEqual({x:292,y:192,width:16,height:16});
  });
  it('handles smaller buffers and invalid positions without reading outside the image',()=>{
    expect(pipelineSample(8,12,1,1)).toEqual({x:0,y:0,width:8,height:12});
    expect(pipelineSample(600,400,NaN,Infinity)).toEqual(pipelineSample(600,400,.5,.5));
  });
});
