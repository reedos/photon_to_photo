import { softwareRendererName } from './software-gl';

describe('telling a software renderer from a GPU (score loop r5)', () => {
  const gl = (name: string | null) => ({
    getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' && name !== null ? { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 } : null),
    getParameter: () => name,
  });

  it('names SwiftShader, llvmpipe and the Basic Render Driver on WebGL', () => {
    expect(softwareRendererName({ gl: gl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)') })).toMatch(/SwiftShader/);
    expect(softwareRendererName({ gl: gl('llvmpipe (LLVM 15.0.7, 256 bits)') })).toMatch(/llvmpipe/);
    expect(softwareRendererName({ gl: gl('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)') })).toMatch(/Basic Render/);
  });

  it('leaves a GPU, a masked name and a missing backend alone', () => {
    expect(softwareRendererName({ gl: gl('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)') })).toBeNull();
    expect(softwareRendererName({ gl: gl(null) })).toBeNull();
    expect(softwareRendererName({ gl: gl('') })).toBeNull();
    expect(softwareRendererName(undefined)).toBeNull();
    expect(softwareRendererName({})).toBeNull();
  });

  it('reads a WebGPU adapter: the fallback flag, or a software name', () => {
    expect(softwareRendererName({ adapter: { info: { isFallbackAdapter: true, description: 'SwiftShader' } } })).toBe('SwiftShader');
    expect(softwareRendererName({ adapter: { isFallbackAdapter: true } })).toBe('a fallback adapter');
    expect(softwareRendererName({ adapter: { info: { vendor: 'google', architecture: 'swiftshader', device: '', description: '' } } })).toMatch(/swiftshader/);
    expect(softwareRendererName({ device: { adapterInfo: { isFallbackAdapter: true, vendor: 'google' } } })).toBe('google');
    expect(softwareRendererName({ adapter: { info: { vendor: 'nvidia', architecture: 'ada', device: 'rtx 4070', description: 'NVIDIA GeForce RTX 4070' } } })).toBeNull();
  });
});
