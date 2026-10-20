"""Measure an exported lens GLB against the engine prescription and the published exterior (review loop, 10/10/2026).

Imports public/models/lenses/<id>.glb (the shipped, Draco-compressed artifact) and reports, as JSON:
  - per element: max deviation of every glass vertex from the prescription sag (front or back surface, mm), the axial
    vertex positions vs the engine's zWorld, the rim radius vs the realized clear semi-diameter, and the edge thickness;
  - overlaps in the (r, y) section between glass, cells, the iris housing and the barrel bore (cut halves at theta 0);
  - the iris: blade count (connected pieces), its axial position vs the stop, its opening radius vs the expected one,
    and whether the opening's edges are arcs (rounded) or straight;
  - same-facing coincident faces between the cells and each element (fails the run over 1 mm2), and the elements
    whose edge is under the 0.5 mm minimum (Reed's decision 1);
  - the envelope: barrel max diameter, length from the mount face to the front, filter-thread bore, mount face.

  blender --background --factory-startup --python blender/measure_lens.py -- --lens s35 [--glb PATH] [--out FILE]
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LENS = arg('--lens', 's35')
GLB = arg('--glb', os.path.join(ROOT, 'public/models/lenses', f'{LENS}.glb'))
OPT = json.load(open(os.path.join(ROOT, 'blender/data', f'{LENS}-optics.json'), encoding='utf-8'))
EXT = json.load(open(os.path.join(ROOT, 'data/hardware/lens-exteriors.json'), encoding='utf-8'))['lenses'][LENS]
MOUNT = json.load(open(os.path.join(ROOT, 'data/hardware/mounts.json'), encoding='utf-8'))['mounts'][EXT['mount']]
V = lambda f: f['v'] if isinstance(f, dict) else f
FLANGE, L, D, FILTER = V(MOUNT['flangeMm']), V(EXT['lengthMm']), V(EXT['diameterMm']), V(EXT['filterMm'])
SURF = OPT['surfaces']

def sag(s, h):
    c, k = s['c'], s.get('k', 0) or 0
    z = c * h * h / (1 + math.sqrt(max(1 - (1 + k) * c * c * h * h, 1e-12))) if c else 0.0
    for j, a in enumerate(s.get('a') or []):
        z += a * h ** (4 + 2 * j)
    return z

ysurf = lambda s, h: -(s['zWorld'] + sag(s, h))       # Blender Y of a surface at height h

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=GLB)
bpy.context.view_layer.update()
OBJ = {o.name: o for o in bpy.data.objects}

def verts(name):
    o = OBJ.get(name)
    if not o or o.type != 'MESH':
        return []
    M = o.matrix_world
    return [M @ v.co for v in o.data.vertices]

def ry(p):
    return math.hypot(p.x, p.z), p.y

def section(name):
    """The (r, y) section at theta 0 of a cut-half part: its vertices on the x = 0 plane, z >= 0."""
    return [(p.z, p.y) for p in verts(name) if abs(p.x) < 1e-3 and p.z >= -1e-3]

out = {'lens': LENS, 'glb': os.path.relpath(GLB, ROOT).replace(os.sep, '/'), 'sizeMB': round(os.path.getsize(GLB) / 1048576, 3)}

# ---- glass ---------------------------------------------------------------------------------------------------------
elements = [e for e in OPT['elements'] if -e['zFrontWorld'] - FLANGE > -8]
els = []
glass_sections = {}
for n, e in enumerate(elements, 1):
    nm = f'element{n:02d}'
    fs, bs = SURF[e['frontSurface']], SURF[e['backSurface']]
    inner = [SURF[i] for i in range(e['frontSurface'] + 1, e['backSurface'])]     # cemented interfaces
    vs = verts(nm)
    if not vs:
        els.append({'element': n, 'missing': True}); continue
    sdF, sdB = fs['sdRealized'], bs['sdRealized']
    rmax = max(ry(p)[0] for p in vs)
    worst, worst_at = 0.0, None
    sdmax = max(sdF or 0, sdB or 0) or rmax
    band = []                                    # the ground rim band: vertices beyond both clear apertures
    for p in vs:
        r, y = ry(p)
        if r > sdmax + 0.02:
            # not on either prescribed surface (the engine's sag covers only the clear aperture): left out of the sag
            # deviation, which read 1.65 mm on the stale n500fl for a rim band; its thickness is reported below
            band.append(y)
            continue
        cands = []
        for s in (fs, bs):
            sd = s['sdRealized'] or rmax
            if r <= sd + 0.02:
                cands.append(abs(y - ysurf(s, r)))
            else:   # a flat-ground edge beyond this surface's clear aperture: the surface's own rim height
                cands.append(abs(y - ysurf(s, sd)))
        d = min(cands)
        if d > worst:
            worst, worst_at = d, (round(r, 2), round(y, 3))
    axial = [p for p in vs if ry(p)[0] < 0.02]
    ys = sorted(p.y for p in axial)
    yF_exp, yB_exp = ysurf(fs, 0), ysurf(bs, 0)
    rec = {
        'element': n, 'surfaces': [e['frontSurface'], e['backSurface']], 'cemented': len(inner),
        'maxSagDevMm': round(worst, 4), 'worstAt_rY': worst_at,
        'axialFrontDevMm': round(max(ys) - yF_exp, 4) if ys else None,
        'axialBackDevMm': round(min(ys) - yB_exp, 4) if ys else None,
        'centerThickMm': round(max(ys) - min(ys), 4) if ys else None,
        'centerThickExpMm': round(yF_exp - yB_exp, 4),
        'rimMm': round(rmax, 3), 'sdFront': round(sdF, 3) if sdF else None, 'sdBack': round(sdB, 3) if sdB else None,
        'rimVsMaxSd': round(rmax - max(sdF or 0, sdB or 0), 3),
        'edgeThickExpMm': round(ysurf(fs, min(sdF, rmax)) - ysurf(bs, min(sdB, rmax)), 3),
        'rimBandMm': round(max(band) - min(band), 3) if band else None,
        'vertsPerSurfaceRadial': len({round(ry(p)[0], 3) for p in vs if ry(p)[1] > (yF_exp + yB_exp) / 2}),
    }
    # vertex z of the cemented interfaces: the GLB carries one solid per element, so an interface shows only as a note
    els.append(rec)
    glass_sections[nm] = section(nm + 'Cut')
out['elements'] = els
# edge thickness against Reed's 0.5 mm minimum (decision 1: lens apertures are capped at physical edges with a 0.5 mm
# minimum edge, and at four limit rims the f-number is kept and the minimum gives way): the edge at each element's
# clear aperture, from the prescription, so a thin edge is listed instead of reading as a modeling defect
out['edgeMinMm'] = min((e['edgeThickExpMm'] for e in els if not e.get('missing')), default=None)
out['edgeUnderMin'] = [{'element': e['element'], 'edgeThickExpMm': e['edgeThickExpMm']} for e in els
                       if not e.get('missing') and e['edgeThickExpMm'] < 0.5 - 0.005]
out['maxSagDevMm'] = max((e.get('maxSagDevMm') or 0) for e in els)
out['maxAxialDevMm'] = max(max(abs(e.get('axialFrontDevMm') or 0), abs(e.get('axialBackDevMm') or 0)) for e in els)

# glass against glass: the drawn boundaries (the GLB vertices match them to maxSagDevMm), front(r) and back(r) with the
# flat-ground edge beyond each surface's clear aperture; two elements interpenetrate where one's back is behind the
# next one's front at the same radius
def bounds(e):
    fs, bs = SURF[e['surfaces'][0]], SURF[e['surfaces'][1]]
    return (lambda h: ysurf(fs, min(h, fs['sdRealized'] or h))), (lambda h: ysurf(bs, min(h, bs['sdRealized'] or h)))
gaps, inter = [], []
ok = [e for e in els if not e.get('missing')]
for i, a in enumerate(ok):
    for b in ok[i + 1:]:
        fa, ba = bounds(a); fb, bb = bounds(b)
        rr = min(a['rimMm'], b['rimMm'])
        hs = [rr * k / 200 for k in range(201)]
        g = [ba(h) - fb(h) for h in hs]            # a is in front: its back must stay ahead of b's front
        gmin = min(g)
        if b['element'] == a['element'] + 1:
            gaps.append({'between': [a['element'], b['element']], 'minAirGapMm': round(gmin, 3), 'axialGapMm': round(g[0], 3)})
        if gmin < -0.005:
            bad = [h for h, x in zip(hs, g) if x < -0.005]
            inter.append({'between': [a['element'], b['element']], 'depthMm': round(-gmin, 3),
                          'fromR': round(min(bad), 2), 'toR': round(max(bad), 2)})
out['airGaps'] = gaps
out['glassIntersections'] = inter

# ---- section overlaps from the cut caps ----------------------------------------------------------------------------
# Every half part is capped on the x = 0 plane; its cap triangles at z >= 0 are its exact (r, y) section. Two parts
# overlap where a vertex of one lies strictly inside (by more than TOL) the other's section.
TOL = 0.02
def bmesh_pieces(name):
    o = OBJ.get(name)
    if not o or o.type != 'MESH': return []
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)       # glTF splits vertices along sharp edges
    bm.verts.ensure_lookup_table()
    seen, pieces = set(), []
    for v in bm.verts:
        if v.index in seen: continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            w = stack.pop(); comp.append(o.matrix_world @ w.co)
            for e in w.link_edges:
                u = e.other_vert(w)
                if u.index not in seen:
                    seen.add(u.index); stack.append(u)
        pieces.append(comp)
    bm.free()
    return pieces

def cap_pieces(name):
    """[(tris, verts)] per connected piece: tris as ((r, y) x 3), verts the piece's section vertices."""
    o = OBJ.get(name)
    if not o or o.type != 'MESH': return []
    bm = bmesh.new(); bm.from_mesh(o.data); bm.transform(o.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.faces.ensure_lookup_table()
    seen, out_ = set(), []
    for f0 in bm.faces:
        if f0.index in seen: continue
        stack, comp = [f0], []
        seen.add(f0.index)
        while stack:
            f = stack.pop(); comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index); stack.append(g)
        tris = []
        for f in comp:
            ps = [v.co for v in f.verts]
            if all(abs(p.x) < 1e-3 and p.z > -1e-3 for p in ps):
                tris.append(tuple((p.z, p.y) for p in ps))
        vs = {(round(v.co.z, 4), round(v.co.y, 4)) for f in comp for v in f.verts if abs(v.co.x) < 1e-3 and v.co.z > -1e-3}
        if tris:
            out_.append((tris, sorted(vs)))
    bm.free()
    return out_

def in_tri(p, t, tol=TOL):
    (x, y), (a, b, c) = p, t
    def side(p1, p2):
        ex, ey = p2[0] - p1[0], p2[1] - p1[1]
        n_ = math.hypot(ex, ey) or 1e-12
        return (ex * (y - p1[1]) - ey * (x - p1[0])) / n_
    s_ = [side(a, b), side(b, c), side(c, a)]
    return all(v > tol for v in s_) or all(v < -tol for v in s_)

def overlap(pa, pb):
    """Vertices of piece a strictly inside piece b's section, and the other way round."""
    ta, va = pa; tb, vb = pb
    return [p for p in va if any(in_tri(p, t) for t in tb)] + [p for p in vb if any(in_tri(p, t) for t in ta)]

def bbox2(piece):
    vs = piece[1]
    return min(v[0] for v in vs), max(v[0] for v in vs), min(v[1] for v in vs), max(v[1] for v in vs)

glass_caps = {}
for e in els:
    if e.get('missing'): continue
    ps = cap_pieces(f"element{e['element']:02d}Cut")
    if ps: glass_caps[e['element']] = ps[0]
cells = cap_pieces('cellsCut')
others = {nm: cap_pieces(nm) for nm in ('barrelCut', 'irisHousingCut', 'lensMountCut', 'rearBaffleCut', 'scaleDrumCut', 'windowSkinCut')}

glass_in = []
for n, g in glass_caps.items():
    for k, c in enumerate(cells):
        hit = overlap(g, c)
        if hit: glass_in.append({'glass': n, 'in': f'cell{k}', 'n': len(hit), 'at': [round(x, 2) for x in hit[0]]})
    for nm, ps in others.items():
        for c in ps:
            hit = overlap(g, c)
            if hit: glass_in.append({'glass': n, 'in': nm, 'n': len(hit), 'at': [round(x, 2) for x in hit[0]]})
# glass against glass from the caps too (independent of the analytic check above)
ks = sorted(glass_caps)
for i, a in enumerate(ks):
    for b in ks[i + 1:]:
        hit = overlap(glass_caps[a], glass_caps[b])
        if hit: glass_in.append({'glass': a, 'in': f'element{b:02d}', 'n': len(hit), 'at': [round(x, 2) for x in hit[0]]})
out['glassOverlaps'] = glass_in

part_in = []
pieces = [(f'cell{k}', c) for k, c in enumerate(cells)] + [(nm, c) for nm, ps in others.items() for c in ps]
for i, (na, a) in enumerate(pieces):
    for nb, b in pieces[i + 1:]:
        A, B = bbox2(a), bbox2(b)
        if min(A[1], B[1]) < max(A[0], B[0]) or min(A[3], B[3]) < max(A[2], B[2]): continue
        hit = overlap(a, b)
        if hit: part_in.append({'a': na, 'b': nb, 'n': len(hit), 'at': [round(x, 2) for x in hit[0]]})
out['partOverlaps'] = part_in
out['cells'] = [[round(x, 2) for x in bbox2(c)] for c in cells]

# every element held: a cell (or the bore or the mount) whose section meets the element's rim within its edge band
floating = []
holders = cells + others['barrelCut'] + others['lensMountCut']
for e in els:
    if e.get('missing'): continue
    fa, ba = bounds(e)
    rim = e['rimMm']; ylo, yhi = ba(rim), fa(rim)
    probes = [(rim + 0.12, ylo + (yhi - ylo) * k / 10) for k in range(11)] + [(rim + 0.4, ylo + (yhi - ylo) * k / 10) for k in range(11)]
    held = any(in_tri(p, t, tol=0.0) for c in holders for t in c[0] for p in probes)
    if not held:
        floating.append({'element': e['element'], 'rim': rim, 'edgeY': [round(ylo, 2), round(yhi, 2)]})
# an element cemented to a held partner at least as large is held by the cement
held_ids = {e['element'] for e in els if not e.get('missing')} - {f['element'] for f in floating}
for f in list(floating):
    e = next(x for x in els if x['element'] == f['element'])
    for m in els:
        if m.get('missing') or m['element'] not in held_ids: continue
        if (m['surfaces'][1] == e['surfaces'][0] or m['surfaces'][0] == e['surfaces'][1]) and m['rimMm'] >= e['rimMm'] - 0.01:
            f['cementedTo'] = m['element']
floating = [f for f in floating if 'cementedTo' not in f]
out['elementsWithoutCell'] = floating

# ---- iris ----------------------------------------------------------------------------------------------------------
stop = [s for s in SURF if s.get('stop')][0]
ystop = -stop['zWorld']
blades = bmesh_pieces('irisBlades')
irisO = OBJ.get('irisBlades')
fno_shown = irisO.get('fnoShown') if irisO else None
R0 = OPT['iris']['stopRadius']
r_exp = R0 * OPT['maxFno'] / fno_shown if fno_shown else None
by = [p.y for c in blades for p in c]
# opening radius: the smallest radius any blade reaches, and the shape of the opening at many angles
def opening(theta):
    """The radius at which a ray from the axis at angle theta first meets a blade (blade faces projected to the stop
    plane)."""
    best = 1e9
    o = irisO
    M = o.matrix_world
    d = Vector((math.sin(theta), math.cos(theta)))
    for poly in o.data.polygons:
        if abs((M.to_3x3() @ poly.normal).y) < 0.9: continue
        pts = [(M @ o.data.vertices[i].co) for i in poly.vertices]
        P = [Vector((p.x, p.z)) for p in pts]
        for a, b in zip(P, P[1:] + P[:1]):
            e = b - a
            den = d.x * (-e.y) - d.y * (-e.x)
            if abs(den) < 1e-12: continue
            # solve t d = a + s e
            t = (a.x * (-e.y) - a.y * (-e.x)) / den
            s = (d.x * a.y - d.y * a.x) / den
            if t > 0 and -1e-9 <= s <= 1 + 1e-9:
                best = min(best, t)
    return best
samples = [opening(2 * math.pi * i / 720) for i in range(720)] if irisO else []
rmin, rmaxo = (min(samples), max(samples)) if samples else (None, None)
n = OPT['iris']['blades']
# an n-gon of inradius a has circumradius a / cos(pi/n); a rounded opening sits between that and a circle
out['iris'] = {
    'bladesExpected': n, 'roundedExpected': OPT['iris']['rounded'], 'bladePieces': len(blades),
    'stopY': round(ystop, 3), 'bladeYmin': round(min(by), 3) if by else None, 'bladeYmax': round(max(by), 3) if by else None,
    'bladeCenterVsStopMm': round((min(by) + max(by)) / 2 - ystop, 3) if by else None,
    'fnoShown': fno_shown, 'openingExpectedMm': round(r_exp, 3) if r_exp else None,
    'openingMinMm': round(rmin, 3) if rmin else None, 'openingMaxMm': round(rmaxo, 3) if rmaxo else None,
    'polygonCornerRatioIfStraight': round(1 / math.cos(math.pi / n), 4),
    'cornerRatio': round(rmaxo / rmin, 4) if rmin else None,
    'equivDiamMm': round(2 * math.sqrt(sum(s * s for s in samples) / len(samples)), 3) if samples else None,
}
# glass through the blades: any element occupying the blade stack's axial span between the opening and the blades' rim
if by:
    r_out = max(math.hypot(p.x, p.z) for c in blades for p in c)
    hits = []
    for e in els:
        if e.get('missing'): continue
        fa, ba = bounds(e)
        for k in range(101):
            h = rmin + (min(e['rimMm'], r_out) - rmin) * k / 100
            if h > e['rimMm']: break
            if ba(h) < max(by) and fa(h) > min(by):
                hits.append({'element': e['element'], 'r': round(h, 2)}); break
    out['iris']['glassInBlades'] = hits
    out['iris']['bladeOuterMm'] = round(r_out, 3)

# ---- envelope ------------------------------------------------------------------------------------------------------
bv = verts('barrel')
rb = [math.hypot(p.x, p.z) for p in bv]
skip = {'tripodFoot', 'tripodCollar', 'tripodCollarCut', 'floor'}
allv = []
for o in bpy.data.objects:
    if o.type == 'MESH' and o.name not in skip and not o.name.endswith('Cut'):
        M = o.matrix_world
        allv += [M @ v.co for v in o.data.vertices]
maxr_all = max(math.hypot(p.x, p.z) for p in allv)
maxr_all_noring = max(math.hypot(p.x, p.z) for p in allv if True)
front_y = max(p.y for p in allv)
mf = OBJ.get('mountFace')
yfront_barrel = max(p.y for p in bv)
thread = [math.hypot(p.x, p.z) for p in bv if abs(p.y - yfront_barrel) < 0.05]
parts_r = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.name.endswith('Cut'):
        M = o.matrix_world
        parts_r[o.name] = round(max(math.hypot((M @ v.co).x, (M @ v.co).z) for v in o.data.vertices), 2)
parts_front = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.name.endswith('Cut'):
        M = o.matrix_world
        parts_front[o.name] = round(max((M @ v.co).y for v in o.data.vertices) - FLANGE - L, 3)
# same-facing coincident faces between the cells and each glass element (z-fight risk where a cutaway cap meets them):
# face centers of the cells within 0.02 mm of an element's surface with the same normal (score loop r5, 10/11/2026).
# Over 1 mm2 in any pair fails the run.
from mathutils.bvhtree import BVHTree
def _bm(name):
    o = OBJ.get(name)
    if not o or o.type != 'MESH':
        return None
    bm = bmesh.new(); bm.from_mesh(o.data); bm.transform(o.matrix_world); bm.normal_update()
    return bm
same_facing = []
for cname in ('cells', 'cellsCut'):
    cb = _bm(cname)
    if cb is None:
        continue
    for e in els:
        if e.get('missing'):
            continue
        gb = _bm(f"element{e['element']:02d}" + ('Cut' if cname.endswith('Cut') else ''))
        if gb is None:
            continue
        tree = BVHTree.FromBMesh(gb)
        area = 0.0
        for f in cb.faces:
            loc, nrm, idx, d = tree.find_nearest(f.calc_center_median(), 0.02)
            if loc is not None and nrm.dot(f.normal) > 0.995:
                area += f.calc_area()
        if area > 0.01:
            same_facing.append({'cells': cname, 'element': e['element'], 'areaMm2': round(area, 2)})
        gb.free()
    cb.free()
out['cellsVsElementSameFacing'] = same_facing
out['cellsVsElementSameFacingFails'] = [x for x in same_facing if x['areaMm2'] > 1.0]

out['envelope'] = {
    'lengthSpec': L, 'lengthModel': round(front_y - FLANGE, 3), 'lengthDelta': round(front_y - FLANGE - L, 3),
    'barrelFrontModel': round(yfront_barrel - FLANGE, 3),
    'diameterSpec': D, 'barrelMaxDiam': round(2 * max(rb), 3), 'barrelDiamDelta': round(2 * max(rb) - D, 3),
    'maxDiamAllParts': round(2 * maxr_all, 3), 'maxDiamDelta': round(2 * maxr_all - D, 3),
    'filterSpec': FILTER, 'frontInnerDiam': round(2 * min(thread), 3) if thread else None,
    'mountFaceY': round(mf.location.y, 3) if mf else None, 'flange': FLANGE,
    'partMaxRadius': dict(sorted(parts_r.items(), key=lambda kv: -kv[1])[:8]),
    'partsPastFront': {k: v for k, v in sorted(parts_front.items(), key=lambda kv: -kv[1]) if v > 0.01},
}
out['objects'] = sorted(o.name for o in bpy.data.objects)
s = json.dumps(out, indent=1)
dst = arg('--out')
if dst:
    open(dst, 'w', encoding='utf-8').write(s)
print('MEASURE', json.dumps({k: out[k] for k in ('lens', 'sizeMB', 'maxSagDevMm', 'maxAxialDevMm')}))
if out['cellsVsElementSameFacingFails']:
    print('FAIL cells share same-facing faces with an element (over 1 mm2):', json.dumps(out['cellsVsElementSameFacingFails']))
    sys.exit(1)
