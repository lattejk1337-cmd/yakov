# -*- coding: utf-8 -*-
"""
GOTHIC LEAN  -  15-секундный готический эдит под "LIL PEEP - right here"
=========================================================================

Блендер 4.2 LTS ... 5.x  (Eevee).  Один скрипт строит ВСЁ с нуля:

  * готический собор (неф, колонны-пучки, стрельчатые арки, нервюрные своды,
    витражи, роза-окно, башни со шпилями, аркбутаны) + двор-кладбище
    (кованые ворота, надгробия, мёртвые деревья, фонари, лужи, дождь, туман)
  * чёрную дыру (аккреционный диск, фотонное кольцо, линзованный ореол,
    обломки, которые всасывает) - интро "всасывает и вытягивает"
  * "lean" - двойной стаканчик с фиолетовым напитком и льдом на алтаре,
    бутылка сиропа, готический кубок, свечи, лепестки роз
  * 4 персонажа (2 девушки, 2 парня) с арматурой: руки, ноги, голова,
    волосы на цепочках костей (вторичная анимация), одежда
  * 7 шотов-пролётов (FPV/дрон/ручная камера), спид-рампы, whip pan,
    punch-in с отскоком, match cut (стакан -> роза-окно, жидкость -> чёрная дыра),
    глитч/аберрация, тряска, motion blur, DOF
  * компоузинг: хроматическая аберрация, блум, RGB-сплит, блочный глитч,
    вспышки, цветокор
  * монтаж VSE: плёночное зерно, царапины, виньетка, ТВ-шум, лайт-лики,
    дождь поверх, музыка (32.0 c - 47.0 c трека, дроп на 2.95 c) + SFX,
    которые скрипт синтезирует сам (ТВ-шум, дождь, гром, колокол, свисты,
    удары, глитчи, гул чёрной дыры)

Как запустить:
  1. Положи mp3 рядом со скриптом / в Загрузки / Музыку (или укажи MUSIC_PATH).
  2. Blender -> вкладка Scripting -> Open -> gothic_edit.py -> Run Script.
  3. Откроется сцена GOTH_EDIT (монтаж). Render -> Render Animation (Ctrl+F12).
     Готовое видео: <OUT_DIR>/render/gothic_lean.mp4
"""

import bpy
import bmesh
import math
import os
import glob
import random
import wave
import time
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion
from mathutils import noise as mnoise

# ════════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════════
MUSIC_PATH = ""          # путь к "LIL_PEEP_-_right_here.mp3" ("" = автопоиск)
MUSIC_START = 32.0       # с какой секунды трека начинается эдит (брейк перед дропом)
OUT_DIR = ""             # куда класть ассеты/рендер ("" = ~/GothicEdit)
QUALITY = "FINAL"        # "FINAL" 1080x1920 | "PREVIEW" 540x960 быстрый
SEED = 666

MUSIC_PATH = os.environ.get("GOTH_MUSIC", MUSIC_PATH)
OUT_DIR = os.environ.get("GOTH_OUT", OUT_DIR) or os.path.join(os.path.expanduser("~"), "GothicEdit")
QUALITY = os.environ.get("GOTH_QUALITY", QUALITY)

FPS = 30
DUR = 15.0
F0 = 1
F1 = int(DUR * FPS)      # 450

# биты трека (сек от MUSIC_START), посчитаны librosa: 112 BPM, дроп на 2.946
BEATS_S = [0.229, 0.787, 1.344, 1.878, 2.435, 2.946, 3.480, 4.037, 4.618, 5.245,
           5.825, 6.359, 6.917, 7.451, 7.985, 8.449, 8.983, 9.517, 10.028, 10.539,
           11.096, 11.654, 12.257, 12.768, 13.279, 13.790, 14.277, 14.811]


def sec2f(t):
    return F0 + int(round(t * FPS))


BEATS = [sec2f(t) for t in BEATS_S]
DROP = sec2f(2.946)        # 89  - взрыв после интро
BREAK = sec2f(8.983)       # 270 - бас пропадает: слоумо + match cut
DROP2 = sec2f(11.654)      # 351 - второй удар: финальный пролёт

# Шоты: имя, первый кадр, последний кадр
SHOTS = [
    ("S1_blackhole", 1, 88),
    ("S2_courtyard", 89, 157),
    ("S3_lean_hero", 158, 224),
    ("S4_characters", 225, 269),
    ("S5a_cup_top", 270, 316),
    ("S5b_rose", 317, 350),
    ("S6_flythrough", 351, 420),
    ("S7a_vortex", 421, 432),
    ("S7b_blackhole", 433, 450),
]
SHOT = {n: (a, b) for n, a, b in SHOTS}

BH_POS = Vector((220.0, 520.0, 260.0))   # чёрная дыра в небе справа от башен
CUP_POS = Vector((0.0, 37.0, 1.6))       # двойной стакан на алтаре (дно)

PREFIX = "GOTH"
T_START = time.time()


def log(*a):
    print("[GOTH %5.1fs]" % (time.time() - T_START), *a, flush=True)


rng = random.Random(SEED)

# ════════════════════════════════════════════════════════════════════
# COMPAT (4.2 ... 5.x)
# ════════════════════════════════════════════════════════════════════
BV = bpy.app.version


def eevee_id():
    items = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    return 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in items else 'BLENDER_EEVEE'


def fcurves_of(idb):
    ad = getattr(idb, "animation_data", None)
    if not ad or not ad.action:
        return []
    act = ad.action
    out = []
    if hasattr(act, "layers") and len(act.layers):
        slot = getattr(ad, "action_slot", None)
        for layer in act.layers:
            for strip in layer.strips:
                try:
                    cb = strip.channelbag(slot) if slot else None
                except Exception:
                    cb = None
                if cb:
                    out.extend(cb.fcurves)
        return out
    try:
        return list(act.fcurves)
    except Exception:
        return []


def find_fc(idb, path, index):
    for fc in fcurves_of(idb):
        if fc.data_path == path and fc.array_index == index:
            return fc
    return None


_INTERP = {'CONSTANT': 0, 'LINEAR': 1, 'BEZIER': 2}


def bake(idb, path, index, frames, values, interp='BEZIER', extrap=None):
    """Быстро записывает много ключей в один F-curve (idb - ID, path - путь от ID)."""
    if len(frames) == 0:
        return None
    idb.keyframe_insert(path, index=index, frame=frames[0])
    fc = find_fc(idb, path, max(index, 0))
    if fc is None:
        fc = find_fc(idb, path, index)
    if fc is None:
        for f, v in zip(frames, values):     # fallback: медленно, но надёжно
            _set_path(idb, path, index, v)
            idb.keyframe_insert(path, index=index, frame=f)
        return None
    kp = fc.keyframe_points
    try:
        kp.clear()
    except Exception:
        while len(kp):
            kp.remove(kp[0], fast=True)
    n = len(frames)
    kp.add(n)
    co = np.empty(n * 2, dtype=np.float32)
    co[0::2] = frames
    co[1::2] = values
    kp.foreach_set("co", co)
    kp.foreach_set("interpolation", [_INTERP[interp]] * n)
    try:
        kp.foreach_set("handle_left_type", [4] * n)    # AUTO_CLAMPED
        kp.foreach_set("handle_right_type", [4] * n)
    except Exception:
        pass
    if extrap:
        fc.extrapolation = extrap
    fc.update()
    return fc


def _set_path(idb, path, index, v):
    obj, attr = idb.path_resolve(path.rsplit(".", 1)[0]) if "." in path else idb, path.rsplit(".", 1)[-1]
    if index >= 0:
        getattr(obj, attr)[index] = v
    else:
        setattr(obj, attr, v)


def key(idb, path, frame, value, index=-1, interp=None):
    _set_path(idb, path, index, value)
    idb.keyframe_insert(path, index=index, frame=frame)
    if interp:
        fc = find_fc(idb, path, max(index, 0))
        if fc:
            for k in fc.keyframe_points:
                if abs(k.co[0] - frame) < 0.01:
                    k.interpolation = interp


def set_interp_all(idb, interp):
    for fc in fcurves_of(idb):
        for k in fc.keyframe_points:
            k.interpolation = interp


def sock_key(tree, sock, frame, value):
    """ключ на default_value сокета нода (tree - ID node tree)"""
    sock.default_value = value
    tree.keyframe_insert(sock.path_from_id("default_value"), frame=frame)


def socket_bake(tree, sock, frames, values, interp='BEZIER'):
    path = sock.path_from_id("default_value")
    sock.default_value = values[0]
    return bake(tree, path, -1, frames, values, interp)


def try_set(obj, attr, value):
    try:
        setattr(obj, attr, value)
        return True
    except Exception:
        return False


# ════════════════════════════════════════════════════════════════════
# CLEANUP + SCENES + COLLECTIONS
# ════════════════════════════════════════════════════════════════════
def cleanup():
    if bpy.context.object and getattr(bpy.context.object, "mode", "OBJECT") != 'OBJECT':
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass
    for sc in list(bpy.data.scenes):
        if sc.name.startswith(PREFIX) and len(bpy.data.scenes) > 1:
            bpy.data.scenes.remove(sc)
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                 bpy.data.armatures, bpy.data.cameras, bpy.data.lights, bpy.data.node_groups,
                 bpy.data.particles, bpy.data.collections, bpy.data.worlds, bpy.data.images,
                 bpy.data.actions, bpy.data.sounds):
        for d in list(coll):
            if d.name.startswith(PREFIX):
                try:
                    coll.remove(d)
                except Exception:
                    pass


def make_scene(name):
    win = bpy.context.window
    if win is None:
        # фоновый режим: используем текущую сцену
        sc = bpy.context.scene
        for ob in list(sc.collection.objects):
            bpy.data.objects.remove(ob)
        sc.name = name
    else:
        sc = bpy.data.scenes.new(name)
        win.scene = sc
    return sc


COLLS = {}


def coll(name, parent=None):
    full = PREFIX + "_" + name
    if full in COLLS:
        return COLLS[full]
    c = bpy.data.collections.new(full)
    (parent or SC3D.collection).children.link(c)
    COLLS[full] = c
    return c


# ════════════════════════════════════════════════════════════════════
# MESH BUILDER
# ════════════════════════════════════════════════════════════════════
def look_rot(direction, up=Vector((0, 0, 1))):
    """матрица 3x3, переводящая +Z в direction"""
    d = Vector(direction).normalized()
    return d.to_track_quat('Z', 'Y').to_matrix()


class MB:
    """bmesh-конструктор с материалами по индексам и UV"""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def _new_faces(self, n0, mat, smooth=False):
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[n0:]:
            f.material_index = mat
            f.smooth = smooth

    def _nf(self):
        self.bm.faces.ensure_lookup_table()
        return len(self.bm.faces)

    def cube(self, center, size, mat=0, rot=None, smooth=False):
        n0 = self._nf()
        R = (rot if rot is not None else Matrix.Identity(3)).to_4x4()
        M = Matrix.Translation(Vector(center)) @ R @ Matrix.Diagonal((size[0], size[1], size[2], 1))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=M, calc_uvs=True)
        self._new_faces(n0, mat, smooth)

    def cyl(self, p0, p1, r0, r1=None, segs=16, mat=0, cap=True, smooth=True):
        p0, p1 = Vector(p0), Vector(p1)
        r1 = r0 if r1 is None else r1
        L = (p1 - p0).length
        if L < 1e-6:
            return
        n0 = self._nf()
        M = Matrix.Translation((p0 + p1) / 2) @ look_rot(p1 - p0).to_4x4()
        bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=segs,
                              radius1=r0, radius2=r1, depth=L, matrix=M, calc_uvs=True)
        self._new_faces(n0, mat, smooth)

    def sphere(self, c, r, mat=0, u=16, v=10, smooth=True, rot=None):
        n0 = self._nf()
        if not hasattr(r, "__len__"):
            r = (r, r, r)
        R = (rot if rot is not None else Matrix.Identity(3)).to_4x4()
        M = Matrix.Translation(Vector(c)) @ R @ Matrix.Diagonal((r[0], r[1], r[2], 1))
        bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=1.0, matrix=M, calc_uvs=True)
        self._new_faces(n0, mat, smooth)

    def ico(self, c, r, mat=0, sub=1, jitter=0.0, smooth=False, rnd=None):
        n0 = self._nf()
        if not hasattr(r, "__len__"):
            r = (r, r, r)
        M = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((r[0], r[1], r[2], 1))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=1.0, matrix=M, calc_uvs=True)
        if jitter and rnd:
            for v in res["verts"]:
                v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
        self._new_faces(n0, mat, smooth)

    def torus(self, c, R, r, mat=0, seg=32, rseg=8, rot=None, smooth=True):
        rot = rot if rot is not None else Matrix.Identity(3)
        c = Vector(c)
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                ring.append(self.bm.verts.new(c + rot @ p))
            rings.append(ring)
        for i in range(seg):
            for j in range(rseg):
                a, b = rings[i], rings[(i + 1) % seg]
                f = self.bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
                f.material_index = mat
                f.smooth = smooth

    def lathe(self, prof, segs=32, mat=0, c=(0, 0, 0), smooth=True, cap_bottom=True, cap_top=False, rot=None):
        """prof: [(r, z), ...] снизу вверх"""
        c = Vector(c)
        rot = rot if rot is not None else Matrix.Identity(3)
        rings = []
        for k, (r, z) in enumerate(prof):
            ring = []
            for i in range(segs):
                a = 2 * math.pi * i / segs
                ring.append(self.bm.verts.new(c + rot @ Vector((r * math.cos(a), r * math.sin(a), z))))
            rings.append(ring)
        uvl = self.uv
        nk = len(prof)
        for k in range(nk - 1):
            for i in range(segs):
                a, b = rings[k], rings[k + 1]
                f = self.bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
                f.material_index = mat
                f.smooth = smooth
                uvs = [(i / segs, k / (nk - 1)), ((i + 1) / segs, k / (nk - 1)),
                       ((i + 1) / segs, (k + 1) / (nk - 1)), (i / segs, (k + 1) / (nk - 1))]
                for lp, uv in zip(f.loops, uvs):
                    lp[uvl].uv = uv
        if cap_bottom and prof[0][0] > 1e-5:
            f = self.bm.faces.new(list(reversed(rings[0])))
            f.material_index = mat
        if cap_top and prof[-1][0] > 1e-5:
            f = self.bm.faces.new(rings[-1])
            f.material_index = mat
        return rings

    def prism(self, pts2d, y0, y1, mat=0, M=None):
        """многоугольник в плоскости XZ, выдавленный по Y (y0..y1). M - доп. матрица"""
        M = M or Matrix.Identity(4)
        front = [self.bm.verts.new(M @ Vector((x, y0, z))) for x, z in pts2d]
        back = [self.bm.verts.new(M @ Vector((x, y1, z))) for x, z in pts2d]
        n = len(pts2d)
        fs = [self.bm.faces.new(front), self.bm.faces.new(list(reversed(back)))]
        for i in range(n):
            j = (i + 1) % n
            fs.append(self.bm.faces.new((front[j], front[i], back[i], back[j])))
        for f in fs:
            f.material_index = mat
        return fs

    def ring_prism(self, inner, outer, y0, y1, mat=0, M=None):
        """арочное кольцо: inner/outer - открытые полилинии одинаковой длины (XZ), выдавлены по Y"""
        M = M or Matrix.Identity(4)
        n = len(inner)
        vi0 = [self.bm.verts.new(M @ Vector((x, y0, z))) for x, z in inner]
        vo0 = [self.bm.verts.new(M @ Vector((x, y0, z))) for x, z in outer]
        vi1 = [self.bm.verts.new(M @ Vector((x, y1, z))) for x, z in inner]
        vo1 = [self.bm.verts.new(M @ Vector((x, y1, z))) for x, z in outer]
        fs = []
        for i in range(n - 1):
            fs.append(self.bm.faces.new((vi0[i], vo0[i], vo0[i + 1], vi0[i + 1])))
            fs.append(self.bm.faces.new((vi1[i + 1], vo1[i + 1], vo1[i], vi1[i])))
            fs.append(self.bm.faces.new((vi0[i + 1], vi1[i + 1], vi1[i], vi0[i])))
            fs.append(self.bm.faces.new((vo0[i], vo1[i], vo1[i + 1], vo0[i + 1])))
        for e in (0, n - 1):
            fs.append(self.bm.faces.new((vi0[e], vi1[e], vo1[e], vo0[e]) if e == 0 else (vo0[e], vo1[e], vi1[e], vi0[e])))
        for f in fs:
            f.material_index = mat
            f.smooth = False
        return fs

    def sweep(self, path, radius, mat=0, segs=8, rect=None, smooth=True, cap=True, up=Vector((0, 0, 1))):
        """труба/брусок вдоль пути. radius - число или список; rect=(w,h) - прямоугольный профиль"""
        path = [Vector(p) for p in path]
        n = len(path)
        if n < 2:
            return
        rads = radius if hasattr(radius, "__len__") else [radius] * n
        rings = []
        prev_side = None
        for i, p in enumerate(path):
            t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
            side = t.cross(up)
            if side.length < 1e-4:
                side = prev_side if prev_side is not None else t.orthogonal()
            side.normalize()
            if prev_side is not None and side.dot(prev_side) < 0:
                side = -side
            prev_side = side
            nrm = side.cross(t).normalized()
            ring = []
            if rect:
                w, h = rect[0] * rads[i] / rads[0] if rads[0] else rect[0], rect[1]
                for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    ring.append(self.bm.verts.new(p + side * sx * w / 2 + nrm * sy * h / 2))
            else:
                for j in range(segs):
                    a = 2 * math.pi * j / segs
                    ring.append(self.bm.verts.new(p + (side * math.cos(a) + nrm * math.sin(a)) * rads[i]))
            rings.append(ring)
        m = len(rings[0])
        for i in range(n - 1):
            for j in range(m):
                a, b = rings[i], rings[i + 1]
                f = self.bm.faces.new((a[j], a[(j + 1) % m], b[(j + 1) % m], b[j]))
                f.material_index = mat
                f.smooth = smooth and not rect
        if cap:
            for r_, rev in ((rings[0], True), (rings[-1], False)):
                try:
                    f = self.bm.faces.new(list(reversed(r_)) if rev else r_)
                    f.material_index = mat
                except ValueError:
                    pass

    def ribbon(self, path, widths, normals, mat=0):
        """лента (прядь волос): UV u - поперёк, v - вдоль"""
        n = len(path)
        left, right = [], []
        for i in range(n):
            t = (Vector(path[min(i + 1, n - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
            side = t.cross(Vector(normals[i])).normalized()
            p = Vector(path[i])
            left.append(self.bm.verts.new(p - side * widths[i] / 2))
            right.append(self.bm.verts.new(p + side * widths[i] / 2))
        for i in range(n - 1):
            f = self.bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
            f.material_index = mat
            f.smooth = True
            for lp, uv in zip(f.loops, ((0, i / (n - 1)), (1, i / (n - 1)), (1, (i + 1) / (n - 1)), (0, (i + 1) / (n - 1)))):
                lp[self.uv].uv = uv
        return left, right

    def grid(self, center, sx, sy, nx, ny, mat=0, zfunc=None):
        c = Vector(center)
        vs = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                x = -sx / 2 + sx * i / nx
                y = -sy / 2 + sy * j / ny
                z = zfunc(x + c.x, y + c.y) if zfunc else 0.0
                row.append(self.bm.verts.new((c.x + x, c.y + y, c.z + z)))
            vs.append(row)
        for j in range(ny):
            for i in range(nx):
                f = self.bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
                f.material_index = mat
                f.smooth = True
                for lp, uv in zip(f.loops, ((i / nx, j / ny), ((i + 1) / nx, j / ny), ((i + 1) / nx, (j + 1) / ny), (i / nx, (j + 1) / ny))):
                    lp[self.uv].uv = uv
        return vs

    def obj(self, name, mats, collection, loc=None):
        me = bpy.data.meshes.new(PREFIX + "_" + name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(PREFIX + "_" + name, me)
        if loc is not None:
            ob.location = loc
        collection.objects.link(ob)
        return ob


def instance(ob, name, loc, rot=(0, 0, 0), scale=(1, 1, 1), collection=None):
    o = bpy.data.objects.new(PREFIX + "_" + name, ob.data)
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    (collection or ob.users_collection[0]).objects.link(o)
    return o


def apply_modifiers(ob):
    vl = SC3D.view_layers[0]
    vl.update()
    dg = vl.depsgraph
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


# ════════════════════════════════════════════════════════════════════
# GOTHIC GEOMETRY HELPERS
# ════════════════════════════════════════════════════════════════════
def arch_curve(span, rise, n=12, base=0.0):
    """стрельчатая арка: точки (x, z) от левой пяты через замок к правой"""
    a = span / 2.0
    rise = max(rise, 1e-3)
    r = (rise * rise + a * a) / (2 * a)
    cl = -a + r                      # центр левой дуги
    th_a = math.acos(max(-1, min(1, -cl / r)))
    left = []
    for i in range(n + 1):
        th = math.pi + (th_a - math.pi) * i / n
        left.append((cl + r * math.cos(th), base + r * math.sin(th)))
    right = [(-x, z) for x, z in reversed(left[:-1])]
    return left + right


def lancet_poly(width, h_rect, rise, n=10, z0=0.0):
    """контур стрельчатого проёма (замкнутый полигон, XZ)"""
    pts = [(-width / 2, z0)]
    pts += arch_curve(width, rise, n, base=z0 + h_rect)
    pts += [(width / 2, z0)]
    # убрать дубликаты соседних точек
    out = []
    for p in pts:
        if not out or (abs(out[-1][0] - p[0]) + abs(out[-1][1] - p[1])) > 1e-5:
            out.append(p)
    return out


# ════════════════════════════════════════════════════════════════════
# MATERIALS (всё процедурное, проработанное)
# ════════════════════════════════════════════════════════════════════
TIME_GROUP = None


def time_group():
    """общий шейдерный нод-группа 'время' (сек), используют все анимированные материалы"""
    global TIME_GROUP
    if TIME_GROUP:
        return TIME_GROUP
    g = bpy.data.node_groups.new(PREFIX + "_Time", 'ShaderNodeTree')
    g.interface.new_socket("Time", in_out='OUTPUT', socket_type='NodeSocketFloat')
    out = g.nodes.new('NodeGroupOutput')
    val = g.nodes.new('ShaderNodeValue')
    val.name = "T"
    g.links.new(val.outputs[0], out.inputs[0])
    socket_bake(g, val.outputs[0], [F0, F1 + 1], [0.0, DUR], interp='LINEAR')
    for fc in fcurves_of(g):
        fc.extrapolation = 'LINEAR'
    TIME_GROUP = g
    return g


class NB:
    """короткий конструктор шейдерных нодов"""

    def __init__(self, mat_or_tree):
        if isinstance(mat_or_tree, bpy.types.Material):
            if not mat_or_tree.use_nodes:
                mat_or_tree.use_nodes = True
            self.nt = mat_or_tree.node_tree
            self.nt.nodes.clear()
            self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        else:
            self.nt = mat_or_tree
            self.out = None
        self._x = 0

    def n(self, typ, **kw):
        node = self.nt.nodes.new(typ)
        self._x -= 1
        node.location = (self._x * 200, (self._x % 5) * 120)
        for k, v in kw.items():
            if k in node.inputs.keys():
                node.inputs[k].default_value = v
            else:
                setattr(node, k, v)
        return node

    def l(self, a, b):
        self.nt.links.new(a, b)

    def time(self):
        g = self.n('ShaderNodeGroup')
        g.node_tree = time_group()
        return g.outputs[0]

    def coord(self, kind='Object'):
        return self.n('ShaderNodeTexCoord').outputs[kind]

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        m = self.n('ShaderNodeMapping')
        self.l(vec, m.inputs['Vector'])
        m.inputs['Scale'].default_value = scale
        m.inputs['Location'].default_value = loc
        m.inputs['Rotation'].default_value = rot
        return m.outputs[0]

    def noise(self, vec=None, scale=5, detail=6, rough=0.55, dist=0.0, w=None, dims='3D'):
        nn = self.n('ShaderNodeTexNoise')
        nn.noise_dimensions = '4D' if w is not None else dims
        if vec is not None:
            self.l(vec, nn.inputs['Vector'])
        nn.inputs['Scale'].default_value = scale
        nn.inputs['Detail'].default_value = detail
        nn.inputs['Roughness'].default_value = rough
        nn.inputs['Distortion'].default_value = dist
        if w is not None:
            if isinstance(w, (int, float)):
                nn.inputs['W'].default_value = w
            else:
                self.l(w, nn.inputs['W'])
        return nn

    def voronoi(self, vec=None, scale=5, feature='F1', rand=1.0, w=None, dims='3D'):
        v = self.n('ShaderNodeTexVoronoi')
        v.feature = feature
        v.voronoi_dimensions = '4D' if w is not None else dims
        if vec is not None:
            self.l(vec, v.inputs['Vector'])
        v.inputs['Scale'].default_value = scale
        v.inputs['Randomness'].default_value = rand
        if w is not None:
            if isinstance(w, (int, float)):
                v.inputs['W'].default_value = w
            else:
                self.l(w, v.inputs['W'])
        return v

    def ramp(self, fac, stops, interp='LINEAR'):
        r = self.n('ShaderNodeValToRGB')
        r.color_ramp.interpolation = interp
        el = r.color_ramp.elements
        while len(el) > 1:
            el.remove(el[-1])
        el[0].position = stops[0][0]
        el[0].color = _rgba(stops[0][1])
        for pos, col in stops[1:]:
            e = el.new(pos)
            e.color = _rgba(col)
        self.l(fac, r.inputs[0])
        return r

    def mix(self, a, b, fac, blend='MIX'):
        m = self.n('ShaderNodeMix')
        m.data_type = 'RGBA'
        m.blend_type = blend
        for val, sock in ((fac, m.inputs[0]), (a, m.inputs[6]), (b, m.inputs[7])):
            if isinstance(val, (tuple, list, str)):
                sock.default_value = _rgba(val)
            elif isinstance(val, (int, float)):
                sock.default_value = val
            else:
                self.l(val, sock)
        return m.outputs[2]

    def math(self, op, a, b=None, clamp=False, c=None):
        m = self.n('ShaderNodeMath')
        m.operation = op
        m.use_clamp = clamp
        for val, sock in ((a, m.inputs[0]), (b, m.inputs[1]), (c, m.inputs[2])):
            if val is None:
                continue
            if isinstance(val, (int, float)):
                sock.default_value = val
            else:
                self.l(val, sock)
        return m.outputs[0]

    def vmath(self, op, a, b=None):
        m = self.n('ShaderNodeVectorMath')
        m.operation = op
        for val, sock in ((a, m.inputs[0]), (b, m.inputs[1])):
            if val is None:
                continue
            if isinstance(val, (tuple, list)):
                sock.default_value = val
            else:
                self.l(val, sock)
        return m.outputs[0] if op not in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else m.outputs[1]

    def sep(self, vec):
        s = self.n('ShaderNodeSeparateXYZ')
        self.l(vec, s.inputs[0])
        return s.outputs

    def comb(self, x=0.0, y=0.0, z=0.0):
        c = self.n('ShaderNodeCombineXYZ')
        for val, sock in ((x, c.inputs[0]), (y, c.inputs[1]), (z, c.inputs[2])):
            if isinstance(val, (int, float)):
                sock.default_value = val
            else:
                self.l(val, sock)
        return c.outputs[0]

    def bump(self, height, strength=0.3, dist=0.05, normal=None):
        b = self.n('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = dist
        self.l(height, b.inputs['Height'])
        if normal is not None:
            self.l(normal, b.inputs['Normal'])
        return b.outputs[0]

    def bsdf(self, **kw):
        p = self.n('ShaderNodeBsdfPrincipled')
        for k, v in kw.items():
            k2 = k.replace("_", " ")
            if k2 not in p.inputs.keys():
                continue
            if isinstance(v, (tuple, list, int, float, str)):
                p.inputs[k2].default_value = _rgba(v) if (isinstance(v, (tuple, list, str)) and p.inputs[k2].type == 'RGBA') else v
            else:
                self.l(v, p.inputs[k2])
        return p

    def emission(self, color, strength=1.0):
        e = self.n('ShaderNodeEmission')
        if isinstance(color, (tuple, list, str)):
            e.inputs['Color'].default_value = _rgba(color)
        else:
            self.l(color, e.inputs['Color'])
        if isinstance(strength, (int, float)):
            e.inputs['Strength'].default_value = strength
        else:
            self.l(strength, e.inputs['Strength'])
        return e

    def output(self, shader, volume=None, displacement=None):
        if shader is not None:
            self.l(shader if isinstance(shader, bpy.types.NodeSocket) else shader.outputs[0], self.out.inputs['Surface'])
        if volume is not None:
            self.l(volume if isinstance(volume, bpy.types.NodeSocket) else volume.outputs[0], self.out.inputs['Volume'])


def _rgba(c):
    if isinstance(c, str):
        c = hexcol(c)
    c = tuple(c)
    return c if len(c) == 4 else (c[0], c[1], c[2], 1.0)


def hexcol(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb]
    return (lin[0], lin[1], lin[2], 1.0)


MATS = {}


def new_mat(name):
    m = bpy.data.materials.new(PREFIX + "_" + name)
    MATS[name] = m
    return m


def mat_render_method(m, blended=False):
    # Eevee Next: DITHERED/BLENDED, legacy: blend_method
    if hasattr(m, "surface_render_method"):
        try_set(m, "surface_render_method", 'BLENDED' if blended else 'DITHERED')
    else:
        try_set(m, "blend_method", 'BLEND' if blended else 'HASHED')


def build_materials():
    log("materials")
    # ── камень кладки (стены) ─────────────────────────────────────────
    m = new_mat("StoneWall")
    b = NB(m)
    o = b.coord('Object')
    x, y, z = b.sep(o)
    uvw = b.comb(b.math('ADD', x, y), z, 0.0)
    br = b.n('ShaderNodeTexBrick', Scale=1.0)
    br.inputs['Mortar Size'].default_value = 0.025
    br.inputs['Mortar Smooth'].default_value = 0.2
    br.inputs['Brick Width'].default_value = 0.9
    br.inputs['Row Height'].default_value = 0.42
    br.inputs['Color1'].default_value = (1, 1, 1, 1)
    br.inputs['Color2'].default_value = (0.55, 0.55, 0.55, 1)
    br.offset = 0.5
    b.l(uvw, br.inputs['Vector'])
    blockvar = br.outputs['Color']
    mortar = br.outputs['Fac']
    n1 = b.noise(o, scale=2.2, detail=8, rough=0.6)
    stone = b.ramp(n1.outputs['Fac'], [(0.25, '#1d1d24'), (0.5, '#3a3840'), (0.75, '#4d4a4c')])
    stone_c = b.mix(stone.outputs[0], blockvar, 0.35, 'MULTIPLY')
    # потёки грязи (вертикальные)
    streak_v = b.mapping(o, scale=(3.0, 3.0, 0.15))
    streak = b.noise(streak_v, scale=4, detail=4)
    grime = b.ramp(streak.outputs['Fac'], [(0.45, '#ffffff'), (0.7, '#3c3c3c')])
    stone_c = b.mix(stone_c, grime.outputs[0], 0.7, 'MULTIPLY')
    base = b.mix(stone_c, '#0b0a0c', mortar)
    pits = b.noise(o, scale=28, detail=10, rough=0.7)
    h = b.math('ADD', b.math('MULTIPLY', b.math('SUBTRACT', 1.0, mortar), 0.6), b.math('MULTIPLY', pits.outputs['Fac'], 0.4))
    wet = b.ramp(b.noise(o, scale=0.6, detail=3).outputs['Fac'], [(0.45, (0.9, 0.9, 0.9)), (0.6, (0.35, 0.35, 0.35))])
    p = b.bsdf(Base_Color=base, Roughness=0.8, Normal=b.bump(h, 0.55, 0.04))
    b.l(wet.outputs[0], p.inputs['Roughness'])
    b.output(p)

    # ── резной камень (колонны, арки, нервюры) ───────────────────────
    m = new_mat("StoneCarved")
    b = NB(m)
    o = b.coord('Object')
    n1 = b.noise(o, scale=3.5, detail=9, rough=0.62)
    vor = b.voronoi(o, scale=6.0, feature='DISTANCE_TO_EDGE')
    cracks = b.ramp(vor.outputs['Distance'], [(0.0, '#000000'), (0.035, '#ffffff')])
    col = b.ramp(n1.outputs['Fac'], [(0.3, '#24232a'), (0.55, '#45434a'), (0.8, '#5c5856')])
    st = b.noise(b.mapping(o, scale=(5, 5, 0.25)), scale=3, detail=3)
    grime = b.ramp(st.outputs['Fac'], [(0.4, '#ffffff'), (0.75, '#4a4a4a')])
    c2 = b.mix(col.outputs[0], grime.outputs[0], 0.8, 'MULTIPLY')
    c3 = b.mix(c2, cracks.outputs[0], 0.6, 'MULTIPLY')
    det = b.noise(o, scale=40, detail=8)
    h = b.math('ADD', b.math('MULTIPLY', cracks.outputs[0], 0.5), b.math('MULTIPLY', det.outputs['Fac'], 0.5))
    p = b.bsdf(Base_Color=c3, Roughness=0.72, Normal=b.bump(h, 0.45, 0.03))
    b.output(p)

    # ── надгробный камень с мхом ──────────────────────────────────────
    m = new_mat("GraveStone")
    b = NB(m)
    o = b.coord('Object')
    nrm = b.n('ShaderNodeNewGeometry').outputs['Normal']
    up = b.sep(nrm)[2]
    mossn = b.noise(o, scale=6, detail=8, rough=0.7)
    moss_mask = b.math('MULTIPLY', b.math('MAXIMUM', up, 0.0), mossn.outputs['Fac'])
    mm = b.ramp(moss_mask, [(0.25, '#000000'), (0.45, '#ffffff')])
    col = b.ramp(b.noise(o, scale=4, detail=8).outputs['Fac'], [(0.3, '#2a2a2e'), (0.7, '#55524f')])
    lich = b.ramp(b.voronoi(o, scale=18).outputs['Distance'], [(0.0, '#6b6b55'), (0.15, '#ffffff')])
    c2 = b.mix(col.outputs[0], lich.outputs[0], 0.5, 'MULTIPLY')
    c3 = b.mix(c2, '#18240f', mm.outputs[0])
    det = b.noise(o, scale=30, detail=10)
    p = b.bsdf(Base_Color=c3, Roughness=0.85, Normal=b.bump(det.outputs['Fac'], 0.5, 0.03))
    b.output(p)

    # ── мраморный пол (шахматка, прожилки, лужи) ───────────────────────
    m = new_mat("Marble")
    b = NB(m)
    o = b.coord('Object')
    chk = b.n('ShaderNodeTexChecker', Scale=1.0)
    b.l(b.mapping(o, scale=(1 / 1.25, 1 / 1.25, 1)), chk.inputs['Vector'])
    chk.inputs['Color1'].default_value = (1, 1, 1, 1)
    chk.inputs['Color2'].default_value = (0, 0, 0, 1)
    tile = chk.outputs['Fac']
    wv = b.n('ShaderNodeTexWave', wave_type='BANDS')
    b.l(o, wv.inputs['Vector'])
    wv.inputs['Scale'].default_value = 0.8
    wv.inputs['Distortion'].default_value = 14.0
    wv.inputs['Detail'].default_value = 9.0
    wv.inputs['Detail Scale'].default_value = 1.6
    veins = b.ramp(wv.outputs['Fac'], [(0.0, '#000000'), (0.06, '#ffffff')])
    white = b.mix('#7a7a80', '#d9d6d2', veins.outputs[0])
    black = b.mix('#7b6b7f', '#050506', veins.outputs[0])
    marble = b.mix(black, white, tile)
    br = b.n('ShaderNodeTexBrick', Scale=1.0)
    b.l(o, br.inputs['Vector'])
    br.inputs['Brick Width'].default_value = 1.25
    br.inputs['Row Height'].default_value = 1.25
    br.inputs['Mortar Size'].default_value = 0.008
    br.offset = 0.0
    grout = br.outputs['Fac']
    marble = b.mix(marble, '#060606', grout)
    pud = b.ramp(b.noise(o, scale=0.35, detail=4).outputs['Fac'], [(0.5, '#000000'), (0.56, '#ffffff')])
    rough = b.mix((0.18, 0.18, 0.18), (0.02, 0.02, 0.02), pud.outputs[0])
    smudge = b.noise(o, scale=12, detail=6)
    rough = b.mix(rough, smudge.outputs['Color'], 0.15)
    p = b.bsdf(Base_Color=marble, Roughness=0.1, Normal=b.bump(b.math('SUBTRACT', 1.0, grout), 0.25, 0.01))
    b.l(rough, p.inputs['Roughness'])
    b.output(p)

    # ── мокрая брусчатка с лужами и рябью от дождя ─────────────────────
    m = new_mat("Cobble")
    b = NB(m)
    o = b.coord('Object')
    t = b.time()
    vor = b.voronoi(b.mapping(o, scale=(1, 1.35, 1)), scale=4.5, feature='F1', rand=0.85)
    edge = b.voronoi(b.mapping(o, scale=(1, 1.35, 1)), scale=4.5, feature='DISTANCE_TO_EDGE', rand=0.85)
    gap = b.ramp(edge.outputs['Distance'], [(0.0, '#000000'), (0.07, '#ffffff')])
    cellc = b.ramp(b.sep(vor.outputs['Color'])[0], [(0.0, '#1a1a1e'), (0.5, '#2e2c30'), (1.0, '#3d3a39')])
    dirt = b.noise(o, scale=3, detail=8)
    stone = b.mix(cellc.outputs[0], dirt.outputs['Color'], 0.15, 'MULTIPLY')
    base = b.mix('#060504', stone, gap.outputs[0])
    pud = b.ramp(b.noise(o, scale=0.12, detail=5, rough=0.6).outputs['Fac'], [(0.47, '#000000'), (0.53, '#ffffff')])
    base = b.mix(base, '#050506', b.math('MULTIPLY', pud.outputs[0], 0.7))
    # рябь: 4D-вороной по времени
    w = b.math('MULTIPLY', t, 2.2)
    rip = b.voronoi(o, scale=7, feature='F1', w=w)
    ring = b.math('SINE', b.math('MULTIPLY', rip.outputs['Distance'], 60.0))
    ringf = b.math('MULTIPLY', ring, b.math('SUBTRACT', 1.0, b.math('MULTIPLY', rip.outputs['Distance'], 2.5), clamp=True))
    dome = b.math('POWER', b.math('SUBTRACT', 1.0, vor.outputs['Distance'], clamp=True), 0.5)
    h_stone = b.math('MULTIPLY', b.math('MULTIPLY', dome, gap.outputs[0]), b.math('SUBTRACT', 1.0, pud.outputs[0]))
    h = b.math('ADD', h_stone, b.math('MULTIPLY', ringf, b.math('MULTIPLY', pud.outputs[0], 0.08)))
    rough = b.mix((0.38, 0.38, 0.38), (0.01, 0.01, 0.01), pud.outputs[0])
    p = b.bsdf(Base_Color=base, Roughness=0.3, Normal=b.bump(h, 0.6, 0.06), Coat_Weight=0.4, Coat_Roughness=0.05)
    b.l(rough, p.inputs['Roughness'])
    b.output(p)

    # ── витраж (свинцовые переплёты, светится) ────────────────────────
    for nm, pal, seed_w in (("Stained", ['#7a0010', '#3b0a6e', '#0a2a7a', '#c07a0a', '#5a0040', '#102a8a'], 0.0),
                            ("StainedRose", ['#8b0016', '#4b0a8a', '#1a3aa0', '#d49a1a', '#6a0a5a', '#a0102a'], 3.3)):
        m = new_mat(nm)
        b = NB(m)
        o = b.coord('Object')
        t = b.time()
        vor = b.voronoi(o, scale=5.0, feature='F1', w=seed_w)
        edge = b.voronoi(o, scale=5.0, feature='DISTANCE_TO_EDGE', w=seed_w)
        stops = [(i / len(pal), c) for i, c in enumerate(pal)]
        glass = b.ramp(b.sep(vor.outputs['Color'])[1], stops, interp='CONSTANT')
        lead = b.ramp(edge.outputs['Distance'], [(0.0, '#000000'), (0.06, '#ffffff')])
        grain = b.noise(o, scale=30, detail=4)
        shimmer = b.noise(o, scale=0.8, w=b.math('MULTIPLY', t, 0.6), detail=2)
        glow = b.math('ADD', 0.6, b.math('MULTIPLY', shimmer.outputs['Fac'], 0.9))
        col = b.mix(glass.outputs[0], grain.outputs['Color'], 0.18, 'OVERLAY')
        col = b.mix('#000000', col, lead.outputs[0])
        e = b.emission(col, 1.0)
        strength = b.math('MULTIPLY', glow, 9.0 if nm == "StainedRose" else 6.0)
        b.l(strength, e.inputs['Strength'])
        p = b.bsdf(Base_Color=col, Roughness=0.15)
        mx = b.n('ShaderNodeAddShader')
        b.l(e.outputs[0], mx.inputs[0])
        b.l(p.outputs[0], mx.inputs[1])
        b.output(mx)

    # ── кованое железо с ржавчиной ───────────────────────────────────
    m = new_mat("Iron")
    b = NB(m)
    o = b.coord('Object')
    rust = b.ramp(b.noise(o, scale=9, detail=10, rough=0.7).outputs['Fac'], [(0.5, '#000000'), (0.62, '#ffffff')])
    col = b.mix('#0d0d10', '#3a1a0c', rust.outputs[0])
    rough = b.mix((0.35, 0.35, 0.35), (0.9, 0.9, 0.9), rust.outputs[0])
    met = b.math('SUBTRACT', 1.0, b.math('MULTIPLY', b.sep(rust.outputs[0])[0], 0.85))
    p = b.bsdf(Base_Color=col, Metallic=0.9, Roughness=0.4,
               Normal=b.bump(b.noise(o, scale=60, detail=6).outputs['Fac'], 0.3, 0.01))
    b.l(rough, p.inputs['Roughness'])
    b.l(met, p.inputs['Metallic'])
    b.output(p)

    # ── золото (подсвечники, кубок) ───────────────────────────────────
    m = new_mat("Gold")
    b = NB(m)
    o = b.coord('Object')
    scr = b.n('ShaderNodeTexWave', wave_type='BANDS')
    b.l(b.mapping(o, scale=(40, 3, 40)), scr.inputs['Vector'])
    scr.inputs['Distortion'].default_value = 20
    dirt = b.ramp(b.noise(o, scale=14, detail=8).outputs['Fac'], [(0.4, '#ffffff'), (0.7, '#4a3a20')])
    col = b.mix('#d4a017', dirt.outputs[0], 0.8, 'MULTIPLY')
    p = b.bsdf(Base_Color=col, Metallic=1.0, Roughness=0.22,
               Normal=b.bump(scr.outputs['Fac'], 0.08, 0.002))
    b.output(p)

    m = new_mat("Silver")
    b = NB(m)
    p = b.bsdf(Base_Color='#b8b8c0', Metallic=1.0, Roughness=0.18)
    b.output(p)

    # ── воск, пламя ──────────────────────────────────────────────────
    m = new_mat("Wax")
    b = NB(m)
    o = b.coord('Object')
    drip = b.noise(b.mapping(o, scale=(8, 8, 1.5)), scale=6, detail=4)
    col = b.ramp(drip.outputs['Fac'], [(0.3, '#d8ccb4'), (0.7, '#efe6d2')])
    p = b.bsdf(Base_Color=col.outputs[0], Roughness=0.45, Subsurface_Weight=0.6,
               Subsurface_Radius=(1.0, 0.45, 0.2), Subsurface_Scale=0.02,
               Normal=b.bump(drip.outputs['Fac'], 0.3, 0.01))
    b.output(p)

    m = new_mat("Flame")
    b = NB(m)
    o = b.coord('Generated')
    t = b.time()
    zz = b.sep(o)[2]
    oi = b.n('ShaderNodeObjectInfo').outputs['Random']
    fl = b.noise(None, scale=1.0, w=b.math('ADD', b.math('MULTIPLY', t, 9.0), b.math('MULTIPLY', oi, 50.0)), dims='1D')
    col = b.ramp(zz, [(0.0, '#ff4a00'), (0.25, '#fff2c0'), (0.6, '#ff9a20'), (1.0, '#a01000')])
    strength = b.math('MULTIPLY', b.math('ADD', 0.55, fl.outputs['Fac']), 45.0)
    e = b.emission(col.outputs[0], strength)
    b.output(e)

    # ── пенопласт (стаканчик) ────────────────────────────────────────
    m = new_mat("Styrofoam")
    b = NB(m)
    o = b.coord('Object')
    beads = b.voronoi(o, scale=900, feature='F1')
    ridge = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
    b.l(o, ridge.inputs['Vector'])
    ridge.inputs['Scale'].default_value = 160
    smud = b.noise(o, scale=60, detail=6)
    col = b.mix('#f1efe8', smud.outputs['Color'], 0.06, 'MULTIPLY')
    h = b.math('ADD', b.math('MULTIPLY', beads.outputs['Distance'], 0.7), b.math('MULTIPLY', ridge.outputs['Fac'], 0.15))
    p = b.bsdf(Base_Color=col, Roughness=0.62, Subsurface_Weight=0.25, Subsurface_Radius=(0.6, 0.6, 0.55),
               Subsurface_Scale=0.004, Normal=b.bump(h, 0.25, 0.0008))
    b.output(p)

    m = new_mat("Ink")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#2a0040', Roughness=0.3, Emission_Color='#7a10ff', Emission_Strength=0.6))

    # ── LEAN: фиолетовая жидкость с воронкой (swirl кейфреймится) ─────
    m = new_mat("Lean")
    b = NB(m)
    o = b.coord('Object')
    t = b.time()
    sw = b.n('ShaderNodeValue')
    sw.name = "Swirl"
    sw.label = "Swirl"
    sw.outputs[0].default_value = 1.0
    xy = b.comb(b.sep(o)[0], b.sep(o)[1], 0.0)
    r = b.vmath('LENGTH', xy)
    # угол поворота: сильнее к центру + время
    ang = b.math('ADD', b.math('MULTIPLY', b.math('DIVIDE', 0.012, b.math('ADD', r, 0.004)), sw.outputs[0]),
                 b.math('MULTIPLY', t, b.math('MULTIPLY', sw.outputs[0], 1.5)))
    vr = b.n('ShaderNodeVectorRotate', rotation_type='Z_AXIS')
    b.l(o, vr.inputs['Vector'])
    b.l(ang, vr.inputs['Angle'])
    swirl = b.noise(b.mapping(vr.outputs[0], scale=(60, 60, 60)), scale=1.0, detail=6, dist=1.5)
    col = b.ramp(swirl.outputs['Fac'], [(0.3, '#2a0050'), (0.5, '#6a10b0'), (0.62, '#a040ff'), (0.75, '#4a0080')])
    emis = b.math('MULTIPLY', b.math('POWER', swirl.outputs['Fac'], 3.0), b.math('ADD', 1.5, b.math('MULTIPLY', sw.outputs[0], 1.2)))
    p = b.bsdf(Base_Color=col.outputs[0], Roughness=0.04, Subsurface_Weight=0.4, Subsurface_Radius=(0.5, 0.1, 1.0),
               Subsurface_Scale=0.01, Coat_Weight=1.0, Coat_Roughness=0.02,
               Emission_Color=col.outputs[0], Emission_Strength=1.0,
               Normal=b.bump(swirl.outputs['Fac'], 0.15, 0.002))
    b.l(emis, p.inputs['Emission Strength'])
    b.output(p)

    m = new_mat("Ice")
    b = NB(m)
    o = b.coord('Object')
    cr = b.voronoi(o, scale=120, feature='DISTANCE_TO_EDGE')
    p = b.bsdf(Base_Color='#d8c8ff', Roughness=0.08, Transmission_Weight=0.85, IOR=1.31, Alpha=0.85,
               Emission_Color='#9a60ff', Emission_Strength=0.25, Normal=b.bump(cr.outputs['Distance'], 0.3, 0.001))
    b.output(p)
    mat_render_method(m, blended=True)

    m = new_mat("GlassPurple")
    b = NB(m)
    p = b.bsdf(Base_Color='#4a1070', Roughness=0.05, Transmission_Weight=0.9, IOR=1.45, Alpha=0.7,
               Coat_Weight=1.0, Emission_Color='#5a10a0', Emission_Strength=0.4)
    b.output(p)
    mat_render_method(m, blended=True)

    m = new_mat("Paper")
    b = NB(m)
    o = b.coord('UV')
    txt = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y')
    b.l(o, txt.inputs['Vector'])
    txt.inputs['Scale'].default_value = 25
    lines = b.ramp(txt.outputs['Fac'], [(0.0, '#1a0a20'), (0.15, '#e8e0cc')])
    b.output(b.bsdf(Base_Color=lines.outputs[0], Roughness=0.7))

    # ── бархат алтаря, лепестки ───────────────────────────────────────
    m = new_mat("Velvet")
    b = NB(m)
    o = b.coord('Object')
    fold = b.noise(o, scale=3, detail=4)
    col = b.ramp(fold.outputs['Fac'], [(0.3, '#1a0008'), (0.7, '#3a0014')])
    b.output(b.bsdf(Base_Color=col.outputs[0], Roughness=0.9, Sheen_Weight=1.0, Sheen_Tint=(1.0, 0.4, 0.5, 1.0),
                    Sheen_Roughness=0.4, Normal=b.bump(fold.outputs['Fac'], 0.4, 0.05)))

    m = new_mat("Petal")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#4a0010', Roughness=0.5, Subsurface_Weight=0.5, Subsurface_Radius=(1, 0.2, 0.2),
                    Subsurface_Scale=0.01, Sheen_Weight=0.6))

    # ── персонажи: кожа, ткани, волосы, глаза ────────────────────────
    m = new_mat("Skin")
    b = NB(m)
    o = b.coord('Object')
    pores = b.noise(o, scale=400, detail=4)
    blot = b.noise(o, scale=12, detail=3)
    col = b.mix('#e9d5cf', '#d4a8a8', b.math('MULTIPLY', blot.outputs['Fac'], 0.35))
    b.output(b.bsdf(Base_Color=col, Roughness=0.42, Subsurface_Weight=0.35, Subsurface_Radius=(1.0, 0.35, 0.2),
                    Subsurface_Scale=0.012, Coat_Weight=0.1, Normal=b.bump(pores.outputs['Fac'], 0.08, 0.001)))

    for nm, c1, c2, sheen in (("ClothBlack", '#060608', '#141218', 0.7),
                              ("ClothRed", '#2a0006', '#4a000c', 0.9),
                              ("ClothPurple", '#12001e', '#2a0a40', 0.8)):
        m = new_mat(nm)
        b = NB(m)
        o = b.coord('Object')
        weave = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z')
        b.l(o, weave.inputs['Vector'])
        weave.inputs['Scale'].default_value = 300
        lace = b.voronoi(o, scale=60, feature='DISTANCE_TO_EDGE')
        lacem = b.ramp(lace.outputs['Distance'], [(0.0, '#ffffff'), (0.05, '#000000')])
        fold = b.noise(o, scale=8, detail=5)
        col = b.mix(c1, c2, b.math('MULTIPLY', fold.outputs['Fac'], 0.8))
        col = b.mix(col, '#2a2a30', b.math('MULTIPLY', b.sep(lacem.outputs[0])[0], 0.35))
        h = b.math('ADD', b.math('MULTIPLY', weave.outputs['Fac'], 0.3), b.math('MULTIPLY', fold.outputs['Fac'], 0.7))
        b.output(b.bsdf(Base_Color=col, Roughness=0.8, Sheen_Weight=sheen, Sheen_Tint=(0.7, 0.6, 1.0, 1.0),
                        Normal=b.bump(h, 0.35, 0.01)))

    m = new_mat("Leather")
    b = NB(m)
    o = b.coord('Object')
    wr = b.voronoi(o, scale=90, feature='F1')
    b.output(b.bsdf(Base_Color='#070707', Roughness=0.32, Coat_Weight=0.5, Coat_Roughness=0.15,
                    Normal=b.bump(wr.outputs['Distance'], 0.25, 0.002)))

    for nm, c1, c2 in (("HairBlack", '#020203', '#191826'),
                       ("HairRed", '#1a0004', '#6a0a1e'),
                       ("HairPlatinum", '#7a7690', '#d8d4e8'),
                       ("HairPurple", '#0a0010', '#3a0a5a')):
        m = new_mat(nm)
        b = NB(m)
        uv = b.coord('UV')
        u, v, _ = b.sep(uv)
        oi = b.n('ShaderNodeObjectInfo').outputs['Random']
        strands = b.noise(b.comb(b.math('MULTIPLY', u, 8.0), b.math('MULTIPLY', v, 0.4), oi), scale=6, detail=2)
        tipgrad = b.math('POWER', v, 2.0)
        col = b.mix(c1, c2, b.math('MULTIPLY', strands.outputs['Fac'], 1.2))
        col = b.mix(col, c1, b.math('MULTIPLY', b.math('SUBTRACT', 1.0, v), 0.5))
        p = b.bsdf(Base_Color=col, Roughness=0.32, Coat_Weight=0.35, Coat_Roughness=0.2,
                   Sheen_Weight=0.5, Sheen_Tint=(0.8, 0.8, 1.0, 1.0),
                   Normal=b.bump(strands.outputs['Fac'], 0.4, 0.002))
        b.output(p)
        m.use_backface_culling = False

    m = new_mat("Eye")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#050307', Roughness=0.05, Coat_Weight=1.0, Emission_Color='#b07aff', Emission_Strength=0.6))
    m = new_mat("Sclera")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#d8d0d0', Roughness=0.1, Coat_Weight=1.0))
    m = new_mat("Lips")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#0a0206', Roughness=0.15, Coat_Weight=1.0))
    m = new_mat("Liner")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#000000', Roughness=0.5))

    # ── кора мёртвых деревьев ─────────────────────────────────────────
    m = new_mat("Bark")
    b = NB(m)
    o = b.coord('Object')
    wv = b.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X')
    b.l(b.mapping(o, scale=(6, 6, 0.6)), wv.inputs['Vector'])
    wv.inputs['Distortion'].default_value = 8
    wv.inputs['Detail'].default_value = 6
    col = b.ramp(wv.outputs['Fac'], [(0.2, '#0a0806'), (0.8, '#2a2420')])
    b.output(b.bsdf(Base_Color=col.outputs[0], Roughness=0.9, Normal=b.bump(wv.outputs['Fac'], 0.8, 0.03)))

    # ── чёрная дыра ──────────────────────────────────────────────────
    m = new_mat("Accretion")
    b = NB(m)
    o = b.coord('Object')
    t = b.time()
    tw = b.n('ShaderNodeValue')
    tw.name = "Twist"
    tw.outputs[0].default_value = 1.0
    xy = b.comb(b.sep(o)[0], b.sep(o)[1], 0.0)
    r = b.vmath('LENGTH', xy)
    ang = b.math('ADD', b.math('MULTIPLY', b.math('DIVIDE', 6.0, b.math('ADD', r, 0.3)), tw.outputs[0]),
                 b.math('MULTIPLY', t, b.math('MULTIPLY', tw.outputs[0], 0.9)))
    vr = b.n('ShaderNodeVectorRotate', rotation_type='Z_AXIS')
    b.l(xy, vr.inputs['Vector'])
    b.l(ang, vr.inputs['Angle'])
    stretched = b.mapping(vr.outputs[0], scale=(0.35, 0.35, 0.35))
    nz = b.noise(stretched, scale=2.5, detail=10, rough=0.62, dist=0.6)
    rn = b.math('DIVIDE', r, 60.0)   # 0..1 по радиусу
    heat = b.ramp(rn, [(0.0, '#ffffff'), (0.09, '#fff0c8'), (0.16, '#ffa040'), (0.3, '#ff2a10'),
                       (0.5, '#a0004a'), (0.75, '#3a0050'), (1.0, '#000000')])
    fall = b.math('MULTIPLY', b.math('SUBTRACT', 1.0, rn, clamp=True),
                  b.math('MULTIPLY', b.math('SUBTRACT', rn, 0.075), 30.0, clamp=True))
    dens = b.math('MULTIPLY', b.math('POWER', nz.outputs['Fac'], 2.2), fall)
    strength = b.math('MULTIPLY', dens, 40.0)
    e = b.emission(heat.outputs[0], strength)
    tr = b.n('ShaderNodeBsdfTransparent')
    mx = b.n('ShaderNodeMixShader')
    b.l(b.math('MULTIPLY', dens, 4.0, clamp=True), mx.inputs[0])
    b.l(tr.outputs[0], mx.inputs[1])
    b.l(e.outputs[0], mx.inputs[2])
    b.output(mx)
    mat_render_method(m, blended=True)
    m.use_backface_culling = False

    m = new_mat("Horizon")
    b = NB(m)
    b.output(b.emission('#000000', 0.0))

    m = new_mat("PhotonRing")
    b = NB(m)
    lw = b.n('ShaderNodeLayerWeight', Blend=0.4)
    col = b.ramp(lw.outputs['Facing'], [(0.0, '#fff4d8'), (0.6, '#ff7020'), (1.0, '#600010')])
    b.output(b.emission(col.outputs[0], 60.0))

    m = new_mat("Debris")
    b = NB(m)
    o = b.coord('Object')
    hot = b.ramp(b.noise(o, scale=3, detail=6).outputs['Fac'], [(0.5, '#000000'), (0.7, '#ff4010')])
    b.output(b.bsdf(Base_Color='#1a1820', Roughness=0.8, Emission_Color=hot.outputs[0], Emission_Strength=6.0))

    m = new_mat("Streak")
    b = NB(m)
    o = b.coord('Generated')
    g = b.ramp(b.sep(o)[0], [(0.0, '#000000'), (0.5, '#ffb070'), (1.0, '#ffffff')])
    b.output(b.emission(g.outputs[0], 25.0))

    # ── дождь, туман, искры ──────────────────────────────────────────
    m = new_mat("Rain")
    b = NB(m)
    b.output(b.emission('#b8c8ff', 2.2))

    m = new_mat("Dust")
    b = NB(m)
    b.output(b.emission('#ffd8a0', 8.0))

    m = new_mat("FogYard")
    b = NB(m)
    o = b.coord('Generated')
    zz = b.sep(o)[2]
    nz = b.noise(b.coord('Object'), scale=0.08, detail=3, w=b.math('MULTIPLY', b.time(), 0.15))
    dens = b.math('MULTIPLY', b.math('POWER', b.math('SUBTRACT', 1.0, zz, clamp=True), 3.0),
                  b.math('ADD', 0.2, nz.outputs['Fac']))
    vol = b.n('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = hexcol('#8a90b8')
    vol.inputs['Anisotropy'].default_value = 0.35
    b.l(b.math('MULTIPLY', dens, 0.11), vol.inputs['Density'])
    b.output(None, volume=vol)

    m = new_mat("FogNave")
    b = NB(m)
    nz = b.noise(b.coord('Object'), scale=0.15, detail=3, w=b.math('MULTIPLY', b.time(), 0.1))
    vol = b.n('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = hexcol('#a8a0c0')
    vol.inputs['Anisotropy'].default_value = 0.6
    b.l(b.math('MULTIPLY', b.math('ADD', 0.3, nz.outputs['Fac']), 0.022), vol.inputs['Density'])
    b.output(None, volume=vol)

    m = new_mat("LanternGlass")
    b = NB(m)
    t = b.time()
    fl = b.noise(None, scale=1.0, w=b.math('MULTIPLY', t, 7.0), dims='1D')
    b.output(b.emission('#ff9030', b.math('MULTIPLY', b.math('ADD', 0.6, fl.outputs['Fac']), 12.0)))

    m = new_mat("WindowGlowRed")
    b = NB(m)
    b.output(b.emission('#ff1020', 3.0))

    m = new_mat("Dark")
    b = NB(m)
    b.output(b.bsdf(Base_Color='#000000', Roughness=1.0))
    return MATS


# ════════════════════════════════════════════════════════════════════
# CATHEDRAL
# ════════════════════════════════════════════════════════════════════
NAVE_X = 5.0          # ось колонн
AISLE_X = 9.0         # внутренняя грань наружных стен
NAVE_LEN = 40.0
COL_Y = [5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 35.0]
VAULT_Z = 20.0        # пята свода
VAULT_RISE = 8.66


def cutters_coll():
    c = coll("Cutters")
    return c


def cutter_obj(name, mb):
    ob = mb.obj(name, [], cutters_coll())
    ob.display_type = 'WIRE'
    ob.hide_render = True
    return ob


def wall_with_holes(name, center, size, holes_mb, mat, coll_):
    mb = MB()
    mb.cube(center, size, 0)
    wall = mb.obj(name, [mat], coll_)
    if holes_mb is not None:
        cut = cutter_obj(name + "_cut", holes_mb)
        mod = wall.modifiers.new("cut", 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        try_set(mod, "solver", 'EXACT')
        mod.object = cut
        apply_modifiers(wall)
        bpy.data.objects.remove(cut)
    return wall


def build_column_mesh():
    """пучковая колонна + база + капитель, высота 8"""
    mb = MB()
    H = 8.0
    mb.cyl((0, 0, 0), (0, 0, 0.35), 0.95, 0.95, segs=8, mat=0, smooth=False)        # плинт
    mb.cyl((0, 0, 0.35), (0, 0, 0.55), 0.85, 0.72, segs=24, mat=0)
    mb.torus((0, 0, 0.6), 0.7, 0.07, 0, 32, 8)
    mb.cyl((0, 0, 0.55), (0, 0, H - 0.9), 0.55, 0.55, segs=24, mat=0)               # ядро
    for i in range(8):
        a = i * math.pi / 4
        rr = 0.58 if i % 2 == 0 else 0.5
        rad = 0.17 if i % 2 == 0 else 0.11
        p = Vector((math.cos(a) * rr, math.sin(a) * rr, 0))
        mb.cyl(p + Vector((0, 0, 0.55)), p + Vector((0, 0, H - 0.9)), rad, rad, segs=12, mat=0)
        mb.torus(p + Vector((0, 0, 0.7)), rad + 0.02, 0.03, 0, 12, 6)
    # капитель: кольцо + чаша + абака + "листья"
    mb.torus((0, 0, H - 0.9), 0.72, 0.06, 0, 32, 8)
    mb.cyl((0, 0, H - 0.9), (0, 0, H - 0.25), 0.62, 0.9, segs=24, mat=0)
    for i in range(12):
        a = i * 2 * math.pi / 12
        mb.sphere((math.cos(a) * 0.78, math.sin(a) * 0.78, H - 0.45), (0.12, 0.12, 0.2), 0, 8, 6)
    mb.cyl((0, 0, H - 0.25), (0, 0, H), 1.0, 1.0, segs=8, mat=0, smooth=False)
    return mb


def build_cathedral():
    log("cathedral")
    C = coll("Cathedral")
    S, SC_, MARB, GL, GLR = MATS["StoneWall"], MATS["StoneCarved"], MATS["Marble"], MATS["Stained"], MATS["StainedRose"]

    # ── пол нефа ──
    mb = MB()
    mb.grid((0, NAVE_LEN / 2, 0), 2 * AISLE_X + 2, NAVE_LEN + 2, 1, 1, 0)
    mb.obj("NaveFloor", [MARB], C)

    # ── колонны ──
    colm = build_column_mesh().obj("Column", [SC_], C, loc=(NAVE_X, COL_Y[0], 0))
    for sx in (-1, 1):
        for y in COL_Y:
            if sx == 1 and y == COL_Y[0]:
                continue
            instance(colm, "Column", (sx * NAVE_X, y, 0))
    # полуколонны у торцевых стен
    for sx in (-1, 1):
        for y in (0.6, NAVE_LEN - 0.6):
            instance(colm, "ColumnEnd", (sx * NAVE_X, y, 0), scale=(0.7, 0.7, 1))

    # ── стены аркады (x=±5) с арками и клерестори ──
    for sx in (-1, 1):
        holes = MB()
        for i in range(len(COL_Y) - 1):
            yc = (COL_Y[i] + COL_Y[i + 1]) / 2
            span = 5.0 - 1.15
            poly = lancet_poly(span, 8.0 - 0.0, 3.6, 10, z0=-1.0)
            Mt = Matrix.Translation((sx * NAVE_X, yc, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
            holes.prism(poly, -1.0, 1.0, 0, Mt)
            # клерестори
            poly2 = lancet_poly(1.7, 3.2, 1.6, 8, z0=14.4)
            holes.prism(poly2, -1.0, 1.0, 0, Mt)
        for yc in (2.5, NAVE_LEN - 2.5):
            Mt = Matrix.Translation((sx * NAVE_X, yc, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
            holes.prism(lancet_poly(1.7, 3.2, 1.6, 8, z0=14.4), -1.0, 1.0, 0, Mt)
        wall_with_holes("ArcadeWall_%d" % sx, (sx * NAVE_X, NAVE_LEN / 2, VAULT_Z / 2), (0.8, NAVE_LEN, VAULT_Z), holes, S, C)
        # архивольты (обрамление арок)
        ring = MB()
        for i in range(len(COL_Y) - 1):
            yc = (COL_Y[i] + COL_Y[i + 1]) / 2
            span = 5.0 - 1.15
            inner = arch_curve(span, 3.6, 14, base=7.0)
            outer = arch_curve(span + 0.7, 3.6 + 0.45, 14, base=7.0)
            Mt = Matrix.Translation((sx * NAVE_X, yc, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
            ring.ring_prism(inner, outer, -0.55, 0.55, 0, Mt)
            # стекло клерестори
            glass = lancet_poly(1.7, 3.2, 1.6, 8, z0=14.4)
            ring.prism(glass, 0.18, 0.24, 1, Mt)
            # средник
            ring.cube((sx * NAVE_X, yc, 16.8), (0.5, 0.1, 4.6), 0)
        for yc in (2.5, NAVE_LEN - 2.5):
            Mt = Matrix.Translation((sx * NAVE_X, yc, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
            ring.prism(lancet_poly(1.7, 3.2, 1.6, 8, z0=14.4), 0.18, 0.24, 1, Mt)
        # карниз-трифорий
        ring.cube((sx * (NAVE_X - 0.45), NAVE_LEN / 2, 12.9), (0.3, NAVE_LEN, 0.35), 0)
        ring.cube((sx * (NAVE_X - 0.45), NAVE_LEN / 2, VAULT_Z - 0.2), (0.3, NAVE_LEN, 0.4), 0)
        ring.obj("Archivolts_%d" % sx, [SC_, GL], C)

    # ── наружные стены боковых нефов (x=±9) с окнами ──
    for sx in (-1, 1):
        holes = MB()
        bays = [2.5] + [(COL_Y[i] + COL_Y[i + 1]) / 2 for i in range(len(COL_Y) - 1)] + [NAVE_LEN - 2.5]
        for yc in bays:
            Mt = Matrix.Translation((sx * (AISLE_X + 0.5), yc, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
            holes.prism(lancet_poly(2.0, 5.5, 2.0, 8, z0=2.5), -1.5, 1.5, 0, Mt)
        wall_with_holes("AisleWall_%d" % sx, (sx * (AISLE_X + 0.5), NAVE_LEN / 2, 7.0), (1.0, NAVE_LEN, 14.0), holes, S, C)
        gl = MB()
        for yc in bays:
            Mt = Matrix.Translation((sx * (AISLE_X + 0.5), yc, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
            gl.prism(lancet_poly(2.0, 5.5, 2.0, 8, z0=2.5), -0.05, 0.05, 1, Mt)
            # ажурный переплёт: средник + круг
            gl.cube((sx * (AISLE_X + 0.42), yc, 6.0), (0.12, 0.12, 7.0), 0)
            gl.torus((sx * (AISLE_X + 0.42), yc, 9.35), 0.42, 0.06, 0, 24, 6, rot=Matrix.Rotation(math.pi / 2, 3, 'Y'))
        gl.obj("AisleGlass_%d" % sx, [SC_, GL], C)
        # потолок бокового нефа
        mb = MB()
        mb.cube((sx * (NAVE_X + AISLE_X) / 2, NAVE_LEN / 2, 13.5), (AISLE_X - NAVE_X + 1, NAVE_LEN, 0.5), 0)
        # нервюры потолка бокового нефа
        for y in COL_Y + [0.3, NAVE_LEN - 0.3]:
            mb.cube((sx * (NAVE_X + AISLE_X) / 2, y, 13.1), (AISLE_X - NAVE_X, 0.3, 0.35), 0)
        mb.obj("AisleCeil_%d" % sx, [SC_], C)

    # ── стрельчатый свод нефа + нервюры ──
    mb = MB()
    prof = arch_curve(2 * NAVE_X, VAULT_RISE, 24, base=VAULT_Z)
    ny = 40
    rows = []
    for j in range(ny + 1):
        y = NAVE_LEN * j / ny
        rows.append([mb.bm.verts.new((x, y, z)) for x, z in prof])
    for j in range(ny):
        for i in range(len(prof) - 1):
            f = mb.bm.faces.new((rows[j][i + 1], rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]))
            f.smooth = True
    vault = mb.obj("Vault", [SC_], C)
    sol = vault.modifiers.new("solid", 'SOLIDIFY')
    sol.thickness = 0.5
    sol.offset = 1.0
    ribs = MB()
    ys = [0.4] + COL_Y + [NAVE_LEN - 0.4]
    for y in ys:
        pts = [(x * 0.98, y, z - 0.12) for x, z in arch_curve(2 * NAVE_X, VAULT_RISE, 24, base=VAULT_Z)]
        ribs.sweep(pts, 0.2, 0, rect=(0.32, 0.4), cap=True, up=Vector((0, 1, 0)))
    for k in range(len(ys) - 1):
        y0, y1 = ys[k], ys[k + 1]
        L = math.hypot(2 * NAVE_X, y1 - y0)
        for flip in (1, -1):
            pts = []
            for i in range(25):
                tt = i / 24
                x = -NAVE_X + 2 * NAVE_X * tt
                yy = y0 + (y1 - y0) * (tt if flip == 1 else 1 - tt)
                a = L / 2
                rr = (VAULT_RISE ** 2 + a * a) / (2 * a)
                s = tt * L
                d = s if s <= a else L - s
                z = VAULT_Z + math.sqrt(max(rr * rr - (rr - d) ** 2, 0)) - 0.28
                pts.append((x * 0.97, yy, z))
            ribs.sweep(pts, 0.14, 0, segs=6, cap=True)
        # замковый камень (boss)
        ribs.sphere((0, (y0 + y1) / 2, VAULT_Z + VAULT_RISE - 0.35), (0.35, 0.35, 0.25), 0, 12, 8)
    # хребтовая нервюра
    ribs.sweep([(0, 0.3, VAULT_Z + VAULT_RISE - 0.25), (0, NAVE_LEN - 0.3, VAULT_Z + VAULT_RISE - 0.25)], 0.12, 0, segs=6)
    ribs.obj("VaultRibs", [SC_], C)

    # ── крыша снаружи ──
    mb = MB()
    for sx in (-1, 1):
        a = Vector((sx * (NAVE_X + 0.8), -0.5, VAULT_Z + 0.4))
        bpt = Vector((0, -0.5, VAULT_Z + 14))
        v = [mb.bm.verts.new(a), mb.bm.verts.new(a + Vector((0, NAVE_LEN + 1, 0))),
             mb.bm.verts.new(bpt + Vector((0, NAVE_LEN + 1, 0))), mb.bm.verts.new(bpt)]
        mb.bm.faces.new(v if sx < 0 else list(reversed(v)))
        a2 = Vector((sx * (AISLE_X + 1.2), -0.5, 14.0))
        b2 = Vector((sx * (NAVE_X + 0.6), -0.5, 16.5))
        v = [mb.bm.verts.new(a2), mb.bm.verts.new(a2 + Vector((0, NAVE_LEN + 1, 0))),
             mb.bm.verts.new(b2 + Vector((0, NAVE_LEN + 1, 0))), mb.bm.verts.new(b2)]
        mb.bm.faces.new(v if sx < 0 else list(reversed(v)))
    roof = mb.obj("Roof", [MATS["Iron"]], C)
    s2 = roof.modifiers.new("solid", 'SOLIDIFY')
    s2.thickness = 0.3

    # ── аркбутаны и контрфорсы ──
    mb = MB()
    for sx in (-1, 1):
        for y in COL_Y:
            mb.cube((sx * 13.0, y, 9.0), (1.4, 1.6, 18.0), 0)
            mb.cyl((sx * 13.0, y, 18.0), (sx * 13.0, y, 23.5), 0.75, 0.0, segs=4, mat=0, smooth=False)
            for dx in (-0.5, 0.5):
                mb.cyl((sx * 13.0 + dx, y + 0.6, 18.0), (sx * 13.0 + dx, y + 0.6, 20.5), 0.18, 0.0, segs=4, smooth=False)
            pts = []
            for i in range(17):
                tt = i / 16
                x = sx * (12.3 - (12.3 - 5.6) * tt)
                z = 15.5 + 3.8 * tt + 2.2 * math.sin(math.pi * tt)
                pts.append((x, y, z))
            mb.sweep(pts, 0.4, 0, rect=(0.5, 0.75), up=Vector((0, 1, 0)))
            mb.cube((sx * (AISLE_X + 0.5), y, 7.0), (1.6, 1.2, 14.0), 0)
    mb.obj("Buttresses", [SC_], C)

    # ── торцевая стена апсиды с тройным окном ──
    holes = MB()
    for dx, hgt in ((-2.6, 6.0), (0.0, 8.0), (2.6, 6.0)):
        holes.prism(lancet_poly(1.9, hgt, 2.0, 8, z0=5.0), -1.5, 1.5, 0, Matrix.Translation((dx, NAVE_LEN + 0.5, 0)))
    holes.prism([(math.cos(a) * 1.6, 19.5 + math.sin(a) * 1.6) for a in np.linspace(0, 2 * math.pi, 24, endpoint=False)],
                -1.5, 1.5, 0, Matrix.Translation((0, NAVE_LEN + 0.5, 0)))
    wall_with_holes("ApseWall", (0, NAVE_LEN + 0.5, 15.0), (2 * AISLE_X + 2, 1.0, 30.0), holes, S, C)
    gl = MB()
    for dx, hgt in ((-2.6, 6.0), (0.0, 8.0), (2.6, 6.0)):
        gl.prism(lancet_poly(1.9, hgt, 2.0, 8, z0=5.0), -0.05, 0.05, 1, Matrix.Translation((dx, NAVE_LEN + 0.5, 0)))
        gl.cube((dx, NAVE_LEN + 0.4, 5.0 + hgt / 2 + 0.6), (0.1, 0.1, hgt + 1.0), 0)
    gl.prism([(math.cos(a) * 1.6, 19.5 + math.sin(a) * 1.6) for a in np.linspace(0, 2 * math.pi, 24, endpoint=False)],
             -0.05, 0.05, 1, Matrix.Translation((0, NAVE_LEN + 0.5, 0)))
    gl.obj("ApseGlass", [SC_, GLR], C)

    build_facade(C)
    build_altar()


def rose_window(mb, center, R, mat_stone, mat_glass, rot):
    """роза-окно: кольца, спицы, лепестки-трилистники, стекло"""
    c = Vector(center)
    mb.torus(c, R, 0.18, mat_stone, 64, 10, rot=rot)
    mb.torus(c, R * 0.38, 0.12, mat_stone, 40, 8, rot=rot)
    mb.torus(c, R * 0.14, 0.08, mat_stone, 24, 8, rot=rot)
    n = 12
    for i in range(n):
        a = 2 * math.pi * i / n
        d = Vector((math.cos(a), 0, math.sin(a)))
        mb.cyl(c + rot @ Vector((math.cos(a), math.sin(a), 0)) * R * 0.38, c + rot @ Vector((math.cos(a), math.sin(a), 0)) * R,
               0.07, 0.07, segs=6, mat=mat_stone)
        a2 = a + math.pi / n
        mb.torus(c + rot @ Vector((math.cos(a2), math.sin(a2), 0)) * R * 0.7, R * 0.17, 0.05, mat_stone, 24, 6, rot=rot)
        mb.torus(c + rot @ Vector((math.cos(a2), math.sin(a2), 0)) * R * 0.92, R * 0.06, 0.035, mat_stone, 16, 6, rot=rot)
    # стекло (диск)
    pts = [(math.cos(a) * R, math.sin(a) * R) for a in np.linspace(0, 2 * math.pi, 64, endpoint=False)]
    verts = [mb.bm.verts.new(c + rot @ Vector((x, y, 0))) for x, y in pts]
    f = mb.bm.faces.new(verts)
    f.material_index = mat_glass


def build_facade(C):
    S, SC_, GLR, GL = MATS["StoneWall"], MATS["StoneCarved"], MATS["StainedRose"], MATS["Stained"]
    FY0, FY1 = -1.4, 0.0
    ROSE_Z, ROSE_R = 17.0, 4.0
    # проёмы фасада
    holes = MB()
    holes.prism(lancet_poly(3.6, 6.0, 3.2, 10, z0=-1.0), -3, 3, 0, Matrix.Identity(4))
    holes.prism([(math.cos(a) * ROSE_R, ROSE_Z + math.sin(a) * ROSE_R) for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)],
                -3, 3, 0, Matrix.Identity(4))
    wall_with_holes("Facade", (0, (FY0 + FY1) / 2, 15.0), (18.0, FY1 - FY0, 30.0), holes, S, C)
    tri = [(-9.0, 30.0), (9.0, 30.0), (0.0, 38.0)]
    mb = MB()
    mb.prism(tri, FY0, FY1, 0)
    for k in range(5):
        inner = arch_curve(3.6 + 0.55 * k, 3.2 + 0.32 * k, 16, base=6.0)
        outer = arch_curve(3.6 + 0.55 * (k + 1), 3.2 + 0.32 * (k + 1), 16, base=6.0)
        mb.ring_prism(inner, outer, FY0 - 0.25 * (k + 1), FY0 - 0.25 * k, 1)
        for sxx in (-1, 1):
            x = sxx * (1.8 + 0.275 * (2 * k + 1))
            mb.cyl((x, FY0 - 0.25 * k - 0.12, 0), (x, FY0 - 0.25 * k - 0.12, 6.0), 0.12, 0.12, segs=10, mat=1)
            mb.cube((x, FY0 - 0.25 * k - 0.12, 6.05), (0.32, 0.32, 0.12), 1)
    mb.prism([(-4.6, 9.4), (4.6, 9.4), (0.0, 15.0)], FY0 - 1.3, FY0 - 0.9, 1)
    mb.cyl((0, FY0 - 1.1, 15.0), (0, FY0 - 1.1, 16.2), 0.25, 0.0, segs=4, mat=1, smooth=False)
    for sxx in (-1, 1):
        x = sxx * 6.0
        mb.ring_prism(arch_curve(1.5, 1.2, 10, base=4.0), arch_curve(2.0, 1.5, 10, base=4.0), FY0 - 0.5, FY0, 1,
                      Matrix.Translation((x, 0, 0)))
        mb.cube((x, FY0 - 0.25, 0.6), (1.6, 0.5, 1.2), 1)
        mb.prism(lancet_poly(1.5, 4.0 - 1.2, 1.2, 8, z0=1.2), FY0 - 0.02, FY0 + 0.02, 3, Matrix.Translation((x, 0, 0)))
    rose_window(mb, (0, FY0 - 0.15, ROSE_Z), ROSE_R, 1, 2, Matrix.Rotation(math.pi / 2, 3, 'X'))
    mb.torus((0, FY0 - 0.35, ROSE_Z), ROSE_R + 0.45, 0.32, 1, 64, 10, rot=Matrix.Rotation(math.pi / 2, 3, 'X'))
    for i in range(-6, 7):
        x = i * 1.25
        mb.ring_prism(arch_curve(0.8, 0.6, 6, base=22.8), arch_curve(1.05, 0.75, 6, base=22.8), FY0 - 0.3, FY0, 1,
                      Matrix.Translation((x, 0, 0)))
        for dx in (-0.5, 0.5):
            mb.cyl((x + dx, FY0 - 0.15, 21.2), (x + dx, FY0 - 0.15, 22.8), 0.08, 0.08, segs=6, mat=1)
        mb.prism(lancet_poly(0.8, 1.6, 0.6, 6, z0=21.2), FY0 - 0.02, FY0 + 0.01, 3, Matrix.Translation((x, 0, 0)))
    mb.cube((0, FY0 - 0.25, 21.1), (18.0, 0.5, 0.25), 1)
    mb.cube((0, FY0 - 0.25, 24.2), (18.0, 0.5, 0.3), 1)
    for i in range(-14, 15):
        mb.cube((i * 0.62, FY0 - 0.1, 30.25), (0.3, 0.5, 0.5), 1)
    # ступени
    for k in range(4):
        mb.cube((0, FY0 - 1.6 - 0.45 * k, 0.12 * (3 - k) + 0.06), (9.0 + 0.8 * k, 1.0 + 0.9 * k, 0.12), 1)
    mb.obj("FacadeDetail", [S, SC_, GLR, MATS["Dark"]], C)

    # роза изнутри (стекло видно с двух сторон - плоскость двусторонняя)
    # ── башни ──
    for sxx in (-1, 1):
        cx = sxx * 12.0
        holes = MB()
        for face_y in (-1,):
            pass
        for dz in (27.0,):
            for dx in (-1.2, 1.2):
                holes.prism(lancet_poly(1.3, 6.0, 1.4, 8, z0=dz), -4.0, 4.0, 0, Matrix.Translation((cx + dx, 0.3, 0)))
                holes.prism(lancet_poly(1.3, 6.0, 1.4, 8, z0=dz), -4.0, 4.0, 0,
                            Matrix.Translation((cx, 0.3 + dx, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
        for dz in (8.0, 16.0):
            holes.prism(lancet_poly(1.2, 3.5, 1.2, 8, z0=dz), -4.0, -2.0, 0, Matrix.Translation((cx, 0, 0)))
        tower = wall_with_holes("Tower_%d" % sxx, (cx, 0.3, 21.0), (6.0, 6.0, 42.0), holes, S, C)
        mb = MB()
        # угловые контрфорсы
        for dx in (-3.1, 3.1):
            for dy in (-2.8, 3.4):
                mb.cube((cx + dx, 0.3 + dy * 1.0, 19.0), (0.9, 0.9, 38.0), 0)
                mb.cyl((cx + dx, 0.3 + dy, 38.0), (cx + dx, 0.3 + dy, 47.0), 0.55, 0.0, segs=4, smooth=False)
                for k in range(6):
                    zz = 39.0 + k * 1.3
                    rr = 0.55 * (1 - (zz - 38.0) / 9.0)
                    mb.sphere((cx + dx + rr * 0.8, 0.3 + dy, zz), 0.12, 0, 6, 4)
        # шпиль
        mb.cyl((cx, 0.3, 42.0), (cx, 0.3, 43.2), 3.4, 3.2, segs=8, smooth=False)
        mb.cyl((cx, 0.3, 43.2), (cx, 0.3, 62.0), 3.0, 0.05, segs=8, smooth=False)
        for k in range(14):
            zz = 44.0 + k * 1.3
            rr = 3.0 * (1 - (zz - 43.2) / 18.8)
            for j in range(8):
                a = j * math.pi / 4 + math.pi / 8
                mb.sphere((cx + math.cos(a) * rr * 0.93, 0.3 + math.sin(a) * rr * 0.93, zz), 0.14, 0, 6, 4)
        # крест на шпиле
        mb.cube((cx, 0.3, 63.2), (0.15, 0.15, 2.4), 2)
        mb.cube((cx, 0.3, 63.6), (1.2, 0.15, 0.15), 2)
        # карнизы
        for zz in (12.5, 24.5, 34.5, 42.0):
            mb.cube((cx, 0.3, zz), (6.6, 6.6, 0.4), 0)
        # красное свечение в звоннице
        mb.cube((cx, 0.3, 30.0), (4.6, 4.6, 6.2), 3)
        # средники звонницы
        for dx in (-1.2, 1.2):
            mb.cube((cx + dx, -2.7, 31.0), (0.1, 0.2, 7.4), 0)
        mb.obj("TowerDetail_%d" % sxx, [SC_, S, MATS["Iron"], MATS["WindowGlowRed"]], C)

    # двери (приоткрыты внутрь)
    mb = MB()
    for sxx in (-1, 1):
        mb.cube((0, 0, 3.5), (1.8, 0.12, 7.0), 0)
    door = mb.obj("DoorL", [MATS["Iron"]], C)
    door.location = (-1.8, 0.4, 0)
    door.rotation_euler = (0, 0, math.radians(-75))
    mb = MB()
    mb.cube((0, 0, 3.5), (1.8, 0.12, 7.0), 0)
    door2 = mb.obj("DoorR", [MATS["Iron"]], C)
    door2.location = (1.8, 0.4, 0)
    door2.rotation_euler = (0, 0, math.radians(75))
    for d, s_ in ((door, 1), (door2, -1)):
        d.data.transform(Matrix.Translation((s_ * 0.9, 0, 0)))


def build_altar():
    log("altar + lean")
    C = coll("Altar")
    SC_, GOLD, VEL = MATS["StoneCarved"], MATS["Gold"], MATS["Velvet"]
    mb = MB()
    # ступени
    for k in range(3):
        mb.cube((0, 37.2, 0.1 + 0.2 * k), (8.0 - 1.2 * k, 5.0 - 0.9 * k, 0.2), 0)
    # престол
    mb.cube((0, 37.0, 0.6 + 0.5), (2.6, 1.1, 1.0), 0)
    for dx in np.linspace(-1.1, 1.1, 6):
        mb.ring_prism(arch_curve(0.3, 0.2, 6, base=0.75), arch_curve(0.38, 0.25, 6, base=0.75), -0.04, 0.0, 0,
                      Matrix.Translation((dx, 36.45, 0)))
    mb.obj("Altar", [SC_], C)
    # бархатная скатерть с золотой каймой
    mb = MB()
    mb.cube((0, 37.0, 1.585), (2.8, 1.3, 0.03), 0)
    mb.cube((0, 36.36, 1.35), (1.0, 0.02, 0.5), 0)
    mb.cube((0, 36.35, 1.12), (1.0, 0.03, 0.04), 1)
    mb.cube((0, 36.35, 1.58), (2.8, 0.03, 0.04), 1)
    mb.obj("AltarCloth", [VEL, GOLD], C)
    # большой крест за алтарём
    mb = MB()
    mb.cube((0, 38.6, 4.8), (0.22, 0.22, 6.0), 0)
    mb.cube((0, 38.6, 6.3), (2.4, 0.22, 0.22), 0)
    mb.torus((0, 38.6, 6.3), 0.55, 0.05, 0, 32, 6, rot=Matrix.Rotation(math.pi / 2, 3, 'X'))
    mb.obj("AltarCross", [GOLD], C)

    # канделябры
    candles = []
    for sx in (-1, 1):
        mb = MB()
        base = Vector((sx * 1.05, 37.0, 1.6))
        mb.lathe([(0.14, 0), (0.12, 0.03), (0.04, 0.06), (0.03, 0.3), (0.05, 0.33), (0.025, 0.36), (0.025, 0.55)], 16, 0, c=base)
        arms = 3
        for i in range(-arms, arms + 1):
            x = i * 0.09
            top = base + Vector((x, 0, 0.55 + 0.1 * (arms - abs(i)) / arms))
            mb.sweep([base + Vector((0, 0, 0.5)), base + Vector((x * 0.6, 0, 0.52)), top], 0.01, 0, segs=6)
            mb.lathe([(0.03, 0), (0.035, 0.015), (0.02, 0.025)], 12, 0, c=top)
            candles.append((top + Vector((0, 0, 0.025)), 0.012, rng.uniform(0.08, 0.16)))
        mb.obj("Candelabra_%d" % sx, [GOLD], C)
    # свечи на полу и ступенях
    for i in range(46):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(1.6, 3.6)
        x = math.cos(a) * r * 1.2
        y = 37.0 + math.sin(a) * r * 0.75
        if abs(x) < 1.5 and abs(y - 37) < 0.8:
            continue
        z = 0.0
        if abs(x) < 4.0 and 34.7 < y < 39.7:
            z = 0.2
            if abs(x) < 3.4 and 35.15 < y < 39.25:
                z = 0.4
                if abs(x) < 2.8 and 35.6 < y < 38.8:
                    z = 0.6
        candles.append((Vector((x, y, z)), rng.uniform(0.025, 0.045), rng.uniform(0.1, 0.45)))
    # свечи вдоль нефа у колонн
    for sx in (-1, 1):
        for y in COL_Y:
            for k in range(3):
                candles.append((Vector((sx * (NAVE_X - 0.9) + rng.uniform(-0.2, 0.2), y + rng.uniform(-0.4, 0.4), 0)),
                                rng.uniform(0.025, 0.04), rng.uniform(0.15, 0.6)))
    build_candles(candles, C)

    build_lean(C)


def build_candles(candles, C):
    wax, flame = MB(), MB()
    for p, r, h in candles:
        prof = [(r, 0), (r * 1.02, h * 0.3), (r, h * 0.85), (r * 0.9, h), (r * 0.25, h + 0.002)]
        wax.lathe(prof, 12, 0, c=p, cap_bottom=False)
        # потёки
        for k in range(3):
            a = rng.uniform(0, 2 * math.pi)
            wax.sphere(p + Vector((math.cos(a) * r, math.sin(a) * r, h * rng.uniform(0.5, 0.95))),
                       (r * 0.25, r * 0.25, h * 0.15), 0, 6, 4)
        wax.cyl(p + Vector((0, 0, h)), p + Vector((0, 0, h + 0.012)), 0.0015, 0.0015, segs=4, mat=0)
    wax.obj("Candles", [MATS["Wax"]], C)
    # пламя: отдельные объекты не нужны - один меш, мерцание в шейдере (Object Random одинаков)
    # поэтому делаем пламя кластерами по 1 объекту на свечу-группу (6 групп)
    groups = [[] for _ in range(8)]
    for i, (p, r, h) in enumerate(candles):
        groups[i % 8].append((p, r, h))
    for gi, grp in enumerate(groups):
        fm = MB()
        for p, r, h in grp:
            c = p + Vector((0, 0, h + 0.012))
            s = max(r * 0.55, 0.009)
            fm.lathe([(0.0, 0), (s * 0.6, s * 0.4), (s, s * 1.3), (s * 0.7, s * 2.6), (s * 0.25, s * 3.6), (0.0, s * 4.3)],
                     10, 0, c=c, cap_bottom=False)
        fob = fm.obj("Flames_%d" % gi, [MATS["Flame"]], C)
        fob.visible_shadow = False if hasattr(fob, "visible_shadow") else None


def build_lean(C):
    """двойной стаканчик (пенопласт), фиолетовый lean со льдом, бутылка сиропа, кубок, лепестки"""
    STY, LEAN, ICE = MATS["Styrofoam"], MATS["Lean"], MATS["Ice"]
    H, R0, R1 = 0.118, 0.032, 0.047     # высота, радиус дна, радиус верха
    th = 0.0025

    def cup(mb, z0, mat=0):
        prof_out = [(R0, 0.0), (R0 + 0.002, 0.004)] + [(R0 + (R1 - R0) * k / 10, H * k / 10) for k in range(1, 11)]
        prof_out = [(r, z0 + z) for r, z in prof_out]
        mb.lathe(prof_out, 48, mat, cap_bottom=True)
        prof_in = [(R1 - th, z0 + H), (R0 - th + 0.001, z0 + 0.006)]
        rings = mb.lathe(prof_in, 48, mat, cap_bottom=True)
        # кромка (валик)
        mb.torus((0, 0, z0 + H), R1 + 0.0005, 0.0022, mat, 48, 8)

    mb = MB()
    cup(mb, 0.0)            # нижний стакан
    cup(mb, 0.014)          # верхний (вставлен, выше на 1.4 см)
    cupob = mb.obj("LeanCup", [STY], C, loc=CUP_POS)
    # "чернильный" готический крест на стакане
    mb = MB()
    ang = -math.pi / 2 - 0.15
    rr = (R0 + R1) / 2 + 0.0035
    base = Vector((math.cos(ang) * rr, math.sin(ang) * rr, 0.07))
    rot = Matrix.Rotation(ang + math.pi / 2, 3, 'Z')
    mb.cube(base, (0.003, 0.0012, 0.04), 0, rot=rot)
    mb.cube(base + Vector((0, 0, 0.007)), (0.022, 0.0012, 0.003), 0, rot=rot)
    for k in range(5):
        a2 = ang + 0.5 + k * 0.12
        mb.sphere((math.cos(a2) * (rr - 0.0005), math.sin(a2) * (rr - 0.0005), 0.05 + 0.02 * math.sin(k)), 0.0016, 0, 6, 4)
    ink = mb.obj("CupInk", [MATS["Ink"]], C)
    ink.parent = cupob
    # жидкость: верхняя поверхность + "тело"
    LZ = 0.014 + H * 0.82
    rl = R0 + (R1 - R0) * 0.82 - th - 0.0005
    mb = MB()
    mb.lathe([(R0 - th, 0.02), (rl, LZ - 0.002)], 48, 0, cap_bottom=True)
    # поверхность - сетка с радиальным подразделением (для волн/воронки)
    rings = []
    center = mb.bm.verts.new((0, 0, LZ))
    nr, na = 12, 48
    for i in range(1, nr + 1):
        rr_ = rl * i / nr
        rings.append([mb.bm.verts.new((rr_ * math.cos(2 * math.pi * j / na), rr_ * math.sin(2 * math.pi * j / na), LZ))
                      for j in range(na)])
    for j in range(na):
        f = mb.bm.faces.new((center, rings[0][j], rings[0][(j + 1) % na]))
        f.smooth = True
    for i in range(nr - 1):
        for j in range(na):
            f = mb.bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % na], rings[i][(j + 1) % na]))
            f.smooth = True
    liq = mb.obj("LeanLiquid", [LEAN], C)
    liq.parent = cupob
    # воронка: Simple Deform TWIST не прогнёт центр - используем Wave + анимацию масштаба по Z центра (shape key)
    sk0 = liq.shape_key_add(name="Basis")
    sk1 = liq.shape_key_add(name="Vortex")
    for v in liq.data.vertices:
        p = v.co
        if abs(p.z - LZ) < 1e-5:
            r_ = min(1.0, math.hypot(p.x, p.y) / rl)
            a = math.atan2(p.y, p.x) + 2.5 * (1 - r_) ** 2
            depth = 0.07 * (1 - r_) ** 2.2
            sk1.data[v.index].co = Vector((math.cos(a) * r_ * rl, math.sin(a) * r_ * rl, LZ - depth + 0.004 * r_))
    # лёд
    mb = MB()
    for k in range(3):
        a = k * 2.1 + 0.4
        c = Vector((math.cos(a) * 0.018, math.sin(a) * 0.018, LZ - 0.002))
        mb.cube(c, (0.017, 0.016, 0.015), 0, rot=Euler((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 3))).to_matrix())
    ice = mb.obj("LeanIce", [ICE], C)
    bev = ice.modifiers.new("bev", 'BEVEL')
    bev.width = 0.002
    bev.segments = 3
    ice.parent = cupob
    ice.location = (0, 0, 0)

    # бутылка сиропа (аптечная, готическая этикетка)
    mb = MB()
    prof = [(0.03, 0), (0.032, 0.005), (0.032, 0.11), (0.028, 0.125), (0.012, 0.145), (0.011, 0.165), (0.013, 0.168), (0.012, 0.175)]
    mb.lathe(prof, 32, 0)
    mb.lathe([(0.0285, 0.006), (0.0285, 0.08)], 32, 1, cap_bottom=True, cap_top=True)
    mb.cyl((0, 0, 0.175), (0, 0, 0.198), 0.014, 0.014, segs=24, mat=2)
    # этикетка
    mb.lathe([(0.0325, 0.035), (0.0325, 0.09)], 32, 3, cap_bottom=False)
    bottle = mb.obj("SyrupBottle", [MATS["GlassPurple"], LEAN, MATS["Leather"], MATS["Paper"]], C,
                    loc=CUP_POS + Vector((0.16, 0.12, 0)))
    bottle.rotation_euler = (0, 0, 0.6)
    # кубок
    mb = MB()
    mb.lathe([(0.055, 0), (0.05, 0.01), (0.015, 0.03), (0.012, 0.09), (0.02, 0.1), (0.012, 0.11),
              (0.03, 0.13), (0.05, 0.16), (0.058, 0.2), (0.056, 0.2)], 32, 0)
    mb.lathe([(0.054, 0.195), (0.03, 0.15), (0.0, 0.135)], 32, 0, cap_bottom=False)
    mb.lathe([(0.0, 0.17), (0.05, 0.185)], 32, 1, cap_bottom=False)
    for k in range(6):
        a = k * math.pi / 3
        mb.sphere((math.cos(a) * 0.045, math.sin(a) * 0.045, 0.16), 0.006, 2, 8, 6)
    mb.obj("Chalice", [MATS["Gold"], LEAN, MATS["Eye"]], C, loc=CUP_POS + Vector((-0.2, 0.1, 0)))
    # лепестки роз
    mb = MB()
    for k in range(40):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.08, 0.6)
        p = CUP_POS + Vector((math.cos(a) * r * 1.6, math.sin(a) * r * 0.6, 0.003))
        if abs(p.y - 37.0) > 0.6:
            continue
        rot = Euler((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 6.28))).to_matrix()
        mb.sphere(p, (0.018, 0.012, 0.003), 0, 8, 4, rot=rot)
    mb.obj("Petals", [MATS["Petal"]], C)
    return cupob, liq


def build_courtyard():
    log("courtyard")
    C = coll("Courtyard")
    # земля
    mb = MB()
    mb.grid((0, -45, 0), 140, 100, 1, 1, 0)
    mb.obj("Ground", [MATS["Cobble"]], C)
    # ворота: столбы + кованые створки
    IRON = MATS["Iron"]
    mb = MB()
    GY = -36.0
    for sx in (-1, 1):
        x = sx * 2.4
        mb.cube((x, GY, 2.0), (0.9, 0.9, 4.0), 0)
        mb.cube((x, GY, 4.1), (1.1, 1.1, 0.25), 0)
        mb.cyl((x, GY, 4.2), (x, GY, 5.6), 0.5, 0.0, segs=4, smooth=False)
        mb.sphere((x, GY, 5.7), 0.18, 0, 12, 8)
    # ограда
    for sx in (-1, 1):
        for i in range(70):
            x = sx * (3.0 + i * 0.32)
            mb.cyl((x, GY, 0), (x, GY, 2.4), 0.018, 0.018, segs=6, mat=1)
            mb.cyl((x, GY, 2.4), (x, GY, 2.62), 0.04, 0.0, segs=4, mat=1, smooth=False)
        mb.cube((sx * 14.0, GY, 0.4), (22.2, 0.05, 0.05), 1)
        mb.cube((sx * 14.0, GY, 2.1), (22.2, 0.05, 0.05), 1)
        for i in range(0, 70, 8):
            x = sx * (3.0 + i * 0.32)
            mb.cube((x, GY, 1.2), (0.25, 0.25, 2.4), 0)
    mb.obj("GatePillars", [MATS["StoneCarved"], IRON], C)
    # створки ворот (открыты внутрь)
    for sx in (-1, 1):
        mb = MB()
        w = 1.95
        n = 12
        for i in range(n + 1):
            x = sx * (w * i / n)
            top = 3.2 + 0.5 * math.sin(math.pi * (i / n) * 0.5 + (0 if sx > 0 else 0))
            top = 3.0 + 0.6 * (i / n) ** 0.7 if True else top
            mb.cyl((x, 0, 0.05), (x, 0, top), 0.016, 0.016, segs=6, mat=0)
            mb.cyl((x, 0, top), (x, 0, top + 0.22), 0.035, 0.0, segs=4, mat=0, smooth=False)
        for z in (0.3, 1.5, 2.6):
            mb.cyl((0, 0, z), (sx * w, 0, z), 0.025, 0.025, segs=6, mat=0)
        for k in range(4):
            cx = sx * (0.25 + 0.48 * k)
            mb.torus((cx, 0, 2.05), 0.18, 0.012, 0, 20, 4, rot=Matrix.Rotation(math.pi / 2, 3, 'X'))
            mb.torus((cx, 0, 0.9), 0.13, 0.012, 0, 20, 4, rot=Matrix.Rotation(math.pi / 2, 3, 'X'))
        g = mb.obj("GateLeaf_%d" % sx, [IRON], C)
        g.location = (sx * 1.95, GY, 0)
        g.rotation_euler = (0, 0, sx * math.radians(-70) * -1)
        # створка крепится у столба: петля на x=sx*1.95, тело уходит к центру
        g.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
    # надгробия
    graves = MB()
    for i in range(54):
        side = 1 if i % 2 else -1
        x = side * rng.uniform(4.0, 26.0)
        y = rng.uniform(-34.0, -6.0)
        rot = Euler((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(-0.3, 0.3))).to_matrix()
        Mr = Matrix.Translation((x, y, -0.05)) @ rot.to_4x4()
        kind = rng.random()
        h = rng.uniform(0.7, 1.5)
        if kind < 0.45:          # плита с полукруглым верхом
            w = rng.uniform(0.5, 0.8)
            pts = [(-w / 2, 0)] + [(math.cos(a) * w / 2, h + math.sin(a) * w / 2) for a in np.linspace(math.pi, 0, 12)] + [(w / 2, 0)]
            graves.prism(pts, -0.08, 0.08, 0, Mr)
            graves.prism([(-w / 2 - 0.1, 0), (w / 2 + 0.1, 0), (w / 2 + 0.1, 0.2), (-w / 2 - 0.1, 0.2)], -0.2, 0.2, 0, Mr)
        elif kind < 0.75:        # крест
            graves.prism([(-0.07, 0), (0.07, 0), (0.07, h), (-0.07, h)], -0.07, 0.07, 0, Mr)
            graves.prism([(-0.32, h * 0.7), (0.32, h * 0.7), (0.32, h * 0.7 + 0.14), (-0.32, h * 0.7 + 0.14)], -0.07, 0.07, 0, Mr)
            graves.prism([(-0.25, 0), (0.25, 0), (0.2, 0.25), (-0.2, 0.25)], -0.25, 0.25, 0, Mr)
        else:                    # обелиск
            graves.prism([(-0.25, 0), (0.25, 0), (0.25, 0.3), (-0.25, 0.3)], -0.25, 0.25, 0, Mr)
            graves.prism([(-0.16, 0.3), (0.16, 0.3), (0.11, h * 1.4), (0.0, h * 1.4 + 0.25), (-0.11, h * 1.4)], -0.14, 0.14, 0, Mr)
    graves.obj("Graves", [MATS["GraveStone"]], C)
    # мёртвые деревья
    for k, (x, y, hgt) in enumerate(((-9.5, -33.0, 8.0), (11.0, -29.0, 9.5), (-18.0, -18.0, 10.0), (20.0, -12.0, 8.5), (-7.0, -8.0, 7.0))):
        dead_tree("Tree_%d" % k, Vector((x, y, 0)), hgt, C, seed=k * 17 + 3)
    # фонари вдоль дорожки
    lm = MB()
    lamps = []
    for y in (-30.0, -22.0, -14.0, -7.0):
        for sx in (-1, 1):
            x = sx * 2.7
            lm.cyl((x, y, 0), (x, y, 0.3), 0.15, 0.12, segs=8, mat=0)
            lm.cyl((x, y, 0.3), (x, y, 3.0), 0.05, 0.04, segs=8, mat=0)
            lm.cyl((x, y, 3.0), (x, y, 3.08), 0.16, 0.16, segs=6, mat=0, smooth=False)
            for j in range(6):
                a = j * math.pi / 3
                lm.cyl((x + math.cos(a) * 0.14, y + math.sin(a) * 0.14, 3.08), (x + math.cos(a) * 0.17, y + math.sin(a) * 0.17, 3.5),
                       0.01, 0.01, segs=4, mat=0)
            lm.cyl((x, y, 3.08), (x, y, 3.5), 0.13, 0.15, segs=6, mat=1, smooth=False)
            lm.cyl((x, y, 3.5), (x, y, 3.8), 0.2, 0.0, segs=6, mat=0, smooth=False)
            lamps.append(Vector((x, y, 3.3)))
    lm.obj("Lanterns", [MATS["Iron"], MATS["LanternGlass"]], C)
    # туман двора
    fm = MB()
    fm.cube((0, -32, 3.0), (70, 70, 6.0), 0)
    fog = fm.obj("FogYard", [MATS["FogYard"]], C)
    # туман нефа
    fm = MB()
    fm.cube((0, NAVE_LEN / 2, 14), (2 * AISLE_X, NAVE_LEN, 28), 0)
    fm.obj("FogNave", [MATS["FogNave"]], coll("Cathedral"))
    return lamps


def dead_tree(name, base, height, C, seed=0):
    r = random.Random(seed)
    mb = MB()

    def branch(p, d, length, rad, depth):
        pts = [p]
        q = Vector(p)
        dd = Vector(d)
        steps = 6
        for i in range(steps):
            dd = (dd + Vector((r.uniform(-0.35, 0.35), r.uniform(-0.35, 0.35), r.uniform(-0.15, 0.25)))).normalized()
            q = q + dd * (length / steps)
            pts.append(q.copy())
        rads = [rad * (1 - 0.65 * i / steps) for i in range(steps + 1)]
        mb.sweep(pts, rads, 0, segs=max(4, 8 - depth * 2), cap=True)
        if depth < 4:
            nb = r.randint(2, 3)
            for k in range(nb):
                idx = r.randint(2, steps)
                nd = (dd + Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(0.0, 0.8)))).normalized()
                branch(pts[idx], nd, length * r.uniform(0.45, 0.7), rads[idx] * 0.7, depth + 1)

    branch(base, Vector((0, 0, 1)), height * 0.55, height * 0.035, 0)
    # корни
    for k in range(5):
        a = k * 2 * math.pi / 5 + r.uniform(-0.3, 0.3)
        mb.sweep([base + Vector((0, 0, 0.4)), base + Vector((math.cos(a) * 0.6, math.sin(a) * 0.6, 0.05)),
                  base + Vector((math.cos(a) * 1.2, math.sin(a) * 1.2, -0.1))], [height * 0.02, height * 0.012, 0.01], 0, segs=6)
    return mb.obj(name, [MATS["Bark"]], C)


# ════════════════════════════════════════════════════════════════════
# CHARACTERS (арматура + skin-тело + одежда + волосы на костях)
# ════════════════════════════════════════════════════════════════════
def _bones_def(fem):
    sh = 0.165 if fem else 0.19
    hp = 0.095 if fem else 0.09
    B = [
        ("hips", (0, 0, 0.90), (0, 0, 1.05), None),
        ("spine", (0, 0, 1.05), (0, 0, 1.22), "hips"),
        ("chest", (0, 0, 1.22), (0, 0, 1.42), "spine"),
        ("neck", (0, 0, 1.42), (0, 0, 1.54), "chest"),
        ("head", (0, 0, 1.54), (0, 0, 1.80), "neck"),
    ]
    for s, side in ((1, "L"), (-1, "R")):
        B += [
            ("clavicle." + side, (s * 0.03, 0.0, 1.40), (s * sh, 0.01, 1.41), "chest"),
            ("upperarm." + side, (s * sh, 0.01, 1.41), (s * (sh + 0.10), 0.03, 1.15), "clavicle." + side),
            ("forearm." + side, (s * (sh + 0.10), 0.03, 1.15), (s * (sh + 0.16), 0.0, 0.91), "upperarm." + side),
            ("hand." + side, (s * (sh + 0.16), 0.0, 0.91), (s * (sh + 0.175), -0.01, 0.82), "forearm." + side),
            ("thigh." + side, (s * hp, 0.0, 0.92), (s * (hp + 0.01), -0.015, 0.50), "hips"),
            ("shin." + side, (s * (hp + 0.01), -0.015, 0.50), (s * (hp + 0.01), 0.025, 0.09), "thigh." + side),
            ("foot." + side, (s * (hp + 0.01), 0.025, 0.09), (s * (hp + 0.01), -0.11, 0.025), "shin." + side),
        ]
    return B


def _skin_skeleton(fem):
    """вершины + рёбра + радиусы для Skin-модификатора"""
    sh = 0.165 if fem else 0.19
    hp = 0.095 if fem else 0.09
    V, E, R = [], [], []

    def v(p, r):
        V.append(p)
        R.append(r if hasattr(r, "__len__") else (r, r))
        return len(V) - 1

    hips = v((0, 0, 0.93), (0.155, 0.11) if fem else (0.14, 0.10))
    waist = v((0, 0, 1.07), (0.105, 0.085) if fem else (0.125, 0.09))
    chest = v((0, 0, 1.27), (0.13, 0.115) if fem else (0.155, 0.105))
    shl = v((0, 0, 1.39), (0.10, 0.075) if fem else (0.12, 0.08))
    neck = v((0, 0, 1.49), 0.048 if fem else 0.058)
    ntop = v((0, 0, 1.585), 0.043 if fem else 0.05)
    E += [(hips, waist), (waist, chest), (chest, shl), (shl, neck), (neck, ntop)]
    for s in (1, -1):
        c = v((s * 0.10, 0, 1.40), 0.06)
        a0 = v((s * sh, 0.01, 1.405), 0.05 if fem else 0.06)
        a1 = v((s * (sh + 0.10), 0.03, 1.15), 0.034 if fem else 0.042)
        a2 = v((s * (sh + 0.16), 0.0, 0.92), 0.026 if fem else 0.032)
        a3 = v((s * (sh + 0.17), -0.006, 0.865), (0.032, 0.016) if fem else (0.038, 0.019))
        a4 = v((s * (sh + 0.178), -0.012, 0.80), (0.028, 0.012) if fem else (0.033, 0.014))
        th = v((s * (sh + 0.15), -0.03, 0.88), 0.011)
        E += [(shl, c), (c, a0), (a0, a1), (a1, a2), (a2, a3), (a3, a4), (a2, th)]
        l0 = v((s * hp, 0, 0.88), 0.085 if fem else 0.08)
        l1 = v((s * (hp + 0.01), -0.015, 0.50), 0.052 if fem else 0.055)
        l2 = v((s * (hp + 0.01), 0.02, 0.10), 0.036 if fem else 0.04)
        l3 = v((s * (hp + 0.01), -0.03, 0.05), (0.04, 0.045))
        l4 = v((s * (hp + 0.01), -0.11, 0.035), (0.036, 0.025))
        E += [(hips, l0), (l0, l1), (l1, l2), (l2, l3), (l3, l4)]
    return V, E, R


def _seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    proj = a + t[:, None] * ab[None, :]
    return np.linalg.norm(P - proj, axis=1), t


def auto_weights(ob, bones, P=None, names=None, power=4.0, topk=2, bias=None):
    """веса по расстоянию до сегментов костей (без bpy.ops)"""
    me = ob.data
    if P is None:
        P = np.array([v.co[:] for v in me.vertices])
    names = names or [b[0] for b in bones]
    segs = {b[0]: (np.array(b[1], float), np.array(b[2], float)) for b in bones}
    D = np.stack([_seg_dist(P, *segs[n])[0] for n in names], axis=1)
    if bias:
        for n, f in bias.items():
            if n in names:
                D[:, names.index(n)] *= f
    W = 1.0 / (D + 0.012) ** power
    idx = np.argsort(-W, axis=1)[:, :topk]
    groups = {n: ob.vertex_groups.new(name=n) for n in names}
    rows = np.arange(len(P))
    sel = W[rows[:, None], idx]
    sel = sel / sel.sum(axis=1, keepdims=True)
    for k in range(topk):
        for bi, n in enumerate(names):
            m = idx[:, k] == bi
            if not m.any():
                continue
            vids = np.nonzero(m)[0]
            ws = sel[m, k]
            g = groups[n]
            for vi, w in zip(vids.tolist(), ws.tolist()):
                if w > 0.02:
                    g.add([vi], w, 'REPLACE')
    return np.array([names[i] for i in idx[:, 0]])


def set_weights(ob, table):
    """table: {bone: [(vi, w), ...]}"""
    for n, lst in table.items():
        g = ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)
        for vi, w in lst:
            if w > 0.005:
                g.add([vi], float(w), 'REPLACE')


def bone_parent(ob, arm, bone_name):
    b = arm.data.bones[bone_name]
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone_name
    tail_mat = b.matrix_local @ Matrix.Translation((0, b.length, 0))
    ob.matrix_parent_inverse = tail_mat.inverted()
    ob.matrix_basis = Matrix.Identity(4)


def make_armature(name, bones, C):
    ad = bpy.data.armatures.new(PREFIX + "_" + name)
    arm = bpy.data.objects.new(PREFIX + "_" + name, ad)
    C.objects.link(arm)
    vl = bpy.context.view_layer
    for o in vl.objects:
        if o.select_get():
            o.select_set(False)
    vl.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for nm, h, t, par in bones:
        eb = ad.edit_bones.new(nm)
        eb.head = h
        eb.tail = t
        d = (Vector(t) - Vector(h)).normalized()
        if abs(d.y) > 0.8:
            eb.align_roll(Vector((0, 0, 1)))
        else:
            eb.align_roll(Vector((0, -1, 0)))
        if par:
            eb.parent = ad.edit_bones[par]
            eb.use_connect = (Vector(ad.edit_bones[par].tail) - Vector(h)).length < 1e-4
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    ad.display_type = 'STICK'
    return arm


def head_mesh(mb, Hc, fem, hair_mat_idx, hairline=0.25):
    """голова: деформированная сфера + черты лица. Материалы: 0 кожа, hair_mat_idx - скальп"""
    rx, ry, rz = (0.083, 0.098, 0.112) if fem else (0.09, 0.104, 0.118)
    n0 = mb._nf()
    res = bmesh.ops.create_uvsphere(mb.bm, u_segments=40, v_segments=24, radius=1.0, matrix=Matrix.Identity(4), calc_uvs=True)
    for v in res["verts"]:
        x, y, z = v.co
        sx = 1.0
        if z < 0:
            sx = 1.0 - 0.32 * (-z) ** 1.3            # уже к подбородку
        if y < 0 and z < -0.2:
            y *= 1.0 + 0.12 * (-z)                    # подбородок вперёд
        if y > 0 and z > -0.3:
            y *= 1.08                                 # затылок
        if y < -0.6 and -0.25 < z < 0.25:
            y *= 0.94 + 0.06 * abs(z) * 4             # плоскость лица
        v.co = Vector((x * sx * rx, y * ry, z * rz)) + Hc
    mb._new_faces(n0, 0, True)
    mb.bm.faces.ensure_lookup_table()
    for f in mb.bm.faces[n0:]:
        c = f.calc_center_median() - Hc
        d = Vector((c.x / rx, c.y / ry, c.z / rz)).normalized()
        # скальп: верх + затылок, кроме лица
        if (d.z > hairline and not (d.y < -0.55 and d.z < 0.55)) or (d.y > 0.25 and d.z > -0.55):
            f.material_index = hair_mat_idx
    # глаза
    for s in (1, -1):
        e = Hc + Vector((s * 0.033, -0.086 * (ry / 0.098), 0.012))
        mb.sphere(e, (0.0125, 0.008, 0.0095), 2, 16, 10)
        mb.sphere(e + Vector((0, -0.0065, 0)), (0.0062, 0.003, 0.0062), 3, 12, 8)
        mb.torus(e + Vector((0, -0.002, 0)), 0.0135, 0.0018 if fem else 0.0012, 4, 20, 4,
                 rot=Matrix.Rotation(math.pi / 2, 3, 'X') @ Matrix.Diagonal((1.0, 0.75, 1.0)))
        # брови
        mb.cube(Hc + Vector((s * 0.035, -0.091 * (ry / 0.098), 0.034)), (0.03, 0.006, 0.0045 if fem else 0.007), 4,
                rot=Matrix.Rotation(-s * 0.18, 3, 'Y'))
        # стрелки (готик)
        if fem:
            mb.cube(Hc + Vector((s * 0.05, -0.083, 0.014)), (0.016, 0.003, 0.0022), 4, rot=Matrix.Rotation(-s * 0.45, 3, 'Y'))
    # нос
    mb.sphere(Hc + Vector((0, -0.104 * (ry / 0.098), -0.018)), (0.011, 0.016, 0.026), 0, 12, 8)
    # губы
    mb.sphere(Hc + Vector((0, -0.095 * (ry / 0.098), -0.054)), (0.02 if fem else 0.022, 0.008, 0.0055), 5, 16, 8)
    mb.sphere(Hc + Vector((0, -0.094 * (ry / 0.098), -0.063)), (0.018 if fem else 0.02, 0.008, 0.0055), 5, 16, 8)
    # уши
    for s in (1, -1):
        mb.sphere(Hc + Vector((s * rx * 0.98, 0.005, -0.005)), (0.01, 0.022, 0.03), 0, 10, 6)
    return (rx, ry, rz)


def hair_locks(spec, Hc, radii, rnd):
    """генерация прядей: возвращает [(points, widths, normals, root_dir)]"""
    rx, ry, rz = radii
    locks = []

    def collide(p, off, below_head=True):
        q = Vector(((p.x - Hc.x) / rx, (p.y - Hc.y) / ry, (p.z - Hc.z) / rz))
        lim = 1.0 + off
        if q.length < lim:
            q = q.normalized() * lim
            p = Vector((Hc.x + q.x * rx, Hc.y + q.y * ry, Hc.z + q.z * rz))
        # торс (капсула) и плечи
        for a, b, r in ((Vector((0, 0.0, 0.95)), Vector((0, 0.0, 1.40)), 0.16 + off * 0.2),
                        (Vector((0.04, 0, 1.43)), Vector((0.22, 0, 1.41)), 0.075),
                        (Vector((-0.04, 0, 1.43)), Vector((-0.22, 0, 1.41)), 0.075),
                        (Vector((0, 0, 1.43)), Vector((0, 0, 1.56)), 0.06)):
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            c = a + ab * t
            d = p - c
            if d.length < r:
                if d.length < 1e-6:
                    d = Vector((0, 1, 0))
                p = c + d.normalized() * r
        return p

    def grow(root_dir, length, nseg, off, gravity, bias, wave_amp, wave_len, stiff):
        d0 = root_dir
        p = Vector((Hc.x + d0.x * rx, Hc.y + d0.y * ry, Hc.z + d0.z * rz))
        p = collide(p, off * 0.5)
        pts = [p.copy()]
        dirv = (d0 * stiff + Vector((0, 0, -1)) * (1 - stiff)).normalized()
        seg = length / nseg
        side = d0.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        ph = rnd.uniform(0, 6.28)
        for k in range(nseg):
            dirv = (dirv + gravity * 0.35 + bias * 0.25).normalized()
            p = p + dirv * seg
            s = (k + 1) / nseg
            if wave_amp:
                p = p + side * (wave_amp * math.sin(ph + s * length / wave_len * 2 * math.pi)) * min(1.0, s * 3) * 0.35
            p = collide(p, off)
            pts.append(p.copy())
        return pts

    G = Vector((0, 0, -1))
    # основная масса
    n = spec["count"]
    golden = math.pi * (3 - math.sqrt(5))
    tries = 0
    i = 0
    while len(locks) < n and tries < n * 6:
        tries += 1
        i += 1
        zz = 1 - (i % (n * 3)) / (n * 3) * 1.55
        rr = math.sqrt(max(0, 1 - zz * zz))
        th = i * golden
        d = Vector((math.cos(th) * rr, math.sin(th) * rr, zz))
        if d.z < spec.get("min_z", -0.35):
            continue
        if d.y < -0.35 and d.z < 0.62:          # лицо
            continue
        if d.z < 0.1 and abs(d.x) > 0.75 and d.y < 0.1:   # уши/виски ниже - пропуск
            continue
        layer = rnd.uniform(0.02, 0.09) + max(0, d.z) * 0.04
        L = spec["length"] * rnd.uniform(0.88, 1.08)
        if d.y < -0.1:
            L *= spec.get("front_len", 1.0)
        bias = Vector((0, 0.12 if d.y > -0.2 else -0.05, 0)) * spec.get("back_bias", 1.0)
        if spec.get("front_drape") and abs(d.x) > 0.45 and d.y < 0.15:
            bias = Vector((d.x * 0.05, -0.18, 0))
        pts = grow(d, L, spec.get("nseg", 22), layer, G, bias, spec.get("wave", 0.0), spec.get("wave_len", 0.1), spec.get("stiff", 0.55))
        w0 = spec.get("width", 0.03) * rnd.uniform(0.8, 1.2)
        widths = [w0 * (1 - 0.85 * (k / (len(pts) - 1)) ** 1.5) for k in range(len(pts))]
        locks.append((pts, widths, d))
    # чёлка
    fr = spec.get("fringe")
    if fr:
        for k in range(fr["count"]):
            a = fr["az0"] + (fr["az1"] - fr["az0"]) * (k + rnd.uniform(-0.3, 0.3)) / max(1, fr["count"] - 1)
            el = rnd.uniform(fr["el0"], fr["el1"])
            d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
            bias = Vector((fr.get("sweep", 0.0), -0.35, 0.0))
            pts = grow(d, fr["length"] * rnd.uniform(0.85, 1.1), 12, rnd.uniform(0.03, 0.06), G, bias, 0.0, 0.1, 0.25)
            if fr.get("cut_z") is not None:
                pts = [p for p in pts if p.z > Hc.z + fr["cut_z"]] or pts[:2]
                if len(pts) < 3:
                    continue
            w0 = fr.get("width", 0.025)
            widths = [w0 * (1 - 0.6 * (j / (len(pts) - 1))) for j in range(len(pts))]
            locks.append((pts, widths, d))
    return locks


CHAR_ARMS = {}
CHARS = {}


def build_character(name, fem, loc, rot_z, outfit, hair_spec, hair_mat, C, skin_mat=None, hood=False):
    log("character", name)
    bones = _bones_def(fem)
    arm = make_armature(name, bones, C)
    arm.location = loc
    arm.rotation_euler = (0, 0, rot_z)
    SK = skin_mat or MATS["Skin"]

    # ── тело (skin modifier) ──
    V, E, R = _skin_skeleton(fem)
    me = bpy.data.meshes.new(PREFIX + "_" + name + "_skel")
    me.from_pydata(V, E, [])
    tmp = bpy.data.objects.new(PREFIX + "_" + name + "_tmp", me)
    C.objects.link(tmp)
    sk = tmp.modifiers.new("skin", 'SKIN')
    sk.branch_smoothing = 0.6
    sk.use_smooth_shade = True
    for i, r in enumerate(R):
        me.skin_vertices[0].data[i].radius = r
    me.skin_vertices[0].data[0].use_root = True
    ss = tmp.modifiers.new("sub", 'SUBSURF')
    ss.levels = 2
    ss.render_levels = 2
    apply_modifiers(tmp)
    body = tmp
    body.name = PREFIX + "_" + name + "_Body"
    body.data.name = body.name
    mats = [SK, MATS[outfit["top"]], MATS[outfit["legs"]], MATS["Leather"], MATS[outfit.get("sleeves", outfit["top"])]]
    for m in mats:
        body.data.materials.append(m)
    dom = auto_weights(body, bones, names=[b[0] for b in bones if b[0] != "head"] + ["head"])
    # материалы по доминирующей кости
    region = {"hips": 2 if outfit.get("legs_on_hips") else 1, "spine": 1, "chest": 1, "neck": 0, "head": 0}
    for s in "LR":
        region.update({"clavicle." + s: 1, "upperarm." + s: 4, "forearm." + s: 4 if not outfit.get("bare_forearm") else 0,
                       "hand." + s: 0, "thigh." + s: 2, "shin." + s: 2, "foot." + s: 3})
    pol = body.data.polygons
    mi = np.zeros(len(pol), dtype=np.int32)
    for p in pol:
        names = [dom[v] for v in p.vertices]
        best = max(set(names), key=names.count)
        mi[p.index] = region.get(best, 1)
        # декольте / шея - кожа
        z = sum(body.data.vertices[v].co.z for v in p.vertices) / len(p.vertices)
        y = sum(body.data.vertices[v].co.y for v in p.vertices) / len(p.vertices)
        if outfit.get("neckline") and best in ("chest",) and z > outfit["neckline"] and y < 0.02:
            mi[p.index] = 0
    pol.foreach_set("material_index", mi)
    body.parent = arm
    am = body.modifiers.new("arm", 'ARMATURE')
    am.object = arm

    # ── голова ──
    Hc = Vector((0, 0, 1.665 if fem else 1.68))
    mb = MB()
    radii = head_mesh(mb, Hc, fem, 1, hairline=hair_spec.get("hairline", 0.25))
    head = mb.obj(name + "_Head", [SK, MATS[hair_mat], MATS["Sclera"], MATS["Eye"], MATS["Liner"], MATS["Lips"]], C)
    bone_parent(head, arm, "head")

    # ── одежда ──
    cloth_parts = []
    if outfit.get("skirt"):
        top_z, hem_z, r_top, r_hem = outfit["skirt"]
        for layer, (mat, dz, dr) in enumerate(((outfit["skirt_mat2"], -0.06, 0.03), (outfit["skirt_mat"], 0.0, 0.0))):
            mb = MB()
            prof = []
            nz = 14
            for k in range(nz + 1):
                h = k / nz
                z = top_z + (hem_z + dz - top_z) * h
                r = r_top + (r_hem + dr - r_top) * (h ** 0.85)
                prof.append((r, z))
            prof.reverse()
            rings = mb.lathe(prof, 64, 0, cap_bottom=False)
            # оборки по подолу
            for i, v in enumerate(rings[0]):
                a = 2 * math.pi * i / 64
                f = 1.0 + 0.07 * math.sin(a * 12 + layer)
                v.co.x *= f
                v.co.y *= f
                v.co.z += 0.015 * math.sin(a * 24)
            sk_ob = mb.obj(name + "_Skirt%d" % layer, [MATS[mat]], C)
            sk_ob.data.polygons.foreach_set("use_smooth", [True] * len(sk_ob.data.polygons))
            cloth_parts.append(("skirt", sk_ob, top_z, hem_z + dz))
        # корсет со шнуровкой
        mb = MB()
        mb.lathe([(0.108, 0.98), (0.1, 1.07), (0.128, 1.2), (0.124, 1.27), (0.0, 1.27)], 40, 0, cap_bottom=False)
        for k in range(7):
            z = 1.0 + k * 0.035
            mb.cyl((-0.02, -0.112 + 0.012 * (k / 7), z), (0.02, -0.112 + 0.012 * (k / 7), z + 0.03), 0.0025, 0.0025, segs=4, mat=1)
            mb.cyl((0.02, -0.112, z), (-0.02, -0.112, z + 0.03), 0.0025, 0.0025, segs=4, mat=1)
        cs = mb.obj(name + "_Corset", [MATS[outfit.get("corset_mat", "Leather")], MATS["Silver"]], C)
        cloth_parts.append(("corset", cs, 1.27, 0.98))
    if outfit.get("coat"):
        mb = MB()
        L = outfit["coat"]
        prof = [(0.33, L), (0.29, L + 0.15), (0.22, 0.85), (0.16, 1.0), (0.165, 1.2), (0.185, 1.32), (0.15, 1.42), (0.07, 1.47)]
        rings = mb.lathe(prof, 48, 0, cap_bottom=False)
        # разрез спереди (ниже пояса)
        rm = []
        for f in list(mb.bm.faces):
            c = f.calc_center_median()
            ang = math.atan2(c.y, c.x)
            if c.z < 0.95 and abs(ang + math.pi / 2) < 0.12:
                rm.append(f)
        bmesh.ops.delete(mb.bm, geom=rm, context='FACES')
        # воротник
        mb.lathe([(0.075, 1.44), (0.09, 1.5), (0.11, 1.58)], 32, 0, cap_bottom=False)
        # пуговицы
        for k in range(5):
            mb.sphere((0.04, -0.17, 1.02 + k * 0.07), 0.008, 1, 8, 6)
        co = mb.obj(name + "_Coat", [MATS[outfit["coat_mat"]], MATS["Silver"]], C)
        sol = co.modifiers.new("sol", 'SOLIDIFY')
        sol.thickness = 0.008
        co.data.polygons.foreach_set("use_smooth", [True] * len(co.data.polygons))
        cloth_parts.append(("coat", co, 1.47, L))
    # аксессуары: чокер + крест
    mb = MB()
    mb.torus((0, 0, 1.5), 0.05 if fem else 0.06, 0.006, 0, 32, 6, rot=Matrix.Diagonal((1.0, 0.95, 1.0)))
    mb.cube((0, -0.06 if fem else -0.068, 1.46), (0.006, 0.004, 0.04), 1)
    mb.cube((0, -0.06 if fem else -0.068, 1.468), (0.024, 0.004, 0.006), 1)
    acc = mb.obj(name + "_Choker", [MATS["Leather"], MATS["Silver"]], C)
    bone_parent(acc, arm, "neck")
    # платформы ботинок
    for s, side in ((1, "L"), (-1, "R")):
        mb = MB()
        hp = 0.095 if fem else 0.09
        mb.cube((s * (hp + 0.01), -0.035, 0.012), (0.085, 0.24, 0.05 if fem else 0.035), 0)
        boot = mb.obj(name + "_Sole" + side, [MATS["Leather"]], C)
        boot.parent = arm
        set_weights(boot, {"foot." + side: [(v.index, 1.0) for v in boot.data.vertices]})
        boot.modifiers.new("arm", 'ARMATURE').object = arm
    # капюшон
    if hood:
        mb = MB()
        res = bmesh.ops.create_uvsphere(mb.bm, u_segments=32, v_segments=16, radius=1.0, calc_uvs=True)
        rm = [f for f in mb.bm.faces if f.calc_center_median().y < -0.35 and f.calc_center_median().z > -0.6]
        bmesh.ops.delete(mb.bm, geom=rm, context='FACES')
        for v in mb.bm.verts:
            v.co = Vector((v.co.x * 0.125, v.co.y * 0.14 + 0.01, v.co.z * 0.15 + (0.02 if v.co.z > 0 else 0.0))) + Hc
            if v.co.z < Hc.z - 0.08:
                v.co.z -= 0.04
                v.co.x *= 1.25
        for f in mb.bm.faces:
            f.smooth = True
        hd = mb.obj(name + "_Hood", [MATS[outfit["coat_mat"]]], C)
        so = hd.modifiers.new("sol", 'SOLIDIFY')
        so.thickness = 0.012
        bone_parent(hd, arm, "head")
    # веса одежды: юбки/пальто - смесь бёдер и таза
    for kind, ob, ztop, zbot in cloth_parts:
        ob.parent = arm
        tbl = {"hips": [], "spine": [], "chest": [], "thigh.L": [], "thigh.R": [], "shin.L": [], "shin.R": []}
        for v in ob.data.vertices:
            z = v.co.z
            if z > 1.22:
                tbl["chest"].append((v.index, 1.0))
                continue
            if z > 1.05:
                f = (z - 1.05) / 0.17
                tbl["chest"].append((v.index, f))
                tbl["spine"].append((v.index, 1 - f))
                continue
            h = max(0.0, min(1.0, (0.98 - z) / max(0.98 - zbot, 0.1)))
            side = max(0.0, min(1.0, 0.5 + v.co.x / 0.25))
            tbl["hips"].append((v.index, 1.0 - 0.75 * h))
            tbl["thigh.L"].append((v.index, 0.75 * h * side * (1 - 0.4 * h)))
            tbl["thigh.R"].append((v.index, 0.75 * h * (1 - side) * (1 - 0.4 * h)))
            tbl["shin.L"].append((v.index, 0.75 * h * side * 0.4 * h))
            tbl["shin.R"].append((v.index, 0.75 * h * (1 - side) * 0.4 * h))
        set_weights(ob, tbl)
        ob.modifiers.new("arm", 'ARMATURE').object = arm
        if kind in ("skirt", "coat"):
            # лёгкое колыхание ткани
            wv = ob.modifiers.new("flutter", 'WAVE')
            wv.use_x = True
            wv.use_y = True
            wv.height = 0.006
            wv.width = 0.25
            wv.speed = 0.02
            wv.narrowness = 1.2
            wv.start_position_object = None

    # ── волосы ──
    rnd = random.Random(hash(name) & 0xffff)
    locks = hair_locks(hair_spec, Hc, radii, rnd)
    mb = MB()
    lock_ranges = []
    for pts, widths, d in locks:
        nrm = []
        for p in pts:
            q = p - Hc
            if p.z < Hc.z - 0.08:
                q = Vector((p.x, p.y, 0.0))
            nrm.append(q.normalized() if q.length > 1e-5 else Vector((0, 1, 0)))
        nv0 = len(mb.bm.verts)
        mb.ribbon(pts, widths, nrm, 0)
        lock_ranges.append((nv0, len(pts), pts, d))
    hair = mb.obj(name + "_Hair", [MATS[hair_mat]], C)
    hair.parent = arm
    # цепочки костей для волос: кластеры по азимуту корня
    clusters = hair_spec.get("clusters", 6)
    centers = [2 * math.pi * k / clusters - math.pi / 2 for k in range(clusters)]
    chain_pts = {k: [] for k in range(clusters)}
    lock_cl = []
    for nv0, n, pts, d in lock_ranges:
        az = math.atan2(d.y, d.x)
        dists = [abs((az - c + math.pi) % (2 * math.pi) - math.pi) for c in centers]
        order = np.argsort(dists)
        k1, k2 = int(order[0]), int(order[1])
        w2 = dists[k1] / max(dists[k1] + dists[k2], 1e-6)
        lock_cl.append((k1, k2, w2))
        chain_pts[k1].append(pts)
    nb = 3
    hair_bones = []
    for k in range(clusters):
        if not chain_pts[k]:
            continue
        L = min(len(p) for p in chain_pts[k])
        avg = [sum((p[i] for p in chain_pts[k]), Vector()) / len(chain_pts[k]) for i in range(L)]
        idxs = [int(round(x * (L - 1))) for x in (0.12, 0.42, 0.72, 1.0)]
        for j in range(nb):
            a, b = avg[idxs[j]], avg[idxs[j + 1]]
            if (b - a).length < 0.01:
                b = a + Vector((0, 0, -0.03))
            hair_bones.append(("hair%d_%d" % (k, j), a[:], b[:], "head" if j == 0 else "hair%d_%d" % (k, j - 1)))
    # добавить кости волос в арматуру
    vl = bpy.context.view_layer
    vl.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for nm, h, t, par in hair_bones:
        eb = arm.data.edit_bones.new(nm)
        eb.head = h
        eb.tail = t
        eb.align_roll(Vector((0, -1, 0)))
        eb.parent = arm.data.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    hb_names = {nm for nm, *_ in hair_bones}
    tbl = {}
    for (nv0, n, pts, d), (k1, k2, w2) in zip(lock_ranges, lock_cl):
        for i in range(n):
            s = i / (n - 1)
            ws = {}
            hw = max(0.0, 1.0 - s / 0.14)
            ws["head"] = hw
            rest = 1.0 - hw
            seg = min(2.0, max(0.0, (s - 0.12) / 0.3))
            j0 = int(math.floor(seg))
            fj = seg - j0
            for kk, wk in ((k1, 1 - w2 * 0.5), (k2, w2 * 0.5)):
                for jj, wj in ((j0, 1 - fj), (min(j0 + 1, 2), fj)):
                    bn = "hair%d_%d" % (kk, jj)
                    if bn in hb_names:
                        ws[bn] = ws.get(bn, 0) + rest * wk * wj
                    else:
                        ws["head"] += rest * wk * wj
            for bn, w in ws.items():
                for vi in (nv0 + 2 * i, nv0 + 2 * i + 1):
                    tbl.setdefault(bn, []).append((vi, w))
    set_weights(hair, tbl)
    hair.modifiers.new("arm", 'ARMATURE').object = arm
    CHARS[name] = dict(arm=arm, fem=fem, hair_bones=[h[0] for h in hair_bones], clusters=clusters, hair=hair, body=body)
    return arm


def build_characters():
    C = coll("Characters")
    long_black = dict(count=190, length=0.72, nseg=24, width=0.032, back_bias=1.0, front_drape=True, stiff=0.5,
                      fringe=dict(count=26, az0=-math.pi / 2 - 0.85, az1=-math.pi / 2 + 0.85, el0=0.5, el1=0.75,
                                  length=0.17, cut_z=0.028, width=0.026, sweep=0.0),
                      clusters=6, hairline=0.22)
    wavy_red = dict(count=200, length=0.6, nseg=24, width=0.034, wave=0.025, wave_len=0.09, back_bias=1.2, front_drape=True,
                    stiff=0.45, fringe=dict(count=14, az0=-math.pi / 2 - 0.2, az1=-math.pi / 2 + 0.9, el0=0.55, el1=0.8,
                                            length=0.22, cut_z=-0.02, width=0.03, sweep=0.25),
                    clusters=6, hairline=0.2)
    emo = dict(count=120, length=0.16, nseg=10, width=0.03, back_bias=0.6, stiff=0.75, min_z=-0.1,
               fringe=dict(count=22, az0=-math.pi / 2 - 0.9, az1=-math.pi / 2 + 0.5, el0=0.45, el1=0.95,
                           length=0.24, cut_z=-0.035, width=0.03, sweep=0.55),
               clusters=4, hairline=0.3)
    short = dict(count=90, length=0.1, nseg=8, width=0.03, back_bias=0.5, stiff=0.8, min_z=0.0,
                 fringe=dict(count=12, az0=-math.pi / 2 - 0.5, az1=-math.pi / 2 + 0.5, el0=0.6, el1=0.9,
                             length=0.12, cut_z=0.04, width=0.03, sweep=-0.2),
                 clusters=4, hairline=0.35)
    # Лилит - у алтаря, держит стакан
    build_character("Lilith", True, (-0.75, 30.6, 0.0), -0.35,
                    dict(top="ClothBlack", legs="ClothBlack", sleeves="ClothBlack", skirt=(1.0, 0.3, 0.12, 0.5),
                         skirt_mat="ClothBlack", skirt_mat2="ClothRed", neckline=1.33, corset_mat="Leather"),
                    long_black, "HairBlack", C)
    # Рэйвен - рядом, в длинном пальто
    build_character("Raven", False, (0.55, 31.3, 0.0), 0.3,
                    dict(top="ClothBlack", legs="ClothBlack", coat=0.42, coat_mat="Leather"),
                    emo, "HairPlatinum", C)
    # Моргана - во дворе у надгробия, ветер в волосах
    build_character("Morgana", True, (2.4, -17.6, 0.0), -2.2,
                    dict(top="ClothPurple", legs="ClothBlack", sleeves="ClothPurple", skirt=(1.0, 0.18, 0.12, 0.55),
                         skirt_mat="ClothPurple", skirt_mat2="ClothBlack", neckline=1.3, corset_mat="ClothBlack"),
                    wavy_red, "HairRed", C)
    # Призрак в капюшоне - идёт по дорожке к собору
    build_character("Hood", False, (0.9, -27.0, 0.0), math.pi,
                    dict(top="ClothBlack", legs="ClothBlack", coat=0.32, coat_mat="ClothBlack"),
                    short, "HairBlack", C, hood=True)
    # props: стакан в руке Лилит
    cup_src = bpy.data.objects[PREFIX + "_LeanCup"]
    cup2 = bpy.data.objects.new(PREFIX + "_LeanCup_Hand", cup_src.data)
    C.objects.link(cup2)
    bone_parent(cup2, CHARS["Lilith"]["arm"], "hand.R")
    cup2.matrix_basis = Matrix.Translation((0.0, 0.0, 0.0)) @ Euler((math.radians(-95), 0, 0)).to_matrix().to_4x4() @ Matrix.Translation((0, 0, -0.06))
    cup2.location = (-0.01, -0.03, -0.03)
    liq2 = bpy.data.objects.new(PREFIX + "_LeanLiquid_Hand", bpy.data.objects[PREFIX + "_LeanLiquid"].data)
    C.objects.link(liq2)
    liq2.parent = cup2


# ════════════════════════════════════════════════════════════════════
# ANIMATION HELPERS
# ════════════════════════════════════════════════════════════════════
def beat_pulse(f, decay=5.0, beats=None):
    """0..1 импульс после каждого бита"""
    v = 0.0
    for b in (beats or BEATS):
        if b <= f < b + 30:
            v = max(v, math.exp(-(f - b) / decay))
    return v


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def ramp(f, a, b):
    return smooth((f - a) / max(b - a, 1e-6))


def nz(t, seed, freq=1.0):
    return mnoise.noise(Vector((t * freq, seed * 7.31, seed * 1.7)))


def anim_character(name, pose_fn, frames=None, root_fn=None):
    ch = CHARS[name]
    arm = ch["arm"]
    frames = frames or list(range(F0 - 2, F1 + 3, 2))
    data = {}
    for f in frames:
        pose = pose_fn(f)
        for bn, rot in pose.items():
            data.setdefault(bn, []).append(rot)
    for bn, rots in data.items():
        if bn not in arm.pose.bones:
            continue
        path = 'pose.bones["%s"].rotation_euler' % bn
        arr = np.array(rots)
        for i in range(3):
            if np.abs(arr[:, i]).max() < 1e-5:
                continue
            bake(arm, path, i, frames, arr[:, i].tolist())
    if root_fn:
        locs = np.array([root_fn(f) for f in frames])
        for i in range(3):
            bake(arm, "location", i, frames, locs[:, i].tolist())


def hair_motion(name, f, amp=1.0, wind=0.0, head_nod=0.0, seed=0.0):
    ch = CHARS[name]
    t = f / FPS
    out = {}
    for bn in ch["hair_bones"]:
        k = int(bn[4:].split("_")[0])
        j = int(bn.split("_")[1])
        ph = k * 1.3 + seed
        lag = j * 0.55
        x = amp * (0.06 * math.sin(2.1 * t + ph - lag) + 0.04 * nz(t - j * 0.08, k + seed, 1.3)) \
            - head_nod * 0.35 * (j + 1) / 3 + wind * (0.12 + 0.1 * nz(t - j * 0.12, 9 + k, 2.4))
        z = amp * (0.07 * math.sin(1.7 * t + ph * 1.7 - lag) + 0.05 * nz(t - j * 0.1, 30 + k + seed, 1.1)) \
            + wind * 0.15 * nz(t - j * 0.1, 50 + k, 3.0)
        out[bn] = (x * (1 + 0.4 * j), 0.0, z * (1 + 0.5 * j))
    return out


def setup_character_anims():
    log("character animation")

    # ЛИЛИТ: покачивание, кивки в бит, поднимает стакан к губам (S4), смотрит в камеру
    def lilith(f):
        t = f / FPS
        nod = beat_pulse(f, 4.0) * 0.12
        sway = 0.04 * math.sin(t * 2 * math.pi / 2.14)
        lift = ramp(f, 228, 246) * (1 - 0.55 * ramp(f, 262, 285))
        sip = ramp(f, 246, 252) * (1 - ramp(f, 258, 266))
        p = {
            "hips": (0, sway * 0.5, sway),
            "spine": (0.02 * math.sin(t * 2.2), 0, -sway * 0.6),
            "chest": (0.015 * math.sin(t * 2.2 + 1), 0, -sway * 0.4),
            "neck": (nod * 0.5 - 0.1 * sip, 0, 0.05 * math.sin(t * 0.7)),
            "head": (nod - 0.15 * sip - 0.05, 0.04 * math.sin(t * 0.9), 0.12 * math.sin(t * 0.5) + 0.25 * ramp(f, 236, 250)),
            "upperarm.R": (0.95 * lift + 0.05 * sway, 0, -0.25 * lift),
            "forearm.R": (1.95 * lift + 0.25 * sip, 0, 0.0),
            "hand.R": (-0.25 * lift - 0.4 * sip, 0, 0),
            "upperarm.L": (0.18 + 0.05 * math.sin(t * 1.3), 0, 0.12 + 0.05 * nod),
            "forearm.L": (0.6 + 0.1 * math.sin(t * 1.1), 0, 0),
            "hand.L": (0.1, 0, 0),
            "thigh.L": (0.05, 0, 0.03), "thigh.R": (-0.05, 0, -0.02), "shin.L": (-0.1, 0, 0),
        }
        p.update(hair_motion("Lilith", f, 1.0, 0.15, nod, 0.0))
        return p
    anim_character("Lilith", lilith)

    # РЭЙВЕН: хедбэнг в бит, руки в "карманах", поднимает взгляд
    def raven(f):
        t = f / FPS
        nod = beat_pulse(f, 3.5) * 0.22
        look = ramp(f, 245, 262)
        p = {
            "spine": (0.04 + 0.02 * math.sin(t * 2.1), 0, 0.03 * math.sin(t * 0.8)),
            "chest": (0.03, 0, 0),
            "neck": (nod * 0.5, 0, -0.1),
            "head": (nod + 0.1 - 0.3 * look, 0.05 * math.sin(t), -0.2 + 0.35 * look),
            "upperarm.L": (-0.15, 0, 0.1), "forearm.L": (0.55, 0, 0.0), "hand.L": (0.2, 0, 0),
            "upperarm.R": (-0.15, 0, -0.1), "forearm.R": (0.55, 0, 0.0), "hand.R": (0.2, 0, 0),
            "thigh.L": (0.0, 0, 0.06), "thigh.R": (0.0, 0, -0.06),
        }
        p.update(hair_motion("Raven", f, 0.6, 0.0, nod * 1.4, 2.0))
        return p
    anim_character("Raven", raven)

    # МОРГАНА: во дворе, сильный ветер в волосах, провожает камеру взглядом
    def morgana(f):
        t = f / FPS
        follow = ramp(f, 112, 140)
        p = {
            "hips": (0, 0, 0.04 * math.sin(t * 1.2)),
            "spine": (0.03 * math.sin(t * 1.7), 0, 0),
            "neck": (0, 0, 0.3 - 0.6 * follow),
            "head": (-0.12, 0.05 * math.sin(t * 1.3), 0.35 - 0.8 * follow),
            "upperarm.L": (0.35, 0, 0.35), "forearm.L": (1.2, 0, 0.2), "hand.L": (0.3, 0, 0),
            "upperarm.R": (0.35, 0, -0.35), "forearm.R": (1.25, 0, -0.2), "hand.R": (0.3, 0, 0),
            "thigh.L": (0.06, 0, 0.05), "shin.L": (-0.12, 0, 0),
        }
        p.update(hair_motion("Morgana", f, 1.6, 1.0, 0.0, 4.0))
        return p
    anim_character("Morgana", morgana)

    # КАПЮШОН: идёт к собору (шаг = 1 бит)
    step = (BEATS[1] - BEATS[0])

    def hood(f):
        ph = 2 * math.pi * (f - BEATS[0]) / (2 * step)
        s = math.sin(ph)
        p = {
            "hips": (0, 0, 0.08 * s),
            "spine": (0.08, 0, -0.05 * s),
            "chest": (0.05, 0, -0.07 * s),
            "head": (0.15 + 0.03 * math.sin(2 * ph), 0, 0.05 * s),
            "thigh.L": (0.42 * s, 0, 0.02), "thigh.R": (-0.42 * s, 0, -0.02),
            "shin.L": (-0.15 - 0.75 * max(0.0, math.sin(ph - 1.2)), 0, 0),
            "shin.R": (-0.15 - 0.75 * max(0.0, math.sin(ph - 1.2 + math.pi)), 0, 0),
            "foot.L": (0.25 * math.sin(ph - 0.6), 0, 0), "foot.R": (0.25 * math.sin(ph - 0.6 + math.pi), 0, 0),
            "upperarm.L": (-0.3 * s, 0, 0.08), "upperarm.R": (0.3 * s, 0, -0.08),
            "forearm.L": (0.35 + 0.15 * max(0, -s), 0, 0), "forearm.R": (0.35 + 0.15 * max(0, s), 0, 0),
        }
        p.update(hair_motion("Hood", f, 0.4, 0.4, 0.0, 6.0))
        return p

    def hood_root(f):
        t = (f - F0) / FPS
        ph = 2 * math.pi * (f - BEATS[0]) / (2 * step)
        return (0.9, -27.0 + 1.15 * t, 0.012 * abs(math.cos(ph)) - 0.008)
    anim_character("Hood", hood, root_fn=hood_root)


# ════════════════════════════════════════════════════════════════════
# BLACK HOLE
# ════════════════════════════════════════════════════════════════════
BH = {}


def build_black_hole():
    log("black hole")
    C = coll("BlackHole")
    root = bpy.data.objects.new(PREFIX + "_BH_Root", None)
    C.objects.link(root)
    root.location = BH_POS
    # горизонт событий
    mb = MB()
    mb.sphere((0, 0, 0), 5.0, 0, 48, 24)
    hz = mb.obj("BH_Horizon", [MATS["Horizon"]], C)
    hz.parent = root
    # фотонное кольцо
    mb = MB()
    mb.torus((0, 0, 0), 5.35, 0.12, 0, 96, 8)
    ring = mb.obj("BH_PhotonRing", [MATS["PhotonRing"]], C)
    ring.parent = root
    # диск
    mb = MB()
    nr, na = 40, 160
    rows = []
    for i in range(nr + 1):
        r = 5.6 + (60.0 - 5.6) * (i / nr) ** 1.6
        rows.append([mb.bm.verts.new((r * math.cos(2 * math.pi * j / na), r * math.sin(2 * math.pi * j / na),
                                      0.0)) for j in range(na)])
    for i in range(nr):
        for j in range(na):
            mb.bm.faces.new((rows[i][j], rows[i][(j + 1) % na], rows[i + 1][(j + 1) % na], rows[i + 1][j]))
    disk = mb.obj("BH_Disk", [MATS["Accretion"]], C)
    disk.parent = root
    # второй слой диска чуть выше/ниже - объём
    for k, dz in enumerate((0.35, -0.35)):
        d2 = bpy.data.objects.new(PREFIX + "_BH_Disk_%d" % k, disk.data)
        C.objects.link(d2)
        d2.parent = root
        d2.location = (0, 0, dz)
        d2.rotation_euler = (0, 0, 0.7 * (k + 1))
        d2.scale = (0.97, 0.97, 1)
    # "линзованный" ореол: копия диска, повёрнутая лицом к камере (Track To)
    halo = bpy.data.objects.new(PREFIX + "_BH_Halo", disk.data)
    C.objects.link(halo)
    halo.parent = root
    halo.scale = (0.55, 0.55, 0.55)
    BH.update(root=root, disk=disk, halo=halo, ring=ring)
    # вращение диска
    for ob, sp in ((disk, 1.0),):
        bake(ob, "rotation_euler", 2, [F0, F1], [0.0, -sp * 9.0], interp='LINEAR')
    # обломки, затягиваемые по спирали (интро S1 + финал S7)
    deb = MB()
    for k in range(70):
        deb.ico((0, 0, 0), (1, 1, 1), 0, 1, 0.25, False, rng)
    deb_mesh_src = deb
    debris = []
    rnd = random.Random(13)
    for k in range(90):
        mb = MB()
        if k % 9 == 0:   # обломки крестов
            mb.cube((0, 0, 0), (0.25, 0.25, 1.6), 0)
            mb.cube((0, 0, 0.35), (0.9, 0.25, 0.25), 0)
        else:
            mb.ico((0, 0, 0), (rnd.uniform(0.2, 0.9), rnd.uniform(0.2, 0.9), rnd.uniform(0.2, 0.9)), 0, 1, 0.12, False, rnd)
        ob = mb.obj("BH_Debris_%d" % k, [MATS["Debris"] if k % 9 else MATS["StoneCarved"]], C)
        ob.parent = root
        debris.append(ob)
    deb_mesh_src.bm.free()
    for k, ob in enumerate(debris):
        r0 = rnd.uniform(14, 70)
        a0 = rnd.uniform(0, 2 * math.pi)
        z0 = rnd.uniform(-10, 10)
        sp = rnd.uniform(0.6, 1.4)
        frames = list(range(F0 - 2, F1 + 3, 2))
        P, Rt = [], []
        for f in frames:
            t = f / FPS
            # всасывание: радиус падает экспоненциально, угол растёт как 1/r
            u = (t * 0.22 * sp) % 1.0
            r = 5.2 + (r0 - 5.2) * (1 - u) ** 1.8
            a = a0 + 6.0 * sp * t + 25.0 / (r + 1.0)
            z = z0 * (r - 5.2) / (r0 - 5.2) * 0.6
            P.append((r * math.cos(a), r * math.sin(a), z))
            Rt.append((t * 2.3 * sp + k, t * 1.7 * sp, t * 3.1 * sp))
        P, Rt = np.array(P), np.array(Rt)
        # скрываем на "перескоке" петли (масштаб 0 у горизонта)
        S = np.clip((np.linalg.norm(P[:, :2], axis=1) - 5.4) / 3.0, 0, 1)
        for i in range(3):
            bake(ob, "location", i, frames, P[:, i].tolist())
            bake(ob, "rotation_euler", i, frames, Rt[:, i].tolist())
            bake(ob, "scale", i, frames, S.tolist())
    # световые штрихи
    for k in range(50):
        mb = MB()
        mb.cube((0, 0, 0), (rnd.uniform(3, 9), 0.06, 0.06), 0)
        ob = mb.obj("BH_Streak_%d" % k, [MATS["Streak"]], C)
        ob.parent = root
        r0 = rnd.uniform(8, 45)
        a0 = rnd.uniform(0, 6.28)
        z0 = rnd.uniform(-1.5, 1.5)
        sp = rnd.uniform(0.8, 1.6)
        frames = list(range(F0 - 2, F1 + 3, 2))
        P, RZ = [], []
        for f in frames:
            t = f / FPS
            u = (t * 0.35 * sp) % 1.0
            r = 5.5 + (r0 - 5.5) * (1 - u) ** 1.5
            a = a0 + 8.0 * sp * t + 30.0 / (r + 1.0)
            P.append((r * math.cos(a), r * math.sin(a), z0 * r / r0))
            RZ.append(a + math.pi / 2)
        P = np.array(P)
        for i in range(3):
            bake(ob, "location", i, frames, P[:, i].tolist())
        bake(ob, "rotation_euler", 2, frames, RZ)
    # свет от диска
    ld = bpy.data.lights.new(PREFIX + "_BH_Light", 'POINT')
    ld.energy = 2.5e6
    ld.color = hexcol('#ff6a3a')[:3]
    ld.shadow_soft_size = 6.0
    lo = bpy.data.objects.new(PREFIX + "_BH_Light", ld)
    C.objects.link(lo)
    lo.parent = root
    lo.location = (0, 0, 8)
    return root


# ════════════════════════════════════════════════════════════════════
# CAMERA SYSTEM: сплайн-пролёты, спид-рампы, ручная тряска, punch-in, whip
# ════════════════════════════════════════════════════════════════════
def pchip(xs, ys, x):
    """монотонная кубическая интерполяция (органичный спид-рамп)"""
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    n = len(xs)
    if n == 1:
        return float(ys[0])
    if x <= xs[0]:
        return float(ys[0])
    if x >= xs[-1]:
        return float(ys[-1])
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.zeros(n)
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    i = int(np.searchsorted(xs, x) - 1)
    i = max(0, min(n - 2, i))
    t = (x - xs[i]) / h[i]
    h00 = 2 * t ** 3 - 3 * t ** 2 + 1
    h10 = t ** 3 - 2 * t ** 2 + t
    h01 = -2 * t ** 3 + 3 * t ** 2
    h11 = t ** 3 - t ** 2
    return float(h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1])


def catmull(P, s):
    """Catmull-Rom по списку Vector, s - float индекс"""
    n = len(P)
    i = int(math.floor(s))
    i = max(0, min(n - 2, i))
    t = s - i
    p0 = P[max(i - 1, 0)]
    p1 = P[i]
    p2 = P[i + 1]
    p3 = P[min(i + 2, n - 1)]
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def zoom_bounce(x, amp):
    if x < 0:
        return 0.0
    return amp * math.exp(-x / 7.0) * math.cos(x * 0.42)


CAMS = {}


def make_cam(name, shot, keys, shake=0.6, punches=(), focus=None, fstop=2.8, roll_spin=None, hits=True,
             handheld_freq=1.0, local_root=None):
    """keys: [(frame, pos, target, lens, roll)], позиции в мире (или в local_root)"""
    a, b = SHOT[shot]
    cd = bpy.data.cameras.new(PREFIX + "_" + name)
    cd.clip_start = 0.01
    cd.clip_end = 3000
    cd.sensor_width = 36
    cam = bpy.data.objects.new(PREFIX + "_" + name, cd)
    coll("Cameras").objects.link(cam)
    fr = [k[0] for k in keys]
    idx = list(range(len(keys)))
    Ps = [Vector(k[1]) for k in keys]
    Ts = [Vector(k[2]) for k in keys]
    lens = [k[3] for k in keys]
    rolls = [k[4] for k in keys]
    frames = list(range(a - 2, b + 3))
    LOC, ROT, LENS, FOC = [], [], [], []
    prev = None
    seed = hash(name) % 1000
    M = local_root.matrix_world if local_root else Matrix.Identity(4)
    for f in frames:
        s = pchip(fr, idx, f)
        p = catmull(Ps, s)
        tg = catmull(Ts, s)
        ln = pchip(fr, lens, f)
        rl = pchip(fr, rolls, f)
        t = f / FPS
        # ручная камера: низкие частоты + мелкий джиттер
        sh_p = shake * (0.9 * nz(t, seed, 0.9 * handheld_freq) + 0.35 * nz(t, seed + 5, 3.5 * handheld_freq))
        sh_y = shake * (0.9 * nz(t, seed + 11, 0.8 * handheld_freq) + 0.35 * nz(t, seed + 17, 3.1 * handheld_freq))
        sh_r = shake * 0.6 * nz(t, seed + 23, 0.6 * handheld_freq)
        # удары на битах
        hit = 0.0
        if hits:
            for bt in BEATS:
                if bt <= f < bt + 12 and a <= bt <= b:
                    x = f - bt
                    hit += math.exp(-x / 2.5) * math.sin(x * 1.9)
        zb = 0.0
        for pf, pa in punches:
            zb += zoom_bounce(f - pf, pa)
        if roll_spin:
            rl += roll_spin(f)
        wp = M @ p
        wt = M @ tg
        d = (wt - wp)
        q = d.to_track_quat('-Z', 'Y')
        q = q @ Quaternion((0, 0, 1), rl + math.radians(sh_r))
        q = q @ Quaternion((1, 0, 0), math.radians(sh_p + hit * 1.6))
        q = q @ Quaternion((0, 1, 0), math.radians(sh_y))
        e = q.to_euler('XYZ', prev) if prev else q.to_euler('XYZ')
        prev = e
        wp = wp + Vector((0, 0, hit * 0.012 * (1 + shake)))
        LOC.append(wp[:])
        ROT.append(e[:])
        LENS.append(ln * (1 + zb))
        if focus is None:
            fd = d.length
        else:
            fp = Vector(focus(f) if callable(focus) else focus)
            if local_root:
                fp = M @ fp
            fd = (fp - wp).length
        FOC.append(max(0.05, fd))
    LOC, ROT = np.array(LOC), np.array(ROT)
    for i in range(3):
        bake(cam, "location", i, frames, LOC[:, i].tolist())
        bake(cam, "rotation_euler", i, frames, ROT[:, i].tolist())
    bake(cd, "lens", -1, frames, LENS)
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    bake(cd, "dof.focus_distance", -1, frames, FOC)
    CAMS[shot] = cam
    m = SC3D.timeline_markers.new(shot, frame=a)
    m.camera = cam
    return cam


def build_cameras():
    log("cameras")
    root = BH["root"]
    # ── S1: чёрная дыра. Вытягивает назад (dolly-zoom), потом засасывает внутрь ──
    a, b = SHOT["S1_blackhole"]
    make_cam("Cam_S1", "S1_blackhole", [
        (a, (0.0, -10.5, 1.6), (0, 0, 0), 12.0, 0.0),
        (18, (3.0, -22.0, 3.2), (0, 0, 0), 18.0, 0.15),
        (40, (7.0, -42.0, 6.0), (0, 0, 0), 32.0, 0.35),
        (58, (-4.0, -58.0, 8.5), (0, 0, 0.5), 45.0, 0.2),
        (70, (-3.0, -46.0, 5.0), (0, 0, 0), 30.0, 0.0),
        (80, (-0.8, -19.0, 1.6), (0, 0, 0), 20.0, -0.4),
        (85, (0.0, -9.0, 0.5), (0, 0, 0), 15.0, -1.2),
        (b, (0.0, -5.6, 0.05), (0, 0, 0), 13.0, -2.6),
    ], shake=0.25, local_root=root, hits=False, fstop=16,
        roll_spin=lambda f: -1.8 * ramp(f, 64, 88) ** 2)

    # ── S2: FPV-пролёт через ворота над мокрой брусчаткой (спид-рамп) ──
    make_cam("Cam_S2", "S2_courtyard", [
        (89, (0.7, -54.0, 1.9), (0.1, -36.0, 1.5), 16.0, -0.12),
        (100, (0.05, -36.5, 1.35), (0.2, -20.0, 1.1), 17.0, 0.06),
        (108, (-0.25, -29.5, 0.75), (0.8, -20.0, 1.0), 20.0, 0.14),
        (116, (-0.45, -26.0, 0.7), (1.0, -21.0, 1.5), 22.0, 0.10),
        (132, (-0.55, -21.8, 0.95), (2.4, -16.5, 1.4), 22.0, -0.04),
        (140, (-0.25, -15.5, 1.6), (0.0, -4.0, 3.4), 20.0, -0.12),
        (149, (0.0, -6.0, 2.7), (0.0, 4.0, 3.2), 18.0, 0.0),
        (157, (0.0, 1.8, 2.9), (0.0, 14.0, 2.4), 16.0, 0.08),
    ], shake=0.55, punches=[(89, 0.0)], fstop=4.0, handheld_freq=1.6)

    # ── S3: lean - макро-облёт стакана, punch-in на битах, whip pan ──
    cup_c = CUP_POS + Vector((0, 0, 0.075))

    def orbit(f, ang, r, h):
        return (cup_c.x + math.cos(ang) * r, cup_c.y + math.sin(ang) * r, cup_c.z + h)
    make_cam("Cam_S3", "S3_lean_hero", [
        (158, orbit(158, math.radians(-150), 0.62, 0.0), cup_c + Vector((0, 0, -0.01)), 45.0, 0.05),
        (176, orbit(176, math.radians(-125), 0.5, 0.03), cup_c, 50.0, 0.0),
        (196, orbit(196, math.radians(-95), 0.44, 0.07), cup_c, 50.0, -0.04),
        (214, orbit(214, math.radians(-55), 0.4, 0.1), cup_c, 52.0, -0.06),
        (219, orbit(219, math.radians(-48), 0.42, 0.1), cup_c + Vector((0.6, -0.2, 0.05)), 50.0, -0.25),
        (224, orbit(224, math.radians(-44), 0.45, 0.1), cup_c + Vector((3.0, -0.4, 0.3)), 45.0, -0.5),
    ], shake=0.18, punches=[(176, 0.32), (192, 0.32), (209, 0.38)], focus=cup_c, fstop=1.8, handheld_freq=0.8)

    # ── S4: персонажи. Whip-прилёт, ручная камера, punch в стакан ──
    lil_face = Vector((-0.72, 30.55, 1.62))
    make_cam("Cam_S4", "S4_characters", [
        (225, (2.2, 27.0, 1.5), (-4.5, 28.5, 1.4), 40.0, 0.45),
        (229, (2.0, 27.2, 1.5), (-1.6, 30.2, 1.5), 40.0, 0.12),
        (234, (1.85, 27.35, 1.48), lil_face + Vector((0.4, 0.0, -0.05)), 38.0, 0.0),
        (252, (1.2, 27.9, 1.5), lil_face + Vector((0.15, 0, -0.02)), 50.0, -0.03),
        (262, (0.7, 28.4, 1.52), lil_face + Vector((0.06, -0.08, -0.06)), 58.0, -0.02),
        (269, (0.55, 28.6, 1.53), lil_face + Vector((0.05, -0.1, -0.08)), 85.0, 0.0),
    ], shake=0.9, punches=[(241, 0.18), (254, 0.12), (266, 0.6)], focus=lil_face, fstop=2.0, handheld_freq=1.2)

    # ── S5a: стакан сверху (слоумо, брейк), вращение - match cut ──
    rim_z = CUP_POS.z + 0.014 + 0.118
    D_end = 0.20
    make_cam("Cam_S5a", "S5a_cup_top", [
        (270, (0.0, CUP_POS.y + 0.0001, rim_z + 0.34), (0, CUP_POS.y, CUP_POS.z), 50.0, 0.0),
        (300, (0.0, CUP_POS.y + 0.0001, rim_z + 0.27), (0, CUP_POS.y, CUP_POS.z), 50.0, 0.35),
        (316, (0.0, CUP_POS.y + 0.0001, rim_z + D_end), (0, CUP_POS.y, CUP_POS.z), 50.0, 0.6),
    ], shake=0.1, focus=Vector((0, CUP_POS.y, rim_z - 0.02)), fstop=2.8, hits=False)

    # ── S5b: роза-окно (тот же размер круга) -> отъезд, лучи, глитч-разгон ──
    rose_c = Vector((0.0, -1.55, 17.0))
    D_rose = D_end * (4.45 / 0.047)
    make_cam("Cam_S5b", "S5b_rose", [
        (317, (0.0, rose_c.y + D_rose, 17.0), rose_c, 50.0, 0.6 + math.radians(15)),
        (335, (0.0, rose_c.y + D_rose + 2.0, 16.2), rose_c + Vector((0, 0, -0.6)), 42.0, 0.75),
        (350, (0.0, rose_c.y + D_rose + 3.5, 15.0), rose_c + Vector((0, 0, -1.5)), 30.0, 0.95),
    ], shake=0.15, fstop=8.0, hits=False)

    # ── S6: финальный пролёт по нефу между колоннами ──
    make_cam("Cam_S6", "S6_flythrough", [
        (351, (0.0, 1.0, 16.0), (0.0, 20.0, 6.0), 14.0, 0.0),
        (361, (-1.6, 7.5, 5.0), (2.0, 22.0, 2.0), 16.0, 0.35),
        (370, (-3.4, 14.0, 1.7), (0.0, 25.0, 1.4), 18.0, 0.2),
        (379, (-1.3, 21.0, 1.3), (0.8, 30.0, 1.4), 20.0, -0.18),
        (388, (0.9, 25.8, 1.5), (-0.6, 30.6, 1.55), 24.0, -0.1),
        (403, (1.5, 29.3, 1.6), (-0.2, 31.8, 1.55), 26.0, 0.05),
        (411, (0.45, 34.6, 1.9), (0.0, 37.0, 1.68), 26.0, 0.0),
        (416, (0.05, 36.65, 1.95), (0.0, 37.0, 1.68), 30.0, 0.0),
        (420, (0.0, 37.0001, rim_z + 0.22), (0.0, 37.0, CUP_POS.z), 35.0, 0.0),
    ], shake=0.5, punches=[(369, 0.22), (384, 0.15), (415, 0.3)], fstop=2.8, handheld_freq=1.5,
        focus=lambda f: (Vector((-0.6, 30.6, 1.55)) if f < 405 else Vector((0, 37.0, 1.7))))

    # ── S7a: воронка в стакане, камера ныряет в центр ──
    make_cam("Cam_S7a", "S7a_vortex", [
        (421, (0.0, 37.0001, rim_z + 0.22), (0.0, 37.0, CUP_POS.z), 35.0, 0.0),
        (432, (0.0, 37.0001, rim_z + 0.06), (0.0, 37.0, CUP_POS.z), 24.0, 2.5),
    ], shake=0.15, hits=False, fstop=4.0, focus=Vector((0, 37.0, rim_z - 0.03)),
        roll_spin=lambda f: 0.0)
    # ── S7b: match cut в чёрную дыру сверху -> падение в горизонт ──
    make_cam("Cam_S7b", "S7b_blackhole", [
        (433, (0.0, 0.0001, 70.0), (0, 0, 0), 24.0, 2.5),
        (442, (0.0, 0.0001, 26.0), (0, 0, 0), 20.0, 4.5),
        (450, (0.0, 0.0001, 5.9), (0, 0, 0), 16.0, 7.5),
    ], shake=0.2, hits=False, fstop=16, local_root=root)
    # ореол смотрит на активную камеру интро
    tr = BH["halo"].constraints.new('TRACK_TO')
    tr.target = CAMS["S1_blackhole"]
    tr.track_axis = 'TRACK_Z'
    tr.up_axis = 'UP_Y'


# ════════════════════════════════════════════════════════════════════
# LIGHTS, WORLD, RAIN, DUST
# ════════════════════════════════════════════════════════════════════
def add_light(name, kind, loc, energy, color, size=0.1, rot=None, spot=None, shadow=True, C=None):
    ld = bpy.data.lights.new(PREFIX + "_" + name, kind)
    ld.energy = energy
    ld.color = hexcol(color)[:3] if isinstance(color, str) else color
    if kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    elif kind == 'AREA':
        ld.size = size
    elif kind == 'SUN':
        ld.angle = size
    if spot and kind == 'SPOT':
        ld.spot_size = spot[0]
        ld.spot_blend = spot[1]
    try_set(ld, "use_shadow", shadow)
    ob = bpy.data.objects.new(PREFIX + "_" + name, ld)
    (C or coll("Lights")).objects.link(ob)
    ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    return ob


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def flicker(ob, base, amt=0.35, speed=9.0, seed=0, step=2):
    frames = list(range(F0 - 2, F1 + 3, step))
    vals = [base * (1 + amt * nz(f / FPS, seed, speed) + amt * 0.4 * nz(f / FPS, seed + 3, speed * 2.7)) for f in frames]
    bake(ob.data, "energy", -1, frames, vals)


LIGHTNING = [95, 99, 141, 300, 304, 436]


def build_lights(lamps):
    log("lights")
    C = coll("Lights")
    # луна/дыра: фиолетовый контровой
    sun = add_light("SunBH", 'SUN', (0, 0, 50), 1.6, '#9a7aff', 0.02)
    aim(sun, -BH_POS * 0.01)
    sun.rotation_euler = (BH_POS * -1).to_track_quat('Z', 'Y').to_euler()
    sun.rotation_euler = (-(Vector((0, 0, 0)) - BH_POS)).to_track_quat('Z', 'Y').to_euler()
    # молния
    lt = add_light("Lightning", 'SUN', (0, 0, 60), 0.0, '#c8d4ff', 0.05)
    lt.rotation_euler = (math.radians(35), math.radians(-25), 0)
    frames, vals = [F0], [0.0]
    for lf in LIGHTNING:
        for df, v in ((-1, 0.0), (0, 22.0), (1, 4.0), (2, 14.0), (4, 0.5), (7, 0.0)):
            frames.append(lf + df)
            vals.append(v)
    order = np.argsort(frames)
    frames = [frames[i] for i in order]
    vals = [vals[i] for i in order]
    bake(lt.data, "energy", -1, frames, vals, interp='LINEAR')
    # фонари двора
    for i, p in enumerate(lamps):
        l = add_light("Lantern_%d" % i, 'POINT', p, 60.0, '#ff8a30', 0.06)
        flicker(l, 60.0, 0.25, 7.0, i)
    # внутри: свечи у алтаря
    for i, (p, e) in enumerate((((-1.05, 37.0, 2.4), 45), ((1.05, 37.0, 2.4), 45), ((0.0, 35.6, 1.0), 40),
                                ((-2.5, 36.0, 0.6), 30), ((2.5, 36.0, 0.6), 30), ((0.0, 38.4, 2.2), 25))):
        l = add_light("Candle_%d" % i, 'POINT', p, e, '#ff7a28', 0.15)
        flicker(l, e, 0.3, 10.0, 20 + i)
    for i, y in enumerate(COL_Y[::2]):
        for sx in (-1, 1):
            l = add_light("ColCandle_%d_%d" % (i, sx), 'POINT', (sx * (NAVE_X - 0.9), y, 0.7), 12, '#ff7a28', 0.2)
            flicker(l, 12, 0.3, 10.0, 40 + i * 2 + sx)
    # лучи из окон клерестори (через объёмный туман)
    for i, y in enumerate([7.5, 17.5, 27.5]):
        for sx in (-1, 1):
            s = add_light("GodRay_%d_%d" % (i, sx), 'SPOT', (sx * 14.0, y + 3.0, 26.0), 9000, '#8a7aff', 0.05,
                          spot=(math.radians(14), 0.3))
            aim(s, (sx * -1.5, y - 1.0, 0.0))
    # роза: сзади светит внутрь
    rs = add_light("RoseBeam", 'SPOT', (0, -9.0, 19.0), 60000, '#c03a8a', 0.2, spot=(math.radians(28), 0.4))
    aim(rs, (0, 22.0, 2.0))
    # ключ на стакане + контровые
    k = add_light("CupKey", 'AREA', CUP_POS + Vector((-0.35, -0.3, 0.55)), 6.0, '#ffd8c0', 0.35)
    aim(k, CUP_POS + Vector((0, 0, 0.08)))
    k = add_light("CupRim", 'AREA', CUP_POS + Vector((0.25, 0.45, 0.3)), 14.0, '#a050ff', 0.25)
    aim(k, CUP_POS + Vector((0, 0, 0.08)))
    k = add_light("CupTop", 'AREA', CUP_POS + Vector((0.0, 0.1, 0.9)), 3.0, '#ffb0ff', 0.2)
    aim(k, CUP_POS)
    # персонажи: маджента сзади + циан заполняющий
    k = add_light("CharRim", 'AREA', (-1.6, 33.0, 2.4), 260, '#ff2a8a', 1.2)
    aim(k, (-0.4, 30.8, 1.5))
    k = add_light("CharFill", 'AREA', (2.5, 27.5, 2.0), 60, '#3ac8ff', 1.5)
    aim(k, (-0.2, 30.8, 1.5))
    k = add_light("YardRim", 'AREA', (4.5, -12.0, 3.5), 300, '#ff3a6a', 2.0)
    aim(k, (1.5, -19.0, 1.4))


def build_world():
    w = bpy.data.worlds.new(PREFIX + "_World")
    SC3D.world = w
    w.use_nodes = True
    b = NB(w.node_tree)
    b.nt.nodes.clear()
    out = b.n('ShaderNodeOutputWorld')
    tc = b.coord('Generated')
    view = b.n('ShaderNodeTexCoord').outputs['Generated']
    d = b.n('ShaderNodeNewGeometry')
    dirv = b.vmath('NORMALIZE', b.n('ShaderNodeTexCoord').outputs['Generated'])
    # звёзды
    v = b.voronoi(dirv, scale=380, feature='F1')
    star = b.math('POWER', b.math('SUBTRACT', 1.0, b.math('MULTIPLY', v.outputs['Distance'], 9.0), clamp=True), 8.0)
    tw = b.noise(dirv, scale=200, detail=1)
    star = b.math('MULTIPLY', star, b.math('POWER', tw.outputs['Fac'], 3.0))
    # туманность + облака
    t = b.time()
    neb = b.noise(dirv, scale=2.2, detail=10, rough=0.62, w=b.math('MULTIPLY', t, 0.03))
    nebc = b.ramp(neb.outputs['Fac'], [(0.45, '#000000'), (0.62, '#1a0630'), (0.75, '#3a0a3a'), (0.85, '#6a1050')])
    cl = b.noise(b.mapping(dirv, scale=(1, 1, 3)), scale=3.5, detail=12, rough=0.7, w=b.math('MULTIPLY', t, 0.05))
    clouds = b.ramp(cl.outputs['Fac'], [(0.4, '#000000'), (0.7, '#ffffff')])
    zz = b.sep(dirv)[2]
    horizon = b.ramp(zz, [(0.0, '#1a1428'), (0.15, '#08060e'), (0.5, '#020204')])
    col = b.mix(horizon.outputs[0], nebc.outputs[0], 1.0, 'ADD')
    col = b.mix(col, (1.0, 1.0, 1.0), b.math('MULTIPLY', star, 1.0), 'ADD')
    col = b.mix(col, '#0c0a14', b.math('MULTIPLY', b.sep(clouds.outputs[0])[0], 0.85))
    bg = b.n('ShaderNodeBackground')
    b.l(col, bg.inputs['Color'])
    flash = b.n('ShaderNodeValue')
    flash.name = "Flash"
    flash.outputs[0].default_value = 1.0
    b.l(b.math('MULTIPLY', flash.outputs[0], 1.4), bg.inputs['Strength'])
    b.l(bg.outputs[0], out.inputs['Surface'])
    frames, vals = [F0], [1.0]
    for lf in LIGHTNING:
        for df, v_ in ((-1, 1.0), (0, 9.0), (1, 2.0), (2, 6.0), (4, 1.2), (7, 1.0)):
            frames.append(lf + df)
            vals.append(v_)
    order = np.argsort(frames)
    socket_bake(w.node_tree, flash.outputs[0], [frames[i] for i in order], [vals[i] for i in order], 'LINEAR')


def build_rain():
    log("rain")
    C = coll("FX")
    mb = MB()
    mb.cyl((0, 0, -0.2), (0, 0, 0.2), 0.0045, 0.0025, segs=5, mat=0)
    drop = mb.obj("RainDrop", [MATS["Rain"]], C)
    drop.rotation_euler = (math.radians(9), 0, 0)
    drop.location = (0, 0, -500)
    drop.hide_render = True
    mb = MB()
    mb.grid((0, -30, 24), 60, 64, 1, 1, 0)
    em = mb.obj("RainEmitter", [MATS["Rain"]], C)
    ps_mod = em.modifiers.new("rain", 'PARTICLE_SYSTEM')
    ps = ps_mod.particle_system.settings
    ps.name = PREFIX + "_Rain"
    ps.count = 160000
    ps.frame_start = -60
    ps.frame_end = F1 + 10
    ps.lifetime = 45
    ps.emit_from = 'FACE'
    ps.use_emit_random = True
    ps.normal_factor = 0.0
    ps.object_align_factor = (0.0, 2.5, -17.0)
    ps.effector_weights.gravity = 0.4
    ps.render_type = 'OBJECT'
    ps.instance_object = drop
    ps.particle_size = 1.0
    ps.size_random = 0.6
    try_set(ps, "use_rotation_instance", True)
    ps.display_percentage = 4
    em.show_instancer_for_render = False
    em.show_instancer_for_viewport = False
    # пыль в лучах (неф)
    mb = MB()
    mb.cube((0, 30.0, 3.5), (9.0, 14.0, 7.0), 0)
    de = mb.obj("DustEmitter", [MATS["Dust"]], C)
    mb = MB()
    mb.ico((0, 0, 0), 0.004, 0, 1)
    dust = mb.obj("DustMote", [MATS["Dust"]], C)
    dust.location = (0, 0, -500)
    dust.hide_render = True
    pm = de.modifiers.new("dust", 'PARTICLE_SYSTEM')
    ps = pm.particle_system.settings
    ps.name = PREFIX + "_Dust"
    ps.count = 1400
    ps.frame_start = -1
    ps.frame_end = -1
    ps.lifetime = F1 + 100
    ps.emit_from = 'VOLUME'
    ps.normal_factor = 0.0
    ps.physics_type = 'NEWTON'
    ps.brownian_factor = 0.02
    ps.effector_weights.gravity = 0.0
    ps.render_type = 'OBJECT'
    ps.instance_object = dust
    ps.size_random = 0.8
    de.show_instancer_for_render = False
    de.show_instancer_for_viewport = False
    de.display_type = 'WIRE'


# ════════════════════════════════════════════════════════════════════
# ANIMATED FX (воронка в стакане, диск, стёкла)
# ════════════════════════════════════════════════════════════════════
def animate_fx():
    lean = MATS["Lean"].node_tree
    sw = lean.nodes["Swirl"].outputs[0]
    fr = [F0, 158, 224, 270, 300, 316, 351, 410, 421, 432, F1]
    vv = [1.0, 1.2, 1.5, 1.8, 3.5, 5.0, 1.5, 1.6, 3.0, 14.0, 14.0]
    socket_bake(lean, sw, fr, vv)
    liq = bpy.data.objects[PREFIX + "_LeanLiquid"]
    kb = liq.data.shape_keys.key_blocks["Vortex"]
    kb.slider_max = 1.0
    sk = liq.data.shape_keys
    bake(sk, 'key_blocks["Vortex"].value', -1, [F0, 280, 316, 351, 418, 432, F1], [0.0, 0.05, 0.45, 0.05, 0.1, 1.0, 1.0])
    acc = MATS["Accretion"].node_tree
    tw = acc.nodes["Twist"].outputs[0]
    socket_bake(acc, tw, [F0, 60, 88, 433, F1], [1.0, 1.5, 4.0, 2.0, 6.0])


# ════════════════════════════════════════════════════════════════════
# RENDER SETTINGS
# ════════════════════════════════════════════════════════════════════
def setup_render(sc, is_edit=False):
    r = sc.render
    sc.frame_start = F0
    sc.frame_end = F1
    r.fps = FPS
    r.fps_base = 1.0
    if QUALITY == "PREVIEW":
        r.resolution_x, r.resolution_y = 540, 960
    elif QUALITY == "DRAFT":
        r.resolution_x, r.resolution_y = 360, 640
    else:
        r.resolution_x, r.resolution_y = 1080, 1920
    r.resolution_percentage = 100
    r.engine = eevee_id()
    try_set(sc.view_settings, "view_transform", 'AgX')
    for look in ('AgX - Punchy', 'Punchy', 'AgX - Medium High Contrast', 'None'):
        if try_set(sc.view_settings, "look", look):
            break
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    if is_edit:
        return
    e = sc.eevee
    hq = QUALITY == "FINAL"
    try_set(e, "taa_render_samples", 48 if hq else 12)
    try_set(e, "taa_samples", 8)
    try_set(e, "use_raytracing", True)
    try_set(e, "ray_tracing_method", 'SCREEN')
    if hasattr(e, "ray_tracing_options"):
        try_set(e.ray_tracing_options, "resolution_scale", '2' if hq else '4')
        try_set(e.ray_tracing_options, "use_denoise", True)
    try_set(e, "use_shadows", True)
    try_set(e, "shadow_ray_count", 1)
    try_set(e, "shadow_step_count", 4 if hq else 2)
    try_set(e, "volumetric_start", 0.1)
    try_set(e, "volumetric_end", 90.0)
    try_set(e, "volumetric_tile_size", '8' if hq else '16')
    try_set(e, "volumetric_samples", 64 if hq else 24)
    try_set(e, "use_volumetric_shadows", True)
    try_set(e, "volumetric_shadow_samples", 8 if hq else 4)
    try_set(e, "use_gtao", True)
    try_set(e, "fast_gi_method", 'GLOBAL_ILLUMINATION')
    try_set(e, "use_fast_gi", True)
    try_set(e, "motion_blur_steps", 2 if hq else 1)
    try_set(e, "use_motion_blur", True)
    try_set(r, "use_motion_blur", True)
    try_set(r, "motion_blur_shutter", 0.6)
    try_set(e, "motion_blur_shutter", 0.6)
    try_set(e, "use_bloom", True)       # legacy eevee
    try_set(e, "bloom_intensity", 0.08)
    try_set(r, "film_transparent", False)
    try_set(r, "use_compositing", True)
    try_set(r, "use_sequencer", False)
    try_set(r, "filter_size", 1.6)
    # кадры с затвором шире на whip pan
    frames = [F0, 214, 218, 224, 230, 351, 352, F1]
    vals = [0.6, 0.6, 1.4, 1.4, 0.6, 1.2, 0.6, 0.6]
    try:
        bake(sc, "render.motion_blur_shutter", -1, frames, vals, interp='LINEAR')
    except Exception:
        pass


# ════════════════════════════════════════════════════════════════════
# COMPOSITOR: аберрация, блум, RGB-сплит, блочный глитч, вспышки, грейд
# ════════════════════════════════════════════════════════════════════
GLITCH_WINDOWS = [(84, 93, 1.0), (154, 160, 0.6), (220, 229, 0.8), (266, 273, 0.8), (313, 319, 1.0),
                  (338, 354, 1.0), (416, 423, 0.7), (429, 435, 1.0), (443, 450, 1.0)]
MICRO_GLITCH = [105, 140, 176, 192, 209, 241, 287, 369, 384, 399]


def glitch_curve(f):
    v = 0.0
    for a, b, amp in GLITCH_WINDOWS:
        if a <= f <= b:
            mid = (a + b) / 2
            v = max(v, amp * (1 - abs(f - mid) / ((b - a) / 2 + 1)) * (0.6 + 0.4 * abs(nz(f * 0.37, a, 3.0)) * 2))
    for m in MICRO_GLITCH:
        if m <= f <= m + 2:
            v = max(v, 0.35)
    if 338 <= f <= 350:
        v = max(v, 0.25 + 0.75 * (f - 338) / 12)
    return min(v, 1.0)


def cnode(nt, typ, **props):
    n = nt.nodes.new(typ)
    for k, v in props.items():
        set_in(n, k, v)
    return n


def find_in(node, name, typ=None):
    for s in node.inputs:
        if s.name == name and (typ is None or s.type == typ):
            return s
    return None


def set_in(node, name, value):
    s = find_in(node, name, 'RGBA' if isinstance(value, (tuple, list)) and len(value) == 4 else None)
    if s is not None and hasattr(s, "default_value"):
        try:
            s.default_value = value
            return s
        except Exception:
            pass
    try:
        setattr(node, name, value)
    except Exception:
        pass
    return None


def comp_key(nt, node, name, frames, values, prop=None):
    s = find_in(node, name)
    if s is not None and hasattr(s, "default_value") and not s.is_linked:
        socket_bake(nt, s, frames, values)
    elif prop and hasattr(node, prop):
        path = node.path_from_id(prop)
        setattr(node, prop, values[0])
        bake(nt, path, -1, frames, values)


def build_compositor(sc, assets):
    log("compositor")
    if hasattr(sc, "compositing_node_group"):
        nt = bpy.data.node_groups.new(PREFIX + "_Comp", 'CompositorNodeTree')
        sc.compositing_node_group = nt
        nt.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
        out = nt.nodes.new('NodeGroupOutput')
        out_sock = out.inputs[0]
        NEW = True
    else:
        sc.use_nodes = True
        nt = sc.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('CompositorNodeComposite')
        out_sock = out.inputs['Image']
        NEW = False
    L = nt.links.new
    rl = nt.nodes.new('CompositorNodeRLayers')
    rl.scene = sc
    frames = list(range(F0, F1 + 1))
    G = [glitch_curve(f) for f in frames]

    # 1) блочный глитч (Displace по анимированной карте)
    img = bpy.data.images.load(assets["dmap"][0], check_existing=False)
    img.name = PREFIX + "_dmap"
    img.source = 'SEQUENCE'
    try:
        img.colorspace_settings.name = 'Non-Color'
    except Exception:
        pass
    imn = nt.nodes.new('CompositorNodeImage')
    imn.image = img
    imn.frame_duration = len(assets["dmap"])
    imn.frame_start = F0
    imn.use_cyclic = True
    imn.use_auto_refresh = True
    disp = nt.nodes.new('CompositorNodeDisplace')
    L(rl.outputs['Image'], disp.inputs['Image'])
    amp = [g * g * 140.0 * (1.0 if QUALITY == "FINAL" else 0.5) for g in G]
    if find_in(disp, 'X Scale') is not None:
        L(imn.outputs['Image'], disp.inputs['Vector'])
        set_in(disp, 'Y Scale', 0.0)
        comp_key(nt, disp, 'X Scale', frames, amp)
    else:
        mul = nt.nodes.new('ShaderNodeVectorMath')
        mul.operation = 'SCALE'
        L(imn.outputs['Image'], mul.inputs[0])
        sc_in = [s for s in mul.inputs if s.name == 'Scale'][0]
        socket_bake(nt, sc_in, frames, amp)
        msk = nt.nodes.new('ShaderNodeVectorMath')
        msk.operation = 'MULTIPLY'
        L(mul.outputs[0], msk.inputs[0])
        msk.inputs[1].default_value = (1.0, 0.0, 0.0)
        L(msk.outputs[0], disp.inputs['Displacement'])
    cur = disp.outputs['Image']

    # 2) RGB-сплит (R вправо, B влево)
    sep = nt.nodes.new('CompositorNodeSeparateColor')
    L(cur, sep.inputs[0])
    tr_r = nt.nodes.new('CompositorNodeTranslate')
    tr_b = nt.nodes.new('CompositorNodeTranslate')
    # Translate принимает картинку: собираем каналы через Combine
    comb_r = nt.nodes.new('CompositorNodeCombineColor')
    comb_b = nt.nodes.new('CompositorNodeCombineColor')
    L(sep.outputs['Red'], comb_r.inputs['Red'])
    L(sep.outputs['Blue'], comb_b.inputs['Blue'])
    L(comb_r.outputs[0], tr_r.inputs['Image'])
    L(comb_b.outputs[0], tr_b.inputs['Image'])
    res_scale = 1.0 if QUALITY == "FINAL" else 0.5
    split = [(4.0 + 46.0 * g) * res_scale for g in G]
    comp_key(nt, tr_r, 'X', frames, split)
    comp_key(nt, tr_b, 'X', frames, [-v for v in split])
    comp_key(nt, tr_r, 'Y', frames, [v * 0.15 * nz(i * 0.5, 3, 1.0) for i, v in enumerate(split)])
    sep_r = nt.nodes.new('CompositorNodeSeparateColor')
    sep_b = nt.nodes.new('CompositorNodeSeparateColor')
    L(tr_r.outputs[0], sep_r.inputs[0])
    L(tr_b.outputs[0], sep_b.inputs[0])
    comb = nt.nodes.new('CompositorNodeCombineColor')
    L(sep_r.outputs['Red'], comb.inputs['Red'])
    L(sep.outputs['Green'], comb.inputs['Green'])
    L(sep_b.outputs['Blue'], comb.inputs['Blue'])
    L(sep.outputs['Alpha'], comb.inputs['Alpha'])
    cur = comb.outputs[0]

    # 3) линза: дисторсия + дисперсия (хроматическая аберрация)
    ld = nt.nodes.new('CompositorNodeLensdist')
    L(cur, ld.inputs['Image'])
    set_in(ld, 'Fit', True)
    try_set(ld, "use_fit", True)
    dist, dispv = [], []
    for f, g in zip(frames, G):
        dv = 0.0
        if f <= 88:     # интро: тянет к центру всё сильнее
            dv = -0.08 - 0.5 * ramp(f, 55, 88) ** 2
        if 89 <= f <= 96:
            dv = 0.35 * math.exp(-(f - 89) / 2.0)
        if 351 <= f <= 356:
            dv = 0.25 * math.exp(-(f - 351) / 1.5)
        if 433 <= f:
            dv = -0.1 - 0.5 * ramp(f, 436, 450)
        dv += 0.08 * beat_pulse(f, 2.5) if 89 <= f <= 420 else 0.0
        dist.append(max(-0.95, min(0.95, dv)))
        dispv.append(min(1.0, 0.025 + 0.25 * g + 0.06 * beat_pulse(f, 3.0) + (0.25 * ramp(f, 60, 88) if f <= 88 else 0.0)))
    comp_key(nt, ld, 'Distortion', frames, dist)
    comp_key(nt, ld, 'Dispersion', frames, dispv)
    cur = ld.outputs['Image']

    # 4) блум / ореолы
    gl = nt.nodes.new('CompositorNodeGlare')
    L(cur, gl.inputs['Image'])
    if find_in(gl, 'Type') is not None:
        for v in ('Bloom', 'BLOOM', 'Fog Glow', 'FOG_GLOW'):
            try:
                gl.inputs['Type'].default_value = v
                break
            except Exception:
                pass
        set_in(gl, 'Threshold', 0.9)
        set_in(gl, 'Strength', 0.6)
        set_in(gl, 'Size', 0.75)
        set_in(gl, 'Quality', 'Medium')
        set_in(gl, 'Quality', 'MEDIUM')
    else:
        for v in ('BLOOM', 'FOG_GLOW'):
            if try_set(gl, "glare_type", v):
                break
        try_set(gl, "quality", 'MEDIUM')
        try_set(gl, "threshold", 0.9)
        try_set(gl, "mix", -0.3)
        try_set(gl, "size", 8)
    cur = gl.outputs['Image']

    # 5) экспозиция (вспышки на дропах)
    ex = nt.nodes.new('CompositorNodeExposure')
    L(cur, ex.inputs['Image'])
    expo = []
    for f in frames:
        v = 0.0
        for ff, a_, dcy in ((89, 3.5, 2.0), (158, 1.2, 1.5), (225, 1.0, 1.5), (317, 1.6, 2.0), (351, 3.0, 2.0), (433, 2.5, 2.0)):
            if f >= ff:
                v += a_ * math.exp(-(f - ff) / dcy)
        if f >= 444:
            v -= 6.0 * ramp(f, 444, 450)
        if f <= 3:
            v -= 3.0 * (1 - (f - 1) / 3)
        v += 0.25 * beat_pulse(f, 2.0) if 89 <= f <= 420 else 0.0
        expo.append(v)
    comp_key(nt, ex, 'Exposure', frames, expo)
    cur = ex.outputs['Image']

    # 6) цветокор: холодные тени, пурпурные света
    cb = nt.nodes.new('CompositorNodeColorBalance')
    L(cur, cb.inputs['Image'])
    lift, gamma, gain = (0.96, 0.97, 1.06, 1.0), (0.98, 0.96, 1.04, 1.0), (1.06, 0.98, 1.08, 1.0)
    if find_in(cb, 'Lift', 'RGBA') is not None:
        set_in(cb, 'Lift', lift)
        set_in(cb, 'Gamma', gamma)
        set_in(cb, 'Gain', gain)
    else:
        cb.lift = lift[:3]
        cb.gamma = gamma[:3]
        cb.gain = gain[:3]
    L(cb.outputs['Image'], out_sock)
    for i, n in enumerate(nt.nodes):
        n.location = (i * 220, 0)
    return nt


# ════════════════════════════════════════════════════════════════════
# 2D-ОВЕРЛЕИ (numpy -> PNG): зерно, царапины, ТВ-шум, глитч, дождь, лики
# ════════════════════════════════════════════════════════════════════
import zlib
import struct


def write_png(path, arr):
    """arr: HxWx4 uint8 (сверху вниз)"""
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def _blur1d(a, k, axis):
    if k <= 1:
        return a
    ker = np.ones(k) / k
    return np.apply_along_axis(lambda m: np.convolve(m, ker, mode='same'), axis, a)


def gen_overlays(d):
    log("overlays ->", d)
    os.makedirs(d, exist_ok=True)
    R = np.random.default_rng(SEED)
    W, H = 540, 960
    A = {}

    def save(name, arr):
        p = os.path.join(d, name)
        write_png(p, np.clip(arr, 0, 255).astype(np.uint8))
        return p

    # зерно (нейтраль 0.5 для Overlay)
    A["grain"] = []
    for i in range(24):
        g = R.normal(0, 1, (H, W))
        g = (g + np.roll(g, 1, 0) * 0.5 + np.roll(g, 1, 1) * 0.5) / 1.6
        v = 128 + g * 26
        arr = np.stack([v, v, v, np.full_like(v, 255)], -1)
        A["grain"].append(save("grain_%04d.png" % (i + 1), arr))
    # царапины, пыль, волоски (на чёрном для Screen)
    A["scratch"] = []
    for i in range(24):
        arr = np.zeros((H, W, 4))
        arr[..., 3] = 255
        for k in range(R.integers(0, 3)):
            x = int(R.integers(0, W))
            wv = int(R.integers(1, 3))
            inten = R.uniform(60, 160)
            y0, y1 = sorted(R.integers(0, H, 2))
            if R.random() < 0.6:
                y0, y1 = 0, H
            arr[y0:y1, x:x + wv, :3] += inten
        for k in range(R.integers(5, 25)):
            x, y = int(R.integers(2, W - 4)), int(R.integers(2, H - 4))
            r = int(R.integers(1, 3))
            arr[y - r:y + r, x - r:x + r, :3] += R.uniform(80, 220)
        for k in range(R.integers(0, 2)):
            x, y = R.uniform(0, W), R.uniform(0, H)
            ang = R.uniform(0, 6.28)
            for s in range(int(R.integers(20, 70))):
                ang += R.normal(0, 0.15)
                x += math.cos(ang)
                y += math.sin(ang)
                if 0 <= int(x) < W and 0 <= int(y) < H:
                    arr[int(y), int(x), :3] += 120
        A["scratch"].append(save("scratch_%04d.png" % (i + 1), arr))
    # виньетка (Multiply)
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    v = np.clip(1.15 - 0.62 * r ** 2.2, 0.0, 1.0) * 255
    A["vignette"] = save("vignette.png", np.stack([v, v * 0.97, v, np.full_like(v, 255)], -1))
    # ТВ-шум: снег + строки + бегущая полоса + синхро-срыв
    A["static"] = []
    for i in range(16):
        n = R.random((H // 2, W // 2))
        n = np.repeat(np.repeat(n, 2, 0), 2, 1)
        n = n * 0.85 + 0.15 * R.random((H, 1))
        lines = 0.75 + 0.25 * (np.arange(H)[:, None] % 3 != 0)
        band_y = (i * 61) % H
        band = np.exp(-((np.arange(H)[:, None] - band_y) / 40.0) ** 2) * 0.6
        v = np.clip((n * lines + band), 0, 1)
        shift = (R.normal(0, 6, (H, 1))).astype(int)
        idx = (np.arange(W)[None, :] - shift) % W
        v = np.take_along_axis(v, idx, 1)
        col = np.stack([v * 1.0, v * 0.95, v * 1.05], -1) * 255
        chroma = R.random((H, W, 3)) * 30
        arr = np.concatenate([col + chroma, np.full((H, W, 1), 255)], -1)
        A["static"].append(save("static_%04d.png" % (i + 1), arr))
    # глитч-оверлей (RGBA): цветные полосы, блоки
    A["glitch"] = []
    for i in range(12):
        arr = np.zeros((H, W, 4))
        for k in range(R.integers(4, 12)):
            y = int(R.integers(0, H))
            hh = int(R.integers(2, 40))
            x0 = int(R.integers(0, W // 2))
            x1 = int(R.integers(W // 2, W))
            c = [(255, 0, 140), (0, 255, 220), (140, 0, 255), (255, 255, 255), (255, 30, 30)][int(R.integers(0, 5))]
            arr[y:y + hh, x0:x1, :3] = c
            arr[y:y + hh, x0:x1, 3] = R.uniform(90, 220)
        for k in range(R.integers(10, 40)):
            bx, by = int(R.integers(0, W - 40)), int(R.integers(0, H - 20))
            bw, bh = int(R.integers(8, 60)), int(R.integers(4, 18))
            arr[by:by + bh, bx:bx + bw, :3] = R.integers(0, 255, 3)
            arr[by:by + bh, bx:bx + bw, 3] = 200
        A["glitch"].append(save("glitch_%04d.png" % (i + 1), arr))
    # карта смещения для компоузинга (R = сдвиг вправо по блокам)
    A["dmap"] = []
    for i in range(12):
        m = np.zeros((H, W))
        y = 0
        while y < H:
            hh = int(R.integers(4, 70))
            if R.random() < 0.45:
                m[y:y + hh, :] = R.uniform(0.15, 1.0)
                if R.random() < 0.4:
                    x0 = int(R.integers(0, W))
                    m[y:y + hh, x0:] *= 0.3
            y += hh
        v = m * 255
        A["dmap"].append(save("dmap_%04d.png" % (i + 1), np.stack([v, np.zeros_like(v), np.zeros_like(v), np.full_like(v, 255)], -1)))
    # дождь поверх (Screen)
    A["rain"] = []
    for i in range(16):
        arr = np.zeros((H, W))
        for k in range(260):
            x = R.uniform(-60, W)
            y = R.uniform(-80, H)
            L = R.uniform(25, 90)
            inten = R.uniform(40, 150)
            for s in range(int(L)):
                xx_, yy_ = int(x + s * 0.18), int(y + s)
                if 0 <= xx_ < W and 0 <= yy_ < H:
                    arr[yy_, xx_] += inten * (s / L)
        arr = _blur1d(arr, 2, 1)
        A["rain"].append(save("rain_%04d.png" % (i + 1), np.stack([arr * 0.85, arr * 0.9, arr, np.full_like(arr, 255)], -1)))
    # лайт-лики
    A["leak"] = []
    for i, cols in enumerate((((255, 40, 90), (120, 20, 255)), ((255, 120, 40), (255, 20, 60)), ((90, 20, 255), (255, 60, 200)))):
        arr = np.zeros((H, W, 3))
        for k in range(3):
            cx, cy = R.uniform(-0.2, 1.2) * W, R.uniform(-0.2, 1.2) * H
            rr = R.uniform(0.3, 0.7) * W
            g = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (rr * rr)))
            c = np.array(cols[k % 2])
            arr += g[..., None] * c[None, None, :] * R.uniform(0.6, 1.0)
        A["leak"].append(save("leak_%04d.png" % (i + 1), np.concatenate([arr, np.full((H, W, 1), 255)], -1)))
    return A


# ════════════════════════════════════════════════════════════════════
# SFX SYNTH (numpy): ТВ-шум, дождь, гром, колокол, свисты, удары, глитч
# ════════════════════════════════════════════════════════════════════
SR = 48000


def write_wav(path, x):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    peak = np.abs(x).max()
    if peak > 0.98:
        x = x / peak * 0.98
    pcm = (x * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


def bandpass(x, lo, hi, soft=0.15):
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** (4 / soft * 0.15))
    if hi:
        m *= 1 / (1 + (f / hi) ** (4 / soft * 0.15))
    return np.fft.irfft(X * m, n)


def norm(x, g=1.0):
    p = np.abs(x).max()
    return x / p * g if p > 0 else x


def gen_sfx(d):
    log("sfx ->", d)
    os.makedirs(d, exist_ok=True)
    R = np.random.default_rng(SEED + 1)
    S = {}
    t = lambda sec: np.arange(int(sec * SR)) / SR

    # ТВ-шум
    tt = t(1.4)
    n = bandpass(R.normal(0, 1, len(tt)), 600, 9000)
    gate = np.repeat(R.uniform(0.5, 1.0, len(tt) // 480 + 1), 480)[:len(tt)]
    crack = (R.random(len(tt)) > 0.9985) * R.normal(0, 6, len(tt))
    hum = 0.08 * np.sin(2 * np.pi * 60 * tt) + 0.03 * np.sin(2 * np.pi * 15734 * tt)
    x = norm(n * gate + crack + hum, 0.8)
    x *= np.minimum(1, tt / 0.01) * np.minimum(1, (tt[-1] - tt) / 0.05)
    S["static"] = write_wav(os.path.join(d, "tv_static.wav"), np.stack([x, np.roll(x, 37)], 1))
    # дождь (16 c, стерео)
    tt = t(16.0)
    ch = []
    for c in range(2):
        w = R.normal(0, 1, len(tt))
        X = np.fft.rfft(w)
        f = np.fft.rfftfreq(len(w), 1 / SR)
        X /= np.sqrt(np.maximum(f, 20) / 20)
        pink = np.fft.irfft(X, len(w))
        pink = bandpass(pink, 250, 7000)
        drops = np.zeros(len(tt))
        idx = R.integers(0, len(tt) - 400, 5000)
        for i in idx:
            L = int(R.integers(60, 300))
            drops[i:i + L] += R.normal(0, 1, L) * np.exp(-np.arange(L) / (L / 4)) * R.uniform(0.2, 1.0)
        drops = bandpass(drops, 1500, 9000)
        ch.append(norm(pink, 0.5) + norm(drops, 0.35))
    S["rain"] = write_wav(os.path.join(d, "rain.wav"), np.stack(ch, 1) * 0.9)
    # гром
    tt = t(5.0)
    brown = np.cumsum(R.normal(0, 1, len(tt)))
    brown -= np.convolve(brown, np.ones(4800) / 4800, mode='same')
    rumble = bandpass(brown, 25, 180) * (np.exp(-tt / 1.6) * (1 + 0.6 * np.sin(2 * np.pi * 1.3 * tt) ** 2))
    crack = bandpass(R.normal(0, 1, len(tt)), 900, 8000) * np.exp(-tt / 0.08)
    x = norm(np.tanh(norm(rumble, 1.5)) + 0.7 * norm(crack), 0.95)
    S["thunder"] = write_wav(os.path.join(d, "thunder.wav"), np.stack([x, np.roll(x, 300)], 1))
    # колокол
    tt = t(6.0)
    f0 = 98.0
    x = np.zeros(len(tt))
    for ratio, amp, dec in ((0.5, 0.6, 3.5), (1.0, 1.0, 3.0), (1.183, 0.6, 2.2), (1.506, 0.5, 1.8), (2.0, 0.45, 1.5),
                            (2.514, 0.3, 1.0), (2.662, 0.25, 0.9), (3.011, 0.2, 0.7), (4.166, 0.15, 0.5), (5.43, 0.1, 0.35)):
        for det in (1.0, 1.0025):
            x += amp * np.sin(2 * np.pi * f0 * ratio * det * tt + R.uniform(0, 6)) * np.exp(-tt / dec)
    x += 0.4 * bandpass(R.normal(0, 1, len(tt)), 1000, 6000) * np.exp(-tt / 0.02)
    x = norm(x, 0.9)
    S["bell"] = write_wav(os.path.join(d, "bell.wav"), np.stack([x, np.roll(x, 480)], 1))
    # свист (whoosh) с панорамой
    tt = t(0.8)
    nn = R.normal(0, 1, len(tt))
    lo = bandpass(nn, 150, 900)
    hi = bandpass(nn, 1500, 9000)
    envw = np.sin(np.pi * np.clip(tt / 0.8, 0, 1)) ** 2
    sweep = np.clip(tt / 0.5, 0, 1)
    x = (lo * (1 - sweep) + hi * sweep * 0.7) * envw
    x = norm(x, 0.9)
    pan = np.clip(tt / 0.8, 0, 1)
    S["whoosh"] = write_wav(os.path.join(d, "whoosh.wav"), np.stack([x * (1 - pan * 0.8), x * (0.2 + pan * 0.8)], 1))
    # обратный свелл (засасывание в чёрную дыру)
    tt = t(2.6)
    nn = bandpass(R.normal(0, 1, len(tt)), 200, 6000) * np.exp(-tt / 0.7)
    tone = sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt / 1.2) for f in (55, 110.5, 164.8, 220.3))
    x = norm((nn + 0.5 * norm(tone)) [::-1], 0.95)
    x *= np.minimum(1, (tt[-1] - tt) / 0.004)
    S["swell"] = write_wav(os.path.join(d, "reverse_swell.wav"), np.stack([x, np.roll(x, 200)], 1))
    # удар (саб + транзиент)
    tt = t(2.2)
    fr = 95 * np.exp(-tt / 0.25) + 34
    sub = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tt / 0.7)
    tr = bandpass(R.normal(0, 1, len(tt)), 200, 10000) * np.exp(-tt / 0.03)
    x = norm(np.tanh(2.2 * sub) + 0.6 * norm(tr), 0.98)
    S["impact"] = write_wav(os.path.join(d, "impact.wav"), x)
    # глитч (статтер-нарезка)
    tt = t(0.45)
    x = np.zeros(len(tt))
    pos = 0
    while pos < len(tt):
        L = int(R.integers(int(0.012 * SR), int(0.045 * SR)))
        kind = R.integers(0, 4)
        seg = np.arange(min(L, len(tt) - pos)) / SR
        if kind == 0:
            s = np.sign(np.sin(2 * np.pi * R.uniform(200, 2400) * seg))
        elif kind == 1:
            s = np.round(R.normal(0, 1, len(seg)) * 3) / 3
        elif kind == 2:
            s = np.sin(2 * np.pi * R.uniform(3000, 9000) * seg)
        else:
            s = np.zeros(len(seg))
        reps = int(R.integers(1, 3))
        for _ in range(reps):
            if pos >= len(tt):
                break
            e = min(len(tt), pos + len(s))
            x[pos:e] = s[:e - pos] * 0.6
            pos = e
    S["glitch"] = write_wav(os.path.join(d, "glitch.wav"), np.stack([x, np.roll(x, 90)], 1))
    # гул чёрной дыры
    tt = t(3.2)
    x = np.zeros(len(tt))
    for f in (36.7, 41.2, 55.0, 73.4):
        x += np.sin(2 * np.pi * f * tt * (1 + 0.15 * (tt / 3.2) ** 3))
    nn = bandpass(R.normal(0, 1, len(tt)), 60, 500) * (0.3 + tt / 3.2)
    x = norm(np.tanh(norm(x) * 1.5) * (0.4 + 0.6 * tt / 3.2) + 0.6 * norm(nn), 0.9)
    x *= np.minimum(1, tt / 0.3)
    S["drone"] = write_wav(os.path.join(d, "bh_drone.wav"), np.stack([x, np.roll(x, 700)], 1))
    # райзер (разгон глитча)
    tt = t(1.3)
    fsw = 300 + 4000 * (tt / 1.3) ** 2
    x = 0.5 * np.sin(2 * np.pi * np.cumsum(fsw) / SR) + bandpass(R.normal(0, 1, len(tt)), 2000, 12000) * (tt / 1.3)
    x = norm(x * (tt / 1.3) ** 1.5, 0.8)
    S["riser"] = write_wav(os.path.join(d, "riser.wav"), np.stack([x, np.roll(x, 120)], 1))
    # треск плёнки/винила
    tt = t(16.0)
    cr = (R.random(len(tt)) > 0.9993) * R.normal(0, 1, len(tt))
    cr = bandpass(cr, 800, 9000) + 0.02 * bandpass(R.normal(0, 1, len(tt)), 2000, 8000)
    S["crackle"] = write_wav(os.path.join(d, "film_crackle.wav"), np.stack([norm(cr, 0.4), norm(np.roll(cr, 5000), 0.4)], 1))
    return S


# ════════════════════════════════════════════════════════════════════
# EDIT SCENE (VSE): картинка + оверлеи + музыка + SFX
# ════════════════════════════════════════════════════════════════════
def find_music():
    if MUSIC_PATH and os.path.isfile(MUSIC_PATH):
        return MUSIC_PATH
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else ""
    roots = [here, os.path.dirname(bpy.data.filepath) if bpy.data.filepath else "", OUT_DIR,
             os.path.expanduser("~/Downloads"), os.path.expanduser("~/Music"), os.path.expanduser("~/Desktop"),
             os.path.expanduser("~/Загрузки"), os.path.expanduser("~/Музыка"), os.path.expanduser("~")]
    for r in roots:
        if not r or not os.path.isdir(r):
            continue
        for pat in ("*right*here*.mp3", "*RIGHT*HERE*.mp3", "*Right*Here*.mp3", "*LIL*PEEP*.mp3", "*lil*peep*.mp3"):
            hits = glob.glob(os.path.join(r, pat))
            if hits:
                return hits[0]
    return None


def strips_of(sed):
    return sed.strips if hasattr(sed, "strips") else sed.sequences


def add_seq(C, name, files, channel, start, length, blend, alpha, loop=True):
    """картинка-последовательность (с повтором) -> список стрипов"""
    out = []
    f = start
    k = 0
    end = start + length
    while f < end:
        st = C.new_image(name="%s_%02d" % (name, k), filepath=files[0], channel=channel, frame_start=f, fit_method='FILL')
        for p in files[1:]:
            st.elements.append(os.path.basename(p))
        dur = min(len(files), end - f)
        st.frame_final_duration = dur
        st.blend_type = blend
        st.blend_alpha = alpha
        out.append(st)
        f += dur
        k += 1
        if not loop:
            break
    return out


def key_strip_alpha(sc, strips, fn):
    for st in strips:
        a, b = int(st.frame_final_start), int(st.frame_final_end)
        frames = list(range(a, b + 1))
        vals = [float(fn(f)) for f in frames]
        st.blend_alpha = vals[0]
        bake(sc, st.path_from_id("blend_alpha"), -1, frames, vals, interp='LINEAR')


def build_edit(sc3d, A, S):
    log("edit scene (VSE)")
    ed = bpy.data.scenes.new(PREFIX + "_EDIT")
    setup_render(ed, is_edit=True)
    sed = ed.sequence_editor_create()
    C = strips_of(sed)
    main = C.new_scene(name="GOTH_3D", scene=sc3d, channel=1, frame_start=F0)
    main.frame_final_duration = F1 - F0 + 1
    # "gate weave" - лёгкое дрожание кадра плёнки
    try:
        tf = main.transform
        frames = list(range(F0, F1 + 1))
        bake(ed, tf.path_from_id("offset_x"), -1, frames, [0.8 * nz(f * 0.9, 1, 1.0) for f in frames])
        bake(ed, tf.path_from_id("offset_y"), -1, frames, [0.8 * nz(f * 0.9, 2, 1.0) for f in frames])
        tf.scale_x = tf.scale_y = 1.01
    except Exception as ex:
        log("gate weave skipped:", ex)
    exterior = lambda f: (1.0 if 89 <= f <= 157 else 0.0)
    # дождь поверх во дворе
    rs = add_seq(C, "RainFX", A["rain"], 2, 89, 69, 'SCREEN', 0.5)
    # лайт-лики на переходах
    for i, (f0, f1) in enumerate(((84, 96), (220, 232), (313, 323), (346, 358), (428, 440))):
        st = C.new_image(name="Leak_%d" % i, filepath=A["leak"][i % len(A["leak"])], channel=3, frame_start=f0, fit_method='FILL')
        st.frame_final_duration = f1 - f0
        st.blend_type = 'SCREEN'
        key_strip_alpha(ed, [st], lambda f, a=f0, b=f1: math.sin(math.pi * (f - a) / (b - a)) ** 2 * 0.75)
    # глитч-полосы
    gl = add_seq(C, "GlitchFX", A["glitch"], 4, F0, F1, 'SCREEN', 0.0)
    key_strip_alpha(ed, gl, lambda f: 0.9 * glitch_curve(f) ** 1.5 if glitch_curve(f) > 0.3 else 0.0)
    # ТВ-шум
    stt = add_seq(C, "TVStatic", A["static"], 5, F0, F1, 'ALPHA_OVER', 0.0)

    def static_a(f):
        v = 0.0
        if f <= 14:
            v = 1.0 - smooth((f - 1) / 13.0) * 0.92 if f > 3 else 1.0
        for a, b, amp in ((84, 90, 0.85), (266, 271, 0.55), (314, 318, 0.4), (345, 352, 0.7), (418, 423, 0.6),
                          (430, 434, 0.75)):
            if a <= f <= b:
                v = max(v, amp * (0.6 + 0.4 * abs(nz(f * 0.7, a, 3.0)) * 2))
        if f >= 444:
            v = max(v, smooth((f - 444) / 4.0))
        return min(1.0, v)
    key_strip_alpha(ed, stt, static_a)
    # плёнка: царапины, зерно, виньетка
    add_seq(C, "Scratches", A["scratch"], 6, F0, F1, 'SCREEN', 0.55)
    add_seq(C, "Grain", A["grain"], 7, F0, F1, 'OVERLAY', 0.45)
    vg = C.new_image(name="Vignette", filepath=A["vignette"], channel=8, frame_start=F0, fit_method='STRETCH')
    vg.frame_final_duration = F1 - F0 + 1
    vg.blend_type = 'MULTIPLY'
    vg.blend_alpha = 0.85

    # ── звук ──
    music = find_music()
    try:
        if music:
            ms = C.new_sound(name="Music", filepath=music, channel=10, frame_start=F0 - int(round(MUSIC_START * FPS)))
            ms.frame_offset_start = int(round(MUSIC_START * FPS))
            ms.frame_final_end = F1 + 1
            bake(ed, ms.path_from_id("volume"), -1, [F0, F0 + 4, F1 - 12, F1], [0.0, 1.0, 1.0, 0.0], 'LINEAR')
            log("music:", music)
        else:
            log("!!! mp3 не найден - положи его рядом со скриптом или укажи MUSIC_PATH")

        def snd(key, frame, vol, ch, name=None, dur=None):
            s = C.new_sound(name=name or "%s_%d" % (key, frame), filepath=S[key], channel=ch, frame_start=int(frame))
            s.volume = vol
            if dur:
                s.frame_final_duration = int(dur)
            return s
        snd("drone", 1, 0.55, 11)
        snd("swell", DROP - int(2.6 * FPS), 0.7, 12)
        snd("bell", 3, 0.45, 13)
        snd("bell", BREAK, 0.55, 13, name="bell_break")
        for f, v in ((DROP, 0.95), (DROP2, 0.8), (433, 0.75)):
            snd("impact", f, v, 14)
        for i, (f, v) in enumerate(((1, 0.5), (84, 0.45), (266, 0.3), (314, 0.25), (345, 0.4), (418, 0.35), (430, 0.4), (444, 0.6))):
            snd("static", f, v, 15 + (i % 2))
        for i, f in enumerate((95, 147, 214, 263, 360, 371, 408, 419, 438)):
            snd("whoosh", f, 0.55, 17 + (i % 2))
        for f, v in ((95, 0.6), (300, 0.35), (436, 0.5)):
            snd("thunder", f, v, 19)
        for i, (a, b, amp) in enumerate(GLITCH_WINDOWS):
            snd("glitch", a, 0.3 * amp, 20 + (i % 2))
        for m in MICRO_GLITCH:
            snd("glitch", m, 0.12, 22, dur=4)
        snd("riser", 336, 0.4, 23)
        rn = snd("rain", 1, 0.2, 24, dur=F1)
        bake(ed, rn.path_from_id("volume"), -1, [1, 84, 89, 157, 160, 268, 350, 351, 420, 433, F1],
             [0.12, 0.12, 0.85, 0.85, 0.22, 0.15, 0.15, 0.25, 0.25, 0.08, 0.0], 'LINEAR')
        snd("crackle", 1, 0.35, 25, dur=F1)
    except Exception as ex:
        log("звук пропущен (нет Audaspace?):", ex)

    # вывод
    r = ed.render
    os.makedirs(os.path.join(OUT_DIR, "render"), exist_ok=True)
    r.filepath = os.path.join(OUT_DIR, "render", "gothic_lean.mp4")
    ims = r.image_settings
    try_set(ims, "media_type", 'VIDEO')
    try_set(ims, "file_format", 'FFMPEG')
    ff = r.ffmpeg
    try_set(ff, "format", 'MPEG4')
    try_set(ff, "codec", 'H264')
    try_set(ff, "constant_rate_factor", 'HIGH')
    try_set(ff, "ffmpeg_preset", 'GOOD')
    try_set(ff, "audio_codec", 'AAC')
    try_set(ff, "audio_bitrate", 320)
    try_set(ff, "audio_mixrate", 48000)
    try_set(ff, "audio_channels", 'STEREO')
    try_set(r, "use_sequencer", True)
    try_set(r, "use_compositing", False)
    return ed


# ════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════
SC3D = None


def main():
    global SC3D
    log("Blender", bpy.app.version_string, "| quality", QUALITY, "| out", OUT_DIR)
    cleanup()
    SC3D = make_scene(PREFIX + "_3D")
    os.makedirs(OUT_DIR, exist_ok=True)
    assets = gen_overlays(os.path.join(OUT_DIR, "overlays"))
    sfx = gen_sfx(os.path.join(OUT_DIR, "sfx"))
    build_materials()
    build_cathedral()
    lamps = build_courtyard()
    build_black_hole()
    build_characters()
    setup_character_anims()
    build_cameras()
    build_lights(lamps)
    build_world()
    build_rain()
    animate_fx()
    setup_render(SC3D)
    SC3D.camera = CAMS["S1_blackhole"]
    build_compositor(SC3D, assets)
    for c in COLLS.values():
        if c.name.endswith("Cutters"):
            c.hide_render = True
    ed = build_edit(SC3D, assets, sfx)
    SC3D.frame_set(F0)
    if bpy.context.window:
        bpy.context.window.scene = ed
        try:
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "gothic_lean.blend"), copy=True)
        except Exception as ex:
            log("save skipped:", ex)
    log("ГОТОВО. Сцена GOTH_EDIT -> Render > Render Animation. Видео:", ed.render.filepath)
    return ed


if __name__ == "__main__":
    main()
