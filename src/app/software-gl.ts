// Telling a software renderer from a GPU (score loop r5). A browser with no usable GPU (a remote desktop, a locked-down
// virtual machine, a headless run) draws WebGL and WebGPU on the CPU through SwiftShader, llvmpipe or Microsoft's Basic
// Render Driver: the camera orbited at about 2 frames a second there (mean 454 ms a frame), and nothing said why.

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|lavapipe|mesa offscreen/i;

interface AdapterLike { isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean; vendor?: string; architecture?: string; device?: string; description?: string } }
interface GlLike {
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
  getParameter(name: number): unknown;
}
/** three's WebGPU backend keeps the device (whose `adapterInfo` names the adapter), its WebGL backend the context. */
interface BackendLike { adapter?: AdapterLike; device?: { adapterInfo?: AdapterLike['info'] }; gl?: GlLike }

/** The name of the software renderer behind `backend` (three's WebGPU or WebGL backend object), or null for a GPU or when it
 *  cannot be told (a browser that masks the renderer's name is given the benefit of the doubt). */
export function softwareRendererName(backend: BackendLike | undefined): string | null {
  if (!backend) return null;
  const adapter = backend.adapter ?? (backend.device?.adapterInfo ? { info: backend.device.adapterInfo } : undefined);
  if (adapter) {
    const info = adapter.info;
    if (adapter.isFallbackAdapter === true || info?.isFallbackAdapter === true) return info?.description || info?.vendor || 'a fallback adapter';
    const text = [info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(' ');
    if (SOFTWARE.test(text)) return text;
    return null;
  }
  const gl = backend.gl;
  if (gl) {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : '';
      if (SOFTWARE.test(name)) return name;
    } catch { /* a context that will not say */ }
  }
  return null;
}
