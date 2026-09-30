"""Generic full-frame DSLR body, modeled from silhouettes (lead, 09/28/2026; design review round 0, 09/30/2026).

D850-published envelope 146 x 124 x 78.5 mm; Nikon F geometry (flange 46.5 mm, throat 44 mm). Generic and unbranded:
no logos, no maker's trade dress. Frame: common.py (mm, X right seen from behind, Y optical depth with the mount face
at +46.5 and the sensor at 0, Z up, optical axis at Z = 0).

The shell is three solids unioned before one bevel: the lower body, the prism housing (tall and narrow, flat angled
cheeks, a nose over the mount, a short flat top for the shoe) and the grip (full height, flowing into the shoulder,
with a forward-sloping facet for the shutter button). The command dials sit in slots cut into it.

  blender --background --factory-startup --python blender/dslr_v2.py -- [--render DIR] [--export PATH]
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import silhouette as S
import bodykit as K

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d

FLANGE = 46.5
THROAT = 44.0
FACE_D = 56.0                           # the chrome mount face's outer diameter
BOSS_R = 31.0                           # the black mount boss (the front of the mirror box)
# body envelope: X [-64, 82] (146), Y [-24, 54.5] (78.5 incl. grip), Z [-45, 79] (124)
X0, X1 = -64.0, 82.0
YB, YF, YG = -24.0, 40.0, 54.5          # back (rear plate), front face, grip front
ZB, ZS, ZP = -45.0, 47.0, 79.0          # bottom, shoulder (top plate), prism top
ZE = ZS + 13.0                          # the eyepiece's axis height
SLOPE = 4.0                             # the port-side end leans in 4 mm toward the front, in plan (R1-FID-E)
GRIP = dict(x_in=43.0, X1=X1, YF=YF, YG=YG, ZB=ZB, ZS=ZS, back=18.0, top=3.5, front_top=ZS - 16, lean=10.0,
            facet=(YG - 3.0, ZS - 4.0, YF - 4.0, ZS + 3.5), rubber_back=16.0, rubber_top=ZS - 13.5)
DIAL_F = dict(center=(65.0, 44.0, ZS - 11.5), r=8.0, h=5.0)          # front command dial: vertical axis, in the grip front
DIAL_R = dict(center=(X1 - 17.0, YB + 5.0, ZS - 10.0), r=8.0, h=6.0)  # rear command dial: horizontal axis, top-rear corner


def xs(y):
    """The port-side end's x at depth y (it leans in toward the front, in plan)."""
    return X0 + SLOPE * (y - YB) / (YF - YB)


def on_port_side(obj, yc):
    """Turn a part built flat against x = X0 onto the leaning port-side end, about its center depth yc."""
    th = math.atan2(SLOPE, YF - YB)
    M = Matrix.Translation((xs(yc), yc, 0)) @ Matrix.Rotation(-th, 4, 'Z') @ Matrix.Translation((-X0, -yc, 0))
    return K.place(obj, M)


def shell():
    """Round 1 (R1-FID-E): the shoulders roll down to both ends on 11 mm radii, the top plate carries a slight crown
    front to back, the port-side end leans in plan, the grip has a rounded front and a filleted finger channel, the
    prism's nose runs down into a mount housing with no step, and the prism grows out of the top plate on a 3.5 mm
    fillet instead of sitting on it."""
    YC = (YB + YF) / 2
    lower = K.solid('shellClosed',
                    K.fp([(X0, ZB), (X1, ZB), (X1, ZS), (X0 + 24, ZS), (X0, ZS - 1.5)], [8, 10, 11, 40, 11], seg=14),
                    K.fp([(X0, YB), (X1, YB), (X1, YF), (X0 + SLOPE, YF)], [8, 8, 8, 10], seg=12),
                    K.fp([(YB, ZB), (YF, ZB), (YF, ZS - 1.0), (YC, ZS), (YB, ZS - 1.0)], [6, 6, 5, 60, 7], seg=12),
                    (X0, X1, YB, YF, ZB, ZS))
    # the prism housing: 60-degree cheeks up to a 34 mm top, a nose 2 mm proud of the front over the mount, the front
    # raked back above the nose, a short flat top, the eyepiece block standing 4 mm off the back
    hump = K.solid('hump',
                   K.fp([(-35, ZS - 3), (35, ZS - 3), (35, ZS + 2), (29, ZS + 7), (17, ZP), (-17, ZP), (-29, ZS + 7), (-35, ZS + 2)],
                        [0, 0, 2, 3, 2.5, 2.5, 3, 2]),
                   K.fp([(-24, YF + 2), (24, YF + 2), (33, YF - 14), (35, YB - 4), (-35, YB - 4), (-33, YF - 14)],
                        [3, 3, 4, 3, 3, 4]),
                   K.fp([(YB - 4, ZS - 3), (YF + 2, ZS - 3), (YF + 2, ZS + 6), (YF - 12, ZP), (YB + 4, ZP), (YB - 4, ZP - 6)],
                        [0, 0, 2.5, 2.5, 2.5, 2.5]),
                   (-36, 36, YB - 5, YF + 3, ZS - 4, ZP))
    # the mount housing: the prism's nose carried straight down round the mount, flaring from the nose's width to
    # just outside the boss and closing under it on a round bottom, in the nose's own front plane
    housing = K.solid('housing',
                      K.fp([(-24, ZS + 6), (24, ZS + 6), (32.5, ZS - 12), (32.5, -12), (21, -33), (-21, -33), (-32.5, -12),
                            (-32.5, ZS - 12)], [0, 0, 8, 14, 12, 12, 14, 8], seg=12),
                      K.fp([(-33, YF - 6), (33, YF - 6), (33, YF + 2), (-33, YF + 2)], [0, 0, 1.5, 1.5]),
                      K.fp([(YF - 6, -40), (YF + 2, -40), (YF + 2, ZS + 7), (YF - 6, ZS + 7)], [0, 0, 0, 0]),
                      (-34, 34, YF - 7, YF + 3, -40, ZS + 7))
    K.boolean(lower, hump, 'UNION')
    K.boolean(lower, housing, 'UNION')
    K.boolean(lower, K.grip_solid('gripCore', 0.0, GRIP), 'UNION')
    # fillets: the prism into the top plate (and the eyepiece block into the back), 3.5 mm; the housing into the front
    # face, 1.5 mm
    K.fillet_concave(lower, lambda x, y, z: abs(x) < 37 and ZS - 4 < z < ZS + 1 and YB - 6 < y < YF + 1, 3.5)
    K.fillet_concave(lower, lambda x, y, z: abs(x) < 35 and YF - 0.5 < y < YF + 0.5 and z < ZS - 2, 1.5, segments=3)
    K.slot_for_dial(lower, 'Z', DIAL_F['center'], DIAL_F['r'], DIAL_F['h'], reach=YG + 6)
    K.slot_for_dial(lower, 'X', DIAL_R['center'], DIAL_R['r'], DIAL_R['h'], reach=YB - 2)
    body = K.finish(lower, bevel=0.9)
    body.data.materials.append(C.mat_satin_black_paint())
    return C.set_component(body, 'shellClosed', 'Camera body (generic DSLR)')


def mount(chrome, black, gold, paint, white):
    parts = C.body_mount(THROAT, FACE_D, 3, 8, FLANGE, chrome, black, gold, contact_deg=200.0, lock_pin_deg=235.0)
    for key, label in (('mount', 'Lens mount (Nikon F geometry)'), ('mountLugs', 'Bayonet lips'),
                       ('contacts', 'Electrical contacts')):
        C.set_component(parts[key], key, label)
    rt, rw = THROAT / 2, THROAT / 2 + 2.6
    boss = C.revolve('mountBoss', [(rw + 1.6, YF - 2), (BOSS_R, YF - 2), (BOSS_R, FLANGE - 2.4), (BOSS_R - 1.0, FLANGE - 0.95),
                                   (rw + 1.6, FLANGE - 0.95)], C.ring_thetas(128), True, paint, sharp_deg=30)
    th = math.radians(-60)
    rd = (FACE_D / 2 + BOSS_R) / 2
    C.disc('mountIndex', 1.1, 0.12, white, axis='Y', loc=(rd * math.sin(th), FLANGE - 0.95, rd * math.cos(th)), ch=0.04, seg=24)
    # the aperture-coupling lever inside the throat: it stops the lens down by its own lever at the moment of exposure
    lev = C.revolve('apertureCoupling', [(rt - 4.0, FLANGE - 6.0), (rw + 0.2, FLANGE - 6.0), (rw + 0.2, FLANGE - 7.6), (rt - 4.0, FLANGE - 7.6)],
                    C.arc(math.radians(123), math.radians(131), 6), False, black, sharp_deg=30)
    C.set_component(lev, 'apertureCoupling', 'Aperture-coupling lever (moves the lens\'s aperture lever)')
    return parts


def grip(rubber):
    return K.rubber_grip(GRIP, rubber, 'Grip')


def interior(paint, glass, chrome):
    """What the cutaway shows: the mirror box and its light paths, the shutter, the sensor stack. Positions follow
    data/hardware/dslr.json (mirror at 45 degrees hinged at its top edge; the focusing screen at the same optical
    distance from the mirror as the sensor) and d850.json (35.9 x 23.9 mm active area at the sensor plane)."""
    baffle = C.mat_matte_black_baffle(); mirror_m = C.mat_mirror_silvered(); ceramic = C.mat_ceramic()
    silicon = C.mat_silicon(); pix = C.mat_pixel_grid(); wire = C.mat_wire(); stack_glass = C.mat_glass('filterGlass', 1.52, (0.9, 0.95, 1.0, 1.0))
    out = []
    # mirror box: four blackened walls around the light path between the mount and the shutter
    mb = []
    # (no wall on the cut side, x < 0: a real cutaway removes it too, and it would hide the mirror)
    for (sx, sy, sz, lx, ly, lz) in ((1.2, 36, 36, 20, 26, 1), (41, 36, 1.2, 0, 26, -17.5)):
        mb.append(box('mirrorBoxWall', (sx, sy, sz), (lx, ly, lz), baffle, bevel=0.2))
    wall = C.join(mb, 'mirrorBox'); C.set_component(wall, 'mirrorBox', 'Mirror box'); out.append(wall)
    # main mirror: 45 degrees, hinged at its top edge, center on the axis ~25 mm in front of the sensor
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 25, 0))
    m = bpy.context.active_object; m.scale = (36, 34, 1); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)   # keep the origin at the center: the 45 deg turn is about it
    # tilted with its top edge toward the sensor (under the focusing screen) and its bottom toward the lens, so the light
    # coming back from the lens reflects UP to the screen (at +45 deg it went down into the floor: fixed 09/29/2026)
    m.rotation_euler = (math.radians(-45), 0, 0); m.data.materials.append(mirror_m)
    sol = m.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 1.0
    C.set_component(m, 'mirror', 'Main mirror (45 degrees)'); out.append(m)
    # record the mirror's optical FRONT face as glTF extras: a point and unit normal, in the app frame,
    # world space. SOLIDIFY's default offset (-1) extrudes the added thickness away from the original
    # surface, so the plane this object had BEFORE solidify (local z = 0, through its own origin, normal
    # local +Z) is still the reflective front face -- fitting a plane through the solidified mesh's own
    # vertices instead (the previous approach) mixes in the 1mm slab thickness and mis-tilts the normal
    # (Astra-6 finding C1). Read back with mirror.matrix_world so the recorded plane is exact even if this
    # object's own transform changes before export.
    bpy.context.view_layer.update()
    mw = m.matrix_world
    front_pt = mw @ Vector((0, 0, 0))
    front_n = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
    m['mirrorFrontPlane'] = [front_pt.x, front_pt.z, -front_pt.y, front_n.x, front_n.z, -front_n.y]  # app frame (x, y, z)
    # the sub-mirror hangs behind the main mirror's half-silvered center, across the axis, and sends that share down
    # to the autofocus module in the floor
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 19.0, -3.0))
    sm = bpy.context.active_object; sm.scale = (20, 14, 1); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sm.rotation_euler = (math.radians(50), 0, 0); sm.data.materials.append(mirror_m)
    C.set_component(sm, 'subMirror', 'Sub-mirror (to the AF module)'); out.append(sm)
    # focusing screen 25 mm above the mirror center, the same optical distance as the sensor behind it
    fs = box('focusingScreen', (36, 26, 1.2), (0, 25, 25), glass, bevel=0.2)
    C.set_component(fs, 'focusingScreen', 'Focusing screen'); out.append(fs)
    # the screen's own optical plane (app-frame y): nominal 25mm, the same optical distance from the
    # mirror center as the sensor -- recorded as an extra rather than left for the app to infer from the
    # box's near face (which sat 0.6mm short at y=24.4, Astra-6 finding C1).
    fs['opticalScreenY'] = 25.0
    # pentaprism: a glass roof prism over the screen, inside its housing
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=24, radius2=9, depth=26, location=(0, 22, 40))
    pr = bpy.context.active_object; pr.rotation_euler = (0, 0, math.radians(45)); pr.data.materials.append(glass)
    C.set_component(pr, 'prism', 'Pentaprism'); out.append(pr)
    ph = box('prismHousing', (44, 36, 1.0), (0, 22, 54), baffle, bevel=0.3)
    C.set_component(ph, 'prismHousing', 'Prism housing'); out.append(ph)
    # focal-plane shutter just in front of the filter stack: a frame and two curtains of blades
    frame = box('shutterFrame', (52, 2.0, 40), (0, 4.5, 0), baffle, bevel=0.2)
    hole = box('shutterHole', (37, 6, 25), (0, 4.5, 0))
    C.boolean_diff(frame, hole)
    C.set_component(frame, 'shutter', 'Focal-plane shutter'); out.append(frame)
    # each curtain's 4 overlapping blades stack to exactly the sensor's 23.9mm active height (Astra-6
    # finding C2: the old 14.8mm stack covered only 62% of the frame). Blade pitch (5.0mm) is well under
    # blade height (8.9mm) so adjacent blades overlap by 3.9mm -- no light-leak gap between them -- and
    # the overall span (3 * 5.0 + 8.9 = 23.9mm) exactly matches the pixel array height set in interior()
    # below, which is what src/scene/rig-exposure.ts's curtainPose() assumes when it drives the curtain
    # across exactly that height in the data-file curtain-travel time (data/hardware/body.json).
    for name, z0, sgn in (('shutterCurtainFront', 13.5, 1), ('shutterCurtainRear', -13.5, -1)):
        blades = [box(f'{name}{i}', (38, 0.25, 8.9), (0, 3.6 + i * 0.3, z0 + sgn * i * 5.0), paint, bevel=0.05) for i in range(4)]
        cur = C.join(blades, name); C.set_component(cur, name, 'Shutter curtain'); out.append(cur)
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
    return out


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


def details(paint, rubber, knurl, chrome, gold, screen, lcd, white, glass_eye):
    black = C.mat_flat('insulatorBlack', (0.012, 0.012, 0.013), 0.55)
    dials = []
    # left shoulder: the release-mode dial, satin black, with four flat buttons on its cap and its lock button
    rx, ry = -47.0, 2.0
    ring = C.knurl_dial('releaseModeDial', 13.5, 5.0, 72, 0.5, knurl, top_mat=paint, axis='Z', loc=(rx, ry, ZS - 0.5))
    cap = C.disc('rmCap', 11.6, 0.7, paint, axis='Z', loc=(rx, ry, ZS + 4.5), ch=0.2, seg=72)
    keys = []
    for k in range(4):
        a0 = math.radians(90 * k + 4)
        key = C.revolve(f'rmKey{k}', [(3.6, 0), (10.9, 0), (10.9, 0.8), (10.5, 1.15), (4.0, 1.15), (3.6, 0.8)],
                        C.arc(a0, a0 + math.radians(82), 20), False, knurl, sharp_deg=35)
        C.orient(key, 'Z', (rx, ry, ZS + 5.2))
        keys.append(key)
    hub = C.disc('rmHub', 3.1, 1.0, paint, axis='Z', loc=(rx, ry, ZS + 5.2), ch=0.2, seg=32)
    lock = C.disc('rmLock', 2.3, 2.3, knurl, axis='Z', loc=(-44.0, 20.5, ZS - 0.8), ch=0.3, dome=0.2, seg=32)
    # the dial stands on a raised collar where the shoulder rolls away under it
    plinth = C.disc('rmPlinth', 14.6, 5.0, paint, axis='Z', loc=(rx, ry, ZS - 5.0), ch=0.6, seg=96)
    rmd = C.join([ring, cap, hub, lock, plinth] + keys, 'releaseModeDial')
    dials.append(C.set_component(rmd, 'releaseModeDial', 'Release-mode dial'))
    # right shoulder: the top LCD; on the grip, the shutter button in its power collar on the forward facet, and the
    # three buttons behind it
    K.top_lcd(56.0, -5.0, 31.0, 25.0, ZS, paint, lcd, 'Top status LCD')
    K.shutter_assembly(GRIP, 65.0, 41.5, knurl, paint, chrome)
    for i, x in enumerate((50.0, 57.5, 73.5)):
        C.disc(f'topButton{i}', 3.1, 1.2, knurl, axis='Z', loc=(x, 30.0, ZS + GRIP['top'] - 0.2), ch=0.3, dome=0.15, seg=32)
    # command dials, sunk into their slots with 2-3 mm of knurl showing
    c, r, h = DIAL_F['center'], DIAL_F['r'], DIAL_F['h']
    dials.append(C.set_component(C.knurl_dial('commandDialFront', r, h, 44, 0.45, knurl, axis='Z', loc=c),
                                 'commandDialFront', 'Front command dial'))
    c, r, h = DIAL_R['center'], DIAL_R['r'], DIAL_R['h']
    dials.append(C.set_component(C.knurl_dial('commandDialRear', r, h, 44, 0.45, knurl, axis='X', loc=c),
                                 'commandDialRear', 'Main command dial'))
    # the shoe on the prism's flat top
    C.set_component(C.hot_shoe('hotShoe', (0, 4.0, ZP), 19.0, black, chrome, gold), 'hotShoe', 'Hot shoe')
    # front, between the grip and the mount: the Pv and Fn1 buttons; on the other side the lens release button and the
    # focus-mode selector; leatherette on that side of the face (the D850 has no AF-assist lamp)
    fb = [K.button(f'frontButton{i}', 3.3, 2.2, knurl, 36.5, YF - 0.4, z, axis='Y', dome=0.25) for i, z in enumerate((7.0, -7.0))]
    C.set_component(C.join(fb, 'frontButtons'), 'frontButtons', 'Depth-of-field preview (Pv) and function (Fn1) buttons')
    rel = K.button('lensReleaseButton', 4.8, 3.4, knurl, -38.5, YF + 0.6, -10.0, axis='Y', dome=0.4)
    C.set_component(rel, 'lensReleaseButton', 'Lens release button')
    sel = [C.disc('afSelBase', 5.6, 1.3, knurl, axis='Y', loc=(-36.0, YF + 0.6, -30.0), ch=0.3, seg=40),
           C.disc('afModeButton', 2.9, 2.6, knurl, axis='Y', loc=(-36.0, YF + 0.6, -30.0), ch=0.3, dome=0.2, seg=32)]
    tab = C.rounded_box('afSelTab', 2.6, 2.4, 5.0, bevel=0.6, bevel_segments=2, loc=(-36.0 - 5.2, YF + 1.8, -30.0 - 3.0), material=knurl)
    tab.rotation_euler = (0, math.radians(35), 0)
    C.set_component(C.join(sel + [tab], 'afModeLever'), 'afModeLever', 'Focus-mode selector with the AF-mode button')
    K.leather_front(X0 + SLOPE + 11.0, -34.0, ZB + 7.0, ZS - 8.0, YF, BOSS_R, rubber)
    # rear: the tilting screen and its hinge; the eyepiece, a round cup in a squared rubber block; AF-ON, the
    # sub-selector and the multi-selector with its lock lever by the thumb; seven buttons down the left; the thumb pad
    K.screen_unit(-8.0, -12.0, 84.0, 62.0, YB, paint, screen, 'Rear screen (tilting)')
    block = []
    for k, (y, a, b) in enumerate(((YB - 3.5, 15.0, 13.5), (YB - 8.0, 14.8, 13.3), (YB - 10.5, 14.2, 12.7))):
        ring = S.superellipse(0, ZE, a, b, n=4.2, seg=48)
        block.append([(x, y, z) for (x, z) in ring])
    sq = S.loft('eyecupBlock', block)
    sq.data.materials.append(paint)
    cup = C.revolve('eyecupRing', [(9.6, YB - 10.0), (12.6, YB - 10.0), (12.9, YB - 12.4), (12.3, YB - 14.2), (11.2, YB - 14.6),
                                   (10.2, YB - 14.2), (9.6, YB - 12.8)], C.ring_thetas(72), True, rubber, sharp_deg=50)
    cup.location = (0, 0, ZE)
    C.set_component(C.join([sq, cup], 'eyecup'), 'eyecup', 'Viewfinder eyepiece and eyecup')
    C.disc('eyepieceGlass', 9.8, 0.4, glass_eye, axis='-Y', loc=(0, YB - 11.2, ZE), ch=0.1, seg=64)
    K.af_on(36.0, ZS - 8.0, YB)
    K.sub_selector(40.0, ZS - 21.0, YB, knurl, paint)
    K.multi_selector(46.0, -6.0, YB, knurl, paint, lock=True)
    for i, z in enumerate((-27.0, -36.5)):
        K.button(f'infoButton{i}', 3.4, 1.3, knurl, 48.5, YB, z)
    for i in range(7):
        K.button(f'rearButton{i}', 4.1, 1.9, knurl, X0 + 9.5, YB + 0.5, 29.0 - 11.0 * i)
    for i, x in enumerate((-54.0, -42.5)):
        K.button(f'playButton{i}', 4.1, 1.4, knurl, x, YB, ZS - 6.5)
    K.leather_rear(58.0, X1 - 8.5, -36.0, ZS - 17.0, YB, rubber)
    # sides: the port doors on the left, the strap eyelets with their triangular split rings
    on_port_side(K.port_doors(X0, [(10.0, 21.0, 36.0, 26.0), (10.0, -12.0, 36.0, 38.0)], rubber), 10.0)
    for i, (sx, side) in enumerate(((-1, X0), (1, X1))):
        e = K.split_ring_eyelet(f'strapLug{i}' if i else 'strapLug', side, sx, 12.0, ZS - 11.0, paint, chrome)
        if i == 0:
            on_port_side(e, 12.0)
            C.set_component(e, 'strapLug', 'Strap eyelet and split ring')
    # the tripod socket, on the optical axis under the body
    C.disc('tripodSocket', 5.0, 0.3, black, axis='-Z', loc=(0, 8.0, ZB + 0.1), ch=0.1, seg=40)
    return dials


def studio(target=(9, 15, 17)):
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
    # a studio gradient the chrome and paint can reflect: dark floor, bright soft ceiling
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (0.004, 0.004, 0.005, 1)
    ramp.color_ramp.elements[1].position = 0.9; ramp.color_ramp.elements[1].color = (0.30, 0.31, 0.33, 1)
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -1; mr.inputs['From Max'].default_value = 1
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(tc.outputs['Normal'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    sc.render.film_transparent = False
    # mm-scale scene: Blender reads 1 unit as 1 m, so a light ~600 units away delivers 1/(600^2) of what it would at
    # 1 m; energies below are "watts at a 0.6 m studio distance" scaled by 600^2 = 3.6e5
    def area(name, loc, size, watts, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, 'AREA'); d.size = size; d.energy = watts * 3.6e5; d.color = color
        o = bpy.data.objects.new(name, d); C.link(o); o.location = loc
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        return o
    from mathutils import Vector
    area('key', (-420, 520, 420), 420, 30, (1.0, 0.97, 0.93))
    area('fill', (520, 260, 120), 520, 6, (0.85, 0.9, 1.0))
    area('rim', (120, -560, 380), 260, 28, (0.95, 0.97, 1.0))
    area('top', (0, 60, 700), 700, 8)
    # a seamless floor for contact shadows and a soft reflection
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, ZB - 0.1))
    floor = bpy.context.active_object; floor.name = 'floor'
    m = bpy.data.materials.new('floor'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.03, 0.032, 0.036, 1)
    b.inputs['Roughness'].default_value = 0.42
    floor.data.materials.append(m)


def shoot(outdir, prefix, views):
    from mathutils import Vector
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
    glass = C.mat_glass('screenGlass', 1.5, (0.02, 0.025, 0.03, 1.0))      # the focusing screen and prism inside
    display = C.mat_screen('displayGlass'); eye = C.mat_screen('eyepieceGlass'); lcd = C.mat_lcd('topLcdPanel')
    closed = shell()
    grip(rubber)
    mount(chrome, C.mat_matte_black_baffle(), gold, paint, white)
    dials = details(paint, rubber, knurl, chrome, gold, display, lcd, white, eye)
    inside = interior(paint, glass, chrome)
    C.finalize_uvs()
    # the cutaway shell: the closed shell minus the left half (seen from behind), which opens the mirror box
    cut = closed.copy(); cut.data = closed.data.copy(); C.link(cut)
    for mname in [m.name for m in cut.modifiers]:
        bpy.context.view_layer.objects.active = cut
        bpy.ops.object.modifier_apply(modifier=mname)
    # hollow the cut shell first (a 2.5 mm wall, like a magnesium casing), so the section shows a wall and an
    # open interior instead of a solid face
    # (a SOLIDIFY wall self-intersects on this shell and the exact boolean then silently returns it uncut, so the
    # wall is made by subtracting a copy shrunk by ~2.5 mm on every side about the shell's center)
    inner = cut.copy(); inner.data = cut.data.copy(); C.link(inner)
    bb = [cut.matrix_world @ Vector(c) for c in cut.bound_box]
    ctr = sum(bb, Vector()) / 8
    size = Vector((max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb),
                   max(v.z for v in bb) - min(v.z for v in bb)))
    for v in inner.data.vertices:
        p = v.co - ctr
        v.co = ctr + Vector((p.x * (1 - 5 / size.x), p.y * (1 - 5 / size.y), p.z * (1 - 5 / size.z)))
    C.boolean_diff(cut, inner)
    wedge = box('cutWedge', (90, 130, 150), (-45, 15, 17), bevel=0)   # everything at x < 0
    C.boolean_diff(cut, wedge)
    print('CUT verts', len(cut.data.vertices), 'closed verts', len(closed.data.vertices))
    cut.data.materials.clear(); cut.data.materials.append(closed.data.materials[0])
    C.finalize_uvs([cut])
    C.set_component(cut, 'shellCut', 'Camera body, cut away')
    cut.hide_render = True
    # hierarchy: 'body' holds everything, 'topDials' holds the dials
    top = bpy.data.objects.new('topDials', None); C.link(top); top['component'] = 'topDials'; top['label'] = 'Top-plate dials'
    for d in dials:
        d.parent = top
    root = bpy.data.objects.new('body', None); C.link(root); root['component'] = 'body'; root['label'] = 'Camera body (generic DSLR)'
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
        o.hide_render = True    # the closed-shell renders show the outside only
    out = arg('--render')
    if out:
        os.makedirs(out, exist_ok=True)
        studio()
        shoot(out, 'dslr2', [
            ('front3q', (-330, 480, 150), (9, 10, 12)),
            ('front3q-grip', (360, 470, 150), (9, 10, 12)),
            ('top', (9, 60, 700), (9, 14, 0)),
            ('rear3q', (360, -470, 190), (9, 10, 12)),
            ('side', (-640, 30, 40), (0, 12, 15)),
        ])
        # the cutaway: the cut shell and the interior, seen from the open (left) side
        closed.hide_render = True; cut.hide_render = False
        for o in inside:
            o.hide_render = False
        keep = set(inside) | {cut}
        for o in bpy.context.scene.objects:          # outside details on the removed half go with it
            if o.type == 'MESH' and o not in keep and o.name not in ('floor', 'mount', 'mountLugs', 'contacts', 'mountBoss', 'mountThroat'):
                cx = sum((o.matrix_world @ Vector(c)).x for c in o.bound_box) / 8
                if cx < -2:
                    o.hide_render = True
        shoot(out, 'dslr2', [('cutaway', (-420, 330, 170), (0, 20, 10))])


main()
