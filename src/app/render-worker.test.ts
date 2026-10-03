import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./engine-api',()=>({compute:(scenario:unknown)=>scenario,renderImage:(model:{iso:number})=>({
 width:1,height:1,pixelScale:1,rgba:new Uint8ClampedArray([0,0,0,255]),raw:new Uint16Array([model.iso]),stages:{tone:new Float32Array([0,0,0])},meta:{seed:1,ms:1,notes:[]},pixel:()=>({tag:model.iso})
})}));
afterEach(()=>vi.unstubAllGlobals());
it('retains four completed renders even when many pixel requests consume intervening ids',async()=>{
 const worker:{onmessage:((event:{data:unknown})=>void)|null;postMessage:ReturnType<typeof vi.fn>}={onmessage:null,postMessage:vi.fn()};
 vi.stubGlobal('self',worker);await import('./render-worker');
 const render=(id:number)=>worker.onmessage!({data:{type:'render',id,scenario:{iso:id},width:1,height:1,seed:1}});
 const pixel=(id:number,renderId:number)=>{worker.onmessage!({data:{type:'pixel',id,renderId,x:0,y:0}});return worker.postMessage.mock.calls.at(-1)![0];};
 render(1);for(let id=2;id<90;id++)expect(pixel(id,1).pixel.tag).toBe(1);
 render(100);render(200);render(300);
 expect(pixel(301,1).pixel.tag).toBe(1);
 render(400);expect(pixel(401,1).type).toBe('error');expect(pixel(402,100).pixel.tag).toBe(100);
});
