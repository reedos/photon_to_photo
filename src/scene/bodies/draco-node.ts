// A Draco decoder for unit tests that parse the real GLBs in node (no Worker, no fetch): it runs the same decoder the
// app ships (public/draco/draco_decoder.js) in-process and hands GLTFLoader's KHR_draco_mesh_compression extension the
// geometry it asks for. The body GLBs are Draco-compressed like the lenses since score loop r1 (10/11/2026).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import * as THREE from 'three';

type Draco = any;
let modulePromise: Promise<Draco> | null = null;

function decoderModule(): Promise<Draco> {
  modulePromise ??= (() => {
    const src = readFileSync(resolve(__dirname, '../../../public/draco/draco_decoder.js'), 'utf8');
    const module = { exports: {} as unknown };
    const file = resolve(__dirname, '../../../public/draco/draco_decoder.js');
    new Function('module', 'exports', '__filename', '__dirname', 'require', src)(module, module.exports, file, resolve(file, '..'), createRequire(file));
    const factory = module.exports as (config: object) => Promise<Draco>;
    return new Promise<Draco>((done) => { void factory({ onModuleLoaded: (draco: Draco) => done({ draco }) }); }).then((m) => m.draco);
  })();
  return modulePromise;
}

const TYPED: Record<string, any> = { Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array };

function decode(draco: Draco, buffer: ArrayBuffer, attributeIDs: Record<string, number>, attributeTypes: Record<string, string>): THREE.BufferGeometry {
  const decoder = new draco.Decoder();
  const array = new Int8Array(buffer);
  const mesh = new draco.Mesh();
  try {
    const status = decoder.DecodeArrayToMesh(array, array.byteLength, mesh);
    if (!status.ok() || mesh.ptr === 0) throw new Error('draco-node: decoding failed: ' + status.error_msg());
    const geometry = new THREE.BufferGeometry();
    for (const name in attributeIDs) {
      const attribute = decoder.GetAttributeByUniqueId(mesh, attributeIDs[name]);
      const Typed = TYPED[attributeTypes[name]];
      const count = mesh.num_points(), itemSize = attribute.num_components();
      const dataType = Typed === Float32Array ? draco.DT_FLOAT32 : Typed === Int8Array ? draco.DT_INT8 : Typed === Int16Array ? draco.DT_INT16
        : Typed === Int32Array ? draco.DT_INT32 : Typed === Uint8Array ? draco.DT_UINT8 : Typed === Uint16Array ? draco.DT_UINT16 : draco.DT_UINT32;
      const byteLength = count * itemSize * Typed.BYTES_PER_ELEMENT;
      const ptr = draco._malloc(byteLength);
      decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, dataType, byteLength, ptr);
      const values = new Typed(draco.HEAPF32.buffer, ptr, byteLength / Typed.BYTES_PER_ELEMENT).slice();
      draco._free(ptr);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
    }
    const indices = mesh.num_faces() * 3;
    const ptr = draco._malloc(indices * 4);
    decoder.GetTrianglesUInt32Array(mesh, indices * 4, ptr);
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(draco.HEAPF32.buffer, ptr, indices).slice(), 1));
    draco._free(ptr);
    return geometry;
  } finally {
    draco.destroy(mesh);
    draco.destroy(decoder);
  }
}

/** Pass to GLTFLoader.setDRACOLoader() in a node test. */
export function nodeDracoLoader(): any {
  return {
    preload() { return this; },
    decodeDracoFile(buffer: ArrayBuffer, callback: (g: THREE.BufferGeometry) => void, attributeIDs: Record<string, number>, attributeTypes: Record<string, string>, _colorSpace?: string, onError: (e: unknown) => void = () => {}) {
      return decoderModule().then((draco) => callback(decode(draco, buffer, attributeIDs, attributeTypes))).catch(onError);
    },
    dispose() {},
  };
}
