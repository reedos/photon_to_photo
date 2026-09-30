"""Generic full-frame mirrorless body, modeled from silhouettes (lead, 09/28/2026; design review round 0, 09/30/2026).

Z8-published envelope 144 x 118.5 x 83 mm; Nikon Z geometry (flange 16 mm, throat 55 mm, 4 lugs, 11 contacts).
Generic and unbranded. No mechanical shutter (the Z8 has none); an in-body stabilization plate carries the sensor.
Frame: common.py (mm, X right seen from behind, Y optical depth with the mount face at +16 and the sensor at 0, Z up,
optical axis at Z = 0).

What tells it from the DSLR at a glance: the huge mount on a flat boss that nearly reaches the base, the shallow body
with the grip standing far out in front of it, the low, narrow EVF hump with a raked front, and no top dials at all
(a four-button cluster on the left shoulder; release mode is set with a button and the main dial).

  blender --background --factory-startup --python blender/mirrorless_v2.py -- [--render DIR] [--export PATH]
"""
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import silhouette as S
import bodykit as K

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d

FLANGE = 16.0
THROAT = 55.0
FACE_D = 65.0                           # the chrome mount face's outer diameter
BOSS_R = 35.5                           # the flat raised boss round the mount, nearly to the base
# body envelope: X [-62, 82] (144), Y [-43, 40] (83: eyecup to grip front), Z [-41, 77.5] (118.5)
X0, X1 = -62.0, 82.0
YB, YF, YG = -32.0, 12.0, 40.0          # back (rear plate), front face, grip front
YE = -43.0                              # back of the EVF eyecup
ZB, ZS, ZP = -41.0, 58.0, 77.5          # bottom, shoulder (top plate at 84% of the height), EVF hump top
ZV = 60.0                               # the EVF's optical axis height
GRIP = dict(x_in=43.0, X1=X1, YF=YF, YG=YG, ZB=ZB, ZS=ZS, back=14.0, top=3.0, front_top=ZS - 16, lean=9.0,
            facet=(YG - 4.0, ZS - 5.0, YF + 6.0, ZS + 3.0), rubber_back=12.0, rubber_top=ZS - 16.0)
DIAL_F = dict(center=(64.0, 29.5, ZS - 14.5), r=8.0, h=5.0)
DIAL_R = dict(center=(X1 - 17.0, YB + 5.0, ZS - 10.0), r=8.0, h=6.0)


def shell():
    """Round 1 (R1-FID-E): the shoulders roll down to both ends on 11 mm radii, the top plate carries a slight crown,
    the grip has a rounded front and a filleted finger channel, and the EVF hump is low, short front to back and
    steep-fronted, growing out of the top plate on a 3 mm fillet, so it no longer reads as the DSLR's prism."""
    YC = (YB + YF) / 2
    lower = K.solid('shellClosed',
                    K.fp([(X0, ZB), (X1, ZB), (X1, ZS), (X0 + 24, ZS), (X0, ZS - 1.5)], [8, 10, 11, 40, 11], seg=14),
                    K.fp([(X0, YB), (X1, YB), (X1, YF), (X0, YF)], [7, 7, 8, 10], seg=12),
                    K.fp([(YB, ZB), (YF, ZB), (YF, ZS - 1.0), (YC, ZS), (YB, ZS - 1.0)], [6, 6, 4.5, 60, 6], seg=12),
                    (X0, X1, YB, YF, ZB, ZS))
    # the EVF hump (round 2, R2-FID-2): about 45% of the body width at its root and 16% of the height above the top
    # plate, its flanks sloping in 11 degrees so the top is visibly narrower than the base, and its front raked back
    # 28 degrees; the rear flush over the viewfinder housing. The DSLR's prism is taller, wider and keeps a nose.
    RAKE = (ZP - ZS - 1) * math.tan(math.radians(28))
    hump = K.solid('hump',
                   K.fp([(-33, ZS - 3), (33, ZS - 3), (33, ZS + 0.5), (31, ZS + 2.5), (27, ZP), (-27, ZP), (-31, ZS + 2.5), (-33, ZS + 0.5)],
                        [0, 0, 1.5, 3, 3, 3, 3, 1.5]),
                   K.fp([(-28, YF - 3), (28, YF - 3), (32, YF - 9), (32, YB - 2), (-32, YB - 2), (-32, YF - 9)],
                        [3, 3, 3, 2, 2, 3]),
                   K.fp([(YB - 2, ZS - 3), (YF - 3, ZS - 3), (YF - 3, ZS + 1), (YF - 3 - RAKE, ZP), (YB - 2, ZP)],
                        [0, 0, 2.5, 5, 2.5]),
                   (-34, 34, YB - 3, YF - 2, ZS - 4, ZP))
    K.boolean(lower, hump, 'UNION')
    K.boolean(lower, K.grip_solid('gripCore', 0.0, GRIP), 'UNION')
    K.fillet_concave(lower, lambda x, y, z: abs(x) < 35 and ZS - 4 < z < ZS + 1 and YB - 4 < y < YF, 3.0)
    K.slot_for_dial(lower, 'Z', DIAL_F['center'], DIAL_F['r'], DIAL_F['h'], reach=YG + 6)
    K.slot_for_dial(lower, 'X', DIAL_R['center'], DIAL_R['r'], DIAL_R['h'], reach=YB - 2)
    body = K.finish(lower, bevel=0.9)
    body.data.materials.append(C.mat_satin_black_paint())
    return C.set_component(body, 'shellClosed', 'Camera body (generic mirrorless)')


def mount(chrome, black, gold, paint, white):
    parts = C.body_mount(THROAT, FACE_D, 4, 11, FLANGE, chrome, black, gold, contact_deg=200.0, lock_pin_deg=235.0)
    for key, label in (('mount', 'Lens mount (Nikon Z geometry)'), ('mountLugs', 'Bayonet lips'),
                       ('contacts', 'Electrical contacts')):
        C.set_component(parts[key], key, label)
    rw = THROAT / 2 + 2.6
    C.revolve('mountBoss', [(rw + 1.6, YF - 2), (BOSS_R, YF - 2), (BOSS_R, FLANGE - 2.0), (BOSS_R - 0.8, FLANGE - 0.95),
                            (rw + 1.6, FLANGE - 0.95)], C.ring_thetas(128), True, paint, sharp_deg=30)
    th = math.radians(-60)
    rd = (FACE_D / 2 + BOSS_R) / 2
    C.disc('mountIndex', 1.1, 0.12, white, axis='Y', loc=(rd * math.sin(th), FLANGE - 0.95, rd * math.cos(th)), ch=0.04, seg=24)
    return parts


def grip(rubber):
    return K.rubber_grip(GRIP, rubber, 'Grip')


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


def evf(rubber, paint, glass):
    """The viewfinder: its housing projecting behind the rear plate, the rubber eyecup, and inside the hump the
    micro-OLED panel with the eyepiece lens group between it and the eye. Returns (outside parts, inside parts)."""
    # housing: a rounded block lofted from inside the hump back past the rear plate
    hs = []
    for k, y in enumerate((YB + 6, YB, YB - 4, YB - 7)):
        shrink = (0, 0, 0.6, 1.6)[k]
        ring = S.superellipse(0, ZV, 23 - shrink, 15 - shrink, n=3.4, seg=48)
        hs.append([(x, y, z) for (x, z) in ring])
    hous = S.loft('evfHousing', hs); hous.data.materials.append(paint)
    C.set_component(hous, 'evfHousing', 'Viewfinder housing')
    # the eyecup: an open rubber cup, its outer wall stepping back to a rolled lip that turns in and forward to a
    # recessed floor around the eyepiece window
    cup = []
    for (y, a, b) in ((YB - 7, 21.6, 14.8), (YB - 8.5, 22.0, 15.3), (YB - 10.2, 22.2, 15.5), (YE, 21.6, 15.0),
                      (YE + 0.2, 19.2, 12.6), (YE + 1.4, 16.6, 10.2), (YE + 3.2, 15.8, 9.6)):
        ring = S.superellipse(0, ZV, a, b, n=3.0, seg=48)
        cup.append([(x, y, z) for (x, z) in ring])
    eyecup = S.loft('evfEyecup', cup, cap=False); eyecup.data.materials.append(rubber)
    C.set_component(eyecup, 'evfEyecup', 'Viewfinder eyecup')
    win = box('evfWindow', (26, 0.5, 16), (0, YE + 3.6, ZV), C.mat_screen('evfWindowGlass'), bevel=2.2)
    # inside: the panel faces the eye; three eyepiece elements magnify it (0.8x, bodies.json)
    oled = C.mat_lcd('evfOled', (0.05, 0.06, 0.08))
    panel = box('evfPanel', (14, 1.2, 10.5), (0, YF - 16, ZV), oled, bevel=0.2)
    C.set_component(panel, 'evfPanel', 'Viewfinder micro-OLED panel')
    carrier = box('evfPanelCarrier', (20, 2.0, 16), (0, YF - 14.6, ZV), C.mat_matte_black_baffle('evfCarrier'), bevel=0.3)
    optics = [panel, carrier]
    for i, (y, r, d) in enumerate(((YF - 23, 8.5, 3.5), (YF - 29, 10.0, 4.5), (YB + 3, 11.0, 3.0))):
        optics.append(cyl(f'evfLens{i}', r, d, (0, y, ZV), 'Y', glass, verts=64, bevel=0.8))
    root = bpy.data.objects.new('evf', None); C.link(root); root['component'] = 'evf'; root['label'] = 'Electronic viewfinder'
    for o in [hous, eyecup, win] + optics:
        o.parent = root
    return [hous, eyecup, win], optics


def interior(paint, glass):
    """What the cutaway shows: the sensor stack on its stabilization plate right behind the mount, and the short
    open throat in front of it (no mirror, no mechanical shutter)."""
    baffle = C.mat_matte_black_baffle(); ceramic = C.mat_ceramic(); silicon = C.mat_silicon()
    pix = C.mat_pixel_grid(); wire = C.mat_wire(); stack_glass = C.mat_glass('filterGlass', 1.52, (0.9, 0.95, 1.0, 1.0))
    chrome = C.mat_chrome(); gold = C.mat_gold_contact()
    out = []
    # a blackened light box from the mount to the sensor (no wall on the cut side)
    lb = [box('lightBoxWall', (1.2, 12, 46), (28, 8, 0), baffle, bevel=0.2),
          box('lightBoxWall', (57, 12, 1.2), (0, 8, -23), baffle, bevel=0.2),
          box('lightBoxWall', (57, 12, 1.2), (0, 8, 23), baffle, bevel=0.2)]
    wall = C.join(lb, 'lightBox'); C.set_component(wall, 'lightBox', 'Light box'); out.append(wall)
    # the sensor stack: filters (2.0 mm, body.json), the pixel array at the sensor plane, the die and its carrier
    fst = box('filterStack', (40, 2.0, 30), (0, 1.2, 0), stack_glass, bevel=0.1)
    C.set_component(fst, 'filterStack', 'Filter stack (IR cut, low-pass, cover glass)'); out.append(fst)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    pa = bpy.context.active_object; pa.scale = (35.9, 23.9, 1); bpy.ops.object.transform_apply(scale=True)
    pa.rotation_euler = (math.radians(90), 0, 0); pa.data.materials.append(pix)
    C.set_component(pa, 'pixelArray', 'Pixel array (35.9 x 23.9 mm)'); out.append(pa)
    die = box('sensorDie', (40, 0.8, 29), (0, -0.45, 0), silicon, bevel=0.1)
    C.set_component(die, 'sensorDie', 'Silicon die'); out.append(die)
    pkg = box('sensorPackage', (52, 2.6, 40), (0, -2.2, 0), ceramic, bevel=0.4)
    C.set_component(pkg, 'sensorPackage', 'Sensor package'); out.append(pkg)
    bw = C.bond_wires('bondWires', 44, 33, count_per_side=12, material=wire, loc=(0, 0, 0))
    bw.rotation_euler = (math.radians(90), 0, 0); bw.location = (0, -0.9, 0)
    C.set_component(bw, 'bondWires', 'Bond wires'); out.append(bw)
    # stabilization: the moving plate the package rides on, its voice-coil magnets at the corners, the fixed
    # yoke behind (5 axes, +/-2 mm travel, bodies.json)
    ibis = box('ibisPlate', (62, 1.6, 50), (0, -4.3, 0), C.mat_satin_black_paint('ibisPaint'), bevel=0.5)
    C.set_component(ibis, 'ibisPlate', 'Stabilization plate (5-axis)'); out.append(ibis)
    mags = [box(f'ibisMagnet{i}', (9, 3.0, 7), (sx * 25, -6.6, sz * 19), chrome, bevel=0.4)
            for i, (sx, sz) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1)))]
    coils = [cyl(f'ibisCoil{i}', 3.2, 2.0, (sx * 25, -4.3, sz * 19), 'Y', gold, verts=32, bevel=0.3)
             for i, (sx, sz) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1)))]
    mg = C.join(mags + coils, 'ibisActuators'); C.set_component(mg, 'ibisActuators', 'Stabilization voice coils'); out.append(mg)
    yoke = box('ibisYoke', (66, 1.6, 54), (0, -9.0, 0), baffle, bevel=0.4)
    C.set_component(yoke, 'ibisYoke', 'Stabilization yoke (fixed)'); out.append(yoke)
    return out


def details(paint, rubber, knurl, chrome, gold, screen, lcd, white, glass):
    black = C.mat_flat('insulatorBlack', (0.012, 0.012, 0.013), 0.55)
    dials = []
    # left shoulder: no dials, a 2 x 2 cluster of flat buttons on a low plinth
    plinth = C.plate('clusterPlinth', C.rounded_rect(-50.0, -8.0, 20.0, 22.0, 4.0), ZS - 6.0, ZS + 0.5, paint, axis='z', bevel=0.3)
    keys = [plinth]
    for i, (x, y) in enumerate(((-54.5, -3.0), (-45.5, -3.0), (-54.5, -13.0), (-45.5, -13.0))):
        keys.append(C.disc(f'clusterKey{i}', 3.5, 1.1, knurl, axis='Z', loc=(x, y, ZS + 0.5), ch=0.3, dome=0.1, seg=40))
    dials.append(C.set_component(C.join(keys, 'buttonCluster'), 'buttonCluster',
                                 'Four setting buttons'))
    # right shoulder: the top LCD; on the grip, the shutter button in its power collar on the forward facet, and three
    # buttons behind it
    K.top_lcd(55.0, -14.0, 27.0, 20.0, ZS, paint, lcd, 'Top status LCD')
    K.shutter_assembly(GRIP, 64.0, 25.0, knurl, paint, chrome)
    for i, x in enumerate((52.0, 60.0, 72.0)):
        C.disc(f'topButton{i}', 3.1, 1.2, knurl, axis='Z', loc=(x, 12.0, ZS + GRIP['top'] - 0.2), ch=0.3, dome=0.15, seg=32)
    c, r, h = DIAL_F['center'], DIAL_F['r'], DIAL_F['h']
    dials.append(C.set_component(C.knurl_dial('commandDialFront', r, h, 44, 0.45, knurl, axis='Z', loc=c),
                                 'commandDialFront', 'Sub-command dial'))
    c, r, h = DIAL_R['center'], DIAL_R['r'], DIAL_R['h']
    dials.append(C.set_component(C.knurl_dial('commandDialRear', r, h, 44, 0.45, knurl, axis='X', loc=c),
                                 'commandDialRear', 'Main command dial'))
    C.set_component(C.hot_shoe('hotShoe', (0, -14.0, ZP), 19.0, black, chrome, gold), 'hotShoe', 'Hot shoe')
    # front: the AF-assist lamp and two function buttons between the grip and the mount; the lens release and the
    # focus-mode button on the other side, on the leatherette
    C.disc('afLamp', 2.6, 0.9, glass, axis='Y', loc=(38.3, YF - 0.2, 31.0), ch=0.2, seg=32)
    fb = [K.button(f'fnButton{i}', 2.9, 2.2, knurl, 38.8, YF - 0.4, z, axis='Y', dome=0.25) for i, z in enumerate((7.0, -7.0))]
    C.set_component(C.join(fb, 'frontButtons'), 'frontButtons', 'Function buttons (Fn1, Fn2)')
    rel = K.button('lensReleaseButton', 4.8, 3.4, knurl, -43.0, YF + 0.6, -10.0, axis='Y', dome=0.4)
    C.set_component(rel, 'lensReleaseButton', 'Lens release button')
    af = [C.disc('afModeRing', 4.6, 0.9, paint, axis='Y', loc=(-41.0, YF + 0.6, -27.0), ch=0.25, seg=40),
          C.disc('afModeKey', 3.3, 2.3, knurl, axis='Y', loc=(-41.0, YF + 0.6, -27.0), ch=0.3, dome=0.2, seg=32)]
    C.set_component(C.join(af, 'afModeLever'), 'afModeLever', 'Focus-mode button')
    K.leather_front(X0 + 10.5, -30.0, ZB + 7.0, ZS - 8.0, YF, BOSS_R, rubber)
    # rear: the tilting screen and its hinge below the viewfinder; AF-ON, the sub-selector and the multi-selector by
    # the thumb; five buttons down the left and two by the viewfinder; the thumb pad
    K.screen_unit(-8.0, -9.0, 82.0, 58.0, YB, paint, screen, 'Rear screen (tilting)')
    K.af_on(36.0, ZS - 7.0, YB)
    K.sub_selector(40.0, ZS - 20.0, YB, knurl, paint)
    K.multi_selector(46.0, -6.0, YB, knurl, paint, lock=False)
    for i, z in enumerate((-24.0, -33.5)):
        K.button(f'infoButton{i}', 3.4, 1.3, knurl, 48.5, YB, z)
    for i in range(5):
        K.button(f'rearButton{i}', 3.9, 1.8, knurl, X0 + 8.5, YB + 0.4, 28.0 - 11.0 * i)
    for i, x in enumerate((-52.0, -40.0)):
        K.button(f'playButton{i}', 3.9, 1.4, knurl, x, YB, ZS - 7.0)
    K.leather_rear(58.0, X1 - 8.0, -32.0, ZS - 19.0, YB, rubber)
    K.port_doors(X0, [(-10.0, 18.0, 30.0, 28.0), (-10.0, -14.0, 30.0, 32.0)], rubber)
    for i, (sx, side) in enumerate(((-1, X0), (1, X1))):
        lug = K.slotted_lug(f'strapLug{i}' if i else 'strapLug', side, sx, -10.0, ZS - 11.0, knurl)
        if i == 0:
            C.set_component(lug, 'strapLug', 'Strap lug')
    C.disc('tripodSocket', 5.0, 0.3, black, axis='-Z', loc=(0, -8.0, ZB + 0.1), ch=0.1, seg=40)
    return dials


def studio(target=(9, 0, 17)):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
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
    sc.render.film_transparent = False
    # mm-scale scene: energies are "watts at a 0.6 m studio distance" scaled by 600^2 = 3.6e5 (see dslr_v2.py)
    def area(name, loc, size, watts, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, 'AREA'); d.size = size; d.energy = watts * 3.6e5; d.color = color
        o = bpy.data.objects.new(name, d); C.link(o); o.location = loc
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        return o
    area('key', (-420, 520, 420), 420, 30, (1.0, 0.97, 0.93))
    area('fill', (520, 260, 120), 520, 6, (0.85, 0.9, 1.0))
    area('rim', (120, -560, 380), 260, 28, (0.95, 0.97, 1.0))
    area('top', (0, 60, 700), 700, 8)
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, ZB - 0.1))
    floor = bpy.context.active_object; floor.name = 'floor'
    m = bpy.data.materials.new('floor'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.03, 0.032, 0.036, 1)
    b.inputs['Roughness'].default_value = 0.42
    floor.data.materials.append(m)


def shoot(outdir, prefix, views):
    sc = bpy.context.scene
    cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 85; cam_d.clip_start = 1; cam_d.clip_end = 20000
    cam = bpy.data.objects.new('cam', cam_d); C.link(cam); sc.camera = cam
    for name, loc, tgt in views:
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(outdir, f'{prefix}-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', sc.render.filepath)


def main():
    C.clear_scene()
    paint = C.mat_satin_black_paint(); rubber = C.mat_rubber(); chrome = C.mat_chrome(); knurl = C.mat_knurl()
    gold = C.mat_gold_contact(); white = C.mat_flat('indexWhite', (0.85, 0.85, 0.83), 0.45)
    glass = C.mat_glass('screenGlass', 1.5, (0.02, 0.025, 0.03, 1.0))
    display = C.mat_screen('displayGlass'); lcd = C.mat_lcd('topLcdPanel')
    closed = shell()
    grip(rubber)
    mount(chrome, C.mat_matte_black_baffle(), gold, paint, white)
    dials = details(paint, rubber, knurl, chrome, gold, display, lcd, white, C.mat_screen('lampWindow'))
    evf_out, evf_in = evf(rubber, paint, C.mat_glass('evfGlass', 1.6, (0.92, 0.95, 0.97, 1.0)))
    inside = interior(paint, glass) + evf_in
    C.finalize_uvs()
    # the cutaway shell, as dslr_v2.py: hollowed by a shrunken copy (a SOLIDIFY wall defeats the exact boolean),
    # then everything at x < 0 removed, which opens the sensor box and the EVF
    cut = closed.copy(); cut.data = closed.data.copy(); C.link(cut)
    for mname in [m.name for m in cut.modifiers]:
        bpy.context.view_layer.objects.active = cut
        bpy.ops.object.modifier_apply(modifier=mname)
    inner = cut.copy(); inner.data = cut.data.copy(); C.link(inner)
    bb = [cut.matrix_world @ Vector(c) for c in cut.bound_box]
    ctr = sum(bb, Vector()) / 8
    size = Vector((max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb),
                   max(v.z for v in bb) - min(v.z for v in bb)))
    for v in inner.data.vertices:
        p = v.co - ctr
        v.co = ctr + Vector((p.x * (1 - 5 / size.x), p.y * (1 - 5 / size.y), p.z * (1 - 5 / size.z)))
    C.boolean_diff(cut, inner)
    wedge = box('cutWedge', (90, 130, 150), (-45, -5, 17), bevel=0)
    C.boolean_diff(cut, wedge)
    print('CUT verts', len(cut.data.vertices), 'closed verts', len(closed.data.vertices))
    cut.data.materials.clear(); cut.data.materials.append(closed.data.materials[0])
    C.finalize_uvs([cut])
    C.set_component(cut, 'shellCut', 'Camera body, cut away')
    cut.hide_render = True
    top = bpy.data.objects.new('topDials', None); C.link(top); top['component'] = 'topDials'; top['label'] = 'Top-plate dials'
    for d in dials:
        d.parent = top
    root = bpy.data.objects.new('body', None); C.link(root); root['component'] = 'body'; root['label'] = 'Camera body (generic mirrorless)'
    for o in list(bpy.context.scene.objects):
        if o is not root and o.parent is None and o.type in ('MESH', 'EMPTY') and o.name != 'floor':
            o.parent = root
    exp = arg('--export')
    if exp:
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.context.scene.objects:
            if o.type in ('MESH', 'EMPTY'):
                o.select_set(True)
        cut.hide_render = False
        restore = C.detach_normal_maps(os.path.join(os.path.dirname(exp), 'textures'))
        bpy.ops.export_scene.gltf(filepath=exp, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_extras=True, export_materials='EXPORT',
                                  export_animations=False, export_cameras=False, export_lights=False)
        cut.hide_render = True
        restore()
        print('EXPORTED', exp, round(os.path.getsize(exp) / 1048576, 2), 'MB')
    for o in inside:
        o.hide_render = True
    out = arg('--render')
    if out:
        os.makedirs(out, exist_ok=True)
        studio()
        shoot(out, 'ml2', [
            ('front3q', (-330, 470, 150), (9, 0, 14)),
            ('front3q-grip', (360, 460, 150), (9, 0, 14)),
            ('top', (9, 40, 700), (9, -2, 0)),
            ('rear3q', (360, -480, 190), (9, -5, 14)),
            ('side', (-640, 0, 40), (0, -2, 15)),
        ])
        closed.hide_render = True; cut.hide_render = False
        for o in inside:
            o.hide_render = False
        keep = set(inside) | {cut}
        for o in bpy.context.scene.objects:
            if o.type == 'MESH' and o not in keep and o.name not in ('floor', 'mount', 'mountLugs', 'contacts', 'mountBoss', 'mountThroat'):
                cx = sum((o.matrix_world @ Vector(c)).x for c in o.bound_box) / 8
                if cx < -2:
                    o.hide_render = True
        shoot(out, 'ml2', [('cutaway', (-470, 170, 130), (0, -6, 14))])


main()
