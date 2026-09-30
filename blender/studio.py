"""Studio lighting, cameras and small primitives shared by the lens builds (lead, 09/29/2026).

Same recipe as dslr_v2.py/mirrorless_v2.py (which keep their own copies so their renders stay reproducible): an AgX
look, a gradient world the paint and chrome can reflect, four area lights and a seamless floor, in a mm-scale scene.
"""
import bpy, os, math
from mathutils import Vector
import common as C


def studio(floor_z, target=(0, 0, 0), scale=1.0, res=(1600, 1000)):
    """scale: light distances grow with the subject (1.0 suits a ~150 mm camera); energies grow with distance^2."""
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    try:
        sc.eevee.taa_render_samples = 128      # clean refraction through the glass
    except AttributeError:
        pass
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    world = bpy.data.worlds.new('studio'); sc.world = world; world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = 1.0
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (0.004, 0.004, 0.005, 1)
    ramp.color_ramp.elements[1].position = 0.9; ramp.color_ramp.elements[1].color = (0.30, 0.31, 0.33, 1)
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -1; mr.inputs['From Max'].default_value = 1
    nt.links.new(tc.outputs['Normal'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    t = Vector(target)

    def area(name, off, size, watts, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, 'AREA'); d.size = size * scale; d.energy = watts * 3.6e5 * scale * scale; d.color = color
        o = bpy.data.objects.new(name, d); C.link(o); o.location = t + Vector(off) * scale
        o.rotation_euler = (t - o.location).to_track_quat('-Z', 'Y').to_euler()
    area('key', (-420, 520, 420), 420, 30, (1.0, 0.97, 0.93))
    area('fill', (520, 260, 120), 520, 6, (0.85, 0.9, 1.0))
    area('rim', (120, -560, 380), 260, 28, (0.95, 0.97, 1.0))
    area('top', (0, 60, 700), 700, 8)
    bpy.ops.mesh.primitive_plane_add(size=6000 * scale, location=(t.x, t.y, floor_z - 0.1))
    floor = bpy.context.active_object; floor.name = 'floor'
    m = bpy.data.materials.new('floor'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.03, 0.032, 0.036, 1)
    b.inputs['Roughness'].default_value = 0.42
    floor.data.materials.append(m)
    return floor


def shoot(outdir, prefix, views, lens_mm=85):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cam_d = bpy.data.cameras.new('cam'); cam_d.lens = lens_mm; cam_d.clip_start = 1; cam_d.clip_end = 50000
        cam = bpy.data.objects.new('cam', cam_d); C.link(cam); sc.camera = cam
    for name, loc, tgt in views:
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(outdir, f'{prefix}-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', sc.render.filepath)


def cyl(name, r, depth, loc, axis='Y', mat=None, verts=64, bevel=0.4):
    """A beveled cylinder along axis X, Y or Z, centered at loc."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = {'X': (0, math.radians(90), 0), 'Y': (math.radians(90), 0, 0), 'Z': (0, 0, 0)}[axis]
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 3; b.limit_method = 'ANGLE'
    bpy.ops.object.shade_smooth()
    if mat: o.data.materials.append(mat)
    return o


def box(name, size, loc, mat=None, bevel=0.6, seg=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = seg
    bpy.ops.object.shade_smooth()
    if mat: o.data.materials.append(mat)
    return o
