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
          [--on-body public/models/dslr.glb]
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
    'z800': dict(profile=[(1.6, 34.0), (10, 35.0), (12, 44.0), (100, 44.0), (104, 49.0), (228, 49.0), (232, 52.0),
                          (250, 52.0), (282, 70.0), (372, 70.0), (374, 69.4), (385, 69.4)],
                 focus=(180, 226, 100, 0.7, 'rubber'), control=(156, 170, 110, 0.35, 'knurl'), switch=(110, 150, 3),
                 collar=(62, 94), dropin=(26, 52), hood=374, text=(310, 6.5), wall=3.0, fn=(236, 248, 4), foot='full'),
}[LENS]

SEG = 192
report = {'lens': LENS, 'clipped': [], 'notes': []}


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

def bore(u):
    return min(outer(u) - LAYOUT['wall'], outer(u) - recess(u) - 1.0)

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
    steps = sorted(set([u for u, _ in PROFILE] + [x for _, r in RINGS for x in (r[0], r[1])]), reverse=True)
    for u in steps:
        if ub < u < uf - depth - 0.5:
            inner.append((bore(u), Y(u)))
    inner.append((bore(ub), Y(ub)))
    return out + inner


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


def build_barrel():
    prof = barrel_profile()
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
    tabs = []
    for k in range(3):
        c0 = 2 * math.pi * k / 3 + 0.35
        tp = [(rh - 0.4, Y(u0 + 0.6)), (rh + 0.9, Y(u0 + 1.2)), (rh + 0.9, Y(u0 + 3.4)), (rh - 0.4, Y(u0 + 4.0))]
        tabs.append(revolve(f'hoodTab{k}', tp, range_thetas(c0, c0 + 0.42, 14), False, PAINT, sharp_deg=40))
    hb = C.join(tabs, 'hoodBayonet'); C.set_component(hb, 'hoodBayonet', 'Hood bayonet')
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
    rg = r - GROOVE
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
    dp = [(rg - 0.4, Y(u0 + 0.2)), (rg + 0.3, Y(u0 + 0.2)), (rg + 0.3, Y(u1 - 0.2)), (rg - 0.4, Y(u1 - 0.2))]
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
    b = revolve('fnBand', band, full_thetas(160), True, PAINT, sharp_deg=40)
    parts = [b]
    uc = (u0 + u1) / 2
    rc = outer(uc) + 0.5
    for k in range(n):
        th = math.radians(45 + 360 / n * k)
        btn = C.disc(f'fnButton{k}', 3.0, 1.3, KNURL, axis='Z', loc=(0, 0, 0), ch=0.4, dome=0.3, seg=32)
        btn.scale = (1.0, 1.0, 1.5)                  # local Z runs along the lens axis once turned: a 6 x 9 mm oval
        M = Matrix.Translation((rc * math.sin(th), Y(uc), rc * math.cos(th))) @ Matrix.Rotation(th, 4, 'Y')
        btn.matrix_basis = M @ btn.matrix_basis
        parts.append(btn)
    grp = C.join(parts, 'focusFnButtons')
    return C.set_component(grp, 'focusFnButtons', 'Focus-function buttons (four, round the barrel)')


def build_front_text():
    """The engraving on the front name ring (design review FID-18): focal length and aperture along the top, the
    filter size along the bottom, about 1.6 mm cap height in light grey, reading upright from the front."""
    marked = OPT.get('markedFno') or OPT['maxFno']
    fno = f'{marked:.1f}'.rstrip('0').rstrip('.')
    ro = outer(L)
    ri = FRONT_R if FRONT_THREAD else ro - 3.5
    rm = (ro + ri) / 2 - 0.9
    size = 2.25 if ro - ri > 4.5 else 1.8
    yf = Y(L) + 0.12
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
    flange = [(rt - 2.4, Y(0)), (rt + 4.8, Y(0)), (rt + 4.8, Y(1.7)), (rt - 2.4, Y(1.7))]
    sleeve = [(rt - 3.2, Y(-4.6)), (rt - 0.6, Y(-4.6)), (rt - 0.6, Y(0.2)), (rt - 3.2, Y(0.2))]
    def mount_build(th, cl, nm):
        a = revolve(nm, flange, th, cl, CHROME)
        b = revolve(nm + 's', sleeve, th, cl, CHROME)
        return C.join([a, b], nm)
    pair('lensMount', f"Lens mount, lens side ({MOUNT['name']['v'] if isinstance(MOUNT['name'], dict) else MOUNT['name']})", mount_build)
    lugs = []
    span = 2 * math.pi / LUGS * 0.34
    for k in range(LUGS):
        c0 = 2 * math.pi * k / LUGS + math.radians(25)
        lp = [(rt - 0.8, Y(-4.6)), (rt + 2.2, Y(-4.6)), (rt + 2.2, Y(-3.0)), (rt - 0.8, Y(-3.0))]
        lugs.append(revolve(f'lug{k}', lp, range_thetas(c0, c0 + span, 16), False, CHROME, sharp_deg=30))
    lg = C.join(lugs, 'lensLugs'); C.set_component(lg, 'lensLugs', f'Lens bayonet lugs ({LUGS})')
    pads = []
    for k in range(CONTACTS):
        th = math.radians(200) + (k - (CONTACTS - 1) / 2) * math.radians(3.1)
        pads.append(revolve(f'pad{k}', [(rt - 2.6, Y(-4.75)), (rt - 1.2, Y(-4.75)), (rt - 1.2, Y(-4.6)), (rt - 2.6, Y(-4.6))],
                            range_thetas(th - 0.022, th + 0.022, 2), False, GOLD, sharp_deg=30))
    ct = C.join(pads, 'lensContacts'); C.set_component(ct, 'lensContacts', f'Lens contacts ({CONTACTS})')
    baffle = [(rear_clear, Y(-4.4)), (rt - 3.2, Y(-4.4)), (rt - 3.2, Y(-3.6)), (rear_clear, Y(-3.6))]
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
def element_profile(e):
    fs, bs = SURF[e['frontSurface']], SURF[e['backSurface']]
    uF = U(fs['zWorld']); uB = U(bs['zWorld'])
    # the engine caps clear apertures at the published barrel less a 3 mm wall (realize.ts); that is the authority, and
    # where the drawn bore steps in (the hood-mount lip on the big teles) the glass edge seats under it
    cap = max(bore((uF + uB) / 2) - 0.6, D / 2 - 3.0)
    sdF = min(fs['sdRealized'] or e['maxSd'], cap); sdB = min(bs['sdRealized'] or e['maxSd'], cap)
    if e['maxSd'] > cap + 1e-6:
        report['clipped'].append({'element': e['index'], 'sd': round(e['maxSd'], 2), 'shown': round(cap, 2)})
    # keep a positive edge: where the two surfaces would meet, stop short
    thick = lambda h: (fs['zWorld'] + sag(fs, h) * 1) - (bs['zWorld'] + sag(bs, h))     # z_front - z_back < 0 is glass
    rE = max(sdF, sdB)
    for _ in range(40):
        hF, hB = min(sdF, rE), min(sdB, rE)
        if (bs['zWorld'] + sag(bs, hB)) - (fs['zWorld'] + sag(fs, hF)) >= 0.25:
            break
        rE *= 0.97; sdF = min(sdF, rE); sdB = min(sdB, rE)
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
    cells = []
    rear_clear = 20.0
    for n, e in enumerate(ELEMENTS, 1):
        prof, rE, yhi, ylo = element_profile(e)
        pf = any(SURF[i].get('doe') for i in range(e['frontSurface'], e['backSurface'] + 1))
        mat = PF_GLASS if pf else GLASS
        nm = f'element{n:02d}'
        label = f'Element {n}' + (' (Phase Fresnel: a diffractive layer bends light the opposite way to glass)' if pf else '')
        full, half = pair(nm, label, lambda th, cl, nm_, prof=prof, mat=mat: revolve(nm_, prof, th, cl, mat, sharp_deg=60), seg=112)
        full.parent = root; half.parent = root
        full['element'] = n; full['pf'] = pf
        # the cell: a black ring from the glass edge to the bore, as long as the edge
        ub = bore(U(-(yhi + ylo) / 2))
        if ub - rE > 0.4:
            ey0, ey1 = min(ylo + 0.2, yhi - 0.5), yhi if (yhi - ylo) < 3 else max(ylo + 1.5, yhi - 1.2)
            cp = [(rE + 0.05, ey0), (ub - 0.05, ey0), (ub - 0.05, ey1), (rE + 0.05, ey1)]
            cells.append(cp)
        rear_clear = rE + 1.0 if n == len(ELEMENTS) else rear_clear
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
        pair('cells', 'Element cells (the black rings that hold each element)', cells_build, seg=96)
    return rear_clear


def build_iris():
    stop = [s for s in SURF if s.get('stop')][0]
    us = U(stop['zWorld'])
    R0 = OPT['iris']['stopRadius']
    n, rounded = OPT['iris']['blades'], OPT['iris']['rounded']
    # shown two stops down from the marked aperture, at the nearest marked stop; the app sets the real opening
    marked = OPT.get('markedFno') or OPT['maxFno']
    fno_shown = min((1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22), key=lambda N: abs(math.log(N / (marked * 2))))
    r_open = R0 * OPT['maxFno'] / fno_shown
    R_out = min(R0 + 3.0, bore(us) - 1.0)
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
        me = bpy.data.meshes.new(f'blade{k}'); bm = bmesh.new()
        yk = Y(us) + 0.12 * k - 0.06 * n
        vs = [bm.verts.new((p.x, yk, p.y)) for p in poly]
        bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.12)
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(f'blade{k}', me); C.link(o); o.data.materials.append(BLADE)
        blades.append(o)
    bl = C.join(blades, 'irisBlades')
    C.set_component(bl, 'irisBlades', f"Iris: {n} {'rounded ' if rounded else ''}blades (shown at f/{fno_shown:g})")
    bl['fnoShown'] = fno_shown
    hp = [(R_out - 0.5, Y(us - 1.2)), (bore(us) - 0.05, Y(us - 1.2)), (bore(us) - 0.05, Y(us + 1.4)), (R_out - 0.5, Y(us + 1.4))]
    pair('irisHousing', 'Iris housing', lambda th, cl, nm: revolve(nm, hp, th, cl, BAFFLE), seg=96)
    return bl


# ---- main ---------------------------------------------------------------------------------------------------------
def main():
    C.clear_scene()
    init_materials()
    rear_clear = build_glass()
    build_barrel()
    build_window()
    build_switches()
    build_collar()
    build_dropin()
    build_fn_buttons()
    build_text()
    build_front_text()
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
    print('REPORT', json.dumps(report))
    exp = arg('--export')
    if exp:
        os.makedirs(os.path.dirname(exp), exist_ok=True)
        hidden = [o for o in bpy.context.scene.objects if o.hide_render]
        for o in hidden: o.hide_render = False
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.context.scene.objects:
            if o.type in ('MESH', 'EMPTY'): o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=exp, export_format='GLB', use_selection=True, export_yup=True,
                                  export_apply=True, export_extras=True, export_materials='EXPORT',
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  # Draco: ~0.02 mm position steps over a 400 mm lens, far under a pixel on any screen
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                                  export_draco_position_quantization=14, export_draco_normal_quantization=10,
                                  export_draco_texcoord_quantization=12)
        for o in hidden: o.hide_render = True
        print('EXPORTED', exp, round(os.path.getsize(exp) / 1048576, 2), 'MB')
        # the sidecar the manifest is built from (tools: blender/data/build-lens-manifest.py)
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
    os.makedirs(out, exist_ok=True)
    R = (foot_drop() - 0.5) if LAYOUT.get('foot') == 'full' else D / 2 + (25 if LAYOUT.get('collar') else 0)   # the floor meets the foot
    cy = FLANGE + L / 2
    size = max(L, D * 1.3)
    floor = ST.studio(-R - 0.5, target=(0, cy, 0), scale=max(1.0, size / 160))
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
