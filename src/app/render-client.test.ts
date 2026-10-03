import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeScenario } from './engine-api';
const DEFAULT_SCENARIO = normalizeScenario({});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}

describe('photo worker recovery', () => {
  beforeEach(() => { vi.resetModules(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects interrupted work and starts a fresh worker for retry', async () => {
    const { requestRender, pixelAt } = await import('./render-client');
    const shot = requestRender(DEFAULT_SCENARIO, 10, 10);
    const pixel = pixelAt(1, 0, 0);
    const shotRejected = expect(shot).rejects.toThrow('crashed');
    const pixelRejected = expect(pixel).rejects.toThrow('crashed');
    const old = FakeWorker.instances[0];
    old.onerror!({ message: 'crashed', preventDefault() {} });
    await Promise.all([shotRejected, pixelRejected]);
    expect(old.terminate).toHaveBeenCalledOnce();
    const retried = requestRender(DEFAULT_SCENARIO, 10, 10);
    const next = FakeWorker.instances[1], request = next.postMessage.mock.calls[0][0];
    // An event queued by the old worker must not disrupt its replacement.
    old.onmessageerror!();
    next.onmessage!({ data: { type: 'render', id: request.id, width: 10, height: 10 } });
    expect(await retried).toMatchObject({ width: 10, scenario: DEFAULT_SCENARIO });
    expect(next.terminate).not.toHaveBeenCalled();
  });

  it('keeps application errors retryable without replacing a healthy worker', async () => {
    const { requestRender } = await import('./render-client');
    const failed = requestRender(DEFAULT_SCENARIO, 10, 10);
    const rejected = expect(failed).rejects.toThrow('bad render');
    const worker = FakeWorker.instances[0], request = worker.postMessage.mock.calls[0][0];
    worker.onmessage!({ data: { type: 'error', id: request.id, error: 'bad render' } });
    await rejected;
    const success = requestRender(DEFAULT_SCENARIO, 10, 10);
    const next = worker.postMessage.mock.calls[1][0];
    worker.onmessage!({ data: { type: 'render', id: next.id, width: 10, height: 10 } });
    expect(await success).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('ignores a superseded render that finishes after a newer request', async () => {
    const { requestRender } = await import('./render-client');
    const old = requestRender(DEFAULT_SCENARIO, 10, 10);
    const current = requestRender({ ...DEFAULT_SCENARIO, iso: 800 }, 10, 10);
    const worker = FakeWorker.instances[0];
    for (const [request] of worker.postMessage.mock.calls) worker.onmessage!({ data: { type: 'render', id: request.id } });
    expect(await old).toBeNull();
    expect((await current)?.scenario.iso).toBe(800);
  });

  it('coalesces a burst of changes and lets pixel queries bypass obsolete renders', async () => {
    const { requestRender, pixelAt } = await import('./render-client');
    const first = requestRender(DEFAULT_SCENARIO, 10, 10);
    const abandoned = Array.from({length:20},(_,i)=>requestRender({...DEFAULT_SCENARIO,iso:200+i},10,10));
    const latest = requestRender({...DEFAULT_SCENARIO,iso:1600},10,10);
    expect(await Promise.all(abandoned)).toEqual(Array(20).fill(null));
    const worker=FakeWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const pixel=pixelAt(1,3,4);
    expect(worker.postMessage.mock.calls[1][0].type).toBe('pixel');
    worker.onmessage!({data:{type:'render',id:1}});
    expect(await first).toBeNull();
    const last=worker.postMessage.mock.calls[2][0];
    expect(last.scenario.iso).toBe(1600);
    const query=worker.postMessage.mock.calls[1][0];
    worker.onmessage!({data:{type:'pixel',id:query.id,pixel:{electrons:123}}});
    expect(await pixel).toMatchObject({electrons:123});
    worker.onmessage!({data:{type:'render',id:last.id,width:10,height:10}});
    expect((await latest)?.scenario.iso).toBe(1600);
  });

  it('rejects both active and queued work on a crash, then accepts a clean retry',async()=>{
    const {requestRender}=await import('./render-client');
    const a=requestRender(DEFAULT_SCENARIO,10,10),b=requestRender({...DEFAULT_SCENARIO,iso:800},10,10);
    const checks=[expect(a).rejects.toThrow('stopped'),expect(b).rejects.toThrow('stopped')];
    FakeWorker.instances[0].onerror!({message:'stopped',preventDefault(){}});await Promise.all(checks);
    const retry=requestRender(DEFAULT_SCENARIO,10,10),w=FakeWorker.instances[1],m=w.postMessage.mock.calls[0][0];
    w.onmessage!({data:{type:'render',id:m.id}});expect(await retry).not.toBeNull();
  });
});
