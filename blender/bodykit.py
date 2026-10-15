"""Shared body-building parts for dslr_v2.py and mirrorless_v2.py (design review round 0, 09/30/2026).

Everything here builds in common.py's frame (mm; Blender X = camera right seen from behind, Y = optical depth with the
mount face at +flange and the sensor at 0, Z up). The body scripts pass their own numbers; nothing here knows which
camera it is building.

What the review asked for and where it lives:
- the grip is part of the shell (FID-2): grip_solid() is unioned into the shell before the bevel, and the rubber 'grip'
  is the same solid 0.5 mm proud, clipped below the dial slot, so the grip reads as covered, not glued on;
- the shutter button sits on the grip's forward-sloping facet with its axis tilted forward (shutter_assembly);
- the front and rear command dials are sunk into slots in the shell with only a sliver of knurl showing (slot);
- leatherette panels, port doors, the tilting rear screen with its hinge, AF-ON, the sub-selector and the
  multi-selector (FID-6, FID-7); strap eyelets with split rings or slotted lugs (FID-14).
"""
import bpy
import bmesh
import math
from mathutils import Matrix, Vector

import common as C
import silhouette as S


def mat_cover_glass(name, tint=(0.035, 0.05, 0.055), alpha=0.3):
    """Thin coated cover glass the app can show as it is: the sensor's filter stack and the EVF eyepiece (aperture
    review 10/11/2026, from presentation handoff 1, P-04/P-05/P-14). common.mat_glass exports a near-white base color
    with KHR_materials_transmission 1, which a real-time renderer here cannot use, so the app fell back to a white
    alpha plug and had to override it. This is what coated glass looks like edge-on in a studio instead: a dark,
    faintly cyan body (an IR-cut stack's reflection), a clear coat for the sheen, and alpha blending, so whatever
    sits behind it (the silicon, the OLED) still reads through. No transmission extension is written."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*tint, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Alpha"].default_value = alpha
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 1.0
        bsdf.inputs["Coat Roughness"].default_value = 0.03
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = 'BLENDED'
    elif hasattr(mat, "blend_method"):
        mat.blend_method = 'BLEND'
    return mat


def fp(pts, radii, seg=10):
    return S.fillet_polygon(pts, radii, seg=seg)


def smooth_curve(pts, per=6, alpha=0.5):
    """An open centripetal Catmull-Rom spline through pts [(u, v), ...], per samples on each span, passing through every
    control point with a continuous tangent (score loop r4, 10/11/2026). The prism's cheeks were a polyline of three
    straight runs joined by tiny fillets, which the bevel and the shading turned into terraced bands; a spline through
    the same traced points has no corners to band. The ends use a mirrored phantom point, so each end leaves along
    its first chord."""
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = [tuple(P[1])]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max((p1 - p0).length, 1e-9) ** alpha
        t2 = t1 + max((p2 - p1).length, 1e-9) ** alpha
        t3 = t2 + max((p3 - p2).length, 1e-9) ** alpha
        for k in range(1, per + 1):
            t = t1 + (t2 - t1) * k / per
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            c = b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1))
            out.append((c.x, c.y))
    return out


def solid(name, front, top, side, box):
    """The intersection of three extruded outlines (front (x, z), top (x, y), side (y, z)), as silhouette.py."""
    return S.shell_from_profiles(name, front, top, side, box)


def boolean(obj, other, op, solver='MANIFOLD', transfer_materials=False):
    """Apply a boolean of `other` onto obj and delete `other`.

    The manifold solver (Blender 4.5+) by default since score loop r3 (10/11/2026). The exact solver, after the
    fillets and the bevel, opened holes in the shells far from the cut itself (the DSLR's eyepiece bore left 12
    boundary and 24 non-manifold edges on the grip front and the hump's nose), which is how both bodies came to export
    with see-through slits. The manifold solver needs closed input, which every part cut here is, and keeps it closed.
    Pass solver='EXACT' for a part that is not closed."""
    mod = obj.modifiers.new('bool', 'BOOLEAN')
    mod.operation = op
    mod.solver = solver
    mod.object = other
    if transfer_materials:
        mod.material_mode = 'TRANSFER'      # the cut faces take the cutter's own material (the default is by slot index)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(other, do_unlink=True)
    return obj


def cube(name, x0, x1, y0, y1, z0, z1):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z0 + (v.co.z + 0.5) * (z1 - z0)))
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    C.link(o)
    return o


def cylinder_y(name, x, z, r, y0, y1, seg=96):
    o = C.revolve(name, [(0, y0), (r, y0), (r, y1), (0, y1)], C.ring_thetas(seg), True, None, sharp_deg=30)
    o.location = (x, 0, z)
    bpy.context.view_layer.update()
    return o


def plan_loft(name, outline, zs, shift):
    """A prism whose plan outline (x, y) changes with height: at each z in zs the outline is moved by shift(x, y, z)
    -> (x, y). Used for the grip's front, which bows forward at mid-height (R2-FID-2)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((*shift(u, v, z), z)) for (u, v) in outline] for z in zs]
    n = len(outline)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    C.link(o)
    return o


def grip_solid(name, o, g):
    """The grip as its own solid, `o` mm proud of the core (0 for the core unioned into the shell, 0.5 for the rubber).
    g: dict of the body's grip numbers: x_in (inner wall), X1 (body side), YF (body front), YG (grip front), ZB, ZS,
    back (how far behind the front face the grip begins), top (ridge height above the shoulder), facet (y0, z0, y1, z1:
    the forward-sloping top facet, front end first), front_top (z where the front face starts to curve back), lean (how
    far the inner face leans out toward the body side as it comes forward), bulge (how far the front stands proud at
    mid-height of where it meets the base and the top), corner (the outer front corner's radius in plan).

    Round 2 (R2-FID-2): the front is convex in elevation as well as in plan. The plan outline is lofted up the grip and
    its forward part pulled back toward the base and the top, so the front bulges `bulge` mm at mid-height and the
    face reads as a rounded handle from any angle, not a slab with a rounded top view. The outer front corner is a true
    arc of `corner` mm (the fillet helper clamped it to 9 mm), so it wraps round onto the body side."""
    x_in, X1, YF, YG, ZB, ZS = g['x_in'], g['X1'], g['YF'], g['YG'], g['ZB'], g['ZS']
    back, top, lean = g['back'], g['top'], g.get('lean', 9.0)
    bulge, R = g.get('bulge', 4.5), g.get('corner', 17.0)
    fy0, fz0, fy1, fz1 = g['facet']
    # plan: the inner face and the front are one bowed curve (a cubic from the channel to the front, leaving the
    # channel nearly straight forward and arriving along the front), then the outer corner as a true arc
    ax, ay = x_in - 1 - o, YF + 6.5
    bx, by = X1 - R - 2, YG + o
    c1, c2 = (ax + 1.5, ay + 0.7 * (by - ay)), (bx - 0.65 * (bx - ax), by)
    # (score loop r3) 40 steps along the curve, 36 round the corner and 57 rings up the grip, twice round 2's: once the
    # DSLR's grip grew to the 146 mm body's true right end, its front came out as 10 x 7 mm facets flat enough to
    # shade as flat plates
    curve = []
    for k in range(40, -1, -1):
        t = k / 40
        mt = 1 - t
        curve.append((mt ** 3 * ax + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * bx,
                      mt ** 3 * ay + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * by))
    arc = []
    Rr = R + o
    cx, cy = X1 + o - Rr, YG + o - Rr
    for k in range(1, 36):             # from the side (angle 0) round to the front (90 degrees), side end first
        a = math.radians(90 * k / 36)
        arc.append((cx + Rr * math.cos(a), cy + Rr * math.sin(a)))
    top_pts = [(X1 + o, YF - back), (X1 + o, cy)] + arc + [(X1 + o - Rr, YG + o)] + curve[1:] +               [(ax, YF - 6 + o), (x_in - 11, YF - 6 + o), (x_in - 11, YF - back)]
    top_r = [0, 0] + [0] * len(arc) + [0] + [0] * (len(curve) - 2) + [0, 0, 0, 0]
    # elevation: the forward part of each plan slice is pulled back by recess(z) * weight(y), zero at mid-height
    zm = ZB + 0.47 * (g['front_top'] - ZB)
    hh = (g['front_top'] - ZB) / 2

    def shift(x, y, z):
        r = abs(z - zm) / hh
        rec = bulge * min(r, 1.0) ** 2 + (0.0 if r <= 1 else min(1.0, 2.2 * bulge * (r - 1)))
        w = max(0.0, min(1.0, (y - (YF - 2)) / (YG - YF + 2))) ** 1.3
        return x, y - rec * w
    zs = [ZB - 3 + (ZS + top + 6 - (ZB - 3)) * k / 56 for k in range(57)]
    front_pts = fp(top_pts, top_r, seg=8)
    side = [(YF - back, ZB), (YG - bulge + o, ZB), (YG + 2 + o, ZB + 30), (YG + 2 + o, g['front_top']), (fy0 + o, fz0 + o),
            (fy1, fz1 + o), (fy1 - 6, fz1 + o), (YF - back + 1, ZS - 1), (YF - back, ZS - 1)]
    side_r = [0, 7, 0, 12, 6, 3, 3, 2, 0]
    front = [(x_in - 11 - o, ZB), (X1 + o, ZB), (X1 + o, ZS - 6), (X1 - 7, ZS + top + o), (x_in + 5, ZS + top + o), (x_in - 11 - o, ZS - 3)]
    front_r = [0, 10, 8, 5, 4, 3]
    x0, x1, y0, y1, z0, z1 = (x_in - 12, X1 + 2, YF - back, YG + 2, ZB, ZS + top + 2)
    body = S.extrude_profile(name, fp(front, front_r, seg=14), 'y', y0 - 5, y1 + 5)
    S.intersect(body, plan_loft(name + '_plan', front_pts, zs, shift))
    S.intersect(body, S.extrude_profile(name + '_side', fp(side, side_r), 'x', x0 - 5, x1 + 5))
    return body


def keep_wall(inner, g, t):
    """Take out of `inner` (the shrunken copy that hollows a cutaway shell) the grip's skin `t` mm thick round its
    finger channel and its inner face, where the channel stands in front of the body face (score loop r3). The skin
    starts 0.5 mm outside the grip, not on its surface: a cutter face lying on the shell's own face came through the
    boolean as flat-shaded pieces of that face."""
    skin = grip_solid('gripWall', 0.5, g)
    boolean(skin, cube('gripWallBox', g['x_in'] - 6, g['x_in'] + 12, g['YF'] - 1, g['YG'] + 3, g['ZB'] - 3, g['ZS'] + 10),
            'INTERSECT')
    boolean(skin, grip_solid('gripWallIn', -t, g), 'DIFFERENCE')
    return boolean(inner, skin, 'DIFFERENCE')


def fillet_concave(obj, pred, offset, segments=4):
    """Round the concave edges whose midpoint passes pred(x, y, z) with a real fillet of `offset` mm, so a part unioned
    onto the shell (a hump, a housing) grows out of it instead of sitting on it (R1-FID-E)."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.02)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2), verts=bm.verts, edges=bm.edges)
    edges = []
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.is_convex:
            continue
        if e.link_faces[0].normal.angle(e.link_faces[1].normal) < math.radians(20):
            continue
        m = (e.verts[0].co + e.verts[1].co) / 2
        if pred(m.x, m.y, m.z):
            edges.append(e)
    if edges:
        bmesh.ops.bevel(bm, geom=edges + list({v for e in edges for v in e.verts}), offset=offset, offset_type='OFFSET',
                        segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(obj.data); bm.free()
    print('FILLET', obj.name, len(edges), 'edges')
    return obj


def finish(body, bevel=0.9):
    S.finish_shell(body, bevel=bevel, segments=3, angle=30)
    body.data.materials.clear()
    return body


def open_chamber(closed, bore_r, bore_y0, bore_y1, box, solver='MANIFOLD'):
    """Open the closed shell behind the mount (review loop 10/10/2026, B-17): the shell was solid there, so the throat
    ended 4-4.5 mm behind the mount face on a flat painted face and showed neither the mirror nor the sensor. Bores a
    cylinder of bore_r along the axis (bore_y0..bore_y1) and a box chamber box = (x0, x1, y0, y1, z0, z1) for the
    parts that should show through the throat, then re-projects the UVs. Call it after the cutaway copy is made."""
    boolean(closed, cylinder_y('chamberBore', 0, 0, bore_r, bore_y0, bore_y1), 'DIFFERENCE', solver)
    boolean(closed, cube('chamberBox', *box), 'DIFFERENCE', solver)
    C.box_uv(closed)
    return closed


def open_edges(obj, tag=''):
    """Boundary and non-manifold edge counts of obj's mesh (modifiers not applied), after merging vertices closer than
    a micron: what a watertight solid must have none of."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    b = [e for e in bm.edges if e.is_boundary]
    n = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    if tag:
        print('OPEN', tag, obj.name, 'boundary', len(b), 'nonmanifold', n,
              ' '.join('(%.1f %.1f %.1f)' % tuple((e.verts[0].co + e.verts[1].co) / 2) for e in b[:6]))
    bm.free()
    return len(b), n


def seal(bm, gap=0.01, max_hole=3.0):
    """Close what the triangulation and the degenerate-edge pass can leave open (score loop r3, 10/11/2026): vertices
    within `gap` mm merged (10 microns: the export's 18-bit positions step 0.6 microns, so no two vertices it keeps
    can fall onto one), what that collapses dissolved, duplicate faces deleted, and any boundary loop shorter than
    `max_hole` mm round filled. Nothing this small is a feature, and a solid shell has no boundary at all."""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=gap)
    bmesh.ops.dissolve_degenerate(bm, dist=gap, edges=bm.edges[:])
    bm.verts.index_update()
    seen, dup = set(), []
    for f in bm.faces:
        k = tuple(sorted(v.index for v in f.verts))
        if k in seen:
            dup.append(f)
        seen.add(k)
    if dup:
        bmesh.ops.delete(bm, geom=dup, context='FACES_ONLY')
    loose = [e for e in bm.edges if not e.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='EDGES')
    bnd = [e for e in bm.edges if e.is_boundary]
    small, done = [], set()
    for e in bnd:                      # walk each boundary loop and keep the short ones
        if e in done:
            continue
        loop, todo = [], [e]
        while todo:
            x = todo.pop()
            if x in done:
                continue
            done.add(x); loop.append(x)
            for v in x.verts:
                todo += [y for y in v.link_edges if y.is_boundary and y not in done]
        if sum(x.calc_length() for x in loop) < max_hole:
            small += loop
    if small:
        new = bmesh.ops.holes_fill(bm, edges=small, sides=0)['faces']
        bmesh.ops.triangulate(bm, faces=[f for f in new if len(f.verts) > 3])
    return len(dup), len(small)


def clean_degenerate(objects=None):
    """Remove what triangulates into zero-area triangles (score loop r1, 10/11/2026): edges under 5 microns (a revolved
    profile's points on the axis, the micro-corners a clamped bevel leaves where three rounds meet), zero-area faces,
    and the extra vertices the booleans leave on straight edges of n-gons, which the exporter's fan triangulation
    turned into slivers of no area. Shape, UVs and materials are unchanged: nothing under 5 microns is a feature, and
    only vertices that lie exactly on a straight edge between two faces go. Returns the number of faces taken out as
    degenerate or duplicate (never the net change, which the triangulation makes negative)."""
    removed = 0
    for o in list(objects if objects is not None else bpy.context.scene.objects):
        if o.type != 'MESH':
            continue
        if o.modifiers:                      # what the exporter would apply anyway (export_apply)
            C.apply_all_modifiers(o)
        bm = bmesh.new(); bm.from_mesh(o.data)
        n0 = len(bm.faces)
        bmesh.ops.dissolve_degenerate(bm, dist=0.005, edges=bm.edges[:])
        n1 = len(bm.faces)
        straight = []
        for v in bm.verts:
            if len(v.link_edges) != 2 or len(v.link_faces) != 2:
                continue
            a = v.link_edges[0].other_vert(v).co - v.co
            b = v.link_edges[1].other_vert(v).co - v.co
            if a.length > 1e-6 and b.length > 1e-6 and a.angle(b) > math.pi - 1e-4:
                straight.append(v)
        if straight:
            bmesh.ops.dissolve_verts(bm, verts=straight)
        # Round 2 (10/11/2026): the n-gons are still triangulated here by the beauty rule, and any triangle left with
        # no area is dissolved, but every corner's normal is then set afresh by flat_normals(). Round 1 stopped at the
        # triangulation, which reshuffled the corners the bevel's custom normals were stored against and left the rear
        # plates' triangles with normals bent up to 45 degrees (a bright wedge across the mirrorless rear, creases on
        # the DSLR's). Leaving the n-gons to the exporter instead was tried and measured: the shading came out the same
        # (flat_normals does not care how a flat face is cut), but its tessellation left more slivers (triangles over
        # 20 mm long with an aspect over 400: DSLR 827 against 494 with the beauty rule, mirrorless 738 against 542).
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3], quad_method='BEAUTY', ngon_method='BEAUTY')
        n2 = len(bm.faces)
        bmesh.ops.dissolve_degenerate(bm, dist=0.005, edges=bm.edges[:])
        n3 = len(bm.faces)
        dup, _filled = seal(bm)
        # faces taken out, not the net change in the face count: triangulating the n-gons adds faces, which made this
        # count negative ("CLEAN -39741 degenerate faces removed", review 10/11/2026)
        removed += max(0, n0 - n1) + max(0, n2 - n3) + dup
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
        flat_normals(o)
    return removed


GATE = math.radians(55.0)       # how far a face may turn from this one and still share its corner's normal (flat_normals)
MAX_DEV = math.radians(19.0)    # the most a corner's normal may lean from its own face's, on a face over CLAMP_AREA
BIG_FACE = 150.0                # mm2: a mesh with a face this large (a shell) takes the area-weighted fan
CLAMP_AREA = 20.0               # mm2: a smaller triangle's shading cannot streak, so it keeps the fan's normal
FLAT_STATS = {}


def flat_normals(obj, min_area=25.0, min_width=4.0, coplanar_deg=1.0, crease_deg=60.0):
    """Set every corner normal of a smooth-shaded mesh so flat plates shade exactly flat (round 2, 10/11/2026).

    A flat feature is a connected set of coplanar faces (normals within coplanar_deg of the largest one's and every
    vertex within 0.02 mm of its plane, joined across smooth edges)
    covering at least min_area mm2 and at least min_width mm across (area over its longest extent in its own plane):
    the rear plate, a side, a box face, a leatherette panel. Narrow coplanar strips, such as a bevel's segments or a
    cylinder's facets, are not features. Each corner's normal is then the area-weighted mean of the faces in its
    smooth fan (the faces round the vertex joined by smooth edges) that are flat features (for a flat face, only those
    within 3 degrees of its own plane), if there are any, and the
    angle-weighted mean of all of them otherwise (Blender's own rule). So a flat face keeps its face normal at every
    corner, a bevel rolls from the flat face's normal over to the next one, and curved surfaces shade as before. This
    is what a Weighted Normal modifier with 'face influence' does, without depending on face-strength data that the
    booleans and the clean-up do not carry. Flat-shaded faces are left alone. Edges where the faces turn more than
    crease_deg (a boolean's section against the shell, a bore's wall against the plate) are marked sharp first:
    smoothing across them bent a face's normals up to 90 degrees."""
    me = obj.data
    if not any(p.use_smooth for p in me.polygons):
        return 0
    bm = bmesh.new(); bm.from_mesh(me)
    bm.normal_update()
    crease = math.radians(crease_deg)
    TINY = 0.1        # mm2: a face this small has no reliable normal of its own (a boolean's sliver); it follows
    flat_tol = math.radians(coplanar_deg)
    for e in bm.edges:
        fs = e.link_faces
        # an edge between two faces of one plane carries no crease, whatever a boolean marked it (score loop r3: the
        # manifold solver's cuts left the grip's flat inner wall on the cutaway shell in pieces split by sharp edges,
        # too small to count as a flat feature, so their corners took bevel-bent normals)
        if not e.smooth and len(fs) == 2 and fs[0].normal.angle(fs[1].normal, 0.0) < flat_tol:
            e.smooth = True
            continue
        if e.smooth and len(fs) == 2 and min(fs[0].calc_area(), fs[1].calc_area()) >= TINY and                 fs[0].normal.angle(fs[1].normal, 0.0) > crease:
            e.smooth = False
    bm.to_mesh(me)
    faces = bm.faces[:]
    for i, f in enumerate(faces):
        f.index = i
    cos_tol = math.cos(math.radians(coplanar_deg))
    area = [f.calc_area() for f in faces]
    region = [-1] * len(faces)
    feature = []
    for f in sorted(faces, key=lambda f: -area[f.index]):     # big faces seed the regions
        if region[f.index] >= 0 or not f.smooth:
            continue
        rid = len(feature)
        region[f.index] = rid
        stack, members, n0, p0 = [f], [f], f.normal.copy(), f.verts[0].co.copy()
        while stack:
            g = stack.pop()
            for e in g.edges:
                if not e.smooth or len(e.link_faces) != 2:
                    continue
                h = e.link_faces[0] if e.link_faces[1] is g else e.link_faces[1]
                if region[h.index] >= 0 or not h.smooth:
                    continue
                if area[h.index] < TINY:          # a sliver joins when it lies in the plane, whatever its own normal
                    if any(abs((v.co - p0).dot(n0)) > 0.005 for v in h.verts):
                        continue
                elif h.normal.dot(n0) < cos_tol or any(abs((v.co - p0).dot(n0)) > 0.02 for v in h.verts):
                    continue
                region[h.index] = rid
                stack.append(h); members.append(h)
        a = sum(area[g.index] for g in members)
        ok = False
        if a >= min_area:
            u = n0.orthogonal().normalized(); w = n0.cross(u)
            pts = {v for g in members for v in g.verts}
            us = [v.co.dot(u) for v in pts]; ws = [v.co.dot(w) for v in pts]
            ext = max(max(us) - min(us), max(ws) - min(ws))
            ok = ext > 0 and a / ext >= min_width
        feature.append(ok)
    flat = [region[f.index] >= 0 and feature[region[f.index]] for f in faces]
    # Score loop r6 (10/11/2026): on a shell, where a big crowned or curved facet sits beside small roll facets, the fan's normal
    # is weighted by angle times area, so the big facet keeps its own lean (angle alone let a 157 mm2 triangle's corner lean 11
    # degrees toward its neighbors' bevel, a streak). Small parts keep the angle weight: a knurled dial's ridges would blur.
    by_area = max(area) > BIG_FACE
    normals = []
    clamped = 0
    for f in faces:
        for l in f.loops:
            if not f.smooth:
                normals.append(f.normal.copy())
                continue
            v = l.vert
            # the smooth fan: faces round v reachable from f across smooth, two-sided edges at v
            fan, todo = {f}, [f]
            while todo:
                g = todo.pop()
                for e in g.edges:
                    if v not in e.verts or not e.smooth or len(e.link_faces) != 2:
                        continue
                    for h in e.link_faces:
                        if h not in fan and h.smooth:
                            fan.add(h); todo.append(h)
            # Score loop r6 (10/11/2026): a fan stops at faces that turn more than GATE from this face. A sliver
            # under TINY keeps an edge smooth whatever its angle, so a hump cheek's long strip reached through one to the
            # rear plate's face (90 degrees away) and took its normal at that end: a streak down the whole strip.
            # in face order, not the set's (memory-address) order: summing the same normals in a different order
            # changed their last bits from run to run, and after the exporter's quantization a few corners' normals,
            # so two exports of the same script differed (score loop r3, 10/11/2026)
            fan = sorted((g for g in fan if g is f or g.normal.angle(f.normal, 0.0) <= GATE), key=lambda g: g.index)
            flats = [g for g in fan if flat[g.index]]
            if flat[f.index]:
                # a flat face keeps its own plane's normal: two flat features meeting on an unbeveled edge (the grip's
                # facet and the top, a hump cheek and the shoulder) crease there instead of both bending toward the
                # other; only planes within 3 degrees of each other (a gently faceted crown) still blend
                flats = [g for g in flats if g.normal.dot(f.normal) > math.cos(math.radians(3.0))]
            n = Vector()
            if flats:
                for g in flats:
                    n += g.normal * area[g.index]
            else:
                for g in fan:
                    lg = next(x for x in g.loops if x.vert is v)
                    n += g.normal * (lg.calc_angle() * (area[g.index] if by_area else 1.0))
            n = n.normalized() if n.length > 1e-12 else f.normal.copy()
            # a backstop: on a face over CLAMP_AREA a corner normal never leans more than MAX_DEV from the face (a large triangle's shading
            # is interpolated from its corners, so a corner far off its face streaks the whole triangle)
            dev = n.angle(f.normal, 0.0)
            if dev > MAX_DEV and area[f.index] > CLAMP_AREA:
                n = f.normal.slerp(n, MAX_DEV / dev)
                clamped += 1
            normals.append(n)
    bm.free()
    me.normals_split_custom_set(normals)
    FLAT_STATS['clamped'] = FLAT_STATS.get('clamped', 0) + clamped
    return sum(flat)


BATTERY_MM = (20.5, 40.0, 56.0)    # EN-EL15c, W x H x D 40 x 56 x 20.5 mm (research/z8.md): thickness across the grip


def battery(center):
    """The battery in the grip (score loop r1, 10/11/2026): an EN-EL15-size block standing on its end, 56 mm tall,
    40 mm front to back and 20.5 mm across, as it slides up into the grip from the base. A labeled block, not a
    model of the cell."""
    w, d, h = BATTERY_MM
    b = C.rounded_box('battery', w, h, d, bevel=1.5, bevel_segments=3, loc=center,
                      material=C.mat_flat('batteryCase', (0.035, 0.036, 0.04), 0.6))
    C.apply_all_modifiers(b)
    return C.set_component(b, 'battery', 'Battery (EN-EL15c size, 40 x 56 x 20.5 mm)')


def half_x(obj, name):
    """A cutaway half of obj: a copy with everything at x < 0 removed and the section capped (score loop r1,
    10/11/2026). A bisect and a hole fill, not a boolean: the exact solver returned nothing for the joined eyecup
    (a loft and a revolved ring sharing faces)."""
    C.apply_all_modifiers(obj)
    half = obj.copy(); half.data = obj.data.copy(); C.link(half)
    half.name = name
    bm = bmesh.new(); bm.from_mesh(half.data)
    bm.transform(half.matrix_basis)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    # at x = 0.05, so its section never shares the plane x = 0 with the cut shell's where the part runs into the wall
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-4, plane_co=(0.05, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
    rim = [e for e in bm.edges if e.is_boundary and all(abs(v.co.x - 0.05) < 1e-3 for v in e.verts)]
    if rim:
        bmesh.ops.holes_fill(bm, edges=rim, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(half.matrix_basis.inverted())
    bm.to_mesh(half.data); bm.free()
    return half


def tidy_loft_caps(obj, steps=(1.5, 1.5)):
    """S.loft caps each end with a single n-gon; under the loft's subdivision surface that n-gon's pole shades as a
    fan of radial streaks. Inset rings keep the rounding at the rim and leave the middle flat (review loop
    10/10/2026, B-16)."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    for th in steps:
        caps = [f for f in bm.faces if len(f.verts) > 4]
        bmesh.ops.inset_individual(bm, faces=caps, thickness=th, use_even_offset=True)
    bm.to_mesh(obj.data); bm.free()
    return obj


def rubber_grip(g, rubber, label):
    """The grip's leatherette: the grip solid 0.5 mm proud, from just above the base plate to below the front dial."""
    r = grip_solid('grip', 0.5, g)
    r.data.materials.clear()
    r.data.materials.append(rubber)
    # a 1.1 mm skin, not a solid (score loop r1, 10/11/2026): as a solid it filled the grip, so the cutaway could not
    # show the battery inside it; the skin's inner face lies inside the shell's grip wall. The inner face takes the
    # rubber's plain twin (score loop r5, 10/11/2026): the pebble belongs on the outside, and the cutaway looks into the skin.
    inner = grip_solid('gripInner', -0.6, g)
    twin = C.plain_twin(rubber)
    if twin is not None:
        inner.data.materials.clear()
        inner.data.materials.append(twin)
    boolean(r, inner, 'DIFFERENCE', transfer_materials=True)
    clip = cube('gripClip', g['x_in'] - 3, g['X1'] + 3, g['YF'] - g['rubber_back'], g['YG'] + 3, g['ZB'] + 2.5, g['rubber_top'])
    S.intersect(r, clip)
    m = r.modifiers.new('bev', 'BEVEL'); m.width = 0.3; m.segments = 2; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(40)
    bpy.context.view_layer.objects.active = r
    bpy.ops.object.shade_smooth()
    r.data.set_sharp_from_angle(angle=math.radians(40))
    return C.set_component(r, 'grip', label)


def place(obj, M):
    obj.matrix_basis = M @ obj.matrix_basis
    return obj


def facet_frame(x, y, g):
    """Where the facet passes through (x, y) and its tilt: returns (point, tilt angle) for parts that sit on it."""
    fy0, fz0, fy1, fz1 = g['facet']
    t = (y - fy1) / (fy0 - fy1)
    z = fz1 + t * (fz0 - fz1)
    tilt = math.atan2(fz1 - fz0, fy0 - fy1)
    return Vector((x, y, z)), tilt


def shutter_assembly(g, x, y, knurl, paint, chrome):
    """The shutter button in its power collar, seated on the grip facet, axis tilted forward with the facet."""
    p, tilt = facet_frame(x, y, g)
    M = Matrix.Translation(p) @ Matrix.Rotation(-tilt, 4, 'X')
    collar = C.revolve('powerSwitch', [(5.9, -0.8), (9.6, -0.8), (10.0, 0.6), (9.6, 1.6), (5.9, 1.6)], C.ring_thetas(72), True,
                       knurl, sharp_deg=35)
    C.orient(collar, 'Z', (0, 0, 0))
    lever = C.rounded_box('powerLever', 4.0, 1.8, 6.5, bevel=0.6, bevel_segments=2, loc=(0, 0, 0), material=knurl)
    lever.location = (6.5, 7.5, 0.4)
    lever.rotation_euler = (0, 0, math.radians(-35))
    sw = C.join([collar, lever], 'powerSwitch')
    place(sw, M)
    C.set_component(sw, 'powerSwitch', 'Power switch (the collar around the shutter button)')
    btn = C.disc('shutterButton', 5.4, 2.6, knurl, axis='Z', loc=(0, 0, -0.6), ch=0.45, dome=0.35, seg=64)
    place(btn, M)
    return C.set_component(btn, 'shutterButton', 'Shutter button')


def slot_for_dial(body, axis, center, r, h, clearance=0.8, reach=None):
    """Cut a pocket for a sunk dial: a box round the dial's disc, open on the side it shows through."""
    cx, cy, cz = center
    if axis == 'Z':        # base at cz, disc spans z cz..cz+h
        cut = cube('slot', cx - r - clearance, cx + r + clearance, cy - r - clearance, reach, cz - clearance, cz + h + clearance)
    else:                  # 'X': base at cx, disc spans x cx..cx+h
        cut = cube('slot', cx - clearance, cx + h + clearance, reach, cy + r + clearance, cz - r - clearance, cz + r + clearance)
    return boolean(body, cut, 'DIFFERENCE')


def button(name, r, h, mat, x, y, z, axis='-Y', dome=0.2):
    return C.disc(name, r, h, mat, axis=axis, loc=(x, y, z), ch=min(0.4, h * 0.4), dome=dome, seg=40)


def _offset_convex(pts, dist):
    """A convex counterclockwise polygon [(x, y), ...] moved outward by dist (inward when negative)."""
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


def seam_groove(body, plan_pts, plan_radii, z0, width=0.5, depth=0.3, skip=(), seg=12, half=False):
    """A shallow parting-line groove round a body at height z0 (score loop r5, 10/11/2026): the covers of a real camera meet
    at a seam, and the model's shells were unbroken planes. The groove follows the body's plan outline (the same filleted
    polygon its shell was built from) `depth` mm in, `width` mm tall, and is left out of the boxes in `skip`
    [(x0, x1, y0, y1), ...] where another part runs over the seam (the prism housing's nose, the grip, the eyepiece block).
    The model's own detail, generic: no maker publishes where the seams run. Cut after the shell's bevel, which would
    otherwise round the groove's edges away."""
    outer = S.fillet_polygon(_offset_convex(plan_pts, 1.0), [r + 1.0 if r > 0 else 0 for r in plan_radii], seg=seg)
    inner = S.fillet_polygon(_offset_convex(plan_pts, -depth), [max(r - depth, 0.5) if r > 0 else 0 for r in plan_radii], seg=seg)
    ring = C.plate('seamRing', outer, z0, z0 + width, None, axis='z', bevel=0)
    boolean(ring, C.plate('seamHole', inner, z0 - 1.0, z0 + width + 1.0, None, axis='z', bevel=0), 'DIFFERENCE')
    for k, (x0, x1, y0, y1) in enumerate(skip):
        boolean(ring, cube(f'seamSkip{k}', x0, x1, y0, y1, z0 - 1.0, z0 + width + 1.0), 'DIFFERENCE')
    boolean(body, ring, 'DIFFERENCE')
    # A dark gasket in the groove (score loop r6, 10/11/2026): on the satin paint the groove's lower wall caught the key light
    # and drew as a bright one-pixel hairline, dashed at a distance, so the seam read as a scratch. A seam is a shadow. The
    # groove is filled with a flat near-black ring ('seamShadow', the screen seam's own material) sitting 0.04 mm under the
    # shell's surface, so the line reads dark from any angle and the paint's walls hardly show. A separate part, not a second
    # material on the shell: the app treats the shell as one mesh of one material (the cutaway, the picking and the
    # highlight). It follows the shell's two forms: the whole ring for the closed shell ('full'), the x >= 0 half for the
    # cut shell ('half'), as the eyecup does.
    eps = 0.04
    shadow = bpy.data.materials.get('seamShadow') or C.mat_flat('seamShadow', (0.004, 0.004, 0.004), 0.9)
    g_out = S.fillet_polygon(_offset_convex(plan_pts, -eps), [max(r - eps, 0.5) if r > 0 else 0 for r in plan_radii], seg=seg)
    g_in = S.fillet_polygon(_offset_convex(plan_pts, -depth + eps), [max(r - depth + eps, 0.5) if r > 0 else 0 for r in plan_radii], seg=seg)
    gasket = C.plate('seamGasket', g_out, z0 + eps, z0 + width - eps, shadow, axis='z', bevel=0)
    boolean(gasket, C.plate('seamGasketHole', g_in, z0 - 1.0, z0 + width + 1.0, None, axis='z', bevel=0), 'DIFFERENCE')
    for k, (x0, x1, y0, y1) in enumerate(skip):
        boolean(gasket, cube(f'seamGasketSkip{k}', x0, x1, y0, y1, z0 - 1.0, z0 + width + 1.0), 'DIFFERENCE')
    if half:
        h = half_x(gasket, 'seamGasketCut')
        bpy.data.objects.remove(gasket, do_unlink=True)
        h['cutaway'] = 'half'
        return h
    gasket['cutaway'] = 'full'
    return gasket


def screen_diag_mm(diag_in, aspect):
    """The (width, height) in mm of a display's active area from its diagonal in inches and its aspect ratio."""
    d = diag_in * 25.4
    return d * aspect / math.hypot(aspect, 1.0), d / math.hypot(aspect, 1.0)


def screen_unit(cx, cz, w, h, YB, paint, screen, label, active=None):
    """A tilting rear screen: a frame 3.4 mm proud of the back, the glass inset in it, and the hinge along its top.

    active (round 2, 10/11/2026): the panel's active area (width, height) in mm, from the maker's diagonal. The glass
    in the frame's opening was taken as the picture, which made both screens 3.6-3.7 in. across against the 3.2 in.
    Nikon publishes; the opening keeps its size, the picture ('rearScreen') is the active area, and a black mask under
    the cover glass fills the border between them, as on a real panel."""
    frame = C.plate('screenFrame', C.rounded_rect(cx, cz, w, h, 4.0), YB - 3.4, YB - 0.1, paint, bevel=0.9, seg=3)
    if active:
        aw, ah = active
        assert aw <= w - 7.0 and ah <= h - 7.6, 'the active area must fit the frame opening'
        # the mask is the cover glass's black border, with a window the picture shows through 0.05 mm back from it,
        # so the step between them is the mask's own dark wall (a picture standing proud of the mask lit its thin
        # edge as a row of sparkles in the renders)
        mask = C.plate('screenMask', C.rounded_rect(cx, cz - 0.8, w - 7.0, h - 7.6, 2.0), YB - 3.52, YB - 2.9,
                       C.mat_flat('screenMask', (0.008, 0.008, 0.009), 0.25), bevel=0.2)
        C.apply_all_modifiers(mask)
        boolean(mask, C.plate('screenWindow', C.rounded_rect(cx, cz - 0.8, aw, ah, 0.6), YB - 3.8, YB - 3.2, None, bevel=0), 'DIFFERENCE')
        glass = C.plate('rearScreen', C.rounded_rect(cx, cz - 0.8, aw, ah, 0.6), YB - 3.47, YB - 3.0, screen, bevel=0)
    else:
        glass = C.plate('rearScreen', C.rounded_rect(cx, cz - 0.8, w - 7.0, h - 7.6, 2.0), YB - 3.52, YB - 3.0, screen, bevel=0.2)
    hinge = C.disc('screenHinge', 1.6, w - 16, paint, axis='X', loc=(cx - (w - 16) / 2, YB - 1.9, cz + h / 2 - 0.2), ch=0.3, seg=24)
    seam = C.plate('screenSeam', C.rounded_rect(cx, cz, w - 1.2, h - 1.2, 3.6), YB - 0.1, YB + 0.05,
                   C.mat_flat('seamShadow', (0.004, 0.004, 0.004), 0.9), bevel=0)
    C.set_component(glass, 'rearScreen', label)
    return frame, glass, hinge, seam


def multi_selector(x, z, YB, knurl, paint, lock=False):
    ring = C.revolve('msRing', [(3.8, 0), (7.5, 0), (7.5, -1.4), (7.1, -1.9), (4.2, -1.9), (3.8, -1.5)], C.ring_thetas(64), True,
                     knurl, sharp_deg=35)
    ring.location = (x, YB, z)
    parts = [ring]
    for k in range(4):     # the four direction bumps on the ring
        a = math.radians(90 * k)
        parts.append(C.disc(f'msBump{k}', 0.9, 0.35, knurl, axis='-Y', loc=(x + 5.6 * math.sin(a), YB - 1.85, z + 5.6 * math.cos(a)),
                            ch=0.1, dome=0.15, seg=16))
    parts.append(C.disc('msCenter', 3.2, 1.9, knurl, axis='-Y', loc=(x, YB, z), ch=0.35, dome=0.15, seg=40))
    if lock:               # the lock lever below the selector
        parts.append(C.disc('msLockPivot', 2.4, 0.9, paint, axis='-Y', loc=(x + 1.0, YB, z - 11.5), ch=0.2, seg=24))
        lev = C.rounded_box('msLockLever', 1.6, 6.5, 1.0, bevel=0.35, bevel_segments=2, loc=(x + 3.6, YB - 1.1, z - 12.8), material=knurl)
        lev.rotation_euler = (0, math.radians(-60), 0)
        parts.append(lev)
    ms = C.join(parts, 'multiSelector')
    return C.set_component(ms, 'multiSelector', 'Multi-selector' + (' with its lock lever' if lock else ''))


def sub_selector(x, z, YB, knurl, paint):
    """A knurled nub on a satin base (R1-FID-F: smooth molded parts, not leatherette)."""
    base = C.disc('subSelectorBase', 5.2, 0.8, paint, axis='-Y', loc=(x, YB, z), ch=0.25, seg=40)
    knob = C.knurl_dial('subSelectorKnob', 4.0, 3.4, 40, 0.22, knurl, top_mat=paint, axis='-Y', loc=(x, YB - 0.5, z), ch=0.6)
    cap = C.disc('subSelectorCap', 3.1, 0.35, paint, axis='-Y', loc=(x, YB - 3.85, z), ch=0.1, dome=0.35, seg=40)
    j = C.join([base, knob, cap], 'subSelector')
    return C.set_component(j, 'subSelector', 'Sub-selector (a joystick for the focus point)')


SATIN = None
def af_on(x, z, YB, _unused=None):
    """Smooth satin black, like the molded button it is (R1-FID-F), with no grain map."""
    global SATIN
    if SATIN is None or SATIN.name not in bpy.data.materials:
        SATIN = C.mat_satin_black_paint('buttonSatin', textured=False)
    b = C.disc('afOnButton', 4.6, 1.8, SATIN, axis='-Y', loc=(x, YB, z), ch=0.5, dome=0.2, seg=40)
    return C.set_component(b, 'afOnButton', 'AF-ON button (focus with the thumb)')


def leather_front(X0, x_right, zb, zt, YF, boss_r, rubber):
    """The leatherette on the front, beside the mount on the far side from the grip, cut round the mount boss."""
    p = C.plate('frontRubber', C.rounded_rect((X0 + x_right) / 2, (zb + zt) / 2, x_right - X0, zt - zb, 3.0), YF - 0.3, YF + 0.6,
                rubber, bevel=0.3)
    C.apply_all_modifiers(p)
    return boolean(p, cylinder_y('bossCut', 0, 0, boss_r + 1.4, YF - 2, YF + 3), 'DIFFERENCE')


def leather_rear(x0, x1, zb, zt, YB, rubber):
    return C.plate('thumbRubber', C.rounded_rect((x0 + x1) / 2, (zb + zt) / 2, x1 - x0, zt - zb, 5.0), YB - 0.6, YB + 0.3, rubber, bevel=0.3)


def port_doors(X0, doors, rubber):
    """Rubber doors over the ports on the left side (seen from behind), each 0.6 mm proud with a gap between them.
    doors: [(y center, z center, width along y, height), ...]."""
    ds = [C.plate(f'portDoor{k}', C.rounded_rect(yc, zc, w, h, 2.5), X0 - 0.6, X0 + 0.3, rubber, axis='x', bevel=0.3)
          for k, (yc, zc, w, h) in enumerate(doors)]
    return C.set_component(C.join(ds, 'portDoor'), 'portDoor', 'Port doors (rubber)')


def split_ring_eyelet(name, side_x, sx, y, z, paint, steel):
    """A strap eyelet: a small boss on the body side with a triangular split ring through it (DSLR)."""
    boss = C.rounded_box(f'{name}Boss', 7.0, 7.0, 6.0, bevel=1.4, bevel_segments=3, loc=(side_x + sx * 0.1, y, z), material=paint)
    tri = [(1.6, 1.6), (9.8, -3.2), (1.6, -8.4)]
    pts = S.fillet_polygon(tri, [1.6, 1.6, 1.6], seg=6)
    cu = bpy.data.curves.new(f'{name}RingCurve', 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, (u, v) in enumerate(pts):
        sp.points[i].co = (side_x + sx * u, y, z + v, 1.0)
    sp.use_cyclic_u = True
    cu.bevel_depth = 0.7
    cu.bevel_resolution = 2
    ob = bpy.data.objects.new(f'{name}Ring_t', cu)
    C.link(ob)
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    ring = bpy.data.objects.new(f'{name}Ring', me)
    C.link(ring)
    for p in me.polygons:
        p.use_smooth = True
    ring.data.materials.clear()
    ring.data.materials.append(steel)
    return C.join([boss, ring], name)


def slotted_lug(name, side_x, sx, y, z, black):
    """A slotted strap lug (mirrorless): a black block standing off the body side with a slot the strap runs through."""
    lug = C.rounded_box(f'{name}Block', 8.0, 9.0, 10.0, bevel=1.6, bevel_segments=3, loc=(side_x + sx * 0.7, y, z), material=black)
    C.apply_all_modifiers(lug)
    slot = cube(f'{name}Slot', side_x + sx * 2.4 - 1.2, side_x + sx * 2.4 + 1.2, y - 6, y + 6, z - 3.2, z + 3.2)
    return boolean(lug, slot, 'DIFFERENCE')


def top_lcd(cx, cy, w, d, ZS, paint, lcd, label):
    # the bezel's underside stops 1.0 mm under the top plate, inside the cut shell's top wall (1.2-1.8 mm on the two
    # bodies): at 1.8 mm it lay in the hollowed mirrorless shell's inner ceiling, the same plane facing the same way,
    # and at 1.5 mm in the DSLR's (z-fighting pairs in the cutaway, score loop r1, 10/11/2026)
    bez = C.plate('topLcdBezel', C.rounded_rect(cx, cy, w, d, 2.5), ZS - 1.0, ZS + 0.6, paint, axis='z', bevel=0.3)
    C.apply_all_modifiers(bez)
    boolean(bez, cube('lcdCut', cx - w / 2 + 2.2, cx + w / 2 - 2.2, cy - d / 2 + 2.2, cy + d / 2 - 2.2, ZS - 1, ZS + 2), 'DIFFERENCE')
    panel = C.plate('topLcd', C.rounded_rect(cx, cy, w - 4.6, d - 4.6, 1.2), ZS - 0.3, ZS + 0.42, lcd, axis='z', bevel=0.1)
    C.set_component(panel, 'topLcd', label)
    return bez, panel
