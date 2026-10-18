"""THE LOOP — the "cars up the wall" trend, built as a real 3D scene (no AI plate).

A concrete ramp leaves a Cairo ring-road, curves straight up into a vertical wall and curls over
at the top toward Munadim's showcase restaurant: a glass box on a pylon with burgundy neon trim and
the brass mark on a solid ink sign. A queue of cars creeps up the FAR lane; the NEAR lane is empty
with a brass edge strip — that is the lane the WhatsApp order climbs (composited in reel/, Remotion).
Fog + ground spotlights do the drama. Everything is procedural; the only texture is the mark.

Run:  Blender -b --python build_loop.py -- [quick]      -> scene_loop.blend + ../../reel/src/lib/loopGeo.ts
Then: Blender -b scene_loop.blend -o //render_loop/#### -a
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

ROOT = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = 'quick' in ARGS
FPS, SECONDS = 30, 13
# story beats (frames): the last car in the queue orders, the Munadim car runs the empty lane up and back
UP0, UP1, DOWN0, DOWN1 = 55, 180, 212, 300
HERO_T0, HERO_TOP, ORDER_T = 0.37, 0.975, 0.455
N = FPS * SECONDS
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 0, N - 1
sc.render.fps = FPS
sc.render.resolution_x, sc.render.resolution_y = 1080, 1920
sc.render.resolution_percentage = 50 if QUICK else 100

INK = (0.0075, 0.0060, 0.0055, 1)      # #141110 linear-ish
BRASS = (0.49, 0.23, 0.032, 1)          # #B98432
BURG = (0.27, 0.012, 0.027, 1)          # #8C1D2F
SEMNA = (0.91, 0.86, 0.79, 1)

# ------------------------------------------------------------------ helpers
def mat(name, color=(0.5, 0.5, 0.5, 1), rough=0.6, metal=0.0, emit=None, strength=0.0, alpha=None, transmission=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
        b.inputs['IOR'].default_value = 1.45
        if hasattr(m, 'use_raytrace_refraction'): m.use_raytrace_refraction = True
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
    return m

def add(name, me):
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); return o

def box(name, size, loc=(0, 0, 0), m=None, rot=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = add(name, me); o.location = loc
    if rot: o.rotation_euler = rot
    if m: me.materials.append(m)
    return o

def cyl(name, r, h, loc, m, axis='Z'):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r, radius2=r, depth=h)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = add(name, me); o.location = loc
    if axis == 'X': o.rotation_euler = (0, math.pi / 2, 0)
    if axis == 'Y': o.rotation_euler = (math.pi / 2, 0, 0)
    me.materials.append(m); return o

def light(name, kind, loc, energy, color=(1, 1, 1), **kw):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    for k, v in kw.items():
        if hasattr(ld, k): setattr(ld, k, v)
    o = bpy.data.objects.new(name, ld); sc.collection.objects.link(o); o.location = loc; return o
def aim(o, target):
    d = Vector(target) - o.location; o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# ------------------------------------------------------------------ the ramp path (metres, Z up)
# A: road  (-46,0,0)->(0,0,0)   B: quarter pipe r=14 up to (14,0,14)   C: wall up to (14,0,24)
# D: curl r=8 about (6,0,24) through 52 deg -> ends leaning over toward the restaurant
R1, R2, CURL = 14.0, 8.0, math.radians(52)
LA, LB, LC, LD = 46.0, math.pi / 2 * R1, 10.0, CURL * R2
LTOT = LA + LB + LC + LD
W, THICK = 9.0, 0.7                      # ramp width (near lane empty, far lane queue) and slab thickness
B = Vector((0, 1, 0))                    # binormal: across the ramp (camera looks along +Y-ish)

def ramp(t):
    """point + tangent at arc-length fraction t"""
    s = t * LTOT
    if s <= LA:
        return Vector((-46 + s, 0, 0)), Vector((1, 0, 0))
    s -= LA
    if s <= LB:
        a = s / R1
        return Vector((R1 * math.sin(a), 0, R1 - R1 * math.cos(a))), Vector((math.cos(a), 0, math.sin(a)))
    s -= LB
    if s <= LC:
        return Vector((R1, 0, R1 + s)), Vector((0, 0, 1))
    s -= LC
    a = s / R2
    return Vector((6 + R2 * math.cos(a), 0, 24 + R2 * math.sin(a))), Vector((-math.sin(a), 0, math.cos(a)))

def frame_at(t):
    p, T = ramp(t); T.normalize()
    Nn = T.cross(B).normalized()         # surface normal ("up" for a car)
    return p, T, Nn

# ------------------------------------------------------------------ materials
m_asphalt = mat('Asphalt', (0.018, 0.017, 0.016, 1), 0.95)
m_concrete = mat('Concrete', (0.30, 0.285, 0.265, 1), 0.88)
cn = m_concrete.node_tree.nodes; cl = m_concrete.node_tree.links
noise = cn.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1.6; noise.inputs['Detail'].default_value = 6
ramp_n = cn.new('ShaderNodeValToRGB'); ramp_n.color_ramp.elements[0].color = (0.22, 0.21, 0.195, 1); ramp_n.color_ramp.elements[1].color = (0.36, 0.345, 0.32, 1)
cl.new(noise.outputs['Fac'], ramp_n.inputs['Fac']); cl.new(ramp_n.outputs['Color'], cn['Principled BSDF'].inputs['Base Color'])
bump = cn.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25
cl.new(noise.outputs['Fac'], bump.inputs['Height']); cl.new(bump.outputs['Normal'], cn['Principled BSDF'].inputs['Normal'])
m_steel = mat('Steel', (0.10, 0.10, 0.11, 1), 0.42, metal=0.85)
m_ink = mat('InkPanel', INK, 0.5)
m_brass_strip = mat('BrassStrip', BRASS, 0.3, emit=(1.0, 0.62, 0.18, 1), strength=7)
m_burg_neon = mat('BurgundyNeon', BURG, 0.3, emit=(0.55, 0.014, 0.04, 1), strength=2.6)
m_dash = mat('LaneDash', (0.8, 0.8, 0.76, 1), 0.7, emit=(0.9, 0.88, 0.8, 1), strength=0.5)
m_glass = mat('Glass', (0.9, 0.92, 0.94, 1), 0.04, transmission=1.0)
m_interior = mat('InteriorGlow', (1, 0.8, 0.55, 1), 0.8, emit=(1.0, 0.68, 0.36, 1), strength=2.4)
m_wood = mat('Counter', (0.26, 0.15, 0.08, 1), 0.5)
m_head = mat('Headlight', (1, 1, 1, 1), 0.2, emit=(1.0, 0.92, 0.78, 1), strength=40)
m_tail = mat('Taillight', (0.6, 0.02, 0.02, 1), 0.3, emit=(1.0, 0.05, 0.03, 1), strength=14)
m_rubber = mat('Rubber', (0.02, 0.02, 0.02, 1), 0.9)
m_cityglow = mat('CityGlow', (1, 0.6, 0.25, 1), 0.5, emit=(1.0, 0.55, 0.2, 1), strength=6)
paints = [mat('PaintWhite', (0.85, 0.85, 0.83, 1), 0.25, 0.1), mat('PaintSilver', (0.55, 0.56, 0.58, 1), 0.2, 0.7),
          mat('PaintDark', (0.03, 0.03, 0.035, 1), 0.2, 0.5), mat('PaintSand', (0.6, 0.5, 0.35, 1), 0.3, 0.1)]
# the mark on its ink panel — the one way the logo may sit in a scene
m_sign = bpy.data.materials.new('Sign'); m_sign.use_nodes = True
sn = m_sign.node_tree.nodes; sl = m_sign.node_tree.links; sb = sn['Principled BSDF']
tex = sn.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(os.path.join(ROOT, 'assets', 'tex', 'mark.png')); tex.extension = 'CLIP'
sl.new(tex.outputs['Color'], sb.inputs['Base Color']); sl.new(tex.outputs['Color'], sb.inputs['Emission Color'])
sb.inputs['Emission Strength'].default_value = 3.2; sb.inputs['Roughness'].default_value = 0.4

# ------------------------------------------------------------------ ground + road
ground = box('Ground', (400, 400, 0.2), (0, 60, -0.1), m_asphalt)
road = box('Road', (120, W, 0.05), (-20, 0, 0.0), m_asphalt)
# dim kerbs either side of the road
box('KerbN', (120, 0.5, 0.25), (-20, -W / 2 - 0.25, 0.1), m_concrete)
box('KerbF', (120, 0.5, 0.25), (-20, W / 2 + 0.25, 0.1), m_concrete)

# ------------------------------------------------------------------ the ramp slab, swept along the path
SAMPLES = 260
T0 = LA * 0.55 / LTOT                   # the slab starts a bit before the curve; the road carries the rest
bm = bmesh.new()
rows = []
for i in range(SAMPLES + 1):
    t = T0 + (1 - T0) * i / SAMPLES
    p, T, Nn = frame_at(t)
    tn = p - B * (W / 2); tf = p + B * (W / 2)
    rows.append([bm.verts.new(tn), bm.verts.new(tf), bm.verts.new(tf - Nn * THICK), bm.verts.new(tn - Nn * THICK)])
for a, b in zip(rows, rows[1:]):
    for k in range(4):
        bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
bm.faces.new(rows[0]); bm.faces.new(list(reversed(rows[-1])))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('Ramp'); bm.to_mesh(me); bm.free()
rampo = add('Ramp', me); me.materials.append(m_concrete)
for pg in me.polygons: pg.use_smooth = True
# edge strips: brass on the NEAR lip (the empty lane), burgundy on the FAR lip
def strip(name, side, m, h=0.12, w=0.22):
    bm = bmesh.new(); rows = []
    for i in range(SAMPLES + 1):
        t = T0 + (1 - T0) * i / SAMPLES
        p, T, Nn = frame_at(t)
        e = p + B * side * (W / 2 - w / 2)
        rows.append([bm.verts.new(e - B * side * w / 2 + Nn * h), bm.verts.new(e + B * side * w / 2 + Nn * h),
                     bm.verts.new(e + B * side * w / 2), bm.verts.new(e - B * side * w / 2)])
    for a, b in zip(rows, rows[1:]):
        for k in range(4): bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = add(name, me); me.materials.append(m); return o
strip('BrassLip', -1, m_brass_strip)
strip('BurgundyLip', +1, m_burg_neon, h=0.10, w=0.16)
# lane divider dashes down the middle (y=0) along the whole way, and on the road
for s in range(-44, int(LTOT) - 1, 4):
    t = (s + 46) / LTOT if s < 0 else (46 + s) / LTOT
    t = max(0.0, min(0.995, (s + 46) / LTOT))
    p, T, Nn = frame_at(t)
    bm = bmesh.new(); L = 1.6; w = 0.14
    q = [p - T * L / 2 - B * w / 2, p - T * L / 2 + B * w / 2, p + T * L / 2 + B * w / 2, p + T * L / 2 - B * w / 2]
    vs = [bm.verts.new(v + Nn * 0.012) for v in q]; bm.faces.new(vs)
    me = bpy.data.meshes.new('Dash'); bm.to_mesh(me); bm.free()
    o = add('Dash', me); me.materials.append(m_dash)

# ------------------------------------------------------------------ steel: lattice tower behind the wall, pylon under the restaurant, cantilever
def truss(name, x0, x1, y0, y1, z0, z1, step=3.0):
    for (x, y) in [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]:
        cyl(f'{name}Post', 0.22, z1 - z0, (x, y, (z0 + z1) / 2), m_steel)
    z = z0
    while z < z1 - 0.1:
        for (ax, ay, bx, by) in [(x0, y0, x1, y0), (x0, y1, x1, y1), (x0, y0, x0, y1), (x1, y0, x1, y1)]:
            # horizontal ring member
            mid = ((ax + bx) / 2, (ay + by) / 2, z); ln = math.hypot(bx - ax, by - ay)
            o = cyl(f'{name}Ring', 0.09, ln, mid, m_steel, 'X' if ay == by else 'Y')
            # diagonal
            d = Vector((bx - ax, by - ay, min(step, z1 - z))); o2 = cyl(f'{name}Diag', 0.07, d.length, (mid[0], mid[1], z + d.z / 2), m_steel)
            o2.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        z += step
truss('Tower', 15.2, 18.6, -1.7, 1.7, 0, 25.5)
truss('Pylon', 0.6, 3.4, -1.4, 1.4, 0, 30.6)
# cantilever beams from the tower top to under the curl
for y in (-1.5, 1.5):
    d = Vector((16.9 - 9.5, 0, 25.5 - 29.6)); o = cyl('Canti', 0.16, d.length, (13.2, y, 27.55), m_steel); o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

# ------------------------------------------------------------------ the restaurant: glass box on the pylon, burgundy neon, the sign
RX, RY, RZ = 2.0, 0.0, 33.6            # centre
RW, RD, RH = 13.0, 8.4, 5.2
box('Floor', (RW, RD, 0.5), (RX, RY, RZ - RH / 2), m_concrete)
box('Roof', (RW + 0.8, RD + 0.8, 0.45), (RX, RY, RZ + RH / 2 + 0.2), m_ink)
box('Back', (RW, 0.3, RH), (RX, RY + RD / 2, RZ), m_ink)
box('SideL', (0.3, RD, RH), (RX - RW / 2, RY, RZ), m_ink)
box('SideR', (0.3, RD, RH), (RX + RW / 2, RY, RZ), m_ink)
glass = box('Glass', (RW - 0.6, 0.06, RH - 0.5), (RX + 1.2, RY - RD / 2, RZ), m_glass)
box('WarmWall', (RW - 0.8, 0.1, RH - 1.2), (RX, RY + RD / 2 - 0.3, RZ), m_interior)     # the glow inside
box('Counter', (6.5, 1.1, 1.05), (RX + 1.5, RY - 1.2, RZ - RH / 2 + 0.8), m_wood)
box('Shelf', (5.0, 0.4, 0.15), (RX + 1.5, RY + RD / 2 - 0.7, RZ + 0.6), m_wood)
for i in range(3):   # pendant lamps
    cyl('Pendant', 0.18, 0.3, (RX - 1.5 + i * 2.6, RY - 1.2, RZ + RH / 2 - 0.9), m_wood)
# burgundy neon along the roof edge and the floor edge, front + sides
for z in (RZ + RH / 2 + 0.05, RZ - RH / 2 - 0.2):
    box('NeonF', (RW + 0.9, 0.12, 0.12), (RX, RY - RD / 2 - 0.45, z), m_burg_neon)
    box('NeonL', (0.12, RD + 0.9, 0.12), (RX - RW / 2 - 0.45, RY, z), m_burg_neon)
    box('NeonR', (0.12, RD + 0.9, 0.12), (RX + RW / 2 + 0.45, RY, z), m_burg_neon)
# the sign: a solid ink panel on the pylon under the restaurant, mark emissive on it
SIGN = (-0.2, RY - RD / 2 - 0.6, RZ - RH / 2 - 3.2, 4.4)    # x, y, z, size
box('SignPanel', (SIGN[3] + 0.5, 0.35, SIGN[3] + 0.5), (SIGN[0], SIGN[1] + 0.2, SIGN[2]), m_ink)
bm = bmesh.new(); s = SIGN[3] / 2
vs = [bm.verts.new(Vector((SIGN[0] + dx, SIGN[1], SIGN[2] + dz))) for dx, dz in ((-s, -s), (s, -s), (s, s), (-s, s))]
f = bm.faces.new(vs); uv = bm.loops.layers.uv.new()
for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): lp[uv].uv = (u, v)
me = bpy.data.meshes.new('SignFace'); bm.to_mesh(me); bm.free(); signo = add('SignFace', me); me.materials.append(m_sign)
box('SignFrame', (SIGN[3] + 0.5, 0.1, 0.1), (SIGN[0], SIGN[1] - 0.05, SIGN[2] + s + 0.3), m_brass_strip)
box('SignFrame', (SIGN[3] + 0.5, 0.1, 0.1), (SIGN[0], SIGN[1] - 0.05, SIGN[2] - s - 0.3), m_brass_strip)

# ------------------------------------------------------------------ cars on the FAR lane, creeping
def car(name, paint, bus=False):
    root = bpy.data.objects.new(name, None); sc.collection.objects.link(root)
    L, Wc, H = (5.6, 1.9, 1.0) if bus else (4.4, 1.8, 0.62)
    body = box(name + 'Body', (L, Wc, H), (0, 0, 0.42 + H / 2), paint); body.parent = root
    bv = body.modifiers.new('b', 'BEVEL'); bv.width = 0.12; bv.segments = 3
    if bus:
        cab = box(name + 'Cab', (L - 0.3, Wc - 0.1, 1.2), (0, 0, 0.42 + H + 0.6), paint); cab.parent = root
        glz = box(name + 'Win', (L - 0.6, Wc + 0.02, 0.6), (0, 0, 0.42 + H + 0.75), m_glass); glz.parent = root
    else:
        cab = box(name + 'Cab', (2.3, Wc - 0.25, 0.62), (-0.2, 0, 0.42 + H + 0.31), paint); cab.parent = root
        bv = cab.modifiers.new('b', 'BEVEL'); bv.width = 0.2; bv.segments = 4
        glz = box(name + 'Win', (2.1, Wc - 0.2, 0.4), (-0.2, 0, 0.42 + H + 0.4), m_glass); glz.parent = root
    for sx in (-1, 1):
        for sy in (-1, 1):
            w = cyl(name + 'Wheel', 0.36, 0.26, (sx * L * 0.33, sy * (Wc / 2 - 0.05), 0.36), m_rubber, 'Y'); w.parent = root
        h = box(name + 'Head', (0.08, 0.34, 0.16), (L / 2 + 0.01, sx * 0.62, 0.42 + H * 0.55), m_head); h.parent = root
        tl = box(name + 'Tail', (0.06, 0.40, 0.14), (-L / 2 - 0.01, sx * 0.62, 0.42 + H * 0.55), m_tail); tl.parent = root
    return root

LANE = W / 4                              # far lane centre (+y); the near lane (-y) stays empty
cars = []
t_slots = [ORDER_T] + [round(0.50 + i * 0.0355, 4) for i in range(14)]
for i, t0 in enumerate(t_slots):
    bus = i in (4, 9)
    c = car(f'Car{i}', paints[i % 4] if not bus else paints[0], bus)
    cars.append((c, t0, random.uniform(0, 6.28)))
def place(c, t):
    p, T, Nn = frame_at(t)
    pos = p + B * LANE + Nn * 0.02
    Y = Nn.cross(T).normalized()
    M = Matrix(((T.x, Y.x, Nn.x, pos.x), (T.y, Y.y, Nn.y, pos.y), (T.z, Y.z, Nn.z, pos.z), (0, 0, 0, 1)))
    c.matrix_world = M
for f in range(0, N + 1, 3):
    sc.frame_set(f)
    for c, t0, ph in cars:
        creep = 0.0 if t0 == ORDER_T else (2.2 * f / N + 0.35 * (0.5 + 0.5 * math.sin(f / 14 + ph))) / LTOT     # stop-and-go, ~2.5 m over the clip
        place(c, min(0.985, t0 + creep))
        c.keyframe_insert('location', frame=f); c.keyframe_insert('rotation_euler', frame=f)
sc.frame_set(0)

# ------------------------------------------------------------------ the Munadim car: ink body, brass strip, the mark on a solid door panel
m_ink_paint = mat('InkPaint', (0.012, 0.010, 0.009, 1), 0.22, metal=0.4)
hero = car('Hero', m_ink_paint)
for sy in (-1, 1):
    st = box('HeroStrip', (3.9, 0.03, 0.07), (0, sy * 0.915, 0.42 + 0.62 * 0.5), m_brass_strip); st.parent = hero
    bm = bmesh.new(); d = 0.52
    vs = [bm.verts.new(Vector((dx, sy * 0.92, 0.42 + 0.31 + dz))) for dx, dz in ((-d, -d * 0.55), (d, -d * 0.55), (d, d * 0.55), (-d, d * 0.55))]
    if sy < 0: vs = list(reversed(vs))
    fce = bm.faces.new(vs); uv = bm.loops.layers.uv.new()
    for lp, (u, v) in zip(fce.loops, ((0, 0.22), (1, 0.22), (1, 0.78), (0, 0.78)) if sy > 0 else ((0, 0.78), (1, 0.78), (1, 0.22), (0, 0.22))): lp[uv].uv = (u, v)
    me = bpy.data.meshes.new('HeroMark'); bm.to_mesh(me); bm.free(); mk = add('HeroMark', me); me.materials.append(m_sign); mk.parent = hero
glow = light('HeroGlow', 'POINT', (0, 0, 0.25), 800, (1.0, 0.68, 0.25), shadow_soft_size=0.8); glow.parent = hero
bag = box('Bag', (0.5, 0.42, 0.5), (-0.9, 0, 0.42 + 0.62 + 0.62 + 0.25), mat('Bag', SEMNA, 0.7, emit=(1.0, 0.8, 0.5, 1), strength=1.2)); bag.parent = hero
bag.hide_render = True; bag.keyframe_insert('hide_render', frame=0)
bag.hide_render = False; bag.keyframe_insert('hide_render', frame=UP1 + 14)
def ease(a):
    return a * a * (3 - 2 * a)
def hero_t(f):
    if f <= UP0: return HERO_T0
    if f <= UP1: return HERO_T0 + (HERO_TOP - HERO_T0) * ease((f - UP0) / (UP1 - UP0))
    if f <= DOWN0: return HERO_TOP
    if f <= DOWN1: return HERO_TOP - (HERO_TOP - ORDER_T - 0.015) * ease((f - DOWN0) / (DOWN1 - DOWN0))
    return ORDER_T + 0.015
def place_hero(c, t, down):
    p, T, Nn = frame_at(t)
    if down: T = -T
    pos = p - B * LANE + Nn * 0.02
    Y = Nn.cross(T).normalized()
    c.matrix_world = Matrix(((T.x, Y.x, Nn.x, pos.x), (T.y, Y.y, Nn.y, pos.y), (T.z, Y.z, Nn.z, pos.z), (0, 0, 0, 1)))
for f in range(0, N + 1, 2):
    sc.frame_set(f)
    place_hero(hero, hero_t(f), f > (UP1 + DOWN0) / 2)
    hero.keyframe_insert('location', frame=f); hero.keyframe_insert('rotation_euler', frame=f)
sc.frame_set(0)

# ------------------------------------------------------------------ Cairo glow on the horizon
for i in range(90):
    x = random.uniform(-120, 120); y = random.uniform(70, 160); z = random.uniform(0.3, 4.5)
    box('Glow', (random.uniform(0.6, 1.6), 0.2, random.uniform(0.4, 1.2)), (x, y, z), m_cityglow)

# ------------------------------------------------------------------ lights
# sky: faint, neutral-warm, from high behind the camera
sky = light('Sky', 'AREA', (-30, -60, 70), 5000, (0.82, 0.76, 0.70), size=60); aim(sky, (0, 0, 15))
sun = light('Moon', 'SUN', (0, 0, 50), 0.08, (0.78, 0.74, 0.70), angle=math.radians(3)); aim(sun, (30, 40, 0))
# warm washes on the ramp face and the structure, from the camera side — the concrete must read
for i, (loc, tgt, e) in enumerate([((-8, -24, 9), (4, 0, 8), 7000), ((2, -22, 20), (12, 0, 18), 8000), ((-10, -20, 30), (4, 0, 31), 6000), ((-26, -16, 6), (-14, 0, 1), 3500)]):
    wsh = light(f'Wash{i}', 'AREA', loc, e, (1.0, 0.82, 0.6), size=14); aim(wsh, tgt)
# ground spotlights fanning up through the fog
for i, (x, y, tx, tz) in enumerate([(-30, -14, -12, 60), (-8, 12, 2, 70), (24, -10, 16, 65), (34, 14, 22, 60)]):
    sp = light(f'Spot{i}', 'SPOT', (x, y, 0.3), 150000, (1.0, 0.96, 0.9), spot_size=math.radians(7), spot_blend=0.35, shadow_soft_size=0.4)
    aim(sp, (tx, y * 0.6, tz))
# warm practicals inside the restaurant + a pool under the sign
for i in range(3):
    light(f'Interior{i}', 'POINT', (RX - 3 + i * 3, RY + 0.5, RZ + 1.2), 170, (1.0, 0.72, 0.42), shadow_soft_size=0.12)
light('SignWash', 'AREA', (SIGN[0], SIGN[1] - 1.2, SIGN[2] - 1.0), 350, (1.0, 0.75, 0.4), size=3)
# the two lead cars actually light the ramp ahead
for c, t0, ph in cars[:2]:
    hl = light('HeadBeam', 'SPOT', (0, 0, 0), 2500, (1.0, 0.9, 0.75), spot_size=math.radians(40), spot_blend=0.6)
    hl.parent = c; hl.location = (2.3, 0, 0.9); hl.rotation_euler = (0, math.radians(90), 0)

# ------------------------------------------------------------------ world: near-black warm night + fog
world = bpy.data.worlds.new('World'); sc.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links; wn.clear()
bg = wn.new('ShaderNodeBackground'); bg.inputs['Color'].default_value = (0.0035, 0.0030, 0.0028, 1); bg.inputs['Strength'].default_value = 1
vol = wn.new('ShaderNodeVolumeScatter'); vol.inputs['Density'].default_value = 0.0085; vol.inputs['Anisotropy'].default_value = 0.55
vol.inputs['Color'].default_value = (0.95, 0.85, 0.75, 1)
out = wn.new('ShaderNodeOutputWorld')
wl.new(bg.outputs['Background'], out.inputs['Surface']); wl.new(vol.outputs['Volume'], out.inputs['Volume'])

# ------------------------------------------------------------------ camera: low, oblique, static (the overlay's path is projected through it)
cam = bpy.data.cameras.new('Cam'); cam.lens = 27; cam.sensor_width = 36; cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 36
camo = bpy.data.objects.new('Camera', cam); sc.collection.objects.link(camo); sc.camera = camo
camo.location = (-18, -35, 6.0)
aim(camo, (3.5, 0, 16.0))
cam.dof.use_dof = False

# ------------------------------------------------------------------ render settings (EEVEE, like the brand film)
r = sc.render
r.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in r.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
ee = sc.eevee
ee.taa_render_samples = 24 if QUICK else 48
for k, v in dict(use_raytracing=True, use_shadows=True, use_volumetric_shadows=True, volumetric_tile_size='2', volumetric_samples=96, volumetric_end=220.0).items():
    if hasattr(ee, k):
        try: setattr(ee, k, v)
        except Exception: pass
r.use_motion_blur = False
for m in bpy.data.materials:
    if hasattr(m, 'surface_render_method'): m.surface_render_method = 'DITHERED'
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy' if 'AgX - Punchy' in [e.identifier for e in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
sc.view_settings.exposure = 0.1
r.image_settings.file_format = 'JPEG'; r.image_settings.quality = 94
r.filepath = os.path.join(ROOT, 'render_loop', '')
try:  # gentle bloom
    ng = bpy.data.node_groups.new('Comp', 'CompositorNodeTree')
    ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    sc.compositing_node_group = ng
    rl = ng.nodes.new('CompositorNodeRLayers'); go = ng.nodes.new('NodeGroupOutput'); gl_ = ng.nodes.new('CompositorNodeGlare')
    def setin(node, name, val):
        for sk in node.inputs:
            if sk.name.lower() == name.lower():
                try: sk.default_value = val; return True
                except Exception: pass
        try: setattr(node, name.lower().replace(' ', '_'), val); return True
        except Exception: return False
    setin(gl_, 'Type', 'Bloom') or setin(gl_, 'glare_type', 'BLOOM')
    setin(gl_, 'Threshold', 1.2); setin(gl_, 'Strength', 0.3); setin(gl_, 'Size', 0.55); setin(gl_, 'Quality', 'High')
    ng.links.new(rl.outputs['Image'], gl_.inputs['Image']); ng.links.new(gl_.outputs['Image'], go.inputs[0])
except Exception as ex:
    print('compositor skipped:', ex)

# ------------------------------------------------------------------ export anchor points (1080x1920) for the Remotion overlay
bpy.context.view_layer.update()   # the camera's matrix_world is stale until the depsgraph runs
def px(v):
    c = world_to_camera_view(sc, camo, Vector(v)); return (round(c.x * 1080), round((1 - c.y) * 1920))
po, To, No = frame_at(ORDER_T)
order_px = px(po + B * LANE + No * 2.4)                      # above the ordering car's roof
top_px = px((RX - 1.5, RY - RD / 2 - 1.5, RZ - 0.4))          # the restaurant's front, where the ticket lands
pb, Tb, Nb = frame_at(ORDER_T + 0.015)
back_px = px(pb - B * LANE + Nb * 2.2)                        # the Munadim car, back beside the customer
ts = "// Generated by igvideos/blender/build_loop.py — screen anchors projected through the 3D camera. Do not hand-edit.\n"
ts += "export const LOOP_GEO = {\n"
ts += f"  order: {{ x: {order_px[0]}, y: {order_px[1]} }},   // the last car in the queue sends the order\n"
ts += f"  top: {{ x: {top_px[0]}, y: {top_px[1]} }},       // the restaurant front: the ticket reply\n"
ts += f"  back: {{ x: {back_px[0]}, y: {back_px[1]} }},     // the Munadim car is back with the bag\n"
ts += f"  beats: {{ up0: {UP0}, up1: {UP1}, down0: {DOWN0}, down1: {DOWN1}, frames: {N} }},\n}};\n"
open(os.path.join(ROOT, '..', '..', 'reel', 'src', 'lib', 'loopGeo.ts'), 'w').write(ts)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'scene_loop.blend'))
print('BUILD OK loop', 'quick' if QUICK else 'full', order_px, top_px, back_px)
