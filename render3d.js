/* ============ render3d.js — Tesla-display-style 3D chase view ============
   Minimal flat-shaded world with fog, glowing route, camera behind the bike.
   World coords: game (x, y[south+]) → three (x, z). Heights on y. */
"use strict";

const R3 = {
  ready: false, failed: false,
  scene: null, camera: null, renderer: null,
  pools: {}, player: null, routeLine: null, pin: null, pinRing: null,
  routeSig: "", camPos: null, camLook: null,
};

function col3(hex) { return new THREE.Color(hex); }

function init3D() {
  if (R3.ready || R3.failed) return;
  if (typeof THREE === "undefined" || !W.ready) { return; }
  try {
    const canvas = document.getElementById("game3d");
    R3.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    R3.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    R3.renderer.setSize(innerWidth, innerHeight, false);
    R3.scene = new THREE.Scene();
    R3.scene.background = col3(0x171420);
    R3.scene.fog = new THREE.Fog(0x171420, 70, 330);
    R3.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 700);
    R3.camPos = new THREE.Vector3(0, 8, 0);
    R3.camLook = new THREE.Vector3(0, 0, 0);

    R3.scene.add(new THREE.AmbientLight(0x9090b8, 0.85));
    const sun = new THREE.DirectionalLight(0xffd9a8, 0.9);
    sun.position.set(120, 220, -80);
    R3.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5a6aa8, 0.35);
    fill.position.set(-100, 120, 140);
    R3.scene.add(fill);

    buildStatic3D();
    buildPools3D();
    addEventListener("resize", () => {
      if (!R3.ready) return;
      R3.renderer.setSize(innerWidth, innerHeight, false);
      R3.camera.aspect = innerWidth / innerHeight;
      R3.camera.updateProjectionMatrix();
    });
    R3.ready = true;
  } catch (e) {
    console.warn("3D init failed", e);
    R3.failed = true;
  }
}

/* ---------- static world ---------- */
function makeInstanced(geo, count, opts) {
  const mat = new THREE.MeshLambertMaterial(Object.assign({ }, opts));
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  R3.scene.add(im);
  return im;
}

function buildStatic3D() {
  const dummy = new THREE.Object3D();

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshLambertMaterial({ color: 0x2b2533 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  R3.scene.add(ground);

  // roads + sidewalks as flat ribbons per segment
  const ribbon = new THREE.PlaneGeometry(1, 1);
  ribbon.rotateX(-Math.PI / 2);
  const sidewalks = makeInstanced(ribbon, W.segs.length, { color: 0x474050 });
  const roads = makeInstanced(ribbon.clone(), W.segs.length, { color: 0x232028 });
  W.segs.forEach((s, i) => {
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
    const half = ROAD_HALF[s.cls];
    dummy.position.set(mx, 0.01, my);
    dummy.rotation.set(0, -s.ang, 0);
    dummy.scale.set(s.len + half * 2, 1, (half + SIDEWALK) * 2);
    dummy.updateMatrix();
    sidewalks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.02;
    dummy.scale.set(s.len + half * 1.6, 1, half * 2);
    dummy.updateMatrix();
    roads.setMatrixAt(i, dummy.matrix);
  });

  // crosswalk bars
  const cwGeo = new THREE.PlaneGeometry(2.2, 0.55);
  cwGeo.rotateX(-Math.PI / 2);
  let cwCount = 0;
  W.crosswalks.forEach(cw => { cwCount += Math.ceil((cw.half * 2 - 1.2) / 1.15); });
  const cwIM = makeInstanced(cwGeo, cwCount, { color: 0x5a5560 });
  let ci = 0;
  W.crosswalks.forEach(cw => {
    for (let yy = -cw.half + 0.7; yy <= cw.half - 0.5; yy += 1.15) {
      const ox = cw.x - Math.sin(cw.ang) * yy, oy = cw.y + Math.cos(cw.ang) * yy;
      dummy.position.set(ox, 0.035, oy);
      dummy.rotation.set(0, -cw.ang, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      cwIM.setMatrixAt(ci++, dummy.matrix);
    }
  });

  // buildings: flat-shaded brownstone boxes
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const lots = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    W.lots.length
  );
  W.lots.forEach((lot, i) => {
    const h = 8 + ((i * 2654435761) % 100) / 100 * 7;
    dummy.position.set(lot.x, 0, lot.y);
    dummy.rotation.set(0, -lot.ang, 0);
    dummy.scale.set(lot.w, h, lot.depth);
    dummy.updateMatrix();
    lots.setMatrixAt(i, dummy.matrix);
    lots.setColorAt(i, col3(lot.col));
  });
  lots.instanceColor.needsUpdate = true;
  R3.scene.add(lots);

  // trees: canopy spheres + slim trunks
  const canopy = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    W.trees.length
  );
  W.trees.forEach((tr, i) => {
    dummy.position.set(tr.x, 2.6 + tr.r * 0.5, tr.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(tr.r, tr.r * 0.9, tr.r);
    dummy.updateMatrix();
    canopy.setMatrixAt(i, dummy.matrix);
    canopy.setColorAt(i, col3(tr.col));
  });
  canopy.instanceColor.needsUpdate = true;
  R3.scene.add(canopy);
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 2.6, 5);
  trunkGeo.translate(0, 1.3, 0);
  const trunks = makeInstanced(trunkGeo, W.trees.length, { color: 0x4a3a2c });
  W.trees.forEach((tr, i) => {
    dummy.position.set(tr.x, 0, tr.y);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });

  // parked cars
  const pcarGeo = new THREE.BoxGeometry(4.3, 1.35, 1.85);
  pcarGeo.translate(0, 0.7, 0);
  const parked = new THREE.InstancedMesh(
    pcarGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    W.parked.length
  );
  W.parked.forEach((pc, i) => {
    dummy.position.set(pc.x, 0, pc.y);
    dummy.rotation.set(0, -pc.ang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    parked.setMatrixAt(i, dummy.matrix);
    parked.setColorAt(i, col3(pc.col));
  });
  parked.instanceColor.needsUpdate = true;
  R3.scene.add(parked);

  // street lamps: warm points on poles (sparse, near player handled by fog)
  const lampGeo = new THREE.SphereGeometry(0.22, 6, 4);
  const lampIM = new THREE.InstancedMesh(
    lampGeo,
    new THREE.MeshBasicMaterial({ color: 0xffc878 }),
    W.lamps.length
  );
  W.lamps.forEach((l, i) => {
    dummy.position.set(l.x, 5.4, l.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lampIM.setMatrixAt(i, dummy.matrix);
  });
  R3.scene.add(lampIM);

  // route line (updated per frame when it changes)
  const routeGeo = new THREE.BufferGeometry();
  routeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 400), 3));
  R3.routeLine = new THREE.Line(routeGeo, new THREE.LineBasicMaterial({ color: 0x3fd8ff }));
  R3.routeLine.frustumCulled = false;
  R3.scene.add(R3.routeLine);

  // destination pin: floating cone + ground ring
  const pinGroup = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 3, 12),
    new THREE.MeshBasicMaterial({ color: 0xff4d2e })
  );
  cone.rotation.x = Math.PI;
  cone.position.y = 8;
  pinGroup.add(cone);
  R3.pinCone = cone;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 4.2, 28),
    new THREE.MeshBasicMaterial({ color: 0xff4d2e, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  pinGroup.add(ring);
  R3.pinRing = ring;
  R3.pin = pinGroup;
  R3.scene.add(pinGroup);
}

/* ---------- dynamic pools ---------- */
function buildPools3D() {
  const mkPool = (n, builder) => {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const g = builder();
      g.visible = false;
      R3.scene.add(g);
      arr.push(g);
    }
    return arr;
  };

  const carBody = new THREE.BoxGeometry(4.4, 1.35, 1.9);
  carBody.translate(0, 0.7, 0);
  const carTop = new THREE.BoxGeometry(2.2, 0.75, 1.65);
  carTop.translate(-0.15, 1.75, 0);
  R3.pools.cars = mkPool(60, () => {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    g.add(new THREE.Mesh(carBody, m));
    const top = new THREE.Mesh(carTop, new THREE.MeshLambertMaterial({ color: 0x1c1a24 }));
    g.add(top);
    g.userData.mat = m;
    return g;
  });

  const busBody = new THREE.BoxGeometry(11, 2.9, 2.55);
  busBody.translate(0, 1.5, 0);
  R3.pools.buses = mkPool(70, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(busBody, new THREE.MeshLambertMaterial({ color: 0x2a3f8f })));
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(11.02, 0.7, 2.57),
      new THREE.MeshLambertMaterial({ color: 0xe9e4d6 })
    );
    stripe.position.y = 2.6;
    g.add(stripe);
    return g;
  });

  const pedBody = new THREE.CapsuleGeometry(0.34, 0.85, 3, 8);
  pedBody.translate(0, 0.95, 0);
  const pedHead = new THREE.SphereGeometry(0.26, 8, 6);
  pedHead.translate(0, 1.78, 0);
  R3.pools.peds = mkPool(80, () => {
    const g = new THREE.Group();
    const bm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const hm = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
    g.add(new THREE.Mesh(pedBody, bm));
    g.add(new THREE.Mesh(pedHead, hm));
    g.userData.mat = bm; g.userData.hair = hm;
    return g;
  });

  // rival riders + player bike share a builder
  const mkBike = (detailed) => {
    const g = new THREE.Group();
    const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.09, 10);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x15121c });
    const w1 = new THREE.Mesh(wheelGeo, wheelMat); w1.position.set(0.72, 0.34, 0); g.add(w1);
    const w2 = new THREE.Mesh(wheelGeo, wheelMat); w2.position.set(-0.72, 0.34, 0); g.add(w2);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.09, 0.09),
      new THREE.MeshLambertMaterial({ color: 0xcfc9ba })
    );
    frame.position.y = 0.5;
    g.add(frame);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2f6db5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 3, 8), bodyMat);
    body.position.set(0.05, 1.15, 0);
    body.rotation.z = -0.5;
    g.add(body);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x1c1c22 })
    );
    helmet.position.set(0.42, 1.62, 0);
    g.add(helmet);
    const bagMat = new THREE.MeshLambertMaterial({ color: 0xff4d2e });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), bagMat);
    bag.position.set(-0.85, 1.05, 0);
    g.add(bag);
    g.userData.jacket = bodyMat;
    g.userData.bag = bagMat;
    if (detailed) {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
      );
      light.position.set(1.0, 0.75, 0);
      g.add(light);
    }
    return g;
  };
  R3.pools.riders = mkPool(20, () => mkBike(false));
  R3.player = mkBike(true);
  R3.player.visible = true;
  R3.scene.add(R3.player);

  // walking player: reuse a ped-style capsule with the bag
  const wg = new THREE.Group();
  const wBody = new THREE.Mesh(pedBody.clone(), new THREE.MeshLambertMaterial({ color: 0x2f6db5 }));
  wg.add(wBody);
  const wHead = new THREE.Mesh(pedHead.clone(), new THREE.MeshLambertMaterial({ color: 0x1c1c22 }));
  wg.add(wHead);
  const wBag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0xff4d2e }));
  wBag.position.set(-0.4, 1.1, 0);
  wg.add(wBag);
  wg.visible = false;
  R3.scene.add(wg);
  R3.walker = wg;

  // signal heads: emissive spheres near intersections
  R3.pools.signals = mkPool(90, () => new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x4dd06a })
  ));
}

/* ---------- per-frame ---------- */
function place(g, x, y, ang) {
  g.visible = true;
  g.position.set(x, 0, y);
  g.rotation.y = -ang;
}

function render3D(P, S, tp) {
  if (!R3.ready) { init3D(); if (!R3.ready) return false; }

  // player
  if (P.riding) {
    R3.player.visible = true;
    R3.walker.visible = false;
    place(R3.player, P.x, P.y, P.ang);
    R3.player.rotation.z = -(P.steer || 0) * 0.28;
  } else {
    R3.player.visible = false;
    R3.walker.visible = true;
    place(R3.walker, P.x, P.y, P.ang);
    // bike stays parked where it was left
  }

  // chase camera: behind and above, looking down the street ahead
  const hx = Math.cos(P.ang), hy = Math.sin(P.ang);
  const back = P.riding ? 13 : 9;
  const height = P.riding ? 6.2 : 5;
  const tx = P.x - hx * back, ty = P.y - hy * back;
  R3.camPos.lerp(new THREE.Vector3(tx, height, ty), 0.09);
  // keep the camera from lagging through buildings too far: clamp distance
  R3.camera.position.copy(R3.camPos);
  R3.camLook.lerp(new THREE.Vector3(P.x + hx * 9, 1.2, P.y + hy * 9), 0.14);
  R3.camera.lookAt(R3.camLook);

  // cars
  const cars = R3.pools.cars;
  cars.forEach(g => g.visible = false);
  Traffic.cars.forEach((car, i) => {
    if (i >= cars.length) return;
    const cp = carPos(car);
    place(cars[i], cp.x, cp.y, cp.ang);
    cars[i].userData.mat.color.set(car.col);
  });

  // buses
  const buses = R3.pools.buses;
  buses.forEach(g => g.visible = false);
  Buses.list.forEach((bus, i) => {
    if (i >= buses.length) return;
    const bp = busPos(bus);
    place(buses[i], bp.x, bp.y, bp.ang);
  });

  // peds
  const peds = R3.pools.peds;
  peds.forEach(g => g.visible = false);
  Traffic.peds.forEach((ped, i) => {
    if (i >= peds.length) return;
    const pp = pedPos(ped);
    place(peds[i], pp.x, pp.y, Math.atan2(ped.hy, ped.hx));
    peds[i].userData.mat.color.set(ped.col);
    peds[i].userData.hair.color.set(ped.hair);
  });

  // rival riders
  const riders = R3.pools.riders;
  riders.forEach(g => g.visible = false);
  Traffic.riders.forEach((r, i) => {
    if (i >= riders.length) return;
    const rp = riderPos(r);
    place(riders[i], rp.x, rp.y, rp.ang);
    riders[i].userData.jacket.color.set(r.jacket);
    riders[i].userData.bag.color.set(r.bag);
  });

  // signals: nearest lights, NS + EW heads
  const sigs = R3.pools.signals;
  sigs.forEach(g => g.visible = false);
  let si = 0;
  for (const light of W.lights) {
    const d = Math.hypot(light.x - P.x, light.y - P.y);
    if (d > 160) continue;
    if (si >= sigs.length - 1) break;
    const stNS = lightState(light, Math.PI / 2, S.gameT);
    const stEW = lightState(light, 0, S.gameT);
    const cNS = stNS === "g" ? 0x4dd06a : stNS === "y" ? 0xffd24d : 0xff4d4d;
    const cEW = stEW === "g" ? 0x4dd06a : stEW === "y" ? 0xffd24d : 0xff4d4d;
    const a = sigs[si++], b = sigs[si++];
    a.visible = true; a.position.set(light.x - 2.6, 4.6, light.y - 2.6); a.material.color.set(cNS);
    b.visible = true; b.position.set(light.x + 2.6, 4.6, light.y - 2.6); b.material.color.set(cEW);
  }

  // route line + pin
  const route = S.route;
  const sig = route ? route.length + ":" + route[0] + ":" + route[route.length - 1] : "none";
  if (sig !== R3.routeSig) {
    R3.routeSig = sig;
    const posAttr = R3.routeLine.geometry.getAttribute("position");
    if (route && route.length > 1) {
      const n = Math.min(route.length, 400);
      for (let i = 0; i < n; i++) {
        const p = W.nodes[route[i]];
        posAttr.setXYZ(i, p[0], 0.25, p[1]);
      }
      R3.routeLine.geometry.setDrawRange(0, n);
      R3.routeLine.visible = true;
    } else {
      R3.routeLine.visible = false;
    }
    posAttr.needsUpdate = true;
  }
  if (tp) {
    R3.pin.visible = true;
    R3.pin.position.set(tp.x, 0, tp.y);
    const isDrop = S.phase === "todrop" || S.phase === "walking";
    const c = isDrop ? 0x5fd685 : 0xff4d2e;
    R3.pinCone.material.color.set(c);
    R3.pinRing.material.color.set(c);
    R3.pinCone.position.y = 8 + Math.sin(S.t * 3) * 0.9;
    R3.pinCone.rotation.y = S.t * 2;
    const pu = 1 + Math.sin(S.t * 5) * 0.18;
    R3.pinRing.scale.set(pu, pu, 1);
  } else R3.pin.visible = false;

  R3.renderer.render(R3.scene, R3.camera);
  return true;
}
