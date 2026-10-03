import * as THREE from 'three/webgpu';

/** Wide lines composited by the GPU's ordinary blending stage.
 * Three r186's transparent Line2NodeMaterial reads a copied framebuffer in its
 * fragment shader. That shared viewport texture can retain a destroyed binding
 * after changing inspection size, blanking the entire frame. Keep Three's line
 * shape and vertex colors, without its screen-space dependency.
 */
export class BlendedLineMaterial extends THREE.Line2NodeMaterial {
  constructor(parameters: ConstructorParameters<typeof THREE.Line2NodeMaterial>[0] = {}) {
    // Opacity belongs to blending, not an MSAA coverage mask as well: applying
    // both quantizes faint halos and attenuates their light a second time.
    super({ blending: THREE.NormalBlending, alphaToCoverage: false, ...parameters });
  }

  override setupDiffuseColor(builder: THREE.NodeBuilder): void {
    const transparent = this.transparent, blending = this.blending;
    // NoBlending prevents the base node material from treating this temporary
    // state as opaque and overriding opacity. The actual blend state is restored
    // before the renderer builds its pipeline.
    this.transparent = false;
    this.blending = THREE.NoBlending;
    try { super.setupDiffuseColor(builder); }
    finally { this.transparent = transparent; this.blending = blending; }
  }
}
