"""Generic full-frame DSLR body, modeled from silhouettes (lead, 09/28/2026; design review round 0, 09/30/2026).

D850-published envelope 146 x 124 x 78.5 mm; Nikon F geometry (flange 46.5 mm, throat 44 mm). Generic and unbranded:
no logos, no maker's trade dress. Frame: common.py (mm, X right seen from behind, Y optical depth with the mount face
at +46.5 and the sensor at 0, Z up, optical axis at Z = 0).

The shell is three solids unioned before one bevel: the lower body, the prism housing (tall and narrow, flat angled
cheeks, a nose over the mount, a short flat top for the shoe) and the grip (full height, flowing into the shoulder,
with a forward-sloping facet for the shutter button). The command dials sit in slots cut into it.

  blender --background --factory-startup --python blender/dslr_v2.py -- [--render DIR] [--export PATH]
"""
import bpy, bmesh, sys, os, math
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
# body envelope: X [-54.6, 91.4] (146; X0 below is -55.1, see there), Y [-24, 54.5] (78.5 incl. grip), Z [-45, 79] (124)
# X0 is 0.5 mm past the end: the port-side end leans in from its rear corner, whose 8 mm round meets the side 0.47 mm
# in, so without it the shell measured 145.5 mm wide (review loop 10/10/2026, B-09); 146.0 with it
# Score loop r3 (10/11/2026): the optical axis is 54.6 mm from the port-side end, not 64. Nikon's D850 rear drawing puts
# the eyepiece, and its top drawing the shoe, both on the axis, 54.6 and 54.7 mm from that end when scaled to the
# 146 mm width (research/d850.md, "Exterior traced from Nikon's manual drawings").
X0, X1 = -55.1, 91.4
YB, YF, YG = -24.0, 40.0, 54.5          # back (rear plate), front face, grip front
ZB, ZS, ZP = -45.0, 47.0, 79.0          # bottom, shoulder (top plate), prism top
# the pentaprism's section (pentaprism_section below): the entry face lies on the focusing screen from y = 12 forward,
# 25 mm deep (the screen's depth) at z = 26, trimmed ahead of the mount boss; the exit face is the vertical face at its
# rear, y = 12, from z = 26 up to 26 + 25
PRISM = dict(y_rear=12.0, z_base=26.0, a=25.0, clip_y=36.8)
# the eyepiece's axis passes through the middle of the prism's exit face (round 1 of the 10/11/2026 score loop, Reed's
# decision 2): z = 38.5, just under the top plate, so the eyecup straddles the shoulder line as on the D850. It sat at
# ZS + 13 = 60, 9-22 mm above the exit face, where no light from the prism could reach it.
ZE = PRISM['z_base'] + PRISM['a'] / 2
# the eyepiece housing's underside (score loop r4, 10/11/2026): it was ZE - 15 = 23.5, 1.7 mm over the screen frame's top
# edge (z 21.8, the rear drawing's 22.2) and 0.3 mm over the hinge barrel (top 23.2), so the housing and the screen
# touched in every rear view. Raised to ZE - 12.5 = 26.0, 2.8 mm clear of the hinge and 4.2 mm of the frame; the eyecup
# block's own underside (25.0) is 1.8 mm clear of the hinge. The drawing's gap is not measured, only that there is one.
EB_Z0 = ZE - 12.5
# How far the eyecup stands behind the rear plate (score loop r5, 10/11/2026): 7.8 mm in all, the housing 4 mm of it. It was 14.6,
# a length with no source that left the model 93.5 mm deep against Nikon's 78.5. Still no published figure (research/d850.md),
# so this is the model's own, chosen as the ceiling the CIPA rule as reported allows: a protrusion may be left out of a depth
# only if it stands out no more than 10% of it (7.85 mm of 78.5), and Nikon's top drawing shows the eyepiece standing out of the
# rear outline by a few millimeters (about 3 to 7, a tilted view). The Z8's eyecup (10.9 mm of a 74 mm shell) counts in its 83 mm.
EYE_STAND = 7.8
EYE_BLOCK = 6.0                         # where the squared rubber block ends, behind the plate; the round cup is the last 1.8 mm
EYE_BORE = 11.5                         # the eyecup block's bore for the eyepiece tube (the shell's is 0.4 mm wider, so the
                                        # two bores never share a surface)
SENSOR_H = 23.9                         # the active area's height (d850.json), which each shutter curtain covers
STACK_PITCH = 0.3                       # how far apart a waiting curtain's blades sit when folded
AF_WIN = (11.0, 12.5, 25.5)             # the AF module's window in the mirror-box floor: half-width in x, y from, y to (af_module)
# the raised mirror (Reed's decision 2): flat under the focusing screen, its front face at z = 23.6 (the screen's
# underside is at 24.4) from just over the folded shutter blades (y = 3.4) to the mirror box's front (y = 37.4)
MIRROR_UP = dict(y=3.4, z=23.6)
SLOPE = 4.0                             # the port-side end leans in 4 mm toward the front, in plan (R1-FID-E)
GRIP = dict(x_in=43.0, X1=X1, YF=YF, YG=YG, ZB=ZB, ZS=ZS, back=18.0, top=3.5, front_top=ZS - 16, lean=10.0,
            facet=(YG - 3.0, ZS - 4.0, YF - 4.0, ZS + 3.5), rubber_back=16.0, rubber_top=ZS - 13.5)
# the front command dial, vertical axis, in the grip front: kept 2.5 mm out from the middle of the grip's front as
# before the grip grew to the new X1 (no drawing shows it square on)
DIAL_F = dict(center=(69.7, 44.0, ZS - 11.5), r=8.0, h=5.0)
# the main command dial, horizontal axis, top-rear corner: its knurl centered at x 72.6 in the rear drawing
DIAL_R = dict(center=(69.6, YB + 5.0, ZS - 10.0), r=8.0, h=6.0)


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
    # the prism housing: a nose 2 mm proud of the front over the mount, the front raked back above the nose, a short
    # flat top, the eyepiece block standing 4 mm off the back. Its cheeks (score loop r3) follow Nikon's D850 rear
    # drawing scaled by the envelope (research/d850.md; photo-derived): 48 mm across at z 61.6 and 44 mm at z 68.3,
    # rising from a 54 mm root, where the release-mode dial now tucks against it; the root was 70 mm across.
    # score loop r4 (10/11/2026): the cheeks are a spline through the traced points, not a polyline of three straight
    # runs, which showed as terraced bands (review: 3-4 stacked flat facets on the cheek). Controls: the 54 mm root
    # (27), the traced 48 mm at z 61.6 (24) and 44 mm at z 68.3 (22), then the model's own roll-over to the shoe's flat
    # top, 20 mm across; the two in-between points (z 53.5 and 74.4) only set how the cheek leaves the root and turns
    # onto the top, and are stylized, not traced. The nose rake in elevation and the plan corners use larger rounds for
    # the same reason (the rake was a straight slab with 2.5 mm corners).
    cheek = K.smooth_curve([(27.0, ZS - 3), (27.0, ZS + 1.5), (26.4, 53.5), (24.0, 61.6), (22.0, 68.3), (19.0, 74.4),
                            (14.6, 78.2), (10.0, ZP)], per=5)
    cheek = [(x, min(z, ZP)) for x, z in cheek]
    hump_front = [(-27.0, ZS - 3)] + cheek + [(-x, z) for x, z in reversed(cheek)]
    hump = K.solid('hump',
                   K.fp(hump_front, [0] * len(hump_front)),
                   # in plan the back corners turn in to the eyepiece housing's width (score loop r3): a hump as wide
                   # as its root all the way back overhung the rear plate's top round beside the housing, and the
                   # bevel pinched into a fin where the three met
                   K.fp([(-24, YF + 2), (24, YF + 2), (26, YF - 14), (27, YB + 2), (24, YB - 4), (-24, YB - 4),
                         (-27, YB + 2), (-26, YF - 14)],
                        [6, 6, 8, 3, 2, 2, 3, 8]),
                   K.fp([(YB - 4, ZS - 3), (YF + 2, ZS - 3), (YF + 2, ZS + 6), (YF - 12, ZP), (YB + 4, ZP), (YB - 4, ZP - 6)],
                        [0, 0, 7.0, 11.0, 7.0, 6.0], seg=14),
                   (-28, 28, YB - 5, YF + 3, ZS - 4, ZP))
    # the mount housing: the prism's nose carried straight down round the mount, flaring from the nose's width to
    # just outside the boss and closing under it on a round bottom, in the nose's own front plane
    housing = K.solid('housing',
                      K.fp([(-26.6, ZS + 6), (26.6, ZS + 6), (32.5, ZS - 12), (32.5, -12), (21, -33), (-21, -33), (-32.5, -12),
                            (-32.5, ZS - 12)], [5, 5, 8, 14, 12, 12, 14, 8], seg=12),
                      K.fp([(-33, YF - 6), (33, YF - 6), (33, YF + 2), (-33, YF + 2)], [0, 0, 9, 9], seg=12),
                      K.fp([(YF - 6, -40), (YF + 2, -40), (YF + 2, ZS + 7), (YF - 6, ZS + 7)], [0, 0, 0, 0]),
                      (-34, 34, YF - 7, YF + 3, -40, ZS + 7))
    # the eyepiece housing (score loop r1, 10/11/2026): the hump's back, 4 mm proud of the rear plate, carried down
    # below the shoulder round the lowered eyepiece, so the eyepiece block sits on the camera and not in the air.
    # 48 mm across (score loop r3), the width of the eyepiece surround in Nikon's D850 rear drawing (research/d850.md),
    # so the hump's back runs straight down into it with no corner of its own (it was 34 mm, narrower than the hump)
    eb = K.solid('eyeBoss',
                 K.fp([(-24, EB_Z0), (24, EB_Z0), (24, ZS + 3), (-24, ZS + 3)], [5, 5, 0, 0]),
                 K.fp([(-24, YB - 4), (24, YB - 4), (24, YB + 6), (-24, YB + 6)], [3, 3, 0, 0]),
                 K.fp([(YB - 4, EB_Z0), (YB + 6, EB_Z0), (YB + 6, ZS + 3), (YB - 4, ZS + 3)], [3, 0, 0, 0]),
                 (-25, 25, YB - 5, YB + 7, EB_Z0 - 1, ZS + 4))
    K.boolean(lower, hump, 'UNION')
    K.boolean(lower, housing, 'UNION')
    K.boolean(lower, eb, 'UNION')
    K.boolean(lower, K.grip_solid('gripCore', 0.0, GRIP), 'UNION')
    # fillets: the prism into the top plate (and the eyepiece block into the back), 3.5 mm; the housing into the front
    # face, 1.5 mm; the eyepiece housing into the rear plate, 2 mm
    K.fillet_concave(lower, lambda x, y, z: abs(x) < 30 and ZS - 4 < z < ZS + 1 and YB - 6 < y < YF + 1, 3.5)
    # (not where the housing's top right meets the grip's inner wall, x > 30 above z ZS - 14: beveling that three-way
    # corner left a non-manifold edge, and the exact booleans after it then opened holes in the shell, score loop r3)
    K.fillet_concave(lower, lambda x, y, z: abs(x) < 35 and YF - 0.5 < y < YF + 0.5 and z < ZS - 2
                     and not (x > 30 and z > ZS - 14), 1.5, segments=3)
    # score loop r6: the visor's lower corners, where the housing's slanted side runs into the hump's cheek, were a
    # sharp ledge (a fin seen from the front and the side); a 4.5 mm round turns it into one surface (no new dimension)
    K.fillet_concave(lower, lambda x, y, z: 24.0 < abs(x) < 34.0 and y > YF - 8.0 and ZS - 3.0 < z < ZS + 9.0
                     and not (x > 30 and z < ZS - 6), 4.5, segments=4)
    K.fillet_concave(lower, lambda x, y, z: abs(x) < 26 and YB - 0.5 < y < YB + 0.5 and EB_Z0 - 2 < z < ZS - 3.5, 2.0, segments=3)
    K.slot_for_dial(lower, 'Z', DIAL_F['center'], DIAL_F['r'], DIAL_F['h'], reach=YG + 6)
    K.slot_for_dial(lower, 'X', DIAL_R['center'], DIAL_R['r'], DIAL_R['h'], reach=YB - 2)
    body = K.finish(lower, bevel=0.9)
    body.data.materials.append(C.mat_satin_black_paint())
    return C.set_component(body, 'shellClosed', 'Camera body (generic DSLR)')


CRADLE = dict(clear=3.5, z_floor=46.5)


def hump_cradle(inner, clear=None, z_floor=None):
    """Score loop r6 (10/11/2026): in the cutaway the hump's hollow was the whole shrunken hump, 27 to 32 mm of air between
    the prism housing and the inner roof at the rear and middle (11 mm at the front), so the pentaprism read as a small
    block rattling in a shell. The hollow now keeps to a pocket that follows the prism: its roofed solid grown by
    `clear` all round (the housing's 1 mm jacket and 2.5 mm of air, the roof's fall to either side included) and carried back
    to the eyepiece housing; above `z_floor` (the shoulder's inner ceiling, 45.8) nothing else is hollow, so the section shows the top
    cover as one casting wrapped round the prism. No new dimension: the prism is the one derived from the screen's depth
    (PRISM), and the hump's outline is unchanged. `inner` is the cutter that hollows the shell; the part of it outside the
    pocket and above the floor is taken out of it, so that part of the shell stays solid."""
    c = CRADLE['clear'] if clear is None else clear
    w = 17.0 + c                                   # the prism is 17 mm either side of the axis (its roof's own width)
    zf = CRADLE['z_floor'] if z_floor is None else z_floor
    sec = pentaprism_section(PRISM['y_rear'], PRISM['z_base'], PRISM['a'], clip_y=PRISM['clip_y'])
    pocket = roof_prism('cradlePrism', offset_convex(sec, c), w, c)
    # back to the eyepiece housing, round the eyepiece tube (11.2 mm in radius on z = ZE) and the exit face
    rear = S.extrude_profile('cradleRear', [(YB - 7.0, EB_Z0 - 2.0), (PRISM['y_rear'] + 3.0, EB_Z0 - 2.0),
                                           (PRISM['y_rear'] + 3.0, ZE + 12.5), (YB - 7.0, ZE + 12.5)], 'x', -14.0, 14.0)
    below = K.cube('cradleBelow', -200.0, 200.0, -200.0, 200.0, -200.0, zf)
    K.boolean(pocket, rear, 'UNION')
    K.boolean(below, pocket, 'UNION')
    K.boolean(inner, below, 'INTERSECT')
    return inner


def seams(body, half=False):
    """The top cover's parting line, round the body just under the shoulders' roll (score loop r5): at z 36 it runs along
    both sides and the rear and is left out where the prism housing's nose, the grip and the eyepiece block run over it."""
    # the rear run starts above the controls' z (the sub-selector's base tops out at 35.7)
    K.seam_groove(body, [(X0, YB), (X1, YB), (X1, YF), (X0 + SLOPE, YF)], [8, 8, 8, 10], 36.0,
                  skip=[(-34.0, 34.0, YF - 8.0, YF + 6.0), (30.0, X1 + 3.0, YF - 20.0, YG + 3.0), (-26.0, 26.0, YB - 6.0, YB + 8.0)], half=half)
    return body


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
    silicon = C.mat_silicon(); pix = C.mat_pixel_grid(); wire = C.mat_wire(); stack_glass = K.mat_cover_glass('filterGlass')
    out = []
    # mirror box: four blackened walls around the light path between the mount and the shutter
    mb = []
    # (no wall on the cut side, x < 0: a real cutaway removes it too, and it would hide the mirror)
    # The box runs from just ahead of the shutter (y = 8) to the mount's own baffle ring at FLANGE - 9 = 37.5, not
    # into the throat: at y = 44 its wall (x = 19.4) and floor (z = -16.9) stood inside the 22 mm throat radius, where
    # a lens's rear sits (review loop 10/10/2026, B-03).
    MB_Y0, MB_Y1 = 8.0, FLANGE - 9.1
    mb_len, mb_mid = MB_Y1 - MB_Y0, (MB_Y0 + MB_Y1) / 2
    for (sx, sy, sz, lx, ly, lz) in ((1.2, mb_len, 36, 20, mb_mid, 1), (41, mb_len, 1.2, 0, mb_mid, -17.5)):
        mb.append(box('mirrorBoxWall', (sx, sy, sz), (lx, ly, lz), baffle, bevel=0.2))
    # the floor's window over the AF module (score loop r2), where the sub-mirror's beam comes down
    C.apply_all_modifiers(mb[1])
    K.boolean(mb[1], K.cube('afWindow', -AF_WIN[0], AF_WIN[0], AF_WIN[1], AF_WIN[2], -20.0, -15.0), 'DIFFERENCE')
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
    # (center 2.7 mm further back than before: at y = 19 its upper edge passed 0.9 mm through the main mirror, B-06)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 16.3, -3.0))
    sm = bpy.context.active_object; sm.scale = (20, 14, 1); bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sm.rotation_euler = (math.radians(50), 0, 0); sm.data.materials.append(mirror_m)
    C.set_component(sm, 'subMirror', 'Sub-mirror (to the AF module)'); out.append(sm)
    out.append(af_module(baffle, glass))
    out += mirror_hinges()
    # focusing screen 25 mm above the mirror center, the same optical distance as the sensor behind it; 25 mm deep
    # (the 23.9 mm frame height plus margin), ending at y = 37 so it stays clear of the throat tube (B-05)
    fs = box('focusingScreen', (36, 25, 1.2), (0, 24.5, 25), glass, bevel=0.2)
    C.set_component(fs, 'focusingScreen', 'Focusing screen'); out.append(fs)
    # the screen's own optical plane (app-frame y): nominal 25mm, the same optical distance from the
    # mirror center as the sensor -- recorded as an extra rather than left for the app to infer from the
    # box's near face (which sat 0.6mm short at y=24.4, Astra-6 finding C1).
    fs['opticalScreenY'] = 25.0
    # pentaprism (review loop 10/10/2026, B-01; roof added in score loop r1, 10/11/2026): the textbook section, a 90
    # degree corner between the entry face (lying on the screen) and the exit face (toward the eyepiece) and 112.5
    # degrees at the other three corners, so the two mirror faces meet at 45 degrees and turn the image through 90
    # degrees. Entry face = the screen's depth; its nose is trimmed where it would reach the mount boss (y > 36.8). The
    # top reflecting face is a 90-degree ROOF: two faces meeting along a ridge in the x = 0 plane, which is what turns
    # the screen's image the right way round left to right (research/dslr.md, "The pentaprism"). Without it the part
    # was a plain pentaprism, which leaves the image reversed.
    sec = pentaprism_section(PRISM['y_rear'], PRISM['z_base'], PRISM['a'], clip_y=PRISM['clip_y'])
    pr = roof_prism('prism', sec, 17.0, 0.0, glass)
    C.set_component(pr, 'prism', 'Roof pentaprism'); out.append(pr)
    # the housing: a 1 mm black jacket over the prism's roof, front and sides, open below (the screen) and behind (the
    # eyepiece window), built from the roofed solid itself. It was a flat 44 x 36 x 1 mm slab floating over the prism
    # (B-02).
    ph = roof_prism('prismHousing', offset_convex(sec, 1.0), 18.0, 1.0, baffle)
    K.boolean(ph, roof_prism('phInner', offset_convex(sec, 0.05), 17.05, 0.05), 'DIFFERENCE')
    K.boolean(ph, box('phOpenBelow', (40, 30, 4), (0, 24.5, 25.0), bevel=0), 'DIFFERENCE')
    K.boolean(ph, box('phOpenBehind', (32, 4, 30), (0, 11.0, 40.0), bevel=0), 'DIFFERENCE')
    # no wall on the cut side (x < 0), as the mirror box: it hid the prism in the cutaway (round 1 re-critique)
    K.boolean(ph, box('phOpenSide', (6, 40, 50), (-20.0, 24.0, 42.0), bevel=0), 'DIFFERENCE')
    C.set_component(ph, 'prismHousing', 'Prism housing'); out.append(ph)
    out += eyepiece_optics()
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
    # Score loop r1 (10/11/2026): each blade is its own node under the curtain, so a curtain folds into a compact stack
    # (blades 0.3 mm apart) where it waits, as real blades do, instead of standing a full frame-height above or below
    # the gate. Standing open, the rear curtain reached z = 36 and crossed both the lowered eyepiece path and the raised
    # mirror. At rest the front curtain covers the gate and the rear curtain waits folded above it (z 11.95 to 21.75).
    g0, bh, n = -SENSOR_H / 2, 8.9, 4
    pitch = (SENSOR_H - bh) / (n - 1)
    for name, bottoms, label in (
            ('shutterCurtainFront', [g0 + i * pitch for i in range(n)], 'Shutter front curtain'),
            ('shutterCurtainRear', [SENSOR_H / 2 + i * STACK_PITCH for i in range(n)], 'Shutter rear curtain')):
        cur = bpy.data.objects.new(name, None); C.link(cur); C.set_component(cur, name, label)
        for i, zb in enumerate(bottoms):
            b = box(f'{name}{i}', (38, 0.25, bh), (0, 3.6 + i * 0.3, zb + bh / 2), paint, bevel=0.05)
            C.apply_all_modifiers(b)
            b.parent = cur
        out.append(cur)
    # the sensor stack: filters (2.0 mm, body.json), the pixel array at the sensor plane, the die and its carrier
    fst = box('filterStack', (40, 2.0, 30), (0, 1.2, 0), stack_glass, bevel=0.1)
    C.set_component(fst, 'filterStack', 'Filter stack (IR cut, cover glass)'); out.append(fst)
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
    # the battery standing in the grip, 3 mm above the base (score loop r1): the cutaway read as a hollow box
    out.append(K.battery((62.5, 26.0, ZB + 3.0 + K.BATTERY_MM[2] / 2)))
    return out


def af_module(baffle, _glass=None):
    """The phase-detect AF module under the mirror-box floor (score loop r2, 10/11/2026). The sub-mirror sends the
    light that passes the main mirror's half-silvered center down to a floor-mounted AF module (US 8,979,400,
    research/dslr.md); the module re-images that light through a field lens, a separator mask and pairs of separator
    lenses onto pairs of line sensors, whose two images' spacing gives the focus error (US 8,213,785; research/dslr.md,
    "The AF module"). Schematic, like the eyepiece optics: no maker publishes the D850 module's dimensions, so its
    parts are drawn to fit the beam, not taken from a drawing. The beam: the sub-mirror (20 x 14 mm at 50 degrees about
    y 16.3, z -3) turns the axial light to (0, 0.17, -0.98), so it reaches the floor (z -16.9) between y 13.3 and 24.2
    and x -10 to 10; the window and the field lens cover that, and the module hangs below the floor, clear of the
    mirror's swing (which turns up, about its top edge)."""
    lens_glass = K.mat_cover_glass('afLensGlass')
    sensor = C.mat_silicon('afLineSensor')
    x, y0, y1 = AF_WIN
    yc = (y0 + y1) / 2
    parts = []
    # the housing: a black box open at the top under the window, its walls 1 mm, and no wall on the cut side (x < 0),
    # as the mirror box, so the cutaway shows the lenses and sensors inside
    hous = box('afHousing', (2 * x + 2.0, y1 - y0 + 2.0, 11.0), (0, yc, -18.1 - 5.5), baffle, bevel=0.3)
    C.apply_all_modifiers(hous)
    K.boolean(hous, K.cube('afHousingInner', -x - 5.0, x, y0, y1, -28.6, -17.0), 'DIFFERENCE')
    parts.append(hous)
    # the field lens in the window, just under the floor's top face
    parts.append(box('afFieldLens', (2 * x - 0.4, y1 - y0 - 0.4, 1.0), (0, yc, -18.6), lens_glass, bevel=0.3))
    # the separator mask and the separator lens pairs (one pair for each direction of the cross sensor)
    mask = box('afSeparatorMask', (2 * x - 0.4, y1 - y0 - 0.4, 0.4), (0, yc, -22.4), baffle, bevel=0)
    C.apply_all_modifiers(mask)
    for (dx, dy) in ((-3.0, 0.0), (3.0, 0.0), (0.0, -3.0), (0.0, 3.0)):
        hole = cyl('afMaskHole', 1.2, 2.0, (dx, yc + dy, -22.4), 'Z', bevel=0)
        K.boolean(mask, hole, 'DIFFERENCE')
        parts.append(cyl('afSeparatorLens', 1.4, 1.2, (dx, yc + dy, -23.4), 'Z', lens_glass, verts=32, bevel=0.2))
    parts.append(mask)
    # the line sensors on their chip at the module's floor: two pairs, crossed
    parts.append(box('afSensorChip', (14.0, 10.0, 0.6), (0, yc, -27.9), C.mat_ceramic('afSensorCarrier'), bevel=0.1))
    for (sx, sy) in ((9.0, 0.8), (0.8, 7.0)):
        parts.append(box('afLineSensor', (sx, sy, 0.1), (0, yc, -27.55), sensor, bevel=0))
    for p in parts:
        C.apply_all_modifiers(p)
    m = C.join(parts, 'afModule')
    return C.set_component(m, 'afModule', 'Phase-detect AF module (schematic: field lens, separator lenses, line sensors)')


def pentaprism_section(y_rear, z_base, a, clip_y=None, t_frac=0.9):
    """The textbook pentaprism's (y, z) section, counterclockwise: entry face A-B along the base (length a, from
    y_rear forward), the faces turning 67.5, 135, 202.5 and 270 degrees from it (interior angles 90 at A, 112.5 at
    the rest), so the exit face E-A is vertical at the rear and the mirror faces B-C and D-E meet at 45 degrees. The
    non-optical face C-D is t_frac * a long. clip_y trims everything ahead of that depth (a flat nose)."""
    d = [math.radians(x) for x in (0, 67.5, 135, 202.5)]
    t = t_frac * a
    s = (a + t * math.cos(d[2])) / -(math.cos(d[1]) + math.cos(d[3]))
    pts, p = [], Vector((y_rear, z_base))
    for ang, ln in zip(d, (a, s, t, s)):
        pts.append(tuple(p)); p = p + Vector((math.cos(ang), math.sin(ang))) * ln
    pts.append(tuple(p))           # E, straight above A: the exit face E-A is a in height
    if clip_y is None:
        return pts
    out = []
    for i in range(len(pts)):      # one Sutherland-Hodgman pass against y <= clip_y
        p, q = Vector(pts[i - 1]), Vector(pts[i])
        pin, qin = p.x <= clip_y, q.x <= clip_y
        if pin != qin:
            k = (clip_y - p.x) / (q.x - p.x)
            out.append(tuple(p + (q - p) * k))
        if qin:
            out.append(tuple(q))
    return out


def offset_convex(pts, dist):
    """A convex counterclockwise polygon [(y, z), ...] grown outward by dist."""
    n = len(pts); lines = []
    for i in range(n):
        p, q = Vector(pts[i]), Vector(pts[(i + 1) % n])
        tv = (q - p).normalized()
        lines.append((p + Vector((tv.y, -tv.x)) * dist, tv))
    out = []
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        k = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        out.append(tuple(p1 + t1 * k))
    return out


def prism_solid(name, section, half_w, mat=None):
    """The (y, z) section extruded across x = -half_w .. half_w, flat shaded."""
    o = S.extrude_profile(name, section, 'x', -half_w, half_w)
    if mat:
        o.data.materials.append(mat)
    return o


def halfspace_cut(obj, point, normal):
    """Remove everything on the side of the plane through `point` that `normal` points to."""
    n = Vector(normal).normalized()
    me = bpy.data.meshes.new('halfspace')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1000.0)
    M = Matrix.Translation(Vector(point) + n * 500.0) @ n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bm.transform(M)
    bm.to_mesh(me); bm.free()
    cutter = bpy.data.objects.new('halfspace', me); C.link(cutter)
    return K.boolean(obj, cutter, 'DIFFERENCE')


def roof_prism(name, section, half_w, grow, mat=None):
    """The pentaprism (y, z) section extruded across x = -half_w .. half_w, with its top reflecting face (the face
    that ends at the top of the exit face) replaced by a 90-degree roof: two faces meeting along a ridge in the x = 0
    plane that lies in the original face, each falling 45 degrees to the sides. `grow` moves the roof faces outward
    (for a jacket made from the same solid)."""
    o = prism_solid(name, section, half_w, mat)
    # the top reflecting face D-E of the untrimmed section (the trimmed one has the same face)
    full = pentaprism_section(PRISM['y_rear'], PRISM['z_base'], PRISM['a'])
    D, E = Vector(full[3]), Vector(full[4])
    d = (E - D).normalized()
    nin = Vector((-d.y, d.x))                       # inward normal of D-E (the section runs counterclockwise)
    for sx in (1, -1):
        out = Vector((sx, -nin.x, -nin.y)).normalized()     # the roof face's outward normal (x, y, z)
        halfspace_cut(o, Vector((0.0, E.x, E.y)) + out * grow, out)
    return o


def mirror_hinges():
    """Hinge markers the app reads to raise the mirror (score loop r1, 10/11/2026, Reed's decision 2). Empties, so they
    export as plain nodes, in this file's frame (the exporter turns them into the app's frame with everything else):
    - mirrorHinge: the main mirror's top edge, where US 7,824,114 puts its rotation axis (research/dslr.md), with
      liftDeg, the turn that brings the mirror from 45 degrees to flat;
    - mirrorHingeUp: where that hinge ends up when the mirror is raised. A plain 45-degree turn about the top edge left
      the mirror flat at z = 12, through the throat and across the light cone (this model's mirror box is shallower
      than a real one: the screen's 25 mm height above the axis is set by the mirror's 25 mm distance from the
      sensor), so the hinge also rides up and back to put the raised mirror flat under the screen, MIRROR_UP;
    - subMirrorHinge: the sub-mirror's top end, where it meets the main mirror's back, with foldDeg, the turn that
      folds it flat against that back before the lift (research/dslr.md: it folds against the main mirror's rear face
      and retracts with it).
    src/scene/rig-exposure.ts (mirrorPhases) sequences the three; src/scene/bodies/blender-glb.test.ts checks the
    path stays clear of the shutter, the screen, the throat and the light cone."""
    c = math.sqrt(0.5)
    top = Vector((0.0, 25.0 - 17.0 * c, 17.0 * c))           # the mirror's 34 mm face at 45 degrees about (y 25, z 0)
    sub_top = Vector((0.0, 16.3 + 7.0 * math.cos(math.radians(50)), -3.0 + 7.0 * math.sin(math.radians(50))))
    out = []
    for name, loc, props in (('mirrorHinge', top, {'liftDeg': 45.0}),
                             ('mirrorHingeUp', Vector((0.0, MIRROR_UP['y'], MIRROR_UP['z'])), {}),
                             ('subMirrorHinge', sub_top, {'foldDeg': 85.0})):
        e = bpy.data.objects.new(name, None); C.link(e)
        e.location = loc; e.empty_display_size = 2.0
        for k, v in props.items():
            e[k] = v
        out.append(e)
    return out


def eyepiece_optics():
    """The viewfinder's optics behind the prism (score loop r1, 10/11/2026): a blackened tube on the eyepiece axis from
    the prism's exit face to the eyecup, holding a three-element eyepiece group, as the mirrorless body's EVF does.
    Schematic: no maker publishes the D850 eyepiece's prescription, so the elements are drawn, not designed (sizes fit
    the 11.5 mm bore; spacing is the model's own). Built twice, whole ('eyepieceOptics', the outside view, seen through
    the eyecup) and as the x >= 0 half ('eyepieceOpticsCut', the cutaway), like the lens barrels."""
    baffle = C.mat_matte_black_baffle('eyepieceTubeBlack')
    lens_glass = K.mat_cover_glass('viewfinderLensGlass')
    y_front, y_back = PRISM['y_rear'] - 0.6, YB - EYE_BLOCK
    tube = C.revolve('eyepieceTube', [(10.4, y_back), (11.2, y_back), (11.2, y_front), (10.4, y_front)],
                     C.ring_thetas(72), True, baffle, sharp_deg=30)
    tube.location = (0, 0, ZE)
    parts = [tube]
    for i, (y, r, t) in enumerate(((6.0, 9.4, 3.5), (YB + 10.0, 10.0, 4.5), (YB + 4.0, 10.0, 3.0))):
        parts.append(cyl(f'eyepieceLens{i}', r, t, (0, y, ZE), 'Y', lens_glass, verts=64, bevel=0.8))
    halves = [K.half_x(p, p.name + 'Cut') for p in parts]
    whole = C.join(parts, 'eyepieceOptics')
    C.set_component(whole, 'eyepieceOptics', 'Viewfinder eyepiece lenses (schematic)'); whole['cutaway'] = 'full'
    half = C.join(halves, 'eyepieceOpticsCut')
    C.set_component(half, 'eyepieceOpticsCut', 'Viewfinder eyepiece lenses (schematic)'); half['cutaway'] = 'half'
    return [whole, half]


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
    # (score loop r3) centered at x -37.5 in the D850 top drawing, 17 mm from the port-side end, 13 mm in radius
    rx, ry = -37.5, 2.0
    ring = C.knurl_dial('releaseModeDial', 13.0, 5.0, 72, 0.5, knurl, top_mat=paint, axis='Z', loc=(rx, ry, ZS - 0.5))
    cap = C.disc('rmCap', 11.1, 0.7, paint, axis='Z', loc=(rx, ry, ZS + 4.5), ch=0.2, seg=72)
    keys = []
    for k in range(4):
        a0 = math.radians(90 * k + 4)
        key = C.revolve(f'rmKey{k}', [(3.6, 0), (10.4, 0), (10.4, 0.8), (10.0, 1.15), (4.0, 1.15), (3.6, 0.8)],
                        C.arc(a0, a0 + math.radians(82), 20), False, knurl, sharp_deg=35)
        C.orient(key, 'Z', (rx, ry, ZS + 5.2))
        keys.append(key)
    hub = C.disc('rmHub', 3.1, 1.0, paint, axis='Z', loc=(rx, ry, ZS + 5.2), ch=0.2, seg=32)
    lock = C.disc('rmLock', 2.3, 2.3, knurl, axis='Z', loc=(rx + 3.0, 20.5, ZS - 0.8), ch=0.3, dome=0.2, seg=32)
    # the dial stands on a raised collar where the shoulder rolls away under it
    plinth = C.disc('rmPlinth', 14.0, 5.0, paint, axis='Z', loc=(rx, ry, ZS - 5.0), ch=0.6, seg=96)
    rmd = C.join([ring, cap, hub, lock, plinth] + keys, 'releaseModeDial')
    dials.append(C.set_component(rmd, 'releaseModeDial', 'Release-mode dial'))
    # right shoulder: the top LCD; on the grip, the shutter button in its power collar on the forward facet, and the
    # three buttons behind it
    # x positions from the D850 top drawing scaled by the 146 mm width (score loop r3): the LCD window 31.8 to 77.0
    # (kept clear of the prism's root here, 38 to 76), the shutter 67.8, the movie-record, ISO and exposure-compensation
    # buttons 54.9, 64.7 and 75.4
    K.top_lcd(57.0, -5.0, 38.0, 25.0, ZS, paint, lcd, 'Top status LCD')
    K.shutter_assembly(GRIP, 67.8, 41.5, knurl, paint, chrome)
    for i, x in enumerate((54.9, 64.7, 75.4)):
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
    K.leather_front(X0 + SLOPE + 4.0, -33.5, ZB + 7.0, ZS - 8.0, YF, BOSS_R, rubber)
    # rear: the tilting screen and its hinge; the eyepiece, a round cup in a squared rubber block; AF-ON, the
    # sub-selector and the multi-selector with its lock lever by the thumb; six buttons down the left; the thumb pad
    # the picture: Nikon's D850 specifications give an "8-cm/3.2-in., approx. 2359k-dot (XGA)" monitor, and XGA is
    # 1024 x 768, so 4:3: 65.0 x 48.8 mm (research/d850.md); the frame and its opening are the model's own
    # the frame's place from the D850 rear drawing (score loop r3): x -34.4 to 45.0, top edge at z 22.2
    K.screen_unit(5.3, -10.2, 80.0, 64.0, YB, paint, screen, 'Rear screen (tilting, 3.2 in.)',
                  active=K.screen_diag_mm(3.2, 4 / 3))
    block = []
    for k, (y, a, b) in enumerate(((YB - 3.5, 15.0, 13.5), (YB - 4.9, 14.8, 13.3), (YB - EYE_BLOCK - 0.2, 14.2, 12.7))):
        ring = S.superellipse(0, ZE, a, b, n=4.2, seg=48)
        block.append([(x, y, z) for (x, z) in ring])
    sq = K.tidy_loft_caps(S.loft('eyecupBlock', block))
    sq.data.materials.append(paint)
    C.apply_all_modifiers(sq)
    # bored on the eyepiece axis for the eyepiece tube (it was solid, and in the cutaway hid the light path)
    K.boolean(sq, K.cylinder_y('eyecupBore', 0, ZE, EYE_BORE, YB - EYE_BLOCK - 2.0, YB + 1.0), 'DIFFERENCE')
    e0, e1 = YB - EYE_BLOCK, YB - EYE_STAND
    cup = C.revolve('eyecupRing', [(9.6, e0), (12.6, e0), (12.9, e0 + (e1 - e0) * 0.45), (12.3, e0 + (e1 - e0) * 0.85), (11.2, e1),
                                   (10.2, e0 + (e1 - e0) * 0.85), (9.6, e0 + (e1 - e0) * 0.55)], C.ring_thetas(72), True,
                    C.mat_rubber('EyecupRubber', textured=False), sharp_deg=50)   # smooth molded rubber (B-07)
    cup.location = (0, 0, ZE)
    # the cutaway's half (x >= 0), so the section shows the bore and the tube running through it
    halves = [K.half_x(sq, 'eyecupBlockCut'), K.half_x(cup, 'eyecupRingCut')]
    eyecup = C.join([sq, cup], 'eyecup')
    C.set_component(eyecup, 'eyecup', 'Viewfinder eyepiece and eyecup'); eyecup['cutaway'] = 'full'
    half = C.join(halves, 'eyecupCut')
    C.set_component(half, 'eyecupCut', 'Viewfinder eyepiece and eyecup'); half['cutaway'] = 'half'
    # 9.5 mm: inside the cup's 9.6 mm bore (at 9.8 mm the glass ran through the rubber)
    C.disc('eyepieceGlass', 9.5, 0.4, glass_eye, axis='-Y', loc=(0, YB - EYE_BLOCK - 0.4, ZE), ch=0.1, seg=64)
    # Score loop r3 (10/11/2026): every rear control's center is where Nikon's D850 rear drawing ("Parts of the
    # Camera", research/d850.md) puts it, scaled by the 146 x 124 mm envelope (0.3489 mm per pixel across, 0.3461 up),
    # not by the model's own screen frame as in round 2: AF-ON (51.6, 41.2), the sub-selector (43.9, 30.5), the
    # multi-selector (58.7, 3.6), i (52.1, -19.0), info (64.7, -16.2), the live-view selector (57.5, -30.2); the left
    # column at x -43.4 (Fn2 -42.4): MENU z 23.5, protect / help 12.4, zoom in 0.4, zoom out -11.6, OK -23.2, Fn2
    # -33.7; playback and delete (-42.4 / -30.7, 38.4).
    K.af_on(51.6, 41.2, YB)
    K.sub_selector(43.9, 30.5, YB, knurl, paint)
    K.multi_selector(58.7, 3.6, YB, knurl, paint, lock=True)
    for i, (x, z) in enumerate(((52.1, -19.0), (64.7, -16.2))):
        K.button(f'infoButton{i}', 3.4, 1.3, knurl, x, YB, z)
    lv = [C.disc('lvRing', 5.4, 0.9, paint, axis='-Y', loc=(57.5, YB, -30.2), ch=0.25, seg=48),
          C.disc('lvKey', 3.6, 1.6, knurl, axis='-Y', loc=(57.5, YB - 0.8, -30.2), ch=0.3, dome=0.15, seg=40)]
    C.set_component(C.join(lv, 'lvButton'), 'lvButton', 'Live-view button and selector')
    for i, (x, z, r) in enumerate(((-43.4, 23.5, 4.1), (-43.4, 12.4, 4.1), (-43.4, 0.4, 4.1), (-43.4, -11.6, 4.1),
                                   (-43.4, -23.2, 4.1), (-42.4, -33.7, 3.4))):
        K.button(f'rearButton{i}', r, 1.9 if r > 4 else 1.5, knurl, x, YB + 0.5, z)
    for i, x in enumerate((-42.4, -30.7)):
        K.button(f'playButton{i}', 4.1, 1.4, knurl, x, YB, 38.4)
    # the thumb rest, between the info button and the memory-card door's edge (x 79.4 in the drawing)
    K.leather_rear(69.0, 79.4, -36.0, ZS - 17.0, YB, rubber)
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
    for attr, val in (('shadow_ray_count', 4), ('shadow_step_count', 16), ('light_threshold', 0.001)):   # as studio.py (score loop r4)
        try:
            setattr(sc.eevee, attr, val)
        except AttributeError:
            pass
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
    bpy.ops.mesh.primitive_plane_add(size=60000, location=(0, 0, ZB - 0.1))   # its edge sits near the horizon (B-18)
    floor = bpy.context.active_object; floor.name = 'floor'
    m = bpy.data.materials.new('floor'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.03, 0.032, 0.036, 1)
    b.inputs['Roughness'].default_value = 0.42
    floor.data.materials.append(m)


def shoot(outdir, prefix, views):
    from mathutils import Vector
    sc = bpy.context.scene
    cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 85; cam_d.clip_start = 1; cam_d.clip_end = 100000
    cam = bpy.data.objects.new('cam', cam_d); C.link(cam); sc.camera = cam
    for name, loc, tgt, *lens in views:
        cam_d.lens = lens[0] if lens else 85
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        C.render_still(os.path.join(outdir, f'{prefix}-{name}.png'))


def custom_views():
    """--views FILE.json: {"closed": [[name, [x, y, z], [x, y, z], lens_mm?], ...], "cut": [...]} replaces the stock views (review
    close-ups; the file is the caller's, the model does not depend on it)."""
    import json
    p = arg('--views')
    return json.load(open(p)) if p else None


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
    # the shrink is about the shell's center, so the grip's inner wall by the finger channel, a wall facing -x right
    # of that center, moved out toward the channel and met it: a patch with no thickness, open after triangulation
    # (score loop r3). The hollow keeps out of a 2.5 mm skin of the grip round the channel.
    K.keep_wall(inner, GRIP, 2.5)
    hump_cradle(inner)
    K.boolean(cut, inner, 'DIFFERENCE', 'MANIFOLD')
    # the eyepiece's light passage through the rear wall, on the eyepiece axis, into the hollow (bored after the
    # hollowing: bored before, the shrunken copy's bore sat 0.9 mm off this one and left a sliver and a plug)
    K.boolean(cut, K.cylinder_y('eyeBoreCut', 0, ZE, EYE_BORE + 0.4, YB - 6, YB + 9), 'DIFFERENCE', 'MANIFOLD')
    wedge = box('cutWedge', (90, 130, 150), (-45, 15, 17), bevel=0)   # everything at x < 0
    K.boolean(cut, wedge, 'DIFFERENCE', 'MANIFOLD')
    print('CUT verts', len(cut.data.vertices), 'closed verts', len(closed.data.vertices))
    cut.data.materials.clear(); cut.data.materials.append(closed.data.materials[0])
    C.finalize_uvs([cut])
    seams(cut, half=True)
    C.set_component(cut, 'shellCut', 'Camera body, cut away')
    # open the closed shell behind the mount, so the mirror, the shutter and the stack show through the throat (B-17):
    # a bore just inside the throat tube (r 26.2) and the mirror box's own chamber, back to just behind the sensor
    # (and the eyepiece's bore first, a blind hole behind the eyecup, so the eyepiece looks into its tube, not onto
    # paint; open_chamber re-projects the UVs after both)
    seams(closed)
    K.boolean(closed, K.cylinder_y('eyeBore', 0, ZE, EYE_BORE + 0.4, YB - 6, YB + 9), 'DIFFERENCE', 'MANIFOLD')
    K.open_chamber(closed, 26.0, FLANGE - 9.6, YF + 3.0, (-21.2, 21.2, -1.6, FLANGE - 9.0, -18.7, 25.95))
    cut.hide_render = True
    # hierarchy: 'body' holds everything, 'topDials' holds the dials
    top = bpy.data.objects.new('topDials', None); C.link(top); top['component'] = 'topDials'; top['label'] = 'Top-plate dials'
    for d in dials:
        d.parent = top
    root = bpy.data.objects.new('body', None); C.link(root); root['component'] = 'body'; root['label'] = 'Camera body (generic DSLR)'
    for o in list(bpy.context.scene.objects):
        if o is not root and o.parent is None and o.type in ('MESH', 'EMPTY') and o.name != 'floor':
            o.parent = root
    print('CLEAN', K.clean_degenerate(), 'degenerate faces removed', '; corner normals held to 20 degrees of their face (faces over 20 mm2):', K.FLAT_STATS)
    # boundary and non-manifold edges of the two shells, which must both be (0, 0) (score loop r3)
    print('WATERTIGHT shellClosed', K.open_edges(closed), 'shellCut', K.open_edges(cut))
    # the gap between the screen (its hinge barrel, the highest part) and the eyepiece housing and eyecup above it
    # (score loop r4: it was 0.3 mm to the housing)
    def zmax(o):
        return max((o.matrix_world @ Vector(c)).z for c in o.bound_box)
    hinge_top = max(zmax(bpy.data.objects[n]) for n in ('screenHinge', 'screenFrame') if n in bpy.data.objects)
    housing_low = min(v.co.z for v in closed.data.vertices if v.co.y < YB - 1.0 and abs(v.co.x) < 30 and v.co.z > 5)
    cup_low = min((bpy.data.objects['eyecup'].matrix_world @ Vector(c)).z for c in bpy.data.objects['eyecup'].bound_box)
    print('CLEARANCE screen top z %.2f, eyepiece housing underside z %.2f (gap %.2f), eyecup underside z %.2f (gap %.2f)'
          % (hinge_top, housing_low, housing_low - hinge_top, cup_low, cup_low - hinge_top))
    print('TIDY merged materials, renamed meshes', C.tidy_for_export())
    exp = arg('--export')
    if exp:
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.context.scene.objects:
            if o.type in ('MESH', 'EMPTY'):
                o.select_set(True)
        cut.hide_render = False
        restore = C.detach_normal_maps(os.path.join(os.path.dirname(exp), 'textures'))
        C.export_glb(exp, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_extras=True, export_materials='EXPORT',
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  # Draco (integration r1: 18-bit positions, ~0.0006 mm steps; 14 bits collapsed small faces to zero area) over the
                                  # ~150 mm body, far under a pixel on any screen (the GLB was 3.07 MB raw, score loop r1)
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                                  export_draco_position_quantization=18, export_draco_normal_quantization=10,
                                  export_draco_texcoord_quantization=12)
        cut.hide_render = True
        restore()
        print('EXPORTED', exp, round(os.path.getsize(C.long_path(exp)) / 1048576, 2), 'MB')
    # the interior stays visible in the closed-shell renders: the solid shell hides all of it except what shows through
    # the throat (the mirror), as on the real camera; hiding it left the throat a flat black void (B-13)
    out = arg('--render')
    if out:
        os.makedirs(C.long_path(out), exist_ok=True)
        for o in bpy.context.scene.objects:          # whole parts outside, cut halves in the cutaway (as the app)
            if o.get('cutaway') == 'half':
                o.hide_render = True
        studio()
        cv = custom_views()
        shoot(out, 'dslr2', cv['closed'] if cv else [
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
        for o in bpy.context.scene.objects:
            if o.get('cutaway'):
                o.hide_render = o.get('cutaway') == 'full'
        for o in bpy.context.scene.objects:          # outside details on the removed half go with it
            if o.type == 'MESH' and o not in keep and o.name not in ('floor', 'mount', 'mountLugs', 'contacts', 'mountBoss', 'mountThroat'):
                cx = sum((o.matrix_world @ Vector(c)).x for c in o.bound_box) / 8
                if cx < -2:
                    o.hide_render = True
        shoot(out, 'dslr2', cv['cut'] if cv else [('cutaway', (-470, 380, 200), (0, 14, 18))])   # framed to keep the shoe in (B-14)


main()
