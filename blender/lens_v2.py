"""The seven lineup lenses, modeled from their published exteriors and the engine's own prescriptions (lead, 09/29/2026).

Every lens is a lathe: the barrel is one closed (r, y) profile revolved about the optical axis, so it has a real wall and
a bore; the rings are revolved too, their ribs cut into the profile as it goes round. Inside, each glass element is
lathed from its two surfaces' curvature, conic and asphere terms (blender/data/<id>-optics.json, exported from the
engine at infinity focus), held in a black cell, with the iris at the stop. Every revolved part also has a half
version (x >= 0) with its cross-section capped, which is the cutaway.

Sources: outside dimensions, filter, mount and controls from data/hardware/lens-exteriors.json and mounts.json; the
layout along the barrel (where each ring, window and switch sits) is read from the products' own photographs, since
no maker publishes it (lens-exteriors.json's openProblems says the same). Generic and unbranded: no maker names or
logos, only the focal length and aperture a lens carries on its barrel.

Frame: common.py's, as the bodies (mm, Blender Y = optical axis with the sensor at 0 and the mount face at
+flange, so the lens sits exactly where it mounts; glTF +Y-up export maps Y to the app's -z).

  blender --background --factory-startup --python blender/lens_v2.py -- --lens s35 [--render DIR] [--export PATH]
          [--on-body public/models/dslr.glb] [--res-pct 50] [--samples 32]
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import common as C
import silhouette as S
import studio as ST

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LENS = arg('--lens', 's35')
OPT = json.load(open(os.path.join(ROOT, 'blender/data', f'{LENS}-optics.json'), encoding='utf-8'))
EXT = json.load(open(os.path.join(ROOT, 'data/hardware/lens-exteriors.json'), encoding='utf-8'))['lenses'][LENS]
MOUNT = json.load(open(os.path.join(ROOT, 'data/hardware/mounts.json'), encoding='utf-8'))['mounts'][EXT['mount']]
V = lambda f: f['v'] if isinstance(f, dict) else f
FLANGE = V(MOUNT['flangeMm'])
THROAT = V(MOUNT['throatMm'])
LUGS = V(MOUNT['lugs'])
CONTACTS = V(MOUNT['contacts'])
L = V(EXT['lengthMm'])
D = V(EXT['diameterMm'])
FILTER = V(EXT['filterMm'])
FRONT_THREAD = LENS not in ('n500fl', 'z800')          # the two big teles take a drop-in filter at the rear

# ---- layout along the barrel (u = mm in front of the mount face), read from product photographs -------------------
# profile: the outer radius at stations along u (linear between them); rings recess into it and fill it back flush.
# ring: (u0, u1, ribs, depth, kind) kind 'rubber' | 'knurl'; window: (u0, u1, centerDeg, halfDeg); switch panel:
# (u0, u1, sliders); collar: (u0, u1); dropin: (u0, u1); hood: (u0) bayonet from there to the front; text: (u, size).
LAYOUT = {
    's35': dict(profile=[(1.6, 31.0), (6, 31.5), (7.5, 34.0), (16, 34.5), (18, 37.8), (86, 38.5), (88, 38.0), (94, 38.0)],
                focus=(47, 80, 150, 0.55, 'rubber'), window=(24, 38, 20, 32), switch=(8.5, 15.5, 1), hood=88,
                text=(42.5, 2.4), wall=2.4, aperture_lever=True),
    'n50': dict(profile=[(1.6, 30.5), (8, 30.8), (9.5, 33.5), (12, 34.0), (14, 35.8), (48, 36.0), (49, 35.5), (52.5, 35.5)],
                focus=(33, 47.5, 120, 0.45, 'rubber'), window=(16, 26, 18, 28), switch=(2.5, 8, 1), hood=48.5,
                text=(29.5, 2.2), wall=2.0, aperture_lever=True),
    'n500': dict(profile=[(1.6, 33.0), (10, 33.5), (12, 40.0), (48, 40.0), (54, 45.5), (160, 46.0), (170, 53.0),
                          (231, 53.0), (233, 52.4), (237, 52.4)],
                 # no collar: Nikon supplies none for the 500 PF and makes none for it (lens-exteriors.json, R1-FID-H)
                 focus=(115, 158, 110, 0.9, 'rubber'), window=(100, 112, 16, 22), switch=(60, 92, 3),
                 hood=226, text=(185, 4.5), wall=2.2),
    'n500fl': dict(profile=[(1.6, 34.0), (10, 35.0), (12, 44.0), (96, 44.0), (100, 47.0), (150, 47.0), (152, 55.0),
                            (215, 55.0), (262, 70.0), (378, 70.0), (380, 69.4), (387, 69.4)],
                   focus=(170, 212, 120, 1.0, 'rubber'), window=(155, 166, 14, 18), switch=(104, 140, 3), collar=(60, 90),
                   dropin=(24, 48), hood=372, text=(300, 6.5), wall=3.0, fn=(219, 231, 4), foot='full'),
    'z35': dict(profile=[(1.6, 31.5), (6, 32.0), (8, 34.0), (26, 34.3), (28, 36.5), (80, 36.5), (81, 36.0), (86, 36.0)],
                focus=(43, 76, 120, 0.4, 'rubber'), switch=(12, 22, 1), hood=81, text=(34, 2.2), wall=2.2,
                ring_label='Control ring (manual focus by default; can be set to aperture, ISO or exposure compensation)'),
    'm50': dict(profile=[(1.6, 31.5), (6, 32.0), (8, 35.5), (26, 35.8), (28, 38.0), (80.5, 38.0), (81.5, 37.4), (86.5, 37.4)],
                focus=(44, 77, 120, 0.4, 'rubber'), switch=(12, 22, 1), hood=81.5, text=(35, 2.2), wall=2.2,
                ring_label='Control ring (manual focus by default; can be set to aperture, ISO or exposure compensation)'),
    # z800: the rear collar is 43.5 mm in radius, not 44 (score loop r5, 10/11/2026): at 44 it ran 0.37 mm into the Z8
    # grip's inner flank (x 43.6). Like every station of this profile it is read from photographs (layout assumed).
    'z800': dict(profile=[(1.6, 34.0), (10, 35.0), (12, 43.5), (100, 43.5), (104, 49.0), (228, 49.0), (232, 52.0),
                          (250, 52.0), (282, 70.0), (372, 70.0), (374, 69.4), (385, 69.4)],
                 focus=(180, 226, 100, 0.7, 'rubber'), control=(156, 170, 110, 0.35, 'knurl'), switch=(110, 150, 3),
                 collar=(62, 94), dropin=(26, 52), hood=374, text=(310, 6.5), wall=3.0, fn=(236, 248, 4), foot='full'),
}[LENS]

SEG = 192
# interior parts' segments round the axis (score loop r4, 10/11/2026): the barrel and rings keep SEG, whose silhouette
# is what shows; the glass elements and cells sit behind it, and 72 sides on the widest rim (r 70 mm) leave a 0.04 mm
# sagitta, under the export's 0.02-0.04 mm position step. At 112 the 24 elements of the big telephotos were 235 of the
# model's 329 thousand triangles.
SEG_GLASS = 72
SEG_CELLS = 64
# the phone variant (score loop r5, 10/11/2026), `--lite`, exported beside the full file as <id>.lite.glb: half the segments
# round the axis (96 on the barrel, 40 on the glass, 32 on the cells). The widest rim's sagitta is then 0.2 mm, a third of a
# pixel on a phone's screen, and the triangles fall by about 40%. The ribs, the parts and their names are the same.
LITE = '--lite' in argv
if LITE:
    SEG, SEG_GLASS, SEG_CELLS = 96, 40, 32
report = {'lens': LENS, 'clipped': [], 'notes': []}
MOUNT_TOP = min(1.7, LAYOUT['profile'][0][0])      # the mount flange's front face: where the barrel starts


# ---- materials ----------------------------------------------------------------------------------------------------
def mat_principled(name, color, rough, metal=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

def init_materials():
    """After clear_scene(), which removes every material."""
    global PAINT, RUBBER, KNURL, CHROME, GOLD, BAFFLE, GLASS, PF_GLASS, WINDOW, ENGRAVE, BLADE
    PAINT = C.mat_satin_black_paint('barrelPaint', textured=False)
    RUBBER = C.mat_rubber('ringRubber', textured=False)
    KNURL = mat_principled('knurlPlastic', (0.018, 0.018, 0.02), 0.58)
    CHROME = C.mat_chrome('mountChrome')
    GOLD = C.mat_gold_contact('lensContacts')
    BAFFLE = C.mat_matte_black_baffle('lensBaffle')
    GLASS = C.mat_glass('lensGlass', 1.62, (0.965, 0.985, 0.975, 1.0))
    PF_GLASS = C.mat_glass('pfLayer', 1.56, (0.99, 0.97, 0.9, 1.0))
    WINDOW = mat_principled('windowGlass', (0.9, 0.92, 0.95), 0.04)
    WINDOW.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.14   # a thin clear window over the scale
    try:
        WINDOW.surface_render_method = 'BLENDED'
    except AttributeError:
        WINDOW.blend_method = 'BLEND'
    ENGRAVE = mat_principled('engraving', (0.62, 0.62, 0.6), 0.55)
    BLADE = mat_principled('irisBlade', (0.02, 0.02, 0.022), 0.32, metal=0.6)


# ---- geometry helpers ---------------------------------------------------------------------------------------------
def revolve(name, prof, thetas, closed, mat=None, prof_fn=None, sharp_deg=32):
    """Revolve a closed polygon [(r, y), ...] about the Y axis through the angles `thetas` (radians; theta 0 at +Z,
    increasing toward +X). closed=True wraps the last angle to the first; otherwise the two ends are capped with the
    polygon itself (a cutaway face). prof_fn(theta) may replace prof to vary the section with angle (ribs)."""
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
            quad = [a[p], a[q], b[q], b[p]]
            if len({v.index if v.index >= 0 else id(v) for v in quad}) == 4:
                try:
                    bm.faces.new(quad)
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
    bm.to_mesh(me); bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    o = bpy.data.objects.new(name, me); C.link(o)
    if mat: o.data.materials.append(mat)
    return o


def full_thetas(n=SEG):
    return [2 * math.pi * i / n for i in range(n)]

def range_thetas(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]

HALF = lambda n=SEG // 2: range_thetas(0, math.pi, n)      # the kept half: x >= 0


def pair(name, label, build, component=True, seg=SEG):
    """Build a revolved part twice: whole (the outside view) and half (the cutaway). build(thetas, closed, name).
    seg: segments round the axis; the inner parts use fewer, since only the barrel's silhouette shows its facets."""
    full = build(full_thetas(seg), True, name)
    half = build(HALF(seg // 2), False, name + 'Cut')
    full['cutaway'] = 'full'; half['cutaway'] = 'half'
    if component:
        C.set_component(full, name, label)
        half['component'] = name + 'Cut'; half['label'] = label + ' (cut away)'
    half.hide_render = True
    return full, half


def interp(pts, u):
    if u <= pts[0][0]: return pts[0][1]
    for (u0, r0), (u1, r1) in zip(pts, pts[1:]):
        if u <= u1:
            return r0 + (r1 - r0) * (u - u0) / max(1e-9, u1 - u0)
    return pts[-1][1]

Y = lambda u: FLANGE + u          # Blender Y of a station u mm in front of the mount face
U = lambda z_world: -z_world - FLANGE


# ---- the optical prescription --------------------------------------------------------------------------------------
def sag(s, h):
    c, k = s['c'], s.get('k', 0) or 0
    arg_ = 1 - (1 + k) * c * c * h * h
    z = c * h * h / (1 + math.sqrt(max(arg_, 1e-9))) if c else 0.0
    for j, a in enumerate(s.get('a') or []):
        z += a * h ** (4 + 2 * j)
    return z

SURF = OPT['surfaces']
ELEMENTS = [e for e in OPT['elements'] if U(e['zFrontWorld']) > -8]     # lens glass, not the body's cover glass
# plates in front of the mount belong to the lens (the drop-in filter); the ones behind it are the body's filter stack
PLATES = [s for s in SURF if s.get('plate') and U(s['zWorld']) > 0]


# ---- the barrel ---------------------------------------------------------------------------------------------------
PROFILE = LAYOUT['profile']
RINGS = [(k, LAYOUT[k]) for k in ('focus', 'control') if k in LAYOUT]
WIN = LAYOUT.get('window')
R_MAX = D / 2
FRONT_R = FILTER / 2 if FRONT_THREAD else None
GROOVE = 2.0                          # the window's drum sits in a groove this deep under the barrel skin

def outer(u):
    return interp(PROFILE, u)

def recess(u):
    """How far the barrel surface itself sits below the profile at u (a ring or the window drum fills it back)."""
    for _, (u0, u1, _, depth, _) in RINGS:
        if u0 <= u <= u1:
            return max(1.2, depth + 0.6)
    if WIN and WIN[0] <= u <= WIN[1]:
        return GROOVE
    return 0.0

GLASS_SEATS = []        # (u0, u1, r): an element's rim band along the barrel, filled in by build_glass
DRAWN = [None]          # the drawn bore as a function of u, once the seats are known (build_glass)

def bore(u):
    """The barrel's inner radius at u. Round 1 (LF-06): never inside an element's rim. The engine caps every clear
    aperture at the published radius less 3 mm (realize.ts), the same as the drawn wall on the big teles, so their
    front glass rims sat exactly on the bore (coincident faces) or 0.3 mm into it where the barrel steps; the wall
    thins locally to keep 0.3 mm of air round the glass."""
    b = base_bore(u)
    seat = [r for u0, u1, r in GLASS_SEATS if u0 <= u <= u1]
    if seat:
        # a seat is a land: the bore is the rim plus 0.3 mm all along the element, so the glass is held, not floating
        # in a taper (z800's element 3)
        r = max(seat)
        if r + 0.3 > outer(u) - recess(u) - 1.0:
            TIGHT.add(round(u))
        b = min(r + 0.3, outer(u) - recess(u) - 1.0)
    return b

def base_bore(u):
    return min(outer(u) - LAYOUT['wall'], outer(u) - recess(u) - 1.0)

TIGHT = set()           # stations where the drawn barrel is too slim to hold the glass with a 1 mm wall
FRONT_POCKET = None      # (r_inner, r_outer, depth) of the pocket in the front face that holds the engraving, once built
ENGRAVING_DEPTH = 0.25  # mm below the front face to the pocket's floor; the print sits 0.06 mm above the floor

def barrel_profile():
    """Closed (r, y) polygon: the outer skin from the mount end to the front, the front lip and filter thread, then the
    bore back to the mount end. Recesses step down with a 0.3 mm chamfer so the rings seat into the barrel."""
    stations = sorted({p[0] for p in PROFILE} | {x for _, r in RINGS for x in (r[0], r[1])} |
                      ({WIN[0], WIN[1]} if WIN else set()))
    out = []
    for u in stations:
        rec_in, rec_out = recess(u - 0.31), recess(u + 0.31)
        if rec_in != rec_out:              # a recess edge: both levels, 0.3 mm apart
            out.append((outer(u - 0.3) - rec_in, Y(u - 0.3)))
            out.append((outer(u + 0.3) - rec_out, Y(u + 0.3)))
        else:
            out.append((outer(u) - recess(u), Y(u)))
    ub, uf = PROFILE[0][0], L
    lip = FRONT_R if FRONT_THREAD else outer(uf) - 3.5
    depth = 6.0 if FRONT_THREAD else 4.0
    inner = [(lip, Y(uf)), (lip, Y(uf - depth)), (bore(uf - depth - 0.5), Y(uf - depth - 0.5))]
    if FRONT_POCKET:
        # the pocket the front engraving sits in (score loop r5): cut into the front face so no print stands past it
        p0, p1, d = FRONT_POCKET
        out += [(p1, Y(uf)), (p1, Y(uf) - d), (p0, Y(uf) - d), (p0, Y(uf))]
    # round 1 (LF-08): stations at the window groove's edges too, so the drawn bore follows bore() there (it ran
    # straight past the groove, so the bore the cells were sized from was not the bore that was drawn)
    steps = sorted(set([u for u, _ in PROFILE] + [x for _, r in RINGS for x in (r[0], r[1])] +
                       ([x for x in (WIN[0] - 0.3, WIN[0], WIN[1], WIN[1] + 0.3)] if WIN else []) +
                       [x for u0, u1, _ in GLASS_SEATS for x in (u0 - 0.3, u0, u1, u1 + 0.3)]), reverse=True)
    for u in steps:
        if ub < u < uf - depth - 0.5:
            inner.append((bore(u), Y(u)))
    inner.append((bore(ub), Y(ub)))
    return out + inner


def drawn_bore_fn():
    """The barrel's inner radius as drawn (its section's inner edge, the front lip included), as a function of u."""
    prof = barrel_profile()
    i = max(range(len(prof)), key=lambda k: prof[k][1])          # the front lip's outer corner starts the inner edge
    inner = [p for p in prof[i:] if p[0] < outer(p[1] - FLANGE) - 0.2]
    pts = sorted(((y - FLANGE, r) for r, y in inner))
    def f(u):
        # the least drawn radius over the stations around u (a step has two stations at one u)
        if u <= pts[0][0]: return pts[0][1]
        if u >= pts[-1][0]: return pts[-1][1]
        for (u0, r0), (u1, r1) in zip(pts, pts[1:]):
            if u0 <= u <= u1:
                if u1 - u0 < 1e-9: return min(r0, r1)
                return r0 + (r1 - r0) * (u - u0) / (u1 - u0)
        return pts[-1][1]
    return f


def rib_prof(u0, u1, rb, depth, ribs, rin):
    ch = min(0.8, (u1 - u0) * 0.08)
    def fn(th):
        f = (th * ribs / (2 * math.pi)) % 1.0
        # rounded ribs (design review FID-13): a raised cosine lifted to a power under 1, so the tops are broad and
        # round and the grooves between them narrow, as a molded rubber grip. Round 1 (R1-14): the power is 0.8 and
        # the Z rings carry fewer, shallower ribs, so the grooves do not alias into moire at the app's viewing distance
        s = (0.5 + 0.5 * math.cos(2 * math.pi * f)) ** 0.8
        top = rb + depth * s
        return [(rin, Y(u0)), (rb - 0.15, Y(u0)), (top, Y(u0 + ch)), (top, Y(u1 - ch)), (rb - 0.15, Y(u1)), (rin, Y(u1))]
    return fn

def rib_thetas(ribs, lo=0.0, hi=2 * math.pi, closed=True):
    fr = (0.0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6)
    th = [2 * math.pi * (k + f) / ribs for k in range(ribs) for f in fr]
    th = [t for t in th if lo - 1e-9 <= t <= hi + 1e-9]
    if not closed and th[-1] < hi: th.append(hi)
    return th


def self_crossings(prof):
    """Pairs of edges of a closed (r, y) polygon that cross: a revolved section must have none, or its cut face
    triangulates wrongly (the cutaway shows holes or slivers)."""
    E = list(zip(prof, prof[1:] + prof[:1]))
    def cross(p, q, r, s):
        d = lambda a, b, c: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return d(p, q, r) * d(p, q, s) < 0 and d(r, s, p) * d(r, s, q) < 0
    return [(i, j) for i in range(len(E)) for j in range(i + 2, len(E)) if not (i == 0 and j == len(E) - 1)
            and cross(*E[i], *E[j])]


def build_barrel():
    prof = barrel_profile()
    bad = self_crossings(prof)
    if bad:
        report['notes'].append(f'barrel section crosses itself at {len(bad)} edge pairs, first at '
                               f'u = {round(prof[bad[0][0]][1] - FLANGE, 2)} mm')
    pair('barrel', 'Barrel', lambda th, cl, nm: revolve(nm, prof, th, cl, PAINT))
    for key, (u0, u1, ribs, depth, kind) in RINGS:
        rb = min(outer(u0), outer(u1)) - max(1.2, depth + 0.6)
        rin = max(rb - 1.0, max(bore(u0), bore(u1)) + 0.15)       # never inside the bore
        fn = rib_prof(u0, u1, rb + max(1.2, depth + 0.6) - depth, depth, ribs, rin)
        mat = RUBBER if kind == 'rubber' else KNURL
        label = {'focus': LAYOUT.get('ring_label', 'Focus ring'), 'control': 'Control ring (programmable: aperture, ISO or exposure compensation)'}[key]
        name = key + 'Ring'
        full, half = pair(name, label, lambda th, cl, nm, fn=fn, mat=mat, ribs=ribs:
                          revolve(nm, None, rib_thetas(ribs, closed=True) if cl else rib_thetas(ribs, 0, math.pi, False), cl, mat, prof_fn=fn, sharp_deg=50))
    # the hood bayonet: three raised tabs just behind the front, and an alignment dot
    u0 = LAYOUT['hood']
    rh = outer(L - 0.5)
    # round 1 (LF-05): the tabs stand 0.9 mm proud but never past the published maximum diameter (they made every lens
    # 0.6 to 0.8 mm too wide)
    top = min(rh + 0.9, R_MAX)
    tp = [(rh - 0.4, Y(u0 + 0.6)), (top, Y(u0 + 1.2)), (top, Y(u0 + 3.4)), (rh - 0.4, Y(u0 + 4.0))]
    spans = [(2 * math.pi * k / 3 + 0.35, 2 * math.pi * k / 3 + 0.77) for k in range(3)]
    def tabs_build(th, cl, nm):
        # round 1 (LF-04): whole and cut-away versions, so the cutaway does not show the far tabs floating in the air
        lo, hi = (0.0, 2 * math.pi) if cl else (0.0, math.pi)
        parts = [revolve(f'{nm}{k}', tp, range_thetas(max(a, lo), min(b, hi), 14), False, PAINT, sharp_deg=40)
                 for k, (a, b) in enumerate(spans) if min(b, hi) - max(a, lo) > 0.02]
        return C.join(parts, nm)
    pair('hoodBayonet', 'Hood bayonet', tabs_build)
    dot = ST.cyl('hoodDot', 0.9, 0.3, (0, 0, 0), 'Z', ENGRAVE, verts=24, bevel=0)
    dot.location = (0, Y(u0 + 2.2), rh + 0.05)
    return rh


def build_window():
    """The distance scale: a drum in a groove under the barrel skin, seen through a window, marked in meters at the
    angles the focus ring really turns to (engine focus travel)."""
    if not WIN:
        return None
    u0, u1, cdeg, hdeg = WIN
    r = outer((u0 + u1) / 2)
    rg = min(outer(u0), outer(u1)) - GROOVE        # the groove floor's lowest point (the profile slopes under it)
    w0, w1 = math.radians(cdeg - hdeg), math.radians(cdeg + hdeg)
    skin = [(r - 1.4, Y(u0)), (r, Y(u0)), (r, Y(u1)), (r - 1.4, Y(u1))]
    # the skin covers every angle but the window; its half version keeps the part at x >= 0
    def skin_build(th, cl, nm):
        lo, hi = (w1, w0 + 2 * math.pi) if cl else (max(0.0, w1), math.pi)
        return revolve(nm, skin, range_thetas(lo, hi, 120), False, PAINT)
    pair('windowSkin', 'Barrel', skin_build, component=False)
    glass = revolve('distanceWindow', [(r - 0.55, Y(u0 + 0.1)), (r - 0.3, Y(u0 + 0.1)), (r - 0.3, Y(u1 - 0.1)), (r - 0.55, Y(u1 - 0.1))],
                    range_thetas(w0, w1, 48), False, WINDOW)
    C.set_component(glass, 'distanceWindow', 'Distance-scale window')
    # round 1 (LF-08): the drum rests on the groove floor (it sank 0.4 mm into the barrel wall, and the two cut faces
    # z-fought in the cutaway), clear of the groove's 0.3 mm chamfers
    floor = lambda u: outer(u) - GROOVE + 0.02
    dp = [(floor(u0 + 0.4), Y(u0 + 0.4)), (rg + 0.3, Y(u0 + 0.4)), (rg + 0.3, Y(u1 - 0.4)), (floor(u1 - 0.4), Y(u1 - 0.4))]
    drum, drum_half = pair('scaleDrum', 'Distance-scale drum', lambda th, cl, nm: revolve(nm, dp, th, cl, BAFFLE), component=False)
    # index line on the fixed barrel just behind the window
    idx = engrave_bar('scaleIndex', r + 0.02, u0 - 1.6, u0 - 0.4, 0.0, 0.35)
    marks = scale_marks()
    parts = [drum, drum_half]
    placed = []
    rs = rg + 0.42
    for mm, ang, label in marks:
        th = ang                                   # nearer distances sit further round toward +X
        arc = rs * th
        wlab = 2.0 * 0.62 * len(label) + 1.2
        if any(abs(arc - a) < (wlab + w) / 2 for a, w in placed) and mm not in (None, marks[-1][0]):
            continue
        placed.append((arc, wlab))
        parts.append(engrave_bar(f'tick{len(parts)}', rs, u0 + 0.9, u0 + 2.6, th, 0.28))
        parts.append(engrave(f'mark{len(parts)}', label, 2.0, rs, (u0 + u1) / 2 + 1.2, th))
    parts.append(engrave('scaleUnit', 'm', 1.6, rs, (u0 + u1) / 2 + 1.2, -math.radians(12)))
    sc = bpy.data.objects.new('distanceScale', None); C.link(sc)
    sc['component'] = 'distanceScale'; sc['label'] = 'Distance scale (turns with the focus ring)'
    for p in parts:
        p.parent = sc
    return sc


def scale_marks():
    """(mm, ring angle rad, label) from infinity to the closest focus. The engine's focus travel places them; for n50
    the engine's transcribed rear-focus gap table cannot reach closer than ~1.7 m (src/engine/focus-travel.ts), so the
    marks there follow thin-lens extension over the same throw (derived), scaled to the engine's closest-focus angle."""
    ms = [(m['mm'], m['angleRad']) for m in OPT['scaleMarks']]
    closest_mm, closest_ang = ms[-1]
    mids = [a for mm, a in ms if mm is not None and mm != closest_mm]
    if mids and max(mids) < 1e-6:
        f = OPT['focalLength']
        ext = lambda Dm: (Dm - math.sqrt(max(Dm * Dm - 4 * Dm * f, 0))) / 2 - f
        e_min = ext(closest_mm)
        ms = [(mm, 0.0 if mm is None else closest_ang * ext(mm) / e_min) for mm, _ in ms]
        report['notes'].append('distance scale: thin-lens extension (derived); the engine focus travel collapses for this design')
    seen, out = set(), []
    for mm, a in ms:
        if mm in seen: continue
        seen.add(mm)
        if mm is None: lab = '\u221e'
        else:
            m = mm / 1000.0
            lab = (f'{m:.2f}'.rstrip('0').rstrip('.') if m < 1 else f'{m:.1f}'.rstrip('0').rstrip('.'))
            if lab.startswith('0.'): lab = lab[1:]
        out.append((mm, a, lab))
    return out


FONT = None
def font():
    global FONT
    if FONT is None:
        for p in (r'C:\Windows\Fonts\arial.ttf', r'C:\Windows\Fonts\segoeui.ttf'):
            if os.path.exists(p):
                FONT = bpy.data.fonts.load(p); break
    return FONT

def text_mesh(name, text, size):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = text; cu.size = size
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    if font(): cu.font = font()
    ob = bpy.data.objects.new(name + '_t', cu); C.link(ob)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu)
    return me

def engrave(name, text, size, R, u, th0):
    """Text wrapped round the barrel at radius R: its baseline runs round the circumference, its top toward the front."""
    me = text_mesh(name, text, size)
    for v in me.vertices:
        x, y = v.co.x, v.co.y
        th = th0 + x / R
        v.co = Vector((R * math.sin(th), Y(u) + y, R * math.cos(th)))
    o = bpy.data.objects.new(name, me); C.link(o); o.data.materials.append(ENGRAVE)
    return o

def engrave_bar(name, R, u0, u1, th, width):
    dth = width / R / 2
    return revolve(name, [(R - 0.02, Y(u0)), (R + 0.12, Y(u0)), (R + 0.12, Y(u1)), (R - 0.02, Y(u1))],
                   range_thetas(th - dth, th + dth, 2), False, ENGRAVE)


def build_switches():
    sw = LAYOUT.get('switch')
    if not sw:
        return None
    u0, u1, n = sw
    r = min(outer(u0), outer(u1))
    c = math.radians(-78)                          # the photographer's left, where the left hand finds it
    half = math.radians(9 if n == 1 else 11)
    pad = revolve('switchPanel', [(r - 0.5, Y(u0)), (r + 0.55, Y(u0 + 0.6)), (r + 0.55, Y(u1 - 0.6)), (r - 0.5, Y(u1))],
                  range_thetas(c - half, c + half, 16), False, PAINT, sharp_deg=40)
    parts = [pad]
    pitch = (u1 - u0) / n
    for k in range(n):
        uc = u0 + pitch * (k + 0.5)
        th = c + half * 0.35
        p = Vector((math.sin(th), 0, math.cos(th)))
        s = ST.box(f'slider{k}', (3.2, min(5.5, pitch * 0.55), 1.4), (0, 0, 0), KNURL, bevel=0.35)
        s.location = Vector((0, Y(uc), 0)) + p * (r + 1.0)
        s.rotation_euler = (0, th, 0)
        parts.append(s)
        parts.append(engrave_bar(f'switchMark{k}', r + 0.6, uc - pitch * 0.35, uc - pitch * 0.2, c - half * 0.4, 0.3))
    grp = C.join(parts, 'switches')
    return C.set_component(grp, 'switches', 'Focus-mode switch' if n == 1 else 'Switches: focus mode, focus limiter, vibration reduction')


def foot_drop():
    return R_MAX + 16.0


def flat_faces_sharp(obj, tol=0.9995):
    """Mark sharp every edge between a face that is flat to an axis (a top, a bottom, a wall) and a bevel face, so
    the flat faces carry flat normals and only the bevel rounds the light."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    def flat(f):
        n = f.normal
        return abs(n.z) > tol or abs(n.z) < 1 - tol
    for e in bm.edges:
        fs = e.link_faces
        e.smooth = not (len(fs) == 2 and flat(fs[0]) != flat(fs[1]))
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(obj.data); bm.free()


def build_collar():
    """The rotating collar and its foot (design review FID-11). A super-telephoto rests on its foot: the neck runs down
    from the collar past the front barrel, to a long plate (about 0.28 of the length) with a tapered front, set forward
    of the collar toward the balance point. The 500 mm PF has none: Nikon supplies no collar for it (R1-FID-H)."""
    col = LAYOUT.get('collar')
    if not col:
        return None
    u0, u1 = col
    r = max(outer(u0), outer(u1))
    prof = [(r - 0.2, Y(u0)), (r + 3.2, Y(u0 + 0.8)), (r + 3.6, Y(u0 + 2)), (r + 3.6, Y(u1 - 2)), (r + 3.2, Y(u1 - 0.8)), (r - 0.2, Y(u1))]
    pair('tripodCollar', 'Tripod collar (rotates for portrait or landscape)', lambda th, cl, nm: revolve(nm, prof, th, cl, PAINT))
    uc, w = (u0 + u1) / 2, (u1 - u0)
    full = LAYOUT.get('foot') == 'full'
    plate_len = 0.28 * L if full else w + 26
    # round 1 (R1-FID-G): the plate's underside 16 mm below the front barrel, clear of a fitted hood, so the lens
    # stands on its foot; the plate's top is then 0.55 D below the axis, the neck the review asked for
    z_bot = -(foot_drop() if full else R_MAX + 6)
    thick = 9.0 if full else 7.0
    yp = Y(uc) + (plate_len * 0.14 if full else 4)
    # the neck: lofted sections, a thin fin in X, long in Y, sweeping forward as it drops to the plate
    secs = []
    z_top, z_low = -(r + 1.0), z_bot + thick * 0.45      # the neck's bottom cap sits inside the plate, not on it
    for k in range(7):
        t = k / 6
        z = z_top + (z_low - z_top) * t
        a = (11.0 if full else 9.0) - 1.5 * t
        b = w * 0.42 + (plate_len * 0.30 - w * 0.42) * t ** 1.6
        yk = Y(uc) + (yp - Y(uc)) * t ** 1.4
        ring = S.superellipse(0, yk, a, b, n=2.8, seg=40)
        secs.append([(x, y, z) for (x, y) in ring])
    neck = S.loft('footNeck', secs)
    neck.data.materials.append(PAINT)
    y0, y1 = yp - plate_len / 2, yp + plate_len / 2
    hw = 20.0 if full else 17.0
    outline = S.fillet_polygon([(-hw, y0), (hw, y0), (hw, y1 - plate_len * 0.22), (hw * 0.62, y1), (-hw * 0.62, y1),
                                (-hw, y1 - plate_len * 0.22)], [6, 6, 12, 5, 5, 12], seg=8)
    plate = C.plate('footPlate', outline, z_bot, z_bot + thick, PAINT, axis='z', bevel=1.6, seg=3)
    sockets = [C.disc(f'footSocket{k}', 3.2, 0.3, BAFFLE, axis='-Z', loc=(0, yp + dy, z_bot + 0.1), ch=0.1, seg=24)
               for k, dy in enumerate((-plate_len * 0.2, plate_len * 0.2) if full else (0,))]
    knob = ST.cyl('collarKnob', 5.5, 10, (-(r + 6), Y(uc), -r * 0.35), 'X', KNURL, verts=40, bevel=1.0)
    # round 3 (R2-FID-4): bake each part's own modifiers before the join. A join keeps only the active object's
    # modifiers, so the neck's subdivision used to smooth the whole plate into a cushion. Then give the plate's flat
    # top, bottom and walls their own normals, so they shade as flat satin paint with a thin lit bevel.
    for o in [neck, plate, knob] + sockets:
        C.apply_all_modifiers(o)
    flat_faces_sharp(plate)
    foot = C.join([neck, plate, knob] + sockets, 'tripodFoot')
    removable = EXT.get('tripodCollar', {}).get('removable') or LAYOUT.get('foot') == 'small'
    return C.set_component(foot, 'tripodFoot', 'Tripod foot' + (' (removable)' if removable else ''))


def build_dropin():
    """The drop-in filter holder: a curved hatch 1.5 mm proud of the barrel top, flush-edged, with a low knurled knob."""
    di = LAYOUT.get('dropin')
    if not di:
        return None
    u0, u1 = di
    r = outer((u0 + u1) / 2)
    hp = [(r - 0.4, Y(u0)), (r + 1.2, Y(u0 + 0.6)), (r + 1.5, Y(u0 + 1.6)), (r + 1.5, Y(u1 - 1.6)), (r + 1.2, Y(u1 - 0.6)), (r - 0.4, Y(u1))]
    hatch = revolve('dropInHatch', hp, range_thetas(math.radians(-30), math.radians(30), 36), False, PAINT, sharp_deg=40)
    knob = C.knurl_dial('dropInKnob', 7.0, 4.0, 36, 0.45, KNURL, top_mat=PAINT, axis='Z', loc=(0, Y((u0 + u1) / 2), r + 1.3))
    lock = C.disc('dropInLock', 2.2, 1.4, KNURL, axis='Z', loc=(0, Y(u0 + 3.2), r + 1.3), ch=0.3, dome=0.2, seg=24)
    grp = C.join([hatch, knob, lock], 'dropInFilter')
    return C.set_component(grp, 'dropInFilter', f'Drop-in filter holder ({FILTER} mm)')


def build_fn_buttons():
    """The super-teles' focus-function buttons (design review FID-10): four oval buttons at 45, 135, 225 and 315
    degrees on a slightly raised band ahead of the focus ring, where either hand finds one in any grip."""
    fn = LAYOUT.get('fn')
    if not fn:
        return None
    u0, u1, n = fn
    band = [(outer(u0) - 0.4, Y(u0)), (outer(u0) + 0.5, Y(u0 + 0.8)), (outer(u1) + 0.5, Y(u1 - 0.8)), (outer(u1) - 0.4, Y(u1))]
    uc = (u0 + u1) / 2
    rc = outer(uc) + 0.5
    def fn_build(th_, cl, nm):
        # round 1 (LF-04): a cut-away version (half band, the two buttons on the kept side), so the cutaway does not
        # show the far half of the band as a floating hoop
        parts = [revolve(nm + 'Band', band, full_thetas(160) if cl else HALF(80), cl, PAINT, sharp_deg=40)]
        for k in range(n):
            th = math.radians(45 + 360 / n * k)
            if not cl and math.sin(th) < 0:
                continue
            btn = C.disc(f'{nm}Button{k}', 3.0, 1.3, KNURL, axis='Z', loc=(0, 0, 0), ch=0.4, dome=0.3, seg=32)
            btn.scale = (1.0, 1.0, 1.5)              # local Z runs along the lens axis once turned: a 6 x 9 mm oval
            M = Matrix.Translation((rc * math.sin(th), Y(uc), rc * math.cos(th))) @ Matrix.Rotation(th, 4, 'Y')
            btn.matrix_basis = M @ btn.matrix_basis
            parts.append(btn)
        return C.join(parts, nm)
    full, half = pair('focusFnButtons', 'Focus-function buttons (four, round the barrel)', fn_build)
    return full


def build_front_text():
    """The engraving on the front name ring (design review FID-18): focal length and aperture along the top, the
    filter size along the bottom, about 1.6 mm cap height in light grey, reading upright from the front."""
    marked = OPT.get('markedFno') or OPT['maxFno']
    fno = f'{marked:.1f}'.rstrip('0').rstrip('.')
    ro = outer(L)
    ri = FRONT_R if FRONT_THREAD else ro - 3.5
    rm = (ro + ri) / 2 - 0.9
    size = 2.25 if ro - ri > 4.5 else 1.8
    yf = Y(L) - ENGRAVING_DEPTH + 0.06      # on the floor of a pocket cut into the face, so nothing stands past the front
    def make(rm):
        parts = []
        def wrap(name, text, top):
            me = text_mesh(name, text, size)
            for v in me.vertices:
                x, y = v.co.x, v.co.y
                th = -x / rm if top else math.pi + x / rm
                rr = rm + y if top else rm - y - size * 0.7
                v.co = Vector((rr * math.sin(th), yf, rr * math.cos(th)))
            o = bpy.data.objects.new(name, me); C.link(o); o.data.materials.append(ENGRAVE)
            parts.append(o)
        wrap('frontSpec', f"{round(OPT['focalLength'])}mm 1:{fno}", True)
        if FRONT_THREAD:
            wrap('frontFilter', '\u00f8' + f'{FILTER:g}', False)
        return parts, [math.hypot(v.co.x, v.co.z) for o in parts for v in o.data.vertices]
    parts, rr_ = make(rm)
    # the filter size read below the focal length sat partly over the thread's bore on four lenses (0.4-0.6 mm inside
    # the lip): move the whole print outward until it lies on the face (score loop r5, 10/11/2026)
    if min(rr_) < ri + 0.35:
        for o in parts:
            bpy.data.objects.remove(o)
        parts, rr_ = make(rm + (ri + 0.35 - min(rr_)))
    # the pocket takes the print's radial extent plus 0.25 mm, kept inside the face (0.1 mm in from either edge)
    p0, p1 = max(min(rr_) - 0.25, ri + 0.1), min(max(rr_) + 0.25, ro - 0.1)
    global FRONT_POCKET
    FRONT_POCKET = (p0, p1, ENGRAVING_DEPTH)
    return C.join(parts, 'frontEngraving')


def build_text():
    u, size = LAYOUT['text']
    marked = OPT.get('markedFno') or OPT['maxFno']
    fno = f'{marked:.1f}'.rstrip('0').rstrip('.')
    txt = f"{round(OPT['focalLength'])}mm 1:{fno}"
    r = outer(u) - recess(u)
    # 0.15 mm proud: a flat glyph face spans a chord of the barrel, and a 6 mm glyph on a 70 mm radius dips 0.07 mm
    # at its middle, so at 0.02 mm the barrel broke through it in patches (R1-14)
    o = engrave('specText', txt, size, r + 0.15, u, 0.0)
    return C.set_component(o, 'specText', 'Focal length and maximum aperture')


# ---- the mount ----------------------------------------------------------------------------------------------------
def build_mount(rear_clear):
    """The lens half of the bayonet: the chrome flange whose rear face is the mount face (it seats on the body's), the
    sleeve that enters the throat, the lugs that turn behind the body's, and the contacts."""
    rt = THROAT / 2
    # round 1 (LF-08): the flange and the sleeve are one section (they overlapped by 0.2 mm, and their cut faces
    # z-fought in the cutaway), and the flange stops where the barrel starts instead of 0.1 mm inside it
    section = [(rt - 3.2, Y(-4.6)), (rt - 0.6, Y(-4.6)), (rt - 0.6, Y(0)), (rt + 4.8, Y(0)), (rt + 4.8, Y(MOUNT_TOP)),
               (rt - 2.4, Y(MOUNT_TOP)), (rt - 2.4, Y(0.2)), (rt - 3.2, Y(0.2))]
    def mount_build(th, cl, nm):
        return revolve(nm, section, th, cl, CHROME)
    pair('lensMount', f"Lens mount, lens side ({MOUNT['name']['v'] if isinstance(MOUNT['name'], dict) else MOUNT['name']})", mount_build)
    span = 2 * math.pi / LUGS * 0.34
    lp = [(rt - 0.6, Y(-4.6)), (rt + 2.2, Y(-4.6)), (rt + 2.2, Y(-3.0)), (rt - 0.6, Y(-3.0))]     # on the sleeve, not in it
    def lugs_build(th, cl, nm):
        # round 1 (LF-04): a cut-away version too, so the lugs on the removed half do not float in the cutaway
        hi = 2 * math.pi if cl else math.pi
        parts = []
        for k in range(LUGS):
            c0 = 2 * math.pi * k / LUGS + math.radians(25)
            a, b = c0, min(c0 + span, hi)
            if b - a > 0.02:
                parts.append(revolve(f'{nm}{k}', lp, range_thetas(a, b, 16), False, CHROME, sharp_deg=30))
        return C.join(parts, nm)
    pair('lensLugs', f'Lens bayonet lugs ({LUGS})', lugs_build)
    pads = []
    for k in range(CONTACTS):
        th = math.radians(200) + (k - (CONTACTS - 1) / 2) * math.radians(3.1)
        pads.append(revolve(f'pad{k}', [(rt - 2.6, Y(-4.75)), (rt - 1.2, Y(-4.75)), (rt - 1.2, Y(-4.6)), (rt - 2.6, Y(-4.6))],
                            range_thetas(th - 0.022, th + 0.022, 2), False, GOLD, sharp_deg=30))
    ct = C.join(pads, 'lensContacts'); C.set_component(ct, 'lensContacts', f'Lens contacts ({CONTACTS})')
    baffle = [(rear_clear, Y(-4.4)), (rt - 3.2, Y(-4.4)), (rt - 3.2, Y(-3.6)), (rear_clear, Y(-3.6))]
    if rt - 3.2 - rear_clear > 0.3:
        pair('rearBaffle', 'Rear baffle', lambda th, cl, nm: revolve(nm, baffle, th, cl, BAFFLE), component=False)
    if LAYOUT.get('aperture_lever'):
        lev = ST.box('apertureLever', (2.2, 3.0, 5.0), (0, 0, 0), CHROME, bevel=0.3)
        th = math.radians(115)
        lev.location = (math.sin(th) * (rt - 5.0), Y(-3.2), math.cos(th) * (rt - 5.0))
        lev.rotation_euler = (0, th, 0)
        C.set_component(lev, 'apertureLever', 'Aperture lever (the body stops the lens down with it)')
    face = bpy.data.objects.new('mountFace', None); C.link(face); face.location = (0, FLANGE, 0)
    face['component'] = 'mountFace'; face['label'] = 'Mount face (seats on the body at the flange distance)'


# ---- the glass, the cells, the iris -------------------------------------------------------------------------------
# The engine's realized clear apertures are physical (src/engine/edges.ts, the 10/11/2026 aperture review): every
# element keeps a 0.5 mm edge and 0.1 mm of air to its neighbors, or, where the on-axis bundle needs it, at least a
# knife edge and no overlap. Round 1 of the 10/10/2026 review (LF-01, LF-03) trimmed the drawn rims here instead and
# logged each trim under `trimmed`; with the engine fixed that list came out empty on all seven lenses, so the model
# no longer trims anything. It only checks: if the engine ever hands it glass inside glass again, the build stops
# with the element named, so the fix lands in the engine, where the traced rays see it too, not in the drawing.
GLASS_TOL = 1e-3       # mm: rounding in the optics JSON, far under the Draco quantization


def element_limits(e):
    """The drawn semi-diameters (front, back) and rim of one element: the engine's own, under the barrel cap."""
    fs, bs = SURF[e['frontSurface']], SURF[e['backSurface']]
    uF = U(fs['zWorld']); uB = U(bs['zWorld'])
    # the engine caps clear apertures at the published barrel less a 3 mm wall (realize.ts); that is the authority, and
    # where the drawn bore steps in (the hood-mount lip on the big teles) the glass edge seats under it
    cap = max(bore((uF + uB) / 2) - 0.6, D / 2 - 3.0)
    sdF = min(fs['sdRealized'] or e['maxSd'], cap); sdB = min(bs['sdRealized'] or e['maxSd'], cap)
    if e['maxSd'] > cap + 1e-6:
        report['clipped'].append({'element': e['index'], 'sd': round(e['maxSd'], 2), 'shown': round(cap, 2)})
    edge = lambda r: (bs['zWorld'] + sag(bs, min(sdB, r))) - (fs['zWorld'] + sag(fs, min(sdF, r)))
    rE = max(sdF, sdB)
    worst = min(edge(rE * k / 400) for k in range(401))
    if worst < -GLASS_TOL:
        raise SystemExit(f"{LENS} element {e['index']}: the engine's clear apertures give it a negative edge "
                         f"({worst:.3f} mm). Fix src/engine/edges.ts, not the model.")
    return sdF, sdB, rE


def front_y(e, lim, h):
    fs = SURF[e['frontSurface']]
    return -(fs['zWorld'] + sag(fs, min(h, lim[0])))

def back_y(e, lim, h):
    bs = SURF[e['backSurface']]
    return -(bs['zWorld'] + sag(bs, min(h, lim[1])))


def check_neighbors(elements, lims):
    """No two elements' glass may occupy the same place (LF-01). The engine guarantees it now; this only checks."""
    for i, a in enumerate(elements):
        for j in range(i + 1, len(elements)):
            b = elements[j]
            if a['backSurface'] == b['frontSurface']:
                continue  # a cemented pair shares its interface surface
            la, lb = lims[i], lims[j]
            rr = min(la[2], lb[2])
            gap = min(back_y(a, la, h) - front_y(b, lb, h) for h in (rr * k / 400 for k in range(401)))
            if gap < -GLASS_TOL:
                raise SystemExit(f"{LENS} elements {a['index']} and {b['index']}: the engine's clear apertures put their "
                                 f"glass {-gap:.3f} mm into each other. Fix src/engine/edges.ts, not the model.")
    return lims




def element_profile(e, lim):
    fs, bs = SURF[e['frontSurface']], SURF[e['backSurface']]
    sdF, sdB, rE = lim
    N = 14
    yF = lambda h: -(fs['zWorld'] + sag(fs, h))
    yB = lambda h: -(bs['zWorld'] + sag(bs, h))
    front = [(sdF * i / N, yF(sdF * i / N)) for i in range(N + 1)]
    back = [(sdB * i / N, yB(sdB * i / N)) for i in range(N, -1, -1)]
    edge = []
    if rE > sdF + 1e-3: edge.append((rE, yF(sdF)))
    if rE > sdB + 1e-3: edge.append((rE, yB(sdB)))
    prof = front + edge + back
    return prof, rE, max(y for _, y in prof), min(y for _, y in prof)


def build_glass():
    root = bpy.data.objects.new('glass', None); C.link(root)
    root['component'] = 'glass'; root['label'] = f"Optics: {OPT['elementCount']} elements in {OPT['groupCount']} groups"
    lims = check_neighbors(ELEMENTS, [element_limits(e) for e in ELEMENTS])
    # the bore clears every rim (LF-06): each element's rim band along the barrel, with 0.5 mm either side
    profs = [element_profile(e, lim) for e, lim in zip(ELEMENTS, lims)]
    for (prof, rE, yhi, ylo) in profs:
        u0, u1 = ylo - FLANGE - 0.5, yhi - FLANGE + 0.5
        # only where the drawn bore comes within 0.3 mm of the rim somewhere along the element
        if min(base_bore(u0 + (u1 - u0) * k / 40) for k in range(41)) < rE + 0.3:
            GLASS_SEATS.append((u0, u1, rE))
    DRAWN[0] = drawn_bore_fn()
    placed = []
    rear_clear = 20.0
    # the rear baffle's opening clears every element that reaches back to it (LF-02: after element 13 of s35 was
    # trimmed, a baffle sized from the last element alone cut into element 12)
    baffle_r = max([rE + 1.0 for (_, rE, yhi, ylo) in profs if ylo <= Y(-3.6) + 0.5] + [profs[-1][1] + 1.0, 8.0])
    def hold_r(u):
        """The most radius a cell may take at u: the bore, inside the mount's sleeve and flange, the rear baffle's
        opening and the iris housing's inner edge."""
        r = DRAWN[0](u)
        if -4.6 <= u <= 0.2: r = min(r, THROAT / 2 - 3.2)
        if 0.0 <= u <= MOUNT_TOP: r = min(r, THROAT / 2 - 2.4)
        if -4.4 <= u <= -3.6: r = min(r, baffle_r)
        h = iris_housing()
        if h[2] <= u <= h[3]: r = min(r, h[0])
        return r
    def lerp(c, h, k):
        for (ra, *va), (rb, *vb) in zip(c, c[1:]):
            if ra <= h <= rb:
                t = (h - ra) / max(rb - ra, 1e-9)
                return va[k - 1] + (vb[k - 1] - va[k - 1]) * t
        return c[0][k] if h < c[0][0] else c[-1][k]
    for n, (e, lim, (prof, rE, yhi, ylo)) in enumerate(zip(ELEMENTS, lims, profs), 1):
        pf = any(SURF[i].get('doe') for i in range(e['frontSurface'], e['backSurface'] + 1))
        mat = PF_GLASS if pf else GLASS
        nm = f'element{n:02d}'
        label = f'Element {n}' + (' (Phase Fresnel: a diffractive layer bends light the opposite way to glass)' if pf else '')
        proud = U(e['zFrontWorld']) - L
        if n == 1 and proud > 0.05:
            # z35: the patent's own vertex position, which the product's barrel front does not follow (score loop r5)
            label += f' (its front vertex stands {proud:.1f} mm past the barrel front: the position the patent gives it, kept as prescribed)'
            report['notes'].append(f'element 1 stands {proud:.1f} mm past the barrel front: the prescription (data/lenses) puts its '
                                   'front vertex there and no source found places the real filter-ring face; kept as prescribed')
        full, half = pair(nm, label, lambda th, cl, nm_, prof=prof, mat=mat: revolve(nm_, prof, th, cl, mat, sharp_deg=60), seg=SEG_GLASS)
        full.parent = root; half.parent = root
        full['element'] = n; full['pf'] = pf
        # the cell: a black ring from the glass edge to the bore, as long as the edge. Round 1 of the 10/10/2026 review
        # (LF-02): its outer radius is the least room along its length (the bore, the mount sleeve and flange, the rear
        # baffle, the iris housing), and its front and back follow any other element's glass and any cell already
        # placed, so no cell runs through a neighbor or shares a face with another part (they did in all seven)
        ey0, ey1 = min(ylo + 0.2, yhi - 0.5), yhi if (yhi - ylo) < 3 else max(ylo + 1.5, yhi - 1.2)
        r0 = rE + 0.05
        ey0, ey1 = min(ey0, back_y(e, lim, rE)), max(ey1, front_y(e, lim, rE))   # always the whole rim band
        eb0, eb1 = back_y(e, lim, rE), front_y(e, lim, rE)      # the rim's own edge band, which the cell holds
        # as wide as the room along the rim's own band, then only as long as that room lasts (n500's front element
        # sits just behind the filter-thread lip, which is narrower than its rim)
        hold_y = lambda y: hold_r(y - FLANGE)
        r1 = min(hold_y(eb0 + (eb1 - eb0) * k / 100) for k in range(101)) - 0.05
        y = eb1
        while y < ey1 and hold_y(y + 0.02) >= r1 + 0.05: y += 0.02
        ey1 = min(ey1, y)
        y = eb0
        while y > ey0 and hold_y(y - 0.02) >= r1 + 0.05: y -= 0.02
        ey0 = max(ey0, y)
        if r1 - r0 < 0.4:
            rear_clear = rE + 1.0 if n == len(ELEMENTS) else rear_clear
            continue
        obst = []      # (r_lo, r_hi, lower(r), upper(r)) of everything else in the section
        for m, (em, lm) in enumerate(zip(ELEMENTS, lims)):
            if m != n - 1 and lm[2] > r0:
                obst.append((0.0, lm[2], (lambda h, em=em, lm=lm: back_y(em, lm, h)), (lambda h, em=em, lm=lm: front_y(em, lm, h))))
        for c in placed:
            # from 0.1 mm short of the placed cell's bore: a cell reaching up along a neighbor's rim left a 0.05 mm leaf in
            # the air gap between that rim and the next cell's bore, which shared (same-facing) faces with the rim
            # (score loop r5, 10/11/2026: n500 340 mm2, n500fl 273, z800 168, s35 66)
            obst.append((c[0][0] - 0.1, c[-1][0], (lambda h, c=c: lerp(c, h, 1)), (lambda h, c=c: lerp(c, h, 2))))
        rs = {r0 + (r1 - r0) * k / 160 for k in range(161)}
        for lo_r, hi_r, _, _ in obst:
            for x in (lo_r, hi_r, hi_r + 0.01, lo_r - 0.01):
                if r0 < x < r1: rs.add(x)
        prof_c = []
        mid_e = (eb0 + eb1) / 2
        for r in sorted(rs):
            a, b = ey0, ey1
            for lo_r, hi_r, lower, upper in obst:
                if not (lo_r - 1e-6 <= r <= hi_r + 1e-6):
                    continue
                lo, hi = lower(r), upper(r)
                if hi <= a or lo >= b:
                    continue
                # 0.06 mm clear measured square to the neighbor's surface, so more along the axis where it is steep
                if (lo + hi) / 2 > mid_e:
                    sl = abs(lower(min(r + 0.01, hi_r)) - lower(max(r - 0.01, lo_r))) / 0.02
                    b = min(b, lo - 0.06 * math.sqrt(1 + sl * sl))
                else:
                    sl = abs(upper(min(r + 0.01, hi_r)) - upper(max(r - 0.01, lo_r))) / 0.02
                    a = max(a, hi + 0.06 * math.sqrt(1 + sl * sl))
            if b - a < 0.15:
                break                                        # pinched: the cell ends here
            prof_c.append((r, a, b))
        held = prof_c and min(prof_c[0][2], eb1) - max(prof_c[0][1], eb0) > 0.05
        if len(prof_c) >= 2 and prof_c[-1][0] - prof_c[0][0] >= 0.3 and held:
            placed.append(prof_c)
        else:
            mates = [m + 1 for m, em in enumerate(ELEMENTS) if em['backSurface'] == e['frontSurface'] or em['frontSurface'] == e['backSurface']]
            report['notes'].append(f'element {n}: no cell; cemented to element {mates[0]}, which holds it' if mates else
                                   f'element {n}: no room for a cell between its neighbors')
        rear_clear = rE + 1.0 if n == len(ELEMENTS) else rear_clear
    # dense where a neighbor's surface bounds the cell, then thinned to 5 microns (most cells are plain rectangles)
    cells = [simplify([(r, a) for r, a, b in c] + [(r, b) for r, a, b in reversed(c)], 0.005) for c in placed]
    for p in PLATES:
        u = U(p['zWorld'])
        r = min((p['sdRealized'] or 10) + 0.5, bore(u) - 0.5)
        pr = [(0, Y(u + 1.0)), (r, Y(u + 1.0)), (r, Y(u)), (0, Y(u))]
        full, half = pair('filterGlass', f'Drop-in filter glass ({FILTER} mm)', lambda th, cl, nm_: revolve(nm_, pr, th, cl, GLASS))
        full.parent = root; half.parent = root
    def cells_build(th, cl, nm):
        parts = [revolve(f'{nm}{i}', cp, th, cl, BAFFLE, sharp_deg=30) for i, cp in enumerate(cells)]
        return C.join(parts, nm)
    if cells:
        pair('cells', 'Element cells (the black rings that hold each element)', cells_build, seg=SEG_CELLS)
    return baffle_r


def simplify(pts, tol):
    """Ramer-Douglas-Peucker on an open polyline (the cell outline from its front-inner corner round to its back)."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    n_ = math.hypot(dx, dy)
    def dist(p):
        if n_ < 1e-12: return math.hypot(p[0] - x0, p[1] - y0)
        return abs(dy * (p[0] - x0) - dx * (p[1] - y0)) / n_
    k, dmax = max(((i, dist(p)) for i, p in enumerate(pts[1:-1], 1)), key=lambda t: t[1])
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)


def iris_housing():
    """(inner r, outer r, u0, u1, blade outer r) of the iris housing. The outer radius is the least bore along its
    length (round 1, LF-08: it was the bore at the stop only, and ran into the barrel where the bore steps in)."""
    stop = [s for s in SURF if s.get('stop')][0]
    us = U(stop['zWorld'])
    db = DRAWN[0] or bore
    R_out = min(OPT['iris']['stopRadius'] + 3.0, db(us) - 1.0)
    rb = min(db(us - 1.2 + 2.6 * k / 104) for k in range(105)) - 0.05
    return (R_out - 0.5, rb, us - 1.2, us + 1.4, R_out)


def build_iris():
    stop = [s for s in SURF if s.get('stop')][0]
    us = U(stop['zWorld'])
    R0 = OPT['iris']['stopRadius']
    n, rounded = OPT['iris']['blades'], OPT['iris']['rounded']
    # shown two stops down from the marked aperture, at the nearest marked stop; the app sets the real opening
    marked = OPT.get('markedFno') or OPT['maxFno']
    fno_shown = min((1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22), key=lambda N: abs(math.log(N / (marked * 2))))
    r_open = R0 * OPT['maxFno'] / fno_shown
    h_in, h_out, hu0, hu1, R_out = iris_housing()
    Re = r_open * 2.4 if rounded else 1e6
    blades = []
    for k in range(n):
        phi = 2 * math.pi * k / n
        uk = Vector((math.sin(phi), math.cos(phi)))
        ck = uk * (r_open - Re)
        pts_in, pts_out = [], []
        for i in range(25):
            th = phi - math.pi / n * 1.0 + (math.pi / n * 3.4) * i / 24
            w = Vector((math.sin(th), math.cos(th)))
            # distance along w to leave disc k: |rho w - ck| = Re, larger root
            b_ = -2 * w.dot(ck); c_ = ck.length_squared - Re * Re
            rho = (-b_ + math.sqrt(max(b_ * b_ - 4 * c_, 0))) / 2 if rounded else (r_open / max(w.dot(uk), 1e-6) if w.dot(uk) > 0 else 1e9)
            rho = max(rho, r_open)
            if rho >= R_out - 0.3:
                continue
            pts_in.append(w * rho); pts_out.append(w * R_out)
        if len(pts_in) < 3:
            continue
        poly = pts_in + list(reversed(pts_out))
        # score loop r4 (10/11/2026): a straight-edged blade's inner edge was 25 points on one line, which the exporter's
        # fan triangulation cut into 700-900 zero-area triangles per lens; only the ends of a straight run stay
        keep = []
        for i, pt in enumerate(poly):
            a, b = poly[i - 1], poly[(i + 1) % len(poly)]
            if abs((pt - a).cross(b - pt)) > 1e-7 * max((b - a).length, 1.0):
                keep.append(pt)
        poly = keep
        me = bpy.data.meshes.new(f'blade{k}'); bm = bmesh.new()
        yk = Y(us) + 0.12 * k - 0.06 * (n - 1)      # the stack centered on the stop (LF-07: it sat 0.06 mm behind)
        # a real 0.10 mm plate (score loop r4, 10/11/2026): bmesh.ops.solidify left the copy in the same plane, so each
        # blade was two coincident caps joined by zero-area side faces (700-900 zero-area triangles a lens, and 441
        # open edges once welded). 0.10 mm, under the 0.12 mm pitch, so neighboring plates never share a face.
        lo = [bm.verts.new((p.x, yk - 0.05, p.y)) for p in poly]
        hi = [bm.verts.new((p.x, yk + 0.05, p.y)) for p in poly]
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            bm.faces.new([lo[i], lo[j], hi[j], hi[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(f'blade{k}', me); C.link(o); o.data.materials.append(BLADE)
        blades.append(o)
    bl = C.join(blades, 'irisBlades')
    C.set_component(bl, 'irisBlades', f"Iris: {n} {'rounded ' if rounded else ''}blades (shown at f/{fno_shown:g})")
    bl['fnoShown'] = fno_shown
    hp = [(h_in, Y(hu0)), (h_out, Y(hu0)), (h_out, Y(hu1)), (h_in, Y(hu1))]
    pair('irisHousing', 'Iris housing', lambda th, cl, nm: revolve(nm, hp, th, cl, BAFFLE), seg=96)
    return bl


# ---- main ---------------------------------------------------------------------------------------------------------
def main():
    C.clear_scene()
    init_materials()
    rear_clear = build_glass()
    build_front_text()          # first: its extent decides the pocket the barrel is cut with
    build_barrel()
    build_window()
    build_switches()
    build_collar()
    build_dropin()
    build_fn_buttons()
    build_text()
    build_mount(max(rear_clear, 8.0))
    build_iris()
    root = bpy.data.objects.new('lens', None); C.link(root)
    fno = OPT.get('markedFno') or OPT['maxFno']
    root['component'] = 'lens'
    root['label'] = f"{round(OPT['focalLength'])} mm f/{fno:g} lens (generic{', after the ' + OPT['representativeOf'] if OPT.get('representativeOf') else ''})"
    root['lensId'] = LENS; root['flangeMm'] = FLANGE; root['lengthMm'] = L; root['diameterMm'] = D
    for o in list(bpy.context.scene.objects):
        if o is not root and o.parent is None and o.type in ('MESH', 'EMPTY'):
            o.parent = root
    if TIGHT:
        report['notes'].append(f'barrel wall under 1 mm round the glass near u = {sorted(TIGHT)} mm: the drawn profile '
                               '(read from photographs) is too slim there for the engine clear apertures')
    print('REPORT', json.dumps(report))
    exp = arg('--export')
    if exp:
        os.makedirs(C.long_path(os.path.dirname(os.path.abspath(exp))), exist_ok=True)
        hidden = [o for o in bpy.context.scene.objects if o.hide_render]
        for o in hidden: o.hide_render = False
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.context.scene.objects:
            if o.type in ('MESH', 'EMPTY'): o.select_set(True)
        # export hygiene, as the bodies (score loop r2): one material per look, mesh data named after its object
        # flat printed decals (the text, the distance-scale marks, the ticks): open surfaces by design, so a topology
        # check can leave them out by name and read the real open edges (score loop r5)
        for o in bpy.context.scene.objects:
            if o.type == 'MESH' and o.data.materials and all(m is ENGRAVE for m in o.data.materials):
                o['decal'] = True
        print('TIDY merged materials, renamed meshes', C.tidy_for_export())
        C.export_glb(exp, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_extras=True, export_materials='EXPORT',
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  # Draco: ~0.02 mm position steps over a 400 mm lens, far under a pixel on any screen
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                                  export_draco_position_quantization=14, export_draco_normal_quantization=10,
                                  export_draco_texcoord_quantization=12)
        for o in hidden: o.hide_render = True
        print('EXPORTED', exp, round(os.path.getsize(C.long_path(exp)) / 1048576, 2), 'MB')
        # the sidecar the manifest is built from (tools: blender/data/build-lens-manifest.py). It records the canonical
        # model path, and is written only for an export to that path: an export to a scratch folder rewrote the
        # tracked sidecar with a relative path out of the repo (score loop r1, 10/11/2026)
        canonical = f'public/models/lenses/{LENS}.glb'
        if os.path.normcase(os.path.abspath(exp)) != os.path.normcase(os.path.abspath(os.path.join(ROOT, canonical))):
            print('SIDECAR skipped: not the canonical export path', canonical)
            exp = None
    if exp:
        comps = sorted({o['component'] for o in bpy.context.scene.objects if o.get('component') and o.get('cutaway') != 'half'})
        side = dict(report, glb=os.path.relpath(exp, ROOT).replace(os.sep, '/'), mount=EXT['mount'], flangeMm=FLANGE,
                    lengthMm=L, diameterMm=D, filterMm=FILTER, filterKind='front thread' if FRONT_THREAD else 'drop-in',
                    focalLength=OPT['focalLength'], markedFno=OPT.get('markedFno') or OPT['maxFno'],
                    elements=len(ELEMENTS), elementCount=OPT['elementCount'], groupCount=OPT['groupCount'],
                    iris={k: OPT['iris'][k] for k in ('blades', 'rounded', 'stopRadius')},
                    representativeOf=OPT.get('representativeOf'), label=root['label'], namedComponents=comps,
                    focusRingThrowDeg=round(math.degrees(OPT['scaleMarks'][-1]['angleRad']), 1))
        json.dump(side, open(os.path.join(ROOT, 'blender/data', f'{LENS}-build.json'), 'w', encoding='utf-8'), indent=1)
    out = arg('--render')
    if out:
        render(out)


def render(out):
    os.makedirs(C.long_path(out), exist_ok=True)
    R = (foot_drop() - 0.5) if LAYOUT.get('foot') == 'full' else D / 2 + (25 if LAYOUT.get('collar') else 0)   # the floor meets the foot
    cy = FLANGE + L / 2
    size = max(L, D * 1.3)
    floor = ST.studio(-R - 0.5, target=(0, cy, 0), scale=max(1.0, size / 160))
    # review renders at modest cost: --res-pct 50 --samples 32 (defaults keep the full 1600 x 1000, 128 samples)
    bpy.context.scene.render.resolution_percentage = int(arg('--res-pct', 100))
    if arg('--samples'):
        bpy.context.scene.eevee.taa_render_samples = int(arg('--samples'))
    dist = size * 3.4
    body = arg('--on-body')
    ST.shoot(out, f'lens-{LENS}', [
        ('front3q', (-dist * 0.55, cy + dist * 0.72, dist * 0.42), (0, cy, 0)),
        ('side', (-dist, cy, dist * 0.12), (0, cy, 0)),
        ('rear3q', (dist * 0.5, cy - dist * 0.75, dist * 0.35), (0, cy, 0)),
    ])
    # the cutaway: the half parts in, the whole ones out, and the loose details on the removed side hidden
    for o in bpy.context.scene.objects:
        if o.get('cutaway') == 'full': o.hide_render = True
        elif o.get('cutaway') == 'half': o.hide_render = False
        elif o.type == 'MESH' and o.name != 'floor':
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            if sum(v.x for v in bb) / 8 < -1: o.hide_render = True
    ST.shoot(out, f'lens-{LENS}', [('cutaway', (-dist * 0.9, cy + dist * 0.28, dist * 0.34), (0, cy, 0))])
    if body:
        for o in bpy.context.scene.objects:
            if o.get('cutaway') == 'full': o.hide_render = False
            elif o.get('cutaway') == 'half': o.hide_render = True
            elif o.type == 'MESH': o.hide_render = False
        bpy.ops.import_scene.gltf(filepath=body)
        zb = None
        for o in bpy.context.selected_objects:
            if o.name.startswith('shellCut'): o.hide_render = True
            if o.type == 'MESH':
                bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
                zb = min([zb] + [v.z for v in bb]) if zb is not None else min(v.z for v in bb)
        floor.location.z = min(zb, -R) - 0.1
        cy2 = (FLANGE + L) / 2 - 20
        d2 = max(L + 150, 320) * 2.6
        ST.shoot(out, f'lens-{LENS}', [('mounted', (-d2 * 0.62, cy2 + d2 * 0.6, d2 * 0.4), (0, cy2, 0))])


main()
