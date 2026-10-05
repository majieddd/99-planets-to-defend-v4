"""Bulwark: the heavy commander (v3: 1400 health, heavy cleave). A visored, fully armoured knight in stylized heroic
proportions: about 6.9 heads without the crest (1.96 m over a 0.28 m helm; 2.01 m to the top of the crest), broad
pauldrons over a chest that tapers to the waist, heavy plated limbs, big boots, gauntlets and weapon. Sword in the right
hand (socket.R), tower shield on the left forearm (socket.L). Animations: idle (2.0 s), run (0.6 s loop at the 7 m/s
run speed), attack (0.85 s, strike at 0.34 s from src/shared/timings.json). The attack's arm keys are re-solved from the
plan's: upper_arm.R, forearm.R with a forearm roll, and a new hand.R wrist key, so the blade crosses the front at the
strike (see attack_keys). The guard plants both feet (see GUARD), and the guard and the run roll the shield forearm so
the shield clears the left pauldron (see SHIELD_ROLL). Axis conventions: see lib/anim.py (humanoid).

Forms are sculpted rather than boxed. The masses are closed superquadrics (rounded boxes and ellipsoids), smooth
shaded, so no flat facets read. Everything that overlaps is a curved plate, cut from a superquadric or lofted through
superelliptic arcs and thickened with a chamfered rim: three-lame pauldrons, faulds, front and rear cuisses, side
tassets (bound to the thighs, not the hips, so a swinging leg carries its plate), couters and poleyns hide the rigid
joints, which keep their one-bone binding.

Value is set by the worst of the grounds the figure stands on (see COLOURS): the mid slate sits between the Verdant
greens and a near-black ground, the dark plate under the greens, silver trims and ivory enamel over them, the dark
undersuit left only deep in the joints. The warm edge highlights are painted rather than derived: every plate's rim and
chamfer faces take a warm light rim region, because Cycles pointiness on these smooth convex forms sits above 0.5 almost
everywhere (median 0.546; the rims start at the 95th percentile, 0.58, measured), so the composite's curvature term
lifts whole surfaces instead of edges. Each plate region also carries a painted warm cap on its upward faces
(paint.add_cap): the key light painted in, as the Verdant kit paints its light crowns."""
import math

from mathutils import Vector

from lib import anim, export, geo, ink, paint, palette, rig, scene
# The sculpted primitives and the plate family's colours, caps and paint style, which lib/charforge.py's armour shares.
from lib.armour import (BRUSH_SCALE, CAP, CAPS, COLOURS, PLATE_DEG, PLATE_STYLE, RIM_KEY, bend_over, blade, chain, lerp, limb, loft,
                        mirror_lon, place, plate, rows_mesh, solid, spow, sq_point, taper, upright, volume)
from lib.ctx import AnimRecord, AssetRecord

# Next to the 0.34 m pauldrons round one's 0.25 m helm read as a pinhead from the gameplay camera, and readability at
# distance beats a strict head count, so the helm is 12% larger (0.28 m). It grows about its base, so it rises and
# widens instead of sinking into the gorget.
HELM_SCALE = 1.12
HELM_BASE_Z = 1.69
# The crest's half width, half length and half height before HELM_SCALE, half again as tall as round one's, so it lifts
# the head's outline from the side and from above; the brow's lift off the skull.
CREST = (0.014, 0.14, 0.036)
BROW = 1.07


def _regions():
    c = COLOURS
    r = {
        'plate': palette.region('bulwark_plate', c['plate']),
        'plate_dark': palette.region('bulwark_plate_dark', c['plate_dark']),
        'plate_light': palette.region('bulwark_plate_light', c['plate_light']),
        'enamel': palette.region('bulwark_enamel', c['enamel']),
        'suit': palette.region('bulwark_undersuit', c['undersuit']),
        'leather': palette.region('bulwark_leather', palette.PLAYER['leather']),
        'blade': palette.region('bulwark_blade', c['blade']),
        'glow': palette.region('bulwark_glow', palette.PLAYER['gunmetal'], emit_hex=palette.PLAYER['energy']),
    }
    rim = paint.add_cap(palette.region('bulwark_rim', c['rim']), CAPS['rim'], **CAP)
    rim_enamel = palette.region('bulwark_rim_enamel', c['rim_enamel'])
    for key in ('plate', 'plate_dark', 'plate_light', 'enamel'):
        r[key][RIM_KEY] = (rim_enamel if key == 'enamel' else rim).name
        paint.add_cap(r[key], CAPS[key], **CAP)
    return r


def parts(arm, r):
    def H(bone):
        return rig.bone_head(arm, bone)

    def Tl(bone):
        return rig.bone_tail(arm, bone)

    out = []
    hz = H('hips').z  # belt, skirt plates, faulds and tassets are placed from the hip joint (tassets bind to thighs)

    def add(ob, bone, width=1.0, kind='plate', angle=PLATE_DEG):
        if kind == 'round':
            geo.shade_smooth(ob, 180.0)
        elif kind == 'flat':
            geo.shade_flat(ob)
        else:
            geo.shade_smooth(ob, angle)
        ink.set_ink(ob, width)
        # The cap does not need this (geo.cap_factor maps normals through matrix_world, so an unapplied part still caps
        # its world top), and bind_rigid applies transforms again at the join; here it only puts each part in world
        # space early.
        scene.apply_transforms(ob)
        geo.cap_factor(ob)
        out.append((ob, bone))
        return ob

    # hips: pelvis, belt and buckle, a front plate and a back skirt
    add(volume('b_pelvis', (0.155, 0.118, 0.095), 0.7, 0.75, 16, 8, material=r['suit'], location=(0, 0.005, hz - 0.02)), 'hips', 0.9, 'round')
    add(volume('b_belt', (0.17, 0.137, 0.03), 0.3, 0.8, 20, 6, material=r['leather'], location=(0, 0, hz + 0.07)), 'hips', 0.8, 'round')
    add(volume('b_buckle', (0.052, 0.022, 0.036), 0.45, 0.45, 12, 6, material=r['plate_light'], location=(0, -0.137, hz + 0.07)), 'hips', 0.6, 'round')
    add(loft('b_culet', [(hz - 0.14, 0.2, 0.17), (hz - 0.05, 0.186, 0.157), (hz + 0.05, 0.172, 0.142)], (15, 165), 0.016, 0.8, 10, r['plate_dark']), 'hips', 0.9)
    add(loft('b_front', [(hz - 0.12, 0.16, 0.14), (hz - 0.03, 0.163, 0.142), (hz + 0.055, 0.17, 0.146)], (-120, -60), 0.015, 0.8, 6, r['plate_dark']), 'hips', 0.9)
    # abdomen and faulds: each lame tucks under the one above it, the top one under the cuirass
    add(volume('b_abdomen', (0.14, 0.108, 0.11), 0.7, 0.7, 16, 8, material=r['suit'], location=(0, 0, hz + 0.19)), 'spine', 0.8, 'round')
    add(loft('b_fauld1', [(hz + 0.1, 0.184, 0.15), (hz + 0.15, 0.176, 0.143), (hz + 0.21, 0.152, 0.122)], (-180, 180), 0.015, 0.8, 18, r['plate']), 'spine', 0.9)
    add(loft('b_fauld2', [(hz + 0.18, 0.176, 0.142), (hz + 0.23, 0.163, 0.13), (hz + 0.28, 0.128, 0.1)], (-180, 180), 0.015, 0.8, 18, r['plate_dark']), 'spine', 0.9)
    # cuirass: broad at the chest, narrowing to the waist, a keel down the front
    c_radii, c_ev, c_eh, c_centre, c_half = (0.215, 0.165, 0.16), 0.5, 0.72, Vector((0, -0.006, 1.445)), 0.16

    def keel(p):
        if p.y < 0:
            p = Vector((p.x, p.y - 0.022 * max(0.0, 1.0 - abs(p.x) / 0.15) ** 2, p.z))
        return p

    c_deform = chain(taper(c_half, 0.72, 1.08), keel)
    add(volume('b_cuirass', c_radii, c_ev, c_eh, 24, 14, deform=c_deform, material=r['plate'], location=c_centre), 'chest', 1.2, 'round')

    def on_cuirass(scale, lon, lat):
        p = sq_point(c_radii, c_ev, c_eh, math.radians(lon), math.radians(lat))
        return c_deform(Vector((p.x * scale, p.y * scale, p.z * scale)))

    def panel_half(la):
        return 20 + 26 * (la - 4) / 42  # degrees: a V, narrow at the sternum and wide under the collar

    rows = []
    for j in range(7):
        la = 4 + (46 - 4) * j / 6
        w = panel_half(la)
        rows.append([on_cuirass(1.04, -90 - w + 2 * w * i / 8, la) for i in range(9)])
    add(solid(place(rows_mesh('b_chestpanel', rows, False, r['enamel']), c_centre, (0, 0, 0)), 0.016), 'chest', 0.9)
    for side in (-1, 1):
        rows = []
        for j in range(5):
            la = 4 + (40 - 4) * j / 4
            centre = -90 + side * (panel_half(la) + 6)  # a cyan channel along each edge of the V
            rows.append([on_cuirass(1.035, centre - 3 + 3 * i, la) for i in range(3)])
        add(solid(place(rows_mesh(f'b_channel{side:+d}', rows, False, r['glow']), c_centre, (0, 0, 0)), 0.012, bevel=False), 'chest', 0.0)
    add(volume('b_backpack', (0.14, 0.06, 0.13), 0.5, 0.5, 16, 8, material=r['plate_dark'], location=(0, 0.177, 1.45)), 'chest', 1.0, 'round')
    for side in (-1, 1):
        add(volume(f'b_vent{side:+d}', (0.013, 0.008, 0.065), 0.4, 0.4, 8, 6, material=r['glow'], location=(side * 0.06, 0.235, 1.45)), 'chest', 0.0, 'round')
    # a high gorget, so the helm sits on armour instead of a thin neck
    add(loft('b_gorget', [(1.57, 0.13, 0.112), (1.615, 0.112, 0.098), (1.662, 0.088, 0.082)], (-180, 180), 0.02, 1.0, 16, r['plate_light']), 'chest', 1.0)
    # neck and helm: a rounded skull, the visor slit recessed between a brow band and a mask
    add(volume('b_neck', (0.058, 0.056, 0.055), 0.5, 1.0, 12, 6, material=r['suit'], location=(0, 0.005, 1.64)), 'neck', 0.8, 'round')
    hs = HELM_SCALE

    def helm(p):
        return Vector((p[0] * hs, p[1] * hs, HELM_BASE_Z + (p[2] - HELM_BASE_Z) * hs))

    s_radii, s_e, s_centre = tuple(x * hs for x in (0.108, 0.124, 0.124)), 0.88, helm((0, 0.008, 1.805))
    add(volume('b_skull', s_radii, s_e, s_e, 24, 14, material=r['plate'], location=s_centre), 'head', 1.2, 'round')

    def helm_plate(name, scale, lon, lat, thickness, material, nu=12, nv=3, deform=None, bevel=True):
        return plate(name, tuple(x * scale for x in s_radii), lon, lat, thickness, s_e, s_e, nu, nv, deform=deform,
                     material=material, location=s_centre, bevel=bevel)

    # Brow and mask stand proud of the skull and the glowing band 2%, so the slit reads as a recess.
    add(helm_plate('b_brow', BROW, (-162, -18), (6, 28), 0.018, r['plate_light']), 'head', 0.9)
    add(helm_plate('b_visor', 1.02, (-150, -30), (-8, 8), 0.012, r['glow'], nu=10, nv=2, bevel=False), 'head', 0.0)

    def mask_keel(p):
        return Vector((p.x, p.y - 0.01 * hs * max(0.0, 1.0 - abs(p.x) / (0.035 * hs)), p.z))

    add(helm_plate('b_mask', 1.07, (-165, -15), (-66, -9), 0.018, r['plate_light'], nv=4, deform=mask_keel), 'head', 0.9)
    add(helm_plate('b_nape', 1.08, (15, 165), (-74, -30), 0.016, r['plate_dark'], nv=3), 'head', 0.9)
    crest = volume('b_crest', tuple(x * hs for x in CREST), 0.5, 0.6, 10, 12, deform=bend_over(s_radii[2], 0.008 * hs),
                   material=r['enamel'], location=s_centre + Vector((0, 0, s_radii[2])))
    add(crest, 'head', 0.9, 'round')
    for side in (-1, 1):
        add(volume(f'b_ear{side:+d}', (0.016 * hs, 0.042 * hs, 0.042 * hs), 0.6, 0.6, 12, 6, material=r['plate_light'],
                   location=helm((side * 0.112, 0.012, 1.785))), 'head', 0.7, 'round')
    # pauldrons: an ivory dome over two lames that flare out and down, each tilted further outward
    for s, side in ((1, 'L'), (-1, 'R')):
        bone = f'shoulder.{side}'
        out_lon = mirror_lon((-115, 115), s)
        add(plate(f'b_spaulder.{side}', (0.17, 0.16, 0.125), (-180, 180), (-4, 90), 0.02, 0.75, 0.85, 18, 6,
                  material=r['enamel'], location=(s * 0.27, 0.0, 1.535), rotation=(0, s * 0.38, 0)), bone, 1.2)
        add(plate(f'b_lame1.{side}', (0.181, 0.171, 0.135), out_lon, (-30, 2), 0.018, 0.75, 0.85, 14, 3,
                  material=r['plate'], location=(s * 0.28, 0.0, 1.52), rotation=(0, s * 0.5, 0)), bone, 1.0)
        add(plate(f'b_lame2.{side}', (0.194, 0.182, 0.145), out_lon, (-52, -22), 0.018, 0.75, 0.85, 14, 3,
                  material=r['plate_dark'], location=(s * 0.29, 0.0, 1.505), rotation=(0, s * 0.62, 0)), bone, 1.0)
    # arms: plated upper arm reaching up under the pauldron, a couter with a fan over the elbow, flared gauntlets. The
    # plates carry about a fifth more girth than round one's, so the arms hold their own under the three-lame pauldrons.
    for s, side in ((1, 'L'), (-1, 'R')):
        ua_h, ua_t = H(f'upper_arm.{side}'), Tl(f'upper_arm.{side}')
        fa_h, fa_t = H(f'forearm.{side}'), Tl(f'forearm.{side}')
        hd_h, hd_t = H(f'hand.{side}'), Tl(f'hand.{side}')
        add(limb(f'b_sleeve.{side}', ua_t, ua_h, 0.056, 0.064, material=r['suit']), f'upper_arm.{side}', 0.8, 'round')
        add(limb(f'b_rerebrace.{side}', lerp(ua_h, ua_t, 0.02), lerp(ua_h, ua_t, 0.8), 0.084, 0.074, e_v=0.35, material=r['plate']), f'upper_arm.{side}', 1.0, 'round')
        # A ball at each joint pivot looks the same at any bend, so no gap opens between the rigid pieces. It is dark
        # plate, not undersuit, so the inside of a bent elbow reads as armour rather than a hole.
        add(volume(f'b_elbow.{side}', (0.06, 0.06, 0.06), material=r['plate_dark'], nu=12, nv=6, location=fa_h), f'forearm.{side}', 0.8, 'round')
        add(plate(f'b_couter.{side}', (0.084, 0.084, 0.07), (-180, 180), (12, 90), 0.017, 0.9, 0.9, 14, 4,
                  material=r['plate_light'], location=fa_h + Vector((0, 0.006, 0)), rotation=(-math.pi / 2, 0, 0)), f'forearm.{side}', 0.9)
        add(volume(f'b_fan.{side}', (0.013, 0.064, 0.07), 0.5, 0.5, 10, 6, material=r['plate_light'], location=fa_h + Vector((s * 0.078, 0.014, 0.0))), f'forearm.{side}', 0.8, 'round')
        add(limb(f'b_vambrace.{side}', lerp(fa_h, fa_t, 0.12), lerp(fa_h, fa_t, 0.8), 0.074, 0.09, e_v=0.35, material=r['plate']), f'forearm.{side}', 1.0, 'round')
        cuff = loft(f'b_cuff.{side}', [(-0.045, 0.09, 0.09), (0.0, 0.104, 0.104), (0.045, 0.124, 0.124)], (-180, 180), 0.016, 1.0, 16, r['plate_light'])
        add(upright(cuff, lerp(fa_h, fa_t, 0.98), lerp(fa_h, fa_t, 0.66)), f'forearm.{side}', 1.0)
        fist_c = lerp(hd_h, hd_t, 0.45)
        add(volume(f'b_fist.{side}', (0.062, 0.068, 0.074), 0.55, 0.55, 12, 8, material=r['plate_dark'], location=fist_c), f'hand.{side}', 0.9, 'round')
        add(volume(f'b_knuckle.{side}', (0.025, 0.06, 0.038), 0.5, 0.5, 10, 6, material=r['plate_light'], location=fist_c + Vector((s * 0.057, -0.004, -0.006))), f'hand.{side}', 0.6, 'round')
    # legs: cuisses and tassets over the thighs, poleyns with a side wing, calf-shaped greaves, big sabatons
    for s, side in ((1, 'L'), (-1, 'R')):
        th_h, th_t = H(f'thigh.{side}'), Tl(f'thigh.{side}')
        sh_h, sh_t = H(f'shin.{side}'), Tl(f'shin.{side}')
        x = th_t.x
        add(limb(f'b_thigh.{side}', th_h, th_t, 0.096, 0.074, material=r['suit']), f'thigh.{side}', 0.9, 'round')
        cuisse = loft(f'b_cuisse.{side}', [(-0.16, 0.098, 0.095), (0.0, 0.112, 0.108), (0.15, 0.117, 0.113)], mirror_lon((-170, 75), s), 0.016, 0.9, 12, r['plate'])
        add(upright(cuisse, lerp(th_h, th_t, 0.88), lerp(th_h, th_t, 0.2)), f'thigh.{side}', 1.0)
        # The rear cuisse closes the back of the thigh, where the undersuit showed; both its edges tuck under the front
        # cuisse, which stands 7 mm prouder.
        rear = loft(f'b_rearcuisse.{side}', [(-0.15, 0.092, 0.089), (0.0, 0.105, 0.101), (0.14, 0.11, 0.106)], mirror_lon((50, 200), s), 0.014, 0.9, 8, r['plate'])
        add(upright(rear, lerp(th_h, th_t, 0.86), lerp(th_h, th_t, 0.22)), f'thigh.{side}', 0.9)
        # Tassets ride the thighs, not the hips, so a swinging leg carries its plate instead of passing through it. They
        # grow deeper rather than wider: the hanging cuffs already cross them by 8 mm in the bind pose (the guard lifts
        # the forearms 18 to 21 cm clear), and a wider tasset would bury more of each cuff.
        tasset = loft(f'b_tasset.{side}', [(hz - 0.21, 0.135, 0.152), (hz - 0.075, 0.125, 0.139), (hz + 0.05, 0.114, 0.123)], mirror_lon((-150, 14), s), 0.017, 0.85, 10, r['plate'])
        tasset.location = (th_h.x, 0.0, 0.0)
        add(tasset, f'thigh.{side}', 1.0)
        add(volume(f'b_knee.{side}', (0.074, 0.074, 0.074), nu=12, nv=6, material=r['plate_dark'], location=sh_h + Vector((0, 0.004, 0))), f'shin.{side}', 0.8, 'round')
        add(plate(f'b_poleyn.{side}', (0.098, 0.094, 0.082), (-180, 180), (22, 90), 0.017, 0.9, 0.9, 14, 4,
                  material=r['plate_light'], location=sh_h + Vector((0, 0.0, 0.008)), rotation=(math.pi / 2, 0, 0)), f'shin.{side}', 1.0)
        add(volume(f'b_wing.{side}', (0.014, 0.07, 0.08), 0.5, 0.5, 10, 6, material=r['plate_light'], location=sh_h + Vector((s * 0.094, 0.004, 0.0))), f'shin.{side}', 0.8, 'round')

        def calf(p):
            if p.y > 0:  # the frame is upright (see upright), so +y is the back of the leg
                p = Vector((p.x, p.y * (1.0 + 0.3 * max(0.0, 1.0 - abs(p.z - 0.09) / 0.16)), p.z))
            return p

        add(limb(f'b_greave.{side}', lerp(sh_h, sh_t, 0.06), lerp(sh_h, sh_t, 0.96), 0.092, 0.07, e_v=0.35, nu=14, nv=10, deform=calf, material=r['plate']), f'shin.{side}', 1.0, 'round')
        # The ivory shin panel tapers like a shield (wide under the knee, near a point at the ankle) and folds along a
        # centre keel: its two halves face the light at different angles, where a smooth strip read as one flat tone.
        # Shading holds the keel's crease (31 degrees under the knee) and smooths the 10 degree steps across each half.
        rows = []
        for z, rx, ry, half, keel in ((-0.15, 0.081, 0.085, 6, 0.005), (-0.1, 0.083, 0.087, 16, 0.008), (0.0, 0.088, 0.092, 30, 0.011),
                                      (0.1, 0.093, 0.097, 40, 0.013), (0.14, 0.095, 0.099, 42, 0.013)):
            row = []
            for i in range(9):
                a = math.radians(-90 - half + 2 * half * i / 8)
                row.append(Vector((rx * spow(math.cos(a), 0.9), ry * spow(math.sin(a), 0.9) - keel * (1 - abs(i - 4) / 4), z)))
            rows.append(row)
        shinplate = solid(rows_mesh(f'b_shinplate.{side}', rows, False, r['enamel']), 0.013)
        add(upright(shinplate, lerp(sh_h, sh_t, 0.88), lerp(sh_h, sh_t, 0.2)), f'shin.{side}', 0.8, angle=16.0)
        ankle = loft(f'b_ankle.{side}', [(-0.03, 0.09, 0.094), (0.0, 0.081, 0.085), (0.03, 0.074, 0.078)], (-180, 180), 0.013, 1.0, 14, r['plate_light'])
        add(upright(ankle, lerp(sh_h, sh_t, 0.96), lerp(sh_h, sh_t, 0.82)), f'shin.{side}', 0.9)

        def sole(p):
            return Vector((p.x, p.y, max(p.z, -0.07)))  # a flat sole on the ground plane

        add(volume(f'b_boot.{side}', (0.086, 0.176, 0.074), 0.45, 0.65, 18, 10, deform=sole, material=r['leather'], location=(x, -0.062, 0.07)), f'foot.{side}', 0.9, 'round')
        add(plate(f'b_sabaton.{side}', (0.09, 0.182, 0.078), (-165, -15), (4, 80), 0.015, 0.6, 0.7, 10, 3,
                  material=r['plate_dark'], location=(x, -0.062, 0.07)), f'foot.{side}', 0.9)
        add(volume(f'b_toecap.{side}', (0.07, 0.066, 0.052), 0.6, 0.6, 12, 8, material=r['plate_light'], location=(x, -0.192, 0.055)), f'foot.{side}', 0.8, 'round')
    # sword in the right hand: grip along y through the fist, blade forward (-y), edge vertical
    g = rig.bone_head(arm, 'socket.R')
    gx, gz = g.x, g.z
    add(limb('b_grip', (gx, 0.035, gz), (gx, -0.12, gz), 0.02, 0.02, e_v=0.3, nu=10, nv=6, material=r['leather']), 'socket.R', 0.6, 'round')
    add(volume('b_pommel', (0.034, 0.038, 0.034), 0.7, 0.7, 12, 8, material=r['plate_light'], location=(gx, 0.058, gz)), 'socket.R', 0.6, 'round')

    def guard_curve(p):
        return Vector((p.x, p.y - 0.03 * (p.z / 0.15) ** 2, p.z))

    add(volume('b_guard', (0.026, 0.03, 0.15), 0.5, 0.5, 12, 10, deform=guard_curve, material=r['enamel'], location=(gx, -0.13, gz)), 'socket.R', 0.8, 'round')
    add(volume('b_gem', (0.032, 0.016, 0.022), 0.6, 0.6, 10, 6, material=r['glow'], location=(gx, -0.13, gz)), 'socket.R', 0.0, 'round')
    add(blade('b_blade', (gx, -0.14, gz), 1.08, 0.052, 0.011, r['blade']), 'socket.R', 0.9, 'flat')
    for side in (-1, 1):
        add(volume(f'b_fuller{side:+d}', (0.003, 0.4, 0.008), 0.3, 0.3, 8, 6, material=r['glow'], location=(gx + side * 0.0112, -0.56, gz)), 'socket.R', 0.0, 'round')
    # tower shield on the left forearm: a curved slab facing out (+x), an ivory face, a cyan emblem and a boss. The slab
    # is slate, not a light trim: its inner side and border then break from a meadow ground by value (L* 44 against 73)
    # where the silver trim (82) would melt into it. Its outer face stands at x 0.52, 2 cm clear of the heavier left cuff.
    radius, axis_x, y0 = 0.7, 0.52 - 0.7, rig.bone_head(arm, 'socket.L').y

    def shield_rows(r_off, margin, nu=10, nv=3):
        half = (0.31 - margin) / (radius + r_off)
        rows = []
        for j in range(nv + 1):
            row = []
            for i in range(nu + 1):
                u = 2 * i / nu - 1
                top = 1.555 + 0.05 * (1 - u * u) - margin
                bottom = 0.49 - 0.06 * (1 - u * u) + margin
                z = bottom + (top - bottom) * j / nv
                row.append(Vector((axis_x + (radius + r_off) * math.cos(u * half), y0 + (radius + r_off) * math.sin(u * half), z)))
            rows.append(row)
        return rows

    add(solid(rows_mesh('b_shield', shield_rows(0.0, 0.0), False, r['plate']), 0.04), 'socket.L', 1.3)
    # The face stands 12 mm proud and is 14 mm thick, so it sinks 2 mm into the body: no gap and no coplanar faces.
    add(solid(rows_mesh('b_shieldface', shield_rows(0.012, 0.045), False, r['enamel']), 0.014), 'socket.L', 0.8)
    emblem_r, zc = radius + 0.024, 1.12
    rows = []
    for j in range(7):
        t = -1 + 2 * j / 6
        half = 0.075 * (1 - abs(t))
        if j in (0, 6):
            rows.append([Vector((axis_x + emblem_r, y0, zc + t * 0.14))])
            continue
        rows.append([Vector((axis_x + emblem_r * math.cos(a), y0 + emblem_r * math.sin(a), zc + t * 0.14))
                     for a in ((-half + 2 * half * i / 4) / emblem_r for i in range(5))])
    # The emblem stands 12 mm proud of the face and is 14 mm thick, so it too sinks 2 mm; 12 mm thick, its back lay
    # exactly on the face.
    add(solid(rows_mesh('b_emblem', rows, False, r['glow']), 0.014, bevel=False), 'socket.L', 0.0)
    add(plate('b_boss', (0.065, 0.065, 0.036), (-180, 180), (0, 90), 0.015, 0.9, 0.9, 14, 3, material=r['plate_light'],
              location=(axis_x + radius + 0.008, y0, 0.8), rotation=(0, math.pi / 2, 0)), 'socket.L', 0.7)
    return out


# The guard and the run hold the shield forearm roughly level and pointing forward, so the shield lies along it with its
# top edge (the bind pose's front edge) at pauldron height. Unrolled, that edge ran through the left dome and first lame
# in every sampled frame of all three clips (up to 110 and 42 triangle pairs, the dome up to 2 cm inside the slab).
# Rolling the forearm (ry) by SHIELD_ROLL swings the edge 8 to 9 cm out and 4 to 5 cm down, which leaves about 2 cm of
# clearance in every frame, and tips the face about 13 degrees down in the guard; the bind pose keeps the shield upright.
# The attack keeps the guard's left arm, so the roll covers all three clips. The elbow cop turns with the forearm, so
# its existing overlap with the waist lame in the run deepens slightly (8.6 mm at most, from 8.0) and now reaches 1 to
# 2 mm around the left contact, where it was clear.
SHIELD_ROLL = -0.25

# The plan's guard left each foot at its leg's net swing, so the front foot sank 2.3 cm and the rear toe 5.8 cm
# (measured on the mesh). The front foot now cancels its leg's 0.05 and lies level, and the hips drop 1.7 cm instead
# of 3, which rests its sole on the ground. The rear foot cancels 0.21 of its leg's 0.45, which rests its toe on the
# ground and keeps the heel about 7 cm up, as the plan's pose showed it. The attack's keys merge the guard, so the
# strike and follow-through inherit both feet (their rear toe sank 3.2 cm before, and rests within 1 cm now).
GUARD = {
    'upper_arm.L': (-0.2, 0, -0.6), 'forearm.L': (0, SHIELD_ROLL, -1.2),
    'upper_arm.R': (0.0, 0, -0.45), 'forearm.R': (0, 0, -1.0),
    'chest': (0, 0.12, 0.05), 'spine': (0, 0, 0.08),
    'thigh.L': (0, 0, -0.25), 'shin.L': (0, 0, 0.3), 'foot.L': (0, 0, -0.05),
    'thigh.R': (0, 0, 0.2), 'shin.R': (0, 0, 0.25), 'foot.R': (0, 0, -0.21),
    'hips@loc': (0, -0.017, 0),
}


def idle_keys():
    # The breath lowers the hips 5 mm under the guard's, so the planted feet dip no more than that.
    breathe = anim.merge(GUARD, {'chest': (0, 0.12, 0.08), 'spine': (0, 0, 0.1), 'head': (0, 0, -0.03),
                                 'hips@loc': (0, GUARD['hips@loc'][1] - 0.005, 0)})
    return [(1, GUARD), (31, breathe), (61, GUARD)]


def run_keys():
    # At contact the forward leg reaches (-0.6) with a slight knee and the hips drop 5 cm, which sets the leading heel
    # near the ground; the plan's -0.75 with the hips 2 cm down held the front toe 0.31 m in the air, a leap rather than
    # a heavy stride.
    legs_contact_r = {
        'thigh.R': (0, 0, -0.6), 'shin.R': (0, 0, 0.3), 'foot.R': (0, 0, -0.2),
        'thigh.L': (0, 0, 0.55), 'shin.L': (0, 0, 1.0), 'foot.L': (0, 0, 0.4),
        'spine': (0, -0.12, 0.18), 'chest': (0, 0.1, 0.05), 'head': (0, 0, -0.1), 'hips@loc': (0, -0.05, 0),
    }
    legs_pass_r = {
        'thigh.R': (0, 0, -0.1), 'shin.R': (0, 0, 0.35), 'thigh.L': (0, 0, -0.35), 'shin.L': (0, 0, 1.5),
        'spine': (0, 0, 0.2), 'head': (0, 0, -0.1), 'hips@loc': (0, 0.04, 0),
    }
    # The shield forearm keeps the guard's roll (SHIELD_ROLL) through the whole stride.
    arms_contact_r = {'upper_arm.R': (0, 0, 0.5), 'forearm.R': (0, 0, -0.8), 'upper_arm.L': (-0.2, 0, -0.1), 'forearm.L': (0, SHIELD_ROLL, -1.3)}
    arms_contact_l = {'upper_arm.R': (0, 0, -0.4), 'forearm.R': (0, 0, -0.9), 'upper_arm.L': (-0.2, 0, -0.35), 'forearm.L': (0, SHIELD_ROLL, -1.2)}
    arms_pass = {'upper_arm.R': (0, 0, 0.05), 'forearm.R': (0, 0, -0.85), 'upper_arm.L': (-0.2, 0, -0.22), 'forearm.L': (0, SHIELD_ROLL, -1.25)}
    contact_r = anim.merge(legs_contact_r, arms_contact_r)
    pass_r = anim.merge(legs_pass_r, arms_pass)
    # Legs and torso mirror; the arms are authored per contact because the sword and shield arms differ.
    contact_l = anim.merge(anim.mirror_pose(legs_contact_r), arms_contact_l)
    pass_l = anim.merge(anim.mirror_pose(legs_pass_r), arms_pass)
    return [(1, contact_r), (5.5, pass_r), (10, contact_l), (14.5, pass_l), (19, contact_r)]


def attack_keys(strike_frame, end_frame):
    # The sword sits across the hand at right angles to the forearm, in the plane the elbow bends in, so the arm
    # raises forward (not out to the side) to cock the blade back over the right shoulder; the forearm then pronates
    # (ry) through the swing so the blade crosses the front level at waist height on the strike, and the wrist
    # (hand.R rz) tips it down into the cut. The arm values are solved in world space against the torso and legs.
    # The wind-up also lifts the right shoulder (rx raises either shoulder's tail), so the pauldron rises with the raised
    # arm, but that does not clear the lames: through the wind-up and the strike (frames 4 to 13) the rerebrace still
    # passes 5 to 7 cm into the right dome and first lame (measured), under the dome, where it does not show. The attack
    # keeps the guard's hips: its front leg holds the guard's angles, so the plan's 5 cm drop sank that foot (4.3 cm, and
    # the rear toe 7.7 cm).
    windup = anim.merge(GUARD, {
        'upper_arm.R': (-0.31, 0, -1.68), 'forearm.R': (0, 0.84, -0.93), 'hand.R': (0, 0, 0.45), 'shoulder.R': (0.3, 0, 0),
        'chest': (0, -0.5, 0.0), 'spine': (0, -0.2, -0.05),
        'thigh.R': (0, 0, 0.15), 'shin.R': (0, 0, 0.4),
    })
    strike = anim.merge(GUARD, {
        'upper_arm.R': (-0.38, 0, -1.09), 'forearm.R': (0, -0.18, 0.0), 'hand.R': (0, 0, 0.62),
        'chest': (0, 0.45, 0.1), 'spine': (0, 0.15, 0.3),
        'thigh.L': (0, 0, -0.5), 'shin.L': (0, 0, 0.5), 'thigh.R': (0, 0, 0.45), 'shin.R': (0, 0, 0.2),
        'hips@loc': (0, -0.06, 0),
    })
    follow = anim.merge(strike, {'upper_arm.R': (0.15, 0, -0.79), 'forearm.R': (0, -0.26, 0.01), 'chest': (0, 0.6, 0.12)})
    return [(1, GUARD), (strike_frame - 4.2, windup), (strike_frame, strike), (strike_frame + 4.8, follow), (end_frame, GUARD)]


def build(ctx):
    timing = ctx.timings()['commanders']['bulwark']['attack']
    strike_frame = 1 + timing['strike'] * anim.FPS
    end_frame = 1 + timing['duration'] * anim.FPS
    r = _regions()
    arm = rig.humanoid('bulwark_rig')
    mesh = rig.bind_rigid(arm, parts(arm, r), 'bulwark')
    paint.paint([mesh], name='bulwark', out_dir=ctx.bake_dir('commanders'), textures_dir=ctx.textures, size=1024,
                style=PLATE_STYLE, ao_distance=0.18, brush_scale=BRUSH_SCALE, emissive_strength=4.0)
    idle = anim.make_action(arm, 'idle', idle_keys(), loc_bones=('hips',))
    run = anim.make_action(arm, 'run', run_keys(), loc_bones=('hips',))
    attack = anim.make_action(arm, 'attack', attack_keys(strike_frame, end_frame), loc_bones=('hips',))
    if ctx.previews_enabled:
        out = ctx.preview_dir('bulwark')
        export.render_views([mesh], out, 'bulwark', views=4, size=640)
        for action in (run, attack):
            export.render_action(arm, [mesh], action, out, 'bulwark', frames=6)
    export.export_glb([arm, mesh], ctx.raw_path('commanders', 'bulwark'), animations=True)
    return [AssetRecord(
        name='bulwark', family='commanders', file='commanders/bulwark.glb', nodes=['bulwark_rig', 'bulwark'],
        tris=scene.tri_count([mesh]),
        animations=[
            AnimRecord('idle', anim.duration(idle), True),
            AnimRecord('run', anim.duration(run), True),
            AnimRecord('attack', anim.duration(attack), False, strike=(strike_frame - 1) / anim.FPS),
        ],
    )]
