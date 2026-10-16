// Exports the exact reel choreography per frame (three.js Y-up world) for the Blender build.
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { cam, T, ITEMS, setVariant, Variant } from '../lib/timeline';
import { holoLayout, Size } from '../lib/holoLayout';
import { mapLayout, billboard, MAP_ORIGIN, MAP_W, MAP_D, SHOP, HOME, ROUTE } from '../lib/mapAct';
import { phoneAt, PD } from '../scene/phonePose';
import { prog, easeOut, lerp, wobble, rng } from '../lib/anim';

const dir = process.argv[2];
const variant = (process.argv[3] || 'holo') as Variant;
setVariant(variant);
const DUR = T.dur;
const sizes: Record<string, [number, number]> = JSON.parse(readFileSync(`${dir}/tex/sizes.json`, 'utf8'));
const M = 40;
const itemSizes: Size[] = ITEMS.map((it) => {
  if (it.msg < 0) return { w: 190, h: 100, me: false };
  const [w, h] = sizes[`bubble${it.msg}`];
  return { w: w - M * 2, h: h - M * 2, me: [0, 2, 4].includes(it.msg) };
});

const R = rng(5);
const pdata = Array.from({ length: 60 }, () => ({ a: R() * Math.PI * 2, r: 0.01 + R() * 0.07, sp: 0.4 + R() * 0.9, ph: R() }));

const o = new THREE.Object3D();
const arr = (m: THREE.Matrix4) => m.elements.map((x) => +x.toFixed(6));
const frames = [];
for (let f = 0; f < DUR; f++) {
  const c = cam(f);
  const camObj = new THREE.PerspectiveCamera();
  camObj.position.set(...c.pos);
  camObj.lookAt(new THREE.Vector3(...c.tgt));
  camObj.updateMatrixWorld();
  const focusDist = new THREE.Vector3(...c.focus).distanceTo(new THREE.Vector3(...c.pos));

  const ph = phoneAt(f);
  o.position.set(...ph.pos);
  o.rotation.set(ph.rot[0], ph.rot[1], ph.rot[2], 'XYZ');
  o.scale.set(1, 1, 1);
  o.updateMatrix();
  const phoneM = arr(o.matrix);

  const hl = holoLayout(f, itemSizes, ph.pos, PD);
  const base = new THREE.Matrix4().makeTranslation(...hl.origin).multiply(new THREE.Matrix4().makeRotationY(hl.yaw));
  const tilt = base.clone().multiply(new THREE.Matrix4().makeRotationX(hl.pitch));
  const items = hl.items.map((it) => {
    if (!it.show) return null;
    const m = tilt.clone().multiply(new THREE.Matrix4().makeTranslation(it.x, it.y, 0)).multiply(new THREE.Matrix4().makeScale(it.sc, it.sc, it.sc));
    return { m: arr(m), a: +it.a.toFixed(4), fw: it.fw, fh: it.fh };
  });
  const beam = arr(base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.16, 0)));
  const parts = pdata.map((d) => {
    const t = (d.ph + (f / 30) * 0.18 * d.sp) % 1;
    const ang = d.a + t * 2.0;
    const rad = d.r * (0.6 + t * 0.9);
    const v = new THREE.Vector3(Math.cos(ang) * rad, t * 0.3, Math.sin(ang) * rad).applyMatrix4(base);
    return [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5), +(Math.sin(Math.PI * t)).toFixed(3)];
  });

  // tray (same as Tray.tsx)
  const e = easeOut(prog(f, T.tray[0], T.tray[1]));
  const tray = f < T.tray[0] ? null : {
    pos: [lerp(0.62, 0.035, e), Math.sin(Math.PI * prog(f, T.tray[1] - 12, T.tray[1])) * 0.004 * (1 - e) + (1 - e) * 0.01, 0],
    ry: lerp(-0.35, -0.06, e),
  };

  // delivery act
  const ml = mapLayout(f);
  const bill = (pos: [number, number, number], pitchScale = 0.7) => {
    const b = billboard(f, pos, pitchScale);
    return arr(new THREE.Matrix4().makeTranslation(...pos)
      .multiply(new THREE.Matrix4().makeRotationY(b.yaw))
      .multiply(new THREE.Matrix4().makeRotationX(b.pitch)));
  };
  const map = {
    a: +ml.a.toFixed(4), visible: ml.visible, routeFrac: +ml.routeFrac.toFixed(4), routeA: +ml.routeA.toFixed(4),
    root: arr(new THREE.Matrix4().makeTranslation(...ml.origin).multiply(new THREE.Matrix4().makeScale(ml.scale, ml.scale, ml.scale))),
    packet: { pos: ml.packet.pos.map((x) => +x.toFixed(5)), a: +ml.packet.a.toFixed(4) },
    shop: { m: bill(ml.shop.pos), a: +ml.shop.a.toFixed(4) },
    home: { m: bill(ml.home.pos), a: +ml.home.a.toFixed(4) },
    ticket: { m: bill(ml.ticket.pos), a: +ml.ticket.a.toFixed(4) },
    eta: { m: bill(ml.eta.pos), a: +ml.eta.a.toFixed(4) },
    scooter: {
      m: arr(new THREE.Matrix4().makeTranslation(...ml.scooter.pos)
        .multiply(new THREE.Matrix4().makeRotationY(ml.scooter.yaw))
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))),
      a: +ml.scooter.a.toFixed(4),
    },
  };

  frames.push({
    map,
    cam: arr(camObj.matrixWorld), fov: c.fov, focus: +focusDist.toFixed(5),
    phone: phoneM, holo: { on: +hl.on.toFixed(4), visible: hl.visible, beam, items, parts },
    tray, flicker: +(1 + wobble(f * 3, 9, 0.18)).toFixed(4),
  });
}
writeFileSync(`${dir}/anim_${variant}.json`, JSON.stringify({
  fps: 30, dur: DUR, items: ITEMS,
  variant, cityRange: T.city,
  mapDef: { origin: MAP_ORIGIN, w: MAP_W, d: MAP_D, shop: SHOP, home: HOME, route: ROUTE },
  frames,
}));
console.log('frames', frames.length);
