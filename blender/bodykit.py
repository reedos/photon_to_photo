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


def fp(pts, radii, seg=10):
    return S.fillet_polygon(pts, radii, seg=seg)


def solid(name, front, top, side, box):
    """The intersection of three extruded outlines (front (x, z), top (x, y), side (y, z)), as silhouette.py."""
    return S.shell_from_profiles(name, front, top, side, box)


def boolean(obj, other, op):
    mod = obj.modifiers.new('bool', 'BOOLEAN')
    mod.operation = op
    mod.solver = 'EXACT'
    mod.object = other
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
    curve = []
    for k in range(20, -1, -1):
        t = k / 20
        mt = 1 - t
        curve.append((mt ** 3 * ax + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * bx,
                      mt ** 3 * ay + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * by))
    arc = []
    Rr = R + o
    cx, cy = X1 + o - Rr, YG + o - Rr
    for k in range(1, 18):             # from the side (angle 0) round to the front (90 degrees), side end first
        a = math.radians(90 * k / 18)
        arc.append((cx + Rr * math.cos(a), cy + Rr * math.sin(a)))
    top_pts = [(X1 + o, YF - back), (X1 + o, cy)] + arc + [(X1 + o - Rr, YG + o)] + curve[1:] +               [(ax, YF + o), (x_in - 10, YF + o), (x_in - 10, YF - back)]
    top_r = [0, 0] + [0] * len(arc) + [0] + [0] * (len(curve) - 2) + [0, 3.2, 0, 0]
    # elevation: the forward part of each plan slice is pulled back by recess(z) * weight(y), zero at mid-height
    zm = ZB + 0.47 * (g['front_top'] - ZB)
    hh = (g['front_top'] - ZB) / 2

    def shift(x, y, z):
        r = abs(z - zm) / hh
        rec = bulge * min(r, 1.0) ** 2 + (0.0 if r <= 1 else min(1.0, 2.2 * bulge * (r - 1)))
        w = max(0.0, min(1.0, (y - (YF - 2)) / (YG - YF + 2))) ** 1.3
        return x, y - rec * w
    zs = [ZB - 3 + (ZS + top + 6 - (ZB - 3)) * k / 28 for k in range(29)]
    front_pts = fp(top_pts, top_r, seg=8)
    side = [(YF - back, ZB), (YG - bulge + o, ZB), (YG + 2 + o, ZB + 30), (YG + 2 + o, g['front_top']), (fy0 + o, fz0 + o),
            (fy1, fz1 + o), (fy1 - 6, fz1 + o), (YF - back + 1, ZS - 1), (YF - back, ZS - 1)]
    side_r = [0, 7, 0, 12, 6, 3, 3, 2, 0]
    front = [(x_in - 10 - o, ZB), (X1 + o, ZB), (X1 + o, ZS - 6), (X1 - 7, ZS + top + o), (x_in + 5, ZS + top + o), (x_in - 10 - o, ZS - 3)]
    front_r = [0, 10, 8, 5, 4, 3]
    x0, x1, y0, y1, z0, z1 = (x_in - 12, X1 + 2, YF - back, YG + 2, ZB, ZS + top + 2)
    body = S.extrude_profile(name, fp(front, front_r, seg=12), 'y', y0 - 5, y1 + 5)
    S.intersect(body, plan_loft(name + '_plan', front_pts, zs, shift))
    S.intersect(body, S.extrude_profile(name + '_side', fp(side, side_r), 'x', x0 - 5, x1 + 5))
    return body


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


def rubber_grip(g, rubber, label):
    """The grip's leatherette: the grip solid 0.5 mm proud, from just above the base plate to below the front dial."""
    r = grip_solid('grip', 0.5, g)
    clip = cube('gripClip', g['x_in'] - 3, g['X1'] + 3, g['YF'] - g['rubber_back'], g['YG'] + 3, g['ZB'] + 2.5, g['rubber_top'])
    S.intersect(r, clip)
    m = r.modifiers.new('bev', 'BEVEL'); m.width = 0.3; m.segments = 2; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(40)
    bpy.context.view_layer.objects.active = r
    bpy.ops.object.shade_smooth()
    r.data.set_sharp_from_angle(angle=math.radians(40))
    r.data.materials.clear()
    r.data.materials.append(rubber)
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
    C.set_component(sw, 'powerSwitch', 'Power switch (the collar round the shutter button)')
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


def screen_unit(cx, cz, w, h, YB, paint, screen, label):
    """A tilting rear screen: a frame 3.4 mm proud of the back, the glass inset in it, and the hinge along its top."""
    frame = C.plate('screenFrame', C.rounded_rect(cx, cz, w, h, 4.0), YB - 3.4, YB - 0.1, paint, bevel=0.9, seg=3)
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
    bez = C.plate('topLcdBezel', C.rounded_rect(cx, cy, w, d, 2.5), ZS - 1.8, ZS + 0.6, paint, axis='z', bevel=0.3)
    C.apply_all_modifiers(bez)
    boolean(bez, cube('lcdCut', cx - w / 2 + 2.2, cx + w / 2 - 2.2, cy - d / 2 + 2.2, cy + d / 2 - 2.2, ZS - 1, ZS + 2), 'DIFFERENCE')
    panel = C.plate('topLcd', C.rounded_rect(cx, cy, w - 4.6, d - 4.6, 1.2), ZS - 0.3, ZS + 0.42, lcd, axis='z', bevel=0.1)
    C.set_component(panel, 'topLcd', label)
    return bez, panel
