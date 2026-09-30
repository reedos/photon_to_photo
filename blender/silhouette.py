"""Silhouette modeling for the camera bodies (lead, 09/28/2026).

A convincing product shell comes from its outlines, not from stacked primitives: the body is the intersection of
three extruded profiles (front, top, side), each a closed 2D outline with filleted corners, followed by an edge
bevel and weighted normals. Frame and units as common.py: mm; Blender X = camera right seen from behind, Y = optical
depth (mount face at Y = +flange, sensor at Y = 0, the back of the body at negative Y), Z = up (optical axis at Z = 0).
"""
import bpy
import bmesh
import math
from mathutils import Vector

import common as C


def fillet_polygon(pts, radii, seg=10):
    """A closed polygon [(u, v), ...] with a fillet of radius radii[i] at vertex i (0 = sharp)."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        r = radii[i]
        if r <= 0:
            out.append(tuple(p1))
            continue
        a, b = (p0 - p1).normalized(), (p2 - p1).normalized()
        ang = math.acos(max(-1.0, min(1.0, a.dot(b))))
        t = r / math.tan(ang / 2)
        t = min(t, (p0 - p1).length * 0.49, (p2 - p1).length * 0.49)
        r = t * math.tan(ang / 2)
        s, e = p1 + a * t, p1 + b * t
        bis = (a + b).normalized()
        ctr = p1 + bis * (r / math.sin(ang / 2))
        v0, v1 = s - ctr, e - ctr
        a0, a1 = math.atan2(v0.y, v0.x), math.atan2(v1.y, v1.x)
        d = a1 - a0
        while d > math.pi: d -= 2 * math.pi
        while d < -math.pi: d += 2 * math.pi
        for k in range(seg + 1):
            ang_k = a0 + d * k / seg
            out.append((ctr.x + r * math.cos(ang_k), ctr.y + r * math.sin(ang_k)))
    return out


def extrude_profile(name, outline, axis, lo, hi):
    """Extrude a closed outline in the plane normal to `axis` ('x', 'y' or 'z') from lo to hi along that axis.
    Outline coordinates: axis 'y' -> (x, z); axis 'z' -> (x, y); axis 'x' -> (y, z)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    def P(u, v, w):
        return {'y': (u, w, v), 'z': (u, v, w), 'x': (w, u, v)}[axis]
    bot = [bm.verts.new(P(u, v, lo)) for (u, v) in outline]
    top = [bm.verts.new(P(u, v, hi)) for (u, v) in outline]
    bm.faces.new(bot)
    bm.faces.new(list(reversed(top)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bot[i], bot[j], top[j], top[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    C.link(obj)
    return obj


def intersect(obj, cutter):
    mod = obj.modifiers.new('isect', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def finish_shell(obj, bevel=2.2, segments=5, angle=35):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # merge boolean slivers before beveling
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.02)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2), verts=bm.verts, edges=bm.edges)
    bm.to_mesh(obj.data); bm.free()
    bev = obj.modifiers.new('bevel', 'BEVEL')
    bev.width = bevel; bev.segments = segments; bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(angle); bev.harden_normals = True; bev.miter_outer = 'MITER_ARC'
    wn = obj.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True
    bpy.ops.object.shade_smooth()
    return obj


def superellipse(cx, cy, a, b, n=3.2, seg=48):
    """Points of |x/a|^n + |y/b|^n = 1 around (cx, cy): n = 2 is an ellipse, larger n squarer."""
    pts = []
    for k in range(seg):
        t = 2 * math.pi * k / seg
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + b * math.copysign(abs(s) ** (2 / n), s)))
    return pts


def loft(name, sections, cap=True):
    """Loft closed rings of equal point count. sections: list of lists of (x, y, z)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    m = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    C.link(obj)
    sub = obj.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 3
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    return obj


def shell_from_profiles(name, front, top, side, box):
    """box = (x0, x1, y0, y1, z0, z1) extents; front: (x, z) outline; top: (x, y); side: (y, z)."""
    x0, x1, y0, y1, z0, z1 = box
    body = extrude_profile(name, front, 'y', y0 - 5, y1 + 5)
    intersect(body, extrude_profile(name + '_top', top, 'z', z0 - 5, z1 + 5))
    intersect(body, extrude_profile(name + '_side', side, 'x', x0 - 5, x1 + 5))
    return body
