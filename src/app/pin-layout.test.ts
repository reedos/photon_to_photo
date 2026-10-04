import { spreadPins } from './pin-layout';

describe('independent part marker layout', () => {
  const cluster = Array.from({length:8}, (_,i) => ({id:String(i),x:160+i%2*2,y:95+i%3*2}));
  it('keeps eight clustered phone parts independently reachable with nonoverlapping touch targets', () => {
    const result = [...spreadPins(cluster,320,220,[],null,true).values()];
    expect(result).toHaveLength(8);
    for (const [i,p] of result.entries()) {
      expect(p.x).toBeGreaterThanOrEqual(22); expect(p.x).toBeLessThanOrEqual(298);
      expect(p.y).toBeGreaterThanOrEqual(22); expect(p.y).toBeLessThanOrEqual(198);
      for (const q of result.slice(i+1)) expect(Math.abs(p.x-q.x)>=44 || Math.abs(p.y-q.y)>=44).toBe(true);
    }
  });
  it('reserves the selected anchor first and produces deterministic positions', () => {
    const a=spreadPins(cluster,320,220,[],'7',true);
    expect(a.get('7')).toEqual(cluster[7]);
    expect(a).toEqual(spreadPins(cluster,320,220,[],'7',true));
  });
  it('keeps markers out of inset controls and omits them if the view is covered', () => {
    const result=[...spreadPins(cluster,320,220,[{l:0,t:0,r:140,b:220}],null,true).values()];
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(p=>p.x>=162)).toBe(true);
    expect(spreadPins(cluster,320,220,[{l:0,t:0,r:320,b:220}],null,true).size).toBe(0);
  });
});
