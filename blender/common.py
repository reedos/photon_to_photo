"""Shared Blender-Python helpers for the Photon to Photo camera-body models.

Run only inside Blender (bpy). Both build_dslr.py and build_mirrorless.py import this
module (it lives next to them in blender/, and each build script adds this directory to
sys.path before importing).

AXIS CONVENTION (read this before touching any coordinate in the build scripts):
The app frame (docs/PANE.md) is: millimeters, sensor plane at z = 0, lens axis along -z
(mount in front of the sensor, at negative z), y up, x to the camera's right as seen from
behind. Blender is Z-up natively. glTF's standard "+Y Up" export axis conversion (the
default in Blender's glTF exporter, `export_yup=True`) maps Blender (x, y, z) -> glTF
(x, z, -y). So if we build directly in Blender with:
    blender X = app x
    blender Y = -(app z)   i.e. app z = -(blender Y)
    blender Z = app y
then the exported glTF automatically lands in exactly the app frame: gltf_z = -blender_y =
app_z, gltf_y = blender_z = app_y, gltf_x = blender_x = app_x. No extra rotation needed.

Practically: build the whole camera with Blender's own Y axis as the optical/depth axis.
The mount face sits at blender Y = +flangeMm (i.e. app z = -flangeMm). The sensor plane
sits at blender Y = 0 (app z = 0). The body extends from the mount backward to negative Y
(deeper into the body, toward the photographer). Blender Z is up (matches app y up).
Blender X is the camera's right as seen from behind (matches app x).

Every object that the app's selection contract names (bodies.test.ts, docs/PANE.md) gets
its Blender object name set to that exact identifier and both custom properties
"component" and "label" set, which the glTF exporter carries through as node name +
extras.
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix

TAU = math.pi * 2.0


# ---------------------------------------------------------------------------------------
# scene setup
# ---------------------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block_collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                              bpy.data.lights, bpy.data.images, bpy.data.node_groups):
        for block in list(block_collection):
            if block.users == 0:
                block_collection.remove(block)


def set_component(obj, component, label):
    obj.name = component
    obj["component"] = component
    obj["label"] = label
    return obj


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------------------------------
# materials -- Principled BSDF, values from design/LOOK.md
# ---------------------------------------------------------------------------------------

def _new_mat(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat, mat.node_tree.nodes["Principled BSDF"]


def mat_chrome(name="BrushedChrome"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.72, 0.74, 0.77, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.18
    bsdf.inputs["Metallic"].default_value = 1.0
    nt = mat.node_tree
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 80.0
    wave.wave_type = 'RINGS'
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def mat_gold_contact(name="GoldContact"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.83, 0.66, 0.22, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.28
    bsdf.inputs["Metallic"].default_value = 1.0
    return mat


def mat_glass(name="OpticalGlass", ior=1.52, tint=(0.98, 0.98, 0.96, 1.0)):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Roughness"].default_value = 0.03
    bsdf.inputs["Transmission Weight"].default_value = 1.0 if "Transmission Weight" in bsdf.inputs else 0.0
    if "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = ior
    mat.blend_method = 'BLEND' if hasattr(mat, "blend_method") else mat.blend_method
    return mat


def mat_mirror_silvered(name="MirrorSurface"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.92, 0.93, 0.95, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.02
    bsdf.inputs["Metallic"].default_value = 1.0
    return mat


def mat_silicon(name="SiliconDie"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.106, 0.125, 0.161, 1.0)  # --silicon
    bsdf.inputs["Roughness"].default_value = 0.25
    bsdf.inputs["Metallic"].default_value = 0.6
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.7
    nt = mat.node_tree
    # thin-film-style iridescent sheen approximated with a LayerWeight-driven ColorRamp
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.2, 0.5, 0.9, 1.0)
    ramp.color_ramp.elements[1].color = (0.9, 0.3, 0.6, 1.0)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'ADD'
    mix.inputs["Fac"].default_value = 0.18
    nt.links.new(lw.outputs["Facing"], ramp.inputs["Fac"])
    nt.links.new(bsdf.inputs["Base Color"].links[0].from_socket if bsdf.inputs["Base Color"].links else None, mix.inputs["Color1"]) if bsdf.inputs["Base Color"].links else None
    mix.inputs["Color1"].default_value = (0.106, 0.125, 0.161, 1.0)
    nt.links.new(ramp.outputs["Color"], mix.inputs["Color2"])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def mat_pixel_grid(name="PixelArray", w_mm=35.9, h_mm=23.9, pitch_mm=0.0045):
    """Fine pixel-grid texture over the sensor's active area, procedural checker."""
    mat, bsdf = _new_mat(name)
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexChecker")
    cols_scale = max(w_mm, h_mm) / max(pitch_mm * 60.0, 0.01)  # exaggerate pitch for visibility
    tex.inputs["Scale"].default_value = cols_scale
    tex.inputs["Color1"].default_value = (0.05, 0.09, 0.14, 1.0)
    tex.inputs["Color2"].default_value = (0.08, 0.14, 0.22, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.18
    bsdf.inputs["Metallic"].default_value = 0.3
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def mat_matte_black_baffle(name="MatteBlackBaffle"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.88
    bsdf.inputs["Metallic"].default_value = 0.08
    return mat


def mat_ceramic(name="CeramicCarrier"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.72, 0.70, 0.66, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def mat_wire(name="BondWire"):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.85, 0.85, 0.85, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.3
    bsdf.inputs["Metallic"].default_value = 1.0
    return mat


# ---------------------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------------------

def add_bevel(obj, width=0.4, segments=3, limit_method='ANGLE', angle_deg=42):
    mod = obj.modifiers.new("Bevel", 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = limit_method
    if limit_method == 'ANGLE':
        mod.angle_limit = math.radians(angle_deg)
    return mod


def add_subsurf(obj, levels=1, render_levels=2):
    mod = obj.modifiers.new("Subsurf", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = render_levels
    return mod


def apply_all_modifiers(obj):
    ctx = bpy.context
    with bpy.context.temp_override(object=obj, active_object=obj, selected_editable_objects=[obj]):
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:
                obj.modifiers.remove(mod)


def rounded_box(name, w, h, d, bevel=3.0, bevel_segments=4, loc=(0, 0, 0), material=None,
                subsurf=False):
    """A box with real support-loop bevels on every edge so it catches light like a real
    product shell, not a flat CG primitive."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    link(obj)
    obj.location = loc
    bevel_w = min(bevel, w * 0.24, h * 0.24, d * 0.24)
    add_bevel(obj, width=bevel_w, segments=bevel_segments)
    if subsurf:
        add_subsurf(obj, levels=1, render_levels=2)
    apply_all_modifiers(obj)
    if material:
        obj.data.materials.append(material)
    return obj


def cylinder(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=48, material=None,
             cap_ends=True):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap_ends, cap_tris=False, segments=verts,
                           radius1=radius, radius2=radius, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    if material:
        obj.data.materials.append(material)
    return obj


def tube(name, outer_r, inner_r, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=64, material=None):
    """A hollow ring/tube (used for the mount throat, eyecup, etc.)."""
    outer = cylinder(f"{name}_outer_tmp", outer_r, depth, verts=verts, cap_ends=True)
    inner = cylinder(f"{name}_inner_tmp", inner_r, depth * 1.4, verts=verts, cap_ends=True)
    mod = outer.modifiers.new("Bool", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = inner
    apply_all_modifiers(outer)
    bpy.data.objects.remove(inner, do_unlink=True)
    outer.name = name
    outer.location = loc
    outer.rotation_euler = rot
    if material:
        outer.data.materials.clear()
        outer.data.materials.append(material)
    return outer


def boolean_diff(obj, cutter, apply=True):
    mod = obj.modifiers.new("Bool", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    if apply:
        apply_all_modifiers(obj)
        bpy.data.objects.remove(cutter, do_unlink=True)
    return obj


def boolean_union(obj, other, apply=True):
    mod = obj.modifiers.new("Bool", 'BOOLEAN')
    mod.operation = 'UNION'
    mod.object = other
    if apply:
        apply_all_modifiers(obj)
        bpy.data.objects.remove(other, do_unlink=True)
    return obj


def join(objs, name):
    """Join a list of objects into the first one, renaming the result."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def bond_wires(name, w, h, count_per_side=10, material=None, loc=(0, 0, 0)):
    """Thin wires from the die edge outward, evoking wire-bonds on the sensor package. Same
    single-bmesh-with-matrix technique: each wire placed by its own matrix, so the object origin stays put."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        for i in range(count_per_side):
            t = (i + 0.5) / count_per_side - 0.5
            x = dx * (w / 2) if dx else t * w
            y = dy * (h / 2) if dy else t * h
            rot = Matrix.Rotation(math.radians(80) * (1 if (dx or dy) > 0 else -1), 4, 'Y')
            mat = Matrix.Translation((x + dx * 0.8, y + dy * 0.8, 0.15)) @ rot
            bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=6,
                                   radius1=0.03, radius2=0.03, depth=1.6, matrix=mat)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    link(obj)
    obj.location = loc
    if material:
        obj.data.materials.append(material)
    return obj


def release_button(name, radius, mat_black, loc=(0, 0, 0), rot=(0, 0, 0)):
    btn = cylinder(name, radius, radius * 0.9, loc=loc, rot=rot, material=mat_black)
    add_bevel(btn, width=radius * 0.25, segments=3)
    apply_all_modifiers(btn)
    return btn


def af_lever(name, mat_black, loc=(0, 0, 0), rot=(0, 0, 0)):
    lever = rounded_box(name, 6, 2.2, 8, bevel=0.6, bevel_segments=3, loc=loc, material=mat_black)
    lever.rotation_euler = rot
    return lever


# ---------------------------------------------------------------------------------------
# surface finish: baked tileable normal maps (design review FID-6, 09/30/2026)
#
# Blender's procedural noise and Bump nodes never reach glTF, so the finish is baked here into small tileable normal
# maps that the exporter writes as each material's normalTexture: a pebble grain for the leatherette (Voronoi cells
# about 1.2 mm across) and a fine crinkle for the magnesium paint. Every mesh wearing one gets box-projected UVs in
# millimeters over one TILE_MM tile (finalize_uvs), so both maps keep their real scale on every part.
# ---------------------------------------------------------------------------------------
import os
import tempfile

TILE_MM = 12.0                  # one texture tile covers 12 x 12 mm of surface
TEXTURED = set()                # names of the materials that carry a normal map (and so need UVs)
_TEX_DIR = os.path.join(tempfile.gettempdir(), 'p2p-blender-tex')


def _height_to_normal_image(name, h, strength):
    import numpy as np
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.dstack([-gx, -gy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    rgba = np.dstack([n * 0.5 + 0.5, np.ones_like(h)]).astype(np.float32)
    size = h.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(rgba.ravel())
    os.makedirs(_TEX_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(_TEX_DIR, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def pebble_normal(size=256, cells=10, seed=7):
    """Leatherette: tileable Voronoi pebbles (cells = pebbles per tile side), flat-topped with rounded shoulders and
    narrow creases between them, plus a faint dome per pebble."""
    img = bpy.data.images.get('pebbleNormal')
    if img:
        return img
    import numpy as np
    rng = np.random.default_rng(seed)
    pts = 0.15 + 0.7 * rng.random((cells, cells, 2))
    ys, xs = np.mgrid[0:size, 0:size]
    u = (xs + 0.5) / size * cells
    v = (ys + 0.5) / size * cells
    ci, cj = np.floor(u).astype(int), np.floor(v).astype(int)
    f1 = np.full(u.shape, 9.0)
    f2 = np.full(u.shape, 9.0)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ni, nj = ci + di, cj + dj
            p = pts[nj % cells, ni % cells]
            d = np.hypot(ni + p[..., 0] - u, nj + p[..., 1] - v)
            f2 = np.where(d < f1, f1, np.minimum(f2, d))
            f1 = np.minimum(f1, d)
    edge = np.clip((f2 - f1) / 0.28, 0, 1)
    h = edge * edge * (3 - 2 * edge) * (1.0 - 0.35 * np.clip(f1, 0, 1))
    return _height_to_normal_image('pebbleNormal', h, strength=size / cells * 0.55)


def crinkle_normal(size=256, seed=11):
    """Fine-texture magnesium paint: blurred white noise, a grain of about 0.15 mm at TILE_MM per tile."""
    img = bpy.data.images.get('paintNormal')
    if img:
        return img
    import numpy as np
    rng = np.random.default_rng(seed)
    noise = rng.random((size, size))
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    sigma = 2.2
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    h = np.real(np.fft.ifft2(np.fft.fft2(noise) * g))
    h = (h - h.min()) / max(h.max() - h.min(), 1e-9)
    return _height_to_normal_image('paintNormal', h, strength=6.0)


def _normal_chain(mat, img, strength):
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = strength
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    TEXTURED.add(mat.name)


def _coat(bsdf, weight, rough):
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = weight
        bsdf.inputs["Coat Roughness"].default_value = rough
    elif "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = weight
        bsdf.inputs["Clearcoat Roughness"].default_value = rough


def mat_satin_black_paint(name="SatinBlackPaint", textured=True):
    """Satin-black magnesium-alloy paint: a dielectric black with a light clearcoat and, when textured, the fine
    crinkle finish as a normal map."""
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.016, 0.016, 0.017, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.5
    bsdf.inputs["Metallic"].default_value = 0.0
    _coat(bsdf, 0.25, 0.35)
    if textured:
        _normal_chain(mat, crinkle_normal(), 0.14)
    return mat


def mat_rubber(name="GripRubber", textured=True):
    """Leatherette/rubber: near-black, soft sheen, the pebble grain as a normal map."""
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.018, 0.018, 0.019, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.72
    bsdf.inputs["Metallic"].default_value = 0.0
    if textured:
        _normal_chain(mat, pebble_normal(), 0.8)
    return mat


def mat_knurl(name="KnurlBlack"):
    """Satin-black molded dials and buttons: a touch glossier than the paint so the knurl catches the light."""
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.021, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.38
    bsdf.inputs["Metallic"].default_value = 0.0
    _coat(bsdf, 0.15, 0.3)
    return mat


def mat_lcd(name="LcdPanel", color=(0.05, 0.06, 0.055)):
    """A status LCD: grey-green under dark cover glass (the glossy coat is the glass). No glow: an unlit panel."""
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.5
    _coat(bsdf, 0.55, 0.12)
    return mat


def mat_screen(name="screenGlass"):
    """A switched-off display under cover glass: a neutral glossy black (no transmission, no blue cast)."""
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (0.008, 0.0085, 0.009, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.06
    bsdf.inputs["Metallic"].default_value = 0.0
    _coat(bsdf, 1.0, 0.03)
    return mat


def mat_flat(name, color, rough=0.5, metal=0.0):
    mat, bsdf = _new_mat(name)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return mat


MAP_FILES = {'pebbleNormal': 'leatherette-normal.png', 'paintNormal': 'paint-normal.png'}


def detach_normal_maps(out_dir, rel_prefix='textures/'):
    """Before a glTF export: write each normal map as a PNG into out_dir and point its materials at it through
    material extras (normalMap: path relative to the GLB's folder, normalScale, uvTileMm) instead of a glTF
    normalTexture. An embedded texture makes three's GLTFLoader throw under node ("self is not defined"), which the
    GLB tests would hit; the app applies the maps from the extras. Returns a function that relinks them, so Blender's
    own renders keep the finish."""
    import shutil
    os.makedirs(out_dir, exist_ok=True)
    relink = []
    for mat in bpy.data.materials:
        if mat.name not in TEXTURED or not mat.use_nodes:
            continue
        nt = mat.node_tree
        nm = next((n for n in nt.nodes if n.type == 'NORMAL_MAP'), None)
        tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE'), None)
        if not nm or not tex:
            continue
        fname = MAP_FILES.get(tex.image.name, tex.image.name + '.png')
        shutil.copyfile(os.path.join(_TEX_DIR, tex.image.name + '.png'), os.path.join(out_dir, fname))
        mat['normalMap'] = rel_prefix + fname
        mat['normalScale'] = round(nm.inputs['Strength'].default_value, 3)
        mat['uvTileMm'] = TILE_MM
        for l in list(nt.links):
            if l.from_node == nm:
                relink.append((nt, nm.outputs['Normal'], l.to_socket))
                nt.links.remove(l)
    def restore():
        for nt, a, b in relink:
            nt.links.new(a, b)
    return restore


def box_uv(obj, tile=TILE_MM):
    """Box-project UVs in world millimeters, one unit per `tile` mm, each face on its dominant axis."""
    me = obj.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name='UVMap')
    me.uv_layers.active = me.uv_layers[0]
    uv = me.uv_layers[0].data
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted_safe().transposed()
    verts = [mw @ v.co for v in me.vertices]
    for poly in me.polygons:
        n = nm @ poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = ((1, 2), (0, 2), (0, 1))[ax]
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index]
            uv[li].uv = (co[a] / tile, co[b] / tile)


def finalize_uvs(objects=None):
    """Every mesh that wears a textured material: modifiers applied, then box UVs, so the normal maps export."""
    for o in list(objects if objects is not None else bpy.context.scene.objects):
        if o.type != 'MESH' or not any(m and m.name in TEXTURED for m in o.data.materials):
            continue
        if o.modifiers:
            apply_all_modifiers(o)
        box_uv(o)


# ---------------------------------------------------------------------------------------
# lathed parts: dials, rings, the body mount (same angle convention as blender/lens_v2.py)
# ---------------------------------------------------------------------------------------

def revolve(name, prof, thetas, closed=True, mat=None, prof_fn=None, sharp_deg=32):
    """Revolve a closed polygon [(r, y), ...] about the Y axis through the angles `thetas` (radians; theta 0 at +Z,
    increasing toward +X). closed=True wraps the last angle to the first; otherwise the two ends are capped with the
    polygon itself. prof_fn(theta) may replace prof to vary the section with angle (ribs, knurling)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for th in thetas:
        pts = prof_fn(th) if prof_fn else prof
        s, c = math.sin(th), math.cos(th)
        rings.append([bm.verts.new((r * s, y, r * c)) for (r, y) in pts])
    P = len(rings[0])
    n = len(rings) if closed else len(rings) - 1
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % len(rings)]
        for p in range(P):
            q = (p + 1) % P
            try:
                bm.faces.new([a[p], a[q], b[q], b[p]])
            except ValueError:
                pass
    if not closed:
        for ring in (rings[0], list(reversed(rings[-1]))):
            try:
                bm.faces.new(ring)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    o = bpy.data.objects.new(name, me)
    link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def arc(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]


def ring_thetas(n):
    return [TAU * i / n for i in range(n)]


def rib_thetas(ribs, per=6):
    return [TAU * (k + f / per) / ribs for k in range(ribs) for f in range(per)]


AXIS_ROT = {'Y': (0, 0, 0), 'Z': (math.radians(90), 0, 0), 'X': (0, 0, math.radians(-90)),
            '-X': (0, 0, math.radians(90)), '-Y': (0, 0, math.pi), '-Z': (math.radians(-90), 0, 0)}


def orient(obj, axis, loc):
    """A part lathed about local +Y, turned so local +Y points along `axis` and moved to loc (its base center)."""
    obj.rotation_euler = AXIS_ROT[axis] if isinstance(axis, str) else axis
    obj.location = loc
    return obj


def knurl_dial(name, r, h, ribs, depth, knurl_mat, top_mat=None, axis='Z', loc=(0, 0, 0), ch=0.45):
    """A dial with modeled knurling: rounded ribs (a raised cosine) round its rim, chamfered edges and a flat top
    (top_mat, satin, when given). Built about local +Y from its base (y = 0) to its top (y = h), then turned to `axis`
    and placed with its base center at `loc`."""
    def prof(th):
        f = (th * ribs / TAU) % 1.0
        rr = r - depth + depth * (0.5 + 0.5 * math.cos(TAU * f))
        return [(0.0, h), (r - ch - depth * 0.5, h), (rr, h - ch), (rr, ch), (r - ch - depth * 0.5, 0.0), (0.0, 0.0)]
    o = revolve(name, None, rib_thetas(ribs, 6), True, knurl_mat, prof_fn=prof, sharp_deg=55)
    if top_mat:
        o.data.materials.append(top_mat)
        for p in o.data.polygons:
            if p.normal.y > 0.95 and p.center.y > h - 0.01:
                p.material_index = 1
    return orient(o, axis, loc)


def disc(name, r, h, mat, axis='Z', loc=(0, 0, 0), ch=0.3, dome=0.0, seg=48):
    """A button/disc: radius r, height h along local +Y from its base, chamfered, optionally domed on top."""
    ch = min(ch, h * 0.45, r * 0.3)
    top = [(0.0, h + dome)] + ([(r * 0.5, h + dome * 0.78)] if dome else []) + [(r - ch, h), (r, h - ch)]
    o = revolve(name, top + [(r, 0.0), (0.0, 0.0)], ring_thetas(seg), True, mat, sharp_deg=40)
    return orient(o, axis, loc)


def body_mount(throat_d, face_outer_d, lug_count, contact_count, flange_y, chrome, black, gold,
               contact_deg=200.0, lock_pin_deg=235.0, lug_offset_deg=0.0):
    """The body half of the bayonet, built so a lens can seat (design review FID-4, 09/30/2026):
    - 'mount': a flat polished annulus whose front IS the mount face at flange_y, uninterrupted, with four flush
      screw heads and the spring lock pin;
    - 'mountLugs': the body's bayonet lips, thin inward flanges 1.5-2.7 mm behind the face whose inner edges are the
      published throat diameter, with gaps between them where the lens's lugs pass (the lens's own lugs sit 3-4.6 mm
      behind the face, blender/lens_v2.py, so they turn in behind these lips);
    - 'contacts': gold pins on a black block inside the throat, where the lens's contacts meet them (lens_v2.py puts
      those at 200 degrees, just behind 4.6 mm);
    plus the blackened throat wall and a baffle ring ('mountThroat').
    Angles: theta 0 at the top, increasing toward +X (the grip side), as lens_v2.py. Returns a dict of objects."""
    rt = throat_d / 2.0
    rw = rt + 2.6                       # the wall behind the lips: room for the lens lugs (to rt + 2.2)
    ro = face_outer_d / 2.0
    fy = flange_y
    face = [(rw + 0.35, fy), (ro - 0.45, fy), (ro, fy - 0.45), (ro, fy - 0.9), (rw, fy - 0.9), (rw, fy - 0.35)]
    ring = revolve('mount', face, ring_thetas(160), True, chrome, sharp_deg=30)
    extras = []
    rs = (rw + ro) / 2
    for k in range(4):
        th = math.radians(45 + 90 * k)
        extras.append(disc(f'mountScrew{k}', 0.95, 0.06, black, axis='Y', loc=(rs * math.sin(th), fy, rs * math.cos(th)),
                           ch=0.03, seg=20))
    th = math.radians(lock_pin_deg)
    extras.append(disc('lockPin', 1.25, 0.5, chrome, axis='Y', loc=(rs * math.sin(th), fy, rs * math.cos(th)), ch=0.2,
                       dome=0.25, seg=24))
    ring = join([ring] + extras, 'mount')
    lips = []
    span = TAU / lug_count
    for k in range(lug_count):
        c0 = math.radians(lug_offset_deg) + span * k + span * 0.16
        lp = [(rt + 0.2, fy - 1.5), (rw + 0.1, fy - 1.5), (rw + 0.1, fy - 2.7), (rt, fy - 2.7), (rt, fy - 1.7)]
        lips.append(revolve(f'lip{k}', lp, arc(c0, c0 + span * 0.62, 36), False, chrome, sharp_deg=30))
    lugs = join(lips, 'mountLugs')
    wall = revolve('mountWall', [(rw, fy - 0.8), (rw + 1.6, fy - 0.8), (rw + 1.6, fy - 9.0), (rw, fy - 9.0)],
                   ring_thetas(96), True, black, sharp_deg=30)
    baffle = revolve('mountBaffle', [(rt - 1.0, fy - 8.0), (rw + 0.2, fy - 8.0), (rw + 0.2, fy - 9.0), (rt - 1.0, fy - 9.0)],
                     ring_thetas(96), True, black, sharp_deg=30)
    c = math.radians(contact_deg)
    half = math.radians(3.1) * (contact_count - 1) / 2 + math.radians(3.0)
    block = revolve('contactBlock', [(rt - 2.8, fy - 4.85), (rw + 0.2, fy - 4.85), (rw + 0.2, fy - 7.5), (rt - 2.8, fy - 7.5)],
                    arc(c - half, c + half, 24), False, black, sharp_deg=30)
    pins = []
    for k in range(contact_count):
        t = c + (k - (contact_count - 1) / 2) * math.radians(3.1)
        pins.append(revolve(f'pin{k}', [(rt - 2.5, fy - 4.6), (rt - 1.3, fy - 4.6), (rt - 1.3, fy - 4.85), (rt - 2.5, fy - 4.85)],
                            arc(t - 0.019, t + 0.019, 2), False, gold, sharp_deg=30))
    contacts = join(pins, 'contacts')
    throat = join([block, wall, baffle], 'mountThroat')
    return {'mount': ring, 'mountLugs': lugs, 'contacts': contacts, 'throat': throat}


def hot_shoe(name, center, length, black, chrome, gold):
    """An accessory shoe along the body's Y axis, open to the rear: a black insulating base, two folded steel rails
    with a slot between them, the center contact and three small signal contacts (FID-16). center = base center."""
    cx, cy, cz = center
    parts = [rounded_box(f'{name}Base', 21.0, 1.4, length, bevel=0.5, bevel_segments=2, loc=(cx, cy, cz + 0.7),
                         material=black)]
    sec = [(9.2, 1.4), (10.0, 1.4), (10.0, 3.6), (7.2, 3.6), (7.2, 3.0), (9.2, 3.0)]
    for sx in (-1, 1):
        me = bpy.data.meshes.new(f'{name}Rail')
        bm = bmesh.new()
        pts = sec if sx > 0 else list(reversed(sec))
        v0 = [bm.verts.new((cx + sx * x, cy - length / 2 + 0.4, cz + z)) for x, z in pts]
        v1 = [bm.verts.new((cx + sx * x, cy + length / 2 - 0.4, cz + z)) for x, z in pts]
        bm.faces.new(v0)
        bm.faces.new(list(reversed(v1)))
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        rail = bpy.data.objects.new(f'{name}Rail', me)
        link(rail)
        rail.data.materials.append(chrome)
        add_bevel(rail, width=0.2, segments=2)
        apply_all_modifiers(rail)
        parts.append(rail)
    parts.append(disc(f'{name}Center', 1.6, 0.25, gold, axis='Z', loc=(cx, cy, cz + 1.4), ch=0.08, seg=24))
    for k, (dx, dy) in enumerate(((-2.8, 3.5), (2.8, 3.5), (0.0, 4.4))):
        parts.append(disc(f'{name}Sig{k}', 0.55, 0.2, gold, axis='Z', loc=(cx + dx, cy + dy, cz + 1.4), ch=0.05, seg=12))
    return join(parts, name)


def plate(name, outline, y0, y1, mat, axis='y', bevel=0.3, seg=2):
    """A thin plate (a panel, a door, a bezel) extruded from a closed 2D outline between y0 and y1 along `axis`, with
    rounded edges. axis 'y': outline in (x, z); 'x': outline in (y, z); 'z': outline in (x, y)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    def P(u, v, w):
        return {'y': (u, w, v), 'x': (w, u, v), 'z': (u, v, w)}[axis]
    a = [bm.verts.new(P(u, v, y0)) for u, v in outline]
    b = [bm.verts.new(P(u, v, y1)) for u, v in outline]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        bm.faces.new([a[i], a[j], b[j], b[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    if bevel:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = seg
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(40)
        m.harden_normals = False
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.set_sharp_from_angle(angle=math.radians(40))
    o.data.materials.append(mat)
    return o


def rounded_rect(cx, cy, w, h, r, seg=6):
    """Outline of a w x h rectangle centered on (cx, cy) with corner radius r (counterclockwise)."""
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (w / 2 - r), cy + sy * (h / 2 - r)
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts
