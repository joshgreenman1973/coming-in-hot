/* ============ render3d.js — 3D chase view, v2: character pass ============
   Flat-shaded night Brooklyn: brownstone facades with lit windows, lamps on
   poles with light pools, NYC signal heads, a real pedaling cyclist, painted
   street names, awnings, stars, rain and comic bursts.
   World coords: game (x, y[south+]) → three (x, z). Heights on y. */
"use strict";

const R3 = {
  ready: false, failed: false,
  scene: null, camera: null, renderer: null,
  pools: {}, player: null, routeLine: null, pin: null, pinCone: null, pinRing: null,
  routeSig: "", camPos: null, camLook: null, rain: null,
};

function col3(hex) { return new THREE.Color(hex); }

/* ---------- canvas textures ---------- */
function facadeTextures(seedN) {
  let seed = seedN;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const Wc = 192, Hc = 256;
  const map = document.createElement("canvas"); map.width = Wc; map.height = Hc;
  const em = document.createElement("canvas"); em.width = Wc; em.height = Hc;
  const g = map.getContext("2d"), e = em.getContext("2d");
  g.fillStyle = "#cfc5ba"; g.fillRect(0, 0, Wc, Hc);
  e.fillStyle = "#000"; e.fillRect(0, 0, Wc, Hc);
  // subtle brick striation
  for (let y = 0; y < Hc; y += 6) {
    g.fillStyle = "rgba(0,0,0," + (0.02 + rnd() * 0.02) + ")";
    g.fillRect(0, y, Wc, 1);
  }
  // cornice with dentils + base band
  g.fillStyle = "#a89a8a"; g.fillRect(0, 0, Wc, 14);
  g.fillStyle = "#8f8274";
  for (let x = 2; x < Wc; x += 12) g.fillRect(x, 9, 7, 5);
  g.fillStyle = "#93866f"; g.fillRect(0, 14, Wc, 2);
  g.fillStyle = "#b2a695"; g.fillRect(0, Hc - 16, Wc, 16);
  // 4 floors × 4 windows, ground floor gets a door
  for (let r = 0; r < 4; r++) {
    const y = 26 + r * 54;
    // floor line
    g.fillStyle = "rgba(0,0,0,.05)"; g.fillRect(0, y + 44, Wc, 2);
    for (let c = 0; c < 4; c++) {
      const x = 12 + c * 46;
      if (r === 3 && (c === 1)) {
        // stoop door
        g.fillStyle = "#e2d9cc"; g.fillRect(x - 3, y - 6, 32, 4);
        g.fillStyle = "#2e2016"; g.fillRect(x, y - 2, 26, 44);
        g.fillStyle = "#4a382a"; g.fillRect(x + 11, y - 2, 3, 44);
        g.fillStyle = "#c8b06a"; g.fillRect(x + 7, y + 22, 2, 4); g.fillRect(x + 17, y + 22, 2, 4);
        e.fillStyle = "#6a4f28"; e.fillRect(x + 2, y, 22, 6); // transom glow
        continue;
      }
      // lintel + sill
      g.fillStyle = "#e2d9cc"; g.fillRect(x - 3, y - 5, 32, 4);
      g.fillStyle = "#bdb0a0"; g.fillRect(x - 3, y + 36, 32, 3);
      // frame + panes
      g.fillStyle = "#3d332b"; g.fillRect(x, y, 26, 36);
      g.fillStyle = "#4f4238"; g.fillRect(x + 2, y + 2, 22, 32);
      g.fillStyle = "#3d332b"; g.fillRect(x + 12, y, 2, 36); g.fillRect(x, y + 17, 26, 2);
      const lit = rnd() < 0.33;
      if (lit) {
        const warm = ["#ffd9a0", "#ffcf8e", "#f5e2b8"][(rnd() * 3) | 0];
        e.fillStyle = warm; e.fillRect(x + 2, y + 2, 22, 32);
        e.fillStyle = "rgba(0,0,0,.35)"; e.fillRect(x + 12, y, 2, 36); e.fillRect(x, y + 17, 26, 2);
        if (rnd() < 0.3) { e.fillStyle = "rgba(0,0,0,.6)"; e.fillRect(x + 4, y + 20, 8, 14); } // figure/curtain
      }
      // window AC unit
      if (rnd() < 0.2) {
        g.fillStyle = "#8a8578"; g.fillRect(x + 6, y + 26, 14, 10);
        g.fillStyle = "#6f6a5e"; g.fillRect(x + 6, y + 30, 14, 2);
        g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(x + 5, y + 36, 16, 2);
        e.fillStyle = "#000"; e.fillRect(x + 6, y + 26, 14, 10);
      }
    }
  }
  // fire escape on some variants: rails, platforms, diagonal stairs
  if (rnd() < 0.6) {
    const fx = 58 + (rnd() * 40 | 0);
    g.strokeStyle = "rgba(30,24,20,.6)"; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(fx, 20); g.lineTo(fx, 210);
    g.moveTo(fx + 40, 20); g.lineTo(fx + 40, 210);
    for (let r = 0; r < 3; r++) {
      const py = 62 + r * 54;
      g.moveTo(fx - 6, py); g.lineTo(fx + 46, py);
      g.moveTo(fx + 40, py); g.lineTo(fx, py + 42);
    }
    g.stroke();
  }
  const mapT = new THREE.CanvasTexture(map);
  const emT = new THREE.CanvasTexture(em);
  return { mapT, emT };
}

/* rounded, beveled car-body slab — Tesla-display softness */
function roundedSlab(len, wid, h, r, yOff) {
  const s = new THREE.Shape();
  const hw = len / 2, hd = wid / 2;
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r); s.quadraticCurveTo(hw, hd, hw - r, hd);
  s.lineTo(-hw + r, hd); s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  s.lineTo(-hw, -hd + r); s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: h, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.08,
    bevelSegments: 2, curveSegments: 5,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, yOff, 0);
  return g;
}

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,200,120,.55)");
  grad.addColorStop(0.5, "rgba(255,180,90,.18)");
  grad.addColorStop(1, "rgba(255,170,80,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const emojiTexCache = {};
function emojiTexture(ch) {
  if (emojiTexCache[ch]) return emojiTexCache[ch];
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  g.font = "52px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(ch, 32, 36);
  const t = new THREE.CanvasTexture(c);
  emojiTexCache[ch] = t;
  return t;
}

function init3D() {
  if (R3.ready || R3.failed) return;
  if (typeof THREE === "undefined" || !W.ready) { return; }
  try {
    const canvas = document.getElementById("game3d");
    R3.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    R3.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    R3.renderer.setSize(innerWidth, innerHeight, false);
    // rich color instead of washed linear output
    R3.renderer.outputEncoding = THREE.sRGBEncoding;
    R3.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    R3.renderer.toneMappingExposure = 0.78;
    R3.scene = new THREE.Scene();
    R3.scene.background = col3(0x0d0b16);
    R3.scene.fog = new THREE.Fog(0x0d0b16, 70, 340);
    R3.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 1600);
    R3.camPos = new THREE.Vector3(0, 8, 0);
    R3.camLook = new THREE.Vector3(0, 0, 0);

    R3.scene.add(new THREE.AmbientLight(0x8888b0, 0.5));
    const sun = new THREE.DirectionalLight(0xffd9a8, 0.75);
    sun.position.set(120, 220, -80);
    R3.scene.add(sun);
    R3.sun = sun;
    const fill = new THREE.DirectionalLight(0x5a6aa8, 0.3);
    fill.position.set(-100, 120, 140);
    R3.scene.add(fill);
    // real shadows ground the world (skipped on touch devices for perf)
    R3.shadows = !matchMedia("(pointer: coarse)").matches;
    if (R3.shadows) {
      R3.renderer.shadowMap.enabled = true;
      R3.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
      sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
      sun.shadow.camera.near = 20; sun.shadow.camera.far = 620;
      sun.shadow.bias = -0.0006;
      R3.scene.add(sun.target);
    }
    // retro pipeline: render small, upscale with fat crisp pixels + palette crush
    R3.blitScene = new THREE.Scene();
    R3.blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    R3.blitMat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tex; varying vec2 vUv;",
        "void main(){",
        "  vec3 c = texture2D(tex, vUv).rgb;",
        "  float l = dot(c, vec3(0.299, 0.587, 0.114));",
        "  c = mix(vec3(l), c, 1.45);",              // saturation punch
        "  c = (c - 0.5) * 1.04 + 0.55;",            // gentle contrast + shadow lift
        "  c = floor(c * 9.0 + 0.5) / 9.0;",         // 16-bit-ish banding
        "  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);",
        "}",
      ].join("\n"),
      depthTest: false, depthWrite: false,
    });
    R3.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), R3.blitMat));
    R3.makeRT = () => {
      if (R3.rt) R3.rt.dispose();
      const s = Math.max(300, Math.round(innerWidth / 3.4));
      R3.rt = new THREE.WebGLRenderTarget(s, Math.round(s * innerHeight / innerWidth), {
        magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter,
      });
      R3.blitMat.uniforms.tex.value = R3.rt.texture;
    };
    R3.makeRT();

    buildSky3D();
    buildStatic3D();
    buildPools3D();
    if (R3.shadows) {
      R3.scene.traverse(o => {
        if ((o.isMesh || o.isInstancedMesh) && o.material &&
            !o.material.transparent && !o.material.isShaderMaterial) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }
    addEventListener("resize", () => {
      if (!R3.ready) return;
      R3.renderer.setSize(innerWidth, innerHeight, false);
      R3.camera.aspect = innerWidth / innerHeight;
      R3.camera.updateProjectionMatrix();
      R3.makeRT();
    });
    R3.ready = true;
  } catch (e) {
    console.warn("3D init failed", e);
    R3.failed = true;
  }
}

/* ---------- sky: stars + moon ---------- */
function buildSky3D() {
  const n = 420;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 700 + Math.random() * 500;
    const elev = 0.12 + Math.random() * 1.3;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(elev) * r * 0.7 + 60;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xcdd6ee, size: 1.6, sizeAttenuation: false, fog: false,
    transparent: true, opacity: 0.8,
  }));
  R3.stars = stars;
  R3.scene.add(stars);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf5ead0, fog: false }));
  moon.scale.set(150, 150, 1);
  moon.position.set(650, 420, -700);
  R3.moon = moon;
  R3.scene.add(moon);
}

/* ---------- static world ---------- */
function makeInstanced(geo, count, opts) {
  const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(opts || {}), count);
  im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  R3.scene.add(im);
  return im;
}

function buildStatic3D() {
  const dummy = new THREE.Object3D();

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.MeshLambertMaterial({ color: 0x2b2533 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  R3.scene.add(ground);

  // roads + sidewalks
  const ribbon = new THREE.PlaneGeometry(1, 1);
  ribbon.rotateX(-Math.PI / 2);
  const sidewalks = makeInstanced(ribbon, W.segs.length, { color: 0x474050 });
  const curbs = makeInstanced(ribbon.clone(), W.segs.length, { color: 0x5c5765 });
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
    dummy.position.y = 0.016;
    dummy.scale.set(s.len + half * 1.8, 1, half * 2 + 0.7);
    dummy.updateMatrix();
    curbs.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.022;
    dummy.scale.set(s.len + half * 1.6, 1, half * 2);
    dummy.updateMatrix();
    roads.setMatrixAt(i, dummy.matrix);
  });

  // center-line dashes on the bigger streets
  const bigSegs = W.segs.filter(s => s.cls >= 2 && s.len > 20);
  let dashCount = 0;
  bigSegs.forEach(s => dashCount += Math.floor(s.len / 9));
  const dashGeo = new THREE.PlaneGeometry(3.4, 0.32);
  dashGeo.rotateX(-Math.PI / 2);
  const dashes = makeInstanced(dashGeo, dashCount, { color: 0x8a8060 });
  let di = 0;
  bigSegs.forEach(s => {
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
    for (let d = 6; d < s.len - 4; d += 9) {
      dummy.position.set(pa[0] + ux * d, 0.03, pa[1] + uy * d);
      dummy.rotation.set(0, -s.ang, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dashes.setMatrixAt(di++, dummy.matrix);
    }
  });

  // bike lanes (green strips, offset right of travel)
  const laneSegs = W.segs.filter(s => (W.ways[s.way].cycle || s.cls === 3) && s.len > 12);
  const laneGeo = new THREE.PlaneGeometry(1, 1.5);
  laneGeo.rotateX(-Math.PI / 2);
  const lanes = makeInstanced(laneGeo, laneSegs.length, { color: 0x2f6b44, transparent: true, opacity: 0.65 });
  laneSegs.forEach((s, i) => {
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
    const off = ROAD_HALF[s.cls] - 2.4;
    dummy.position.set((pa[0] + pb[0]) / 2 - uy * off, 0.028, (pa[1] + pb[1]) / 2 + ux * off);
    dummy.rotation.set(0, -s.ang, 0);
    dummy.scale.set(s.len, 1, 1);
    dummy.updateMatrix();
    lanes.setMatrixAt(i, dummy.matrix);
  });

  // crosswalk bars
  const cwGeo = new THREE.PlaneGeometry(2.2, 0.55);
  cwGeo.rotateX(-Math.PI / 2);
  let cwCount = 0;
  W.crosswalks.forEach(cw => { cwCount += Math.ceil((cw.half * 2 - 1.2) / 1.15); });
  const cwIM = makeInstanced(cwGeo, cwCount, { color: 0x5f5a66 });
  let ci = 0;
  W.crosswalks.forEach(cw => {
    for (let yy = -cw.half + 0.7; yy <= cw.half - 0.5; yy += 1.15) {
      dummy.position.set(cw.x - Math.sin(cw.ang) * yy, 0.035, cw.y + Math.cos(cw.ang) * yy);
      dummy.rotation.set(0, -cw.ang, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      cwIM.setMatrixAt(ci++, dummy.matrix);
    }
  });

  // painted street names on the roadway (atlas, one mesh)
  buildLabels3D();

  // buildings: two facade variants for texture variety, plain roofs
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const lotSets = [[], []];
  W.lots.forEach((lot, i) => lotSets[(i * 7 + (lot.si || 0)) % 2].push([lot, i]));
  lotSets.forEach((set, vi) => {
    const { mapT, emT } = facadeTextures(vi ? 4241 : 977);
    const facadeMat = new THREE.MeshLambertMaterial({
      map: mapT, emissive: 0xffb060, emissiveIntensity: 0.85, emissiveMap: emT,
    });
    const im = new THREE.InstancedMesh(boxGeo, [facadeMat, facadeMat, roofMat, roofMat, facadeMat, facadeMat], set.length);
    set.forEach(([lot, li], i) => {
      const rowSeed = (((lot.si || 0) * 2 + (lot.side + 3) / 2) * 2654435761 % 100) / 100;
      const h = 11.5 + rowSeed * 2 + ((li * 97) % 10) / 10 * 0.3;
      dummy.position.set(lot.x, 0, lot.y);
      dummy.rotation.set(0, -lot.ang, 0);
      dummy.scale.set(lot.w, h, lot.depth);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, col3(lot.col).multiplyScalar(2.1));
    });
    im.instanceColor.needsUpdate = true;
    R3.scene.add(im);
  });

  // sidewalk sheds: scaffolding over a few storefronts (it is New York)
  const shedLots = [];
  W.lots.forEach((lot, i) => { if (((lot.si || 0) * 13 + i * 29) % 100 < 4) shedLots.push(lot); });
  const shedRoof = new THREE.BoxGeometry(1, 0.28, 3.4);
  const shedRoofIM = new THREE.InstancedMesh(shedRoof, new THREE.MeshLambertMaterial({ color: 0x3f6a4a }), shedLots.length);
  const shedLeg = new THREE.CylinderGeometry(0.05, 0.05, 3.5, 5);
  shedLeg.translate(0, 1.75, 0);
  const shedLegIM = makeInstanced(shedLeg, shedLots.length * 4, { color: 0x8a8578 });
  shedLots.forEach((lot, i) => {
    const nx = -Math.sin(lot.ang), ny = Math.cos(lot.ang);
    const ux = Math.cos(lot.ang), uy = Math.sin(lot.ang);
    const out = lot.depth / 2 + 1.9;
    const cx = lot.x - nx * lot.side * out, cy = lot.y - ny * lot.side * out;
    dummy.position.set(cx, 3.6, cy);
    dummy.rotation.set(0, -lot.ang, 0);
    dummy.scale.set(lot.w + 1.2, 1, 1);
    dummy.updateMatrix();
    shedRoofIM.setMatrixAt(i, dummy.matrix);
    let k = 0;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      dummy.position.set(
        cx + ux * su * (lot.w / 2 + 0.4) + nx * sv * 1.45,
        0,
        cy + uy * su * (lot.w / 2 + 0.4) + ny * sv * 1.45
      );
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      shedLegIM.setMatrixAt(i * 4 + k++, dummy.matrix);
    }
  });
  R3.scene.add(shedRoofIM);

  // corner mailboxes
  const boxes = [];
  W.lights.forEach((l, li) => {
    if (l.corners && l.corners.length === 2 && li % 7 === 0) boxes.push(l.corners[0]);
  });
  const mbGeo = new THREE.BoxGeometry(0.62, 1.05, 0.55);
  mbGeo.translate(0, 0.53, 0);
  const mbIM = makeInstanced(mbGeo, boxes.length, { color: 0x2a4a9a });
  boxes.forEach((c, i) => {
    dummy.position.set(c.x + 1.2, 0, c.y + 1.2);
    dummy.rotation.set(0, -c.ang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mbIM.setMatrixAt(i, dummy.matrix);
  });

  // bus stop signs at the real stop spacing
  const busSigns = [];
  W.busRoutes.forEach((route, ri) => {
    for (let s = 140; s < route.len - 60; s += 260 + (ri * 37) % 90) {
      let lo = 0, hi = route.cum.length - 1;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (route.cum[mid] <= s) lo = mid; else hi = mid; }
      const segLen = route.cum[lo + 1] - route.cum[lo] || 1;
      const f = (s - route.cum[lo]) / segLen;
      const a = route.pts[lo], b = route.pts[lo + 1];
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const ux = (b[0] - a[0]) / segLen, uy = (b[1] - a[1]) / segLen;
      const st = closestStreet(x, y);
      const off = st ? ROAD_HALF[W.segs[st.seg].cls] + 1.1 : 6;
      busSigns.push({ x: x - uy * off, y: y + ux * off });
    }
  });
  const bsPole = new THREE.CylinderGeometry(0.045, 0.045, 3.0, 5);
  bsPole.translate(0, 1.5, 0);
  const bsPoleIM = makeInstanced(bsPole, busSigns.length, { color: 0x8a8578 });
  const bsSign = new THREE.BoxGeometry(0.5, 0.62, 0.06);
  bsSign.translate(0, 2.75, 0);
  const bsSignIM = makeInstanced(bsSign, busSigns.length, { color: 0x1f3a93 });
  busSigns.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bsPoleIM.setMatrixAt(i, dummy.matrix);
    bsSignIM.setMatrixAt(i, dummy.matrix);
  });

  // stoops on the residential rows
  const stoopLots = W.lots.filter((l, i) => l.cls === 1 && ((l.si * 7 + i * 13) % 10) < 7);
  const stoopMat = new THREE.MeshLambertMaterial({ color: 0x5a4433 });
  const stepHeights = [0.88, 0.6, 0.32];
  for (let k = 0; k < 3; k++) {
    const stepGeo = new THREE.BoxGeometry(1.75, 1, 0.56);
    stepGeo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(stepGeo, stoopMat, stoopLots.length);
    im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    stoopLots.forEach((lot, i) => {
      const nx = -Math.sin(lot.ang), ny = Math.cos(lot.ang);
      const out = lot.depth / 2 + 0.32 + k * 0.56;
      dummy.position.set(lot.x - nx * lot.side * out, 0, lot.y - ny * lot.side * out);
      dummy.rotation.set(0, -lot.ang, 0);
      dummy.scale.set(1, stepHeights[k], 1);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    R3.scene.add(im);
  }

  // rooftop water towers — the Brooklyn skyline signature
  const towerLots = [];
  W.lots.forEach((lot, i) => { if ((i * 31 + (lot.si || 0) * 7) % 12 === 0) towerLots.push([lot, i]); });
  const lotH = (lot, i) => {
    const rowSeed = (((lot.si || 0) * 2 + (lot.side + 3) / 2) * 2654435761 % 100) / 100;
    return 11.5 + rowSeed * 2 + ((i * 97) % 10) / 10 * 0.3;
  };
  const twBody = new THREE.CylinderGeometry(1.5, 1.7, 2.6, 9);
  const twBodyIM = makeInstanced(twBody, towerLots.length, { color: 0x6b4c36 });
  const twRoof = new THREE.ConeGeometry(1.85, 1.2, 9);
  const twRoofIM = makeInstanced(twRoof, towerLots.length, { color: 0x463225 });
  const twLegs = new THREE.CylinderGeometry(0.9, 1.15, 1.1, 6);
  const twLegsIM = makeInstanced(twLegs, towerLots.length, { color: 0x2e2a34 });
  towerLots.forEach(([lot, li], i) => {
    const h = lotH(lot, li);
    dummy.rotation.set(0, -lot.ang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(lot.x, h + 0.55, lot.y);
    dummy.updateMatrix(); twLegsIM.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lot.x, h + 2.4, lot.y);
    dummy.updateMatrix(); twBodyIM.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lot.x, h + 4.3, lot.y);
    dummy.updateMatrix(); twRoofIM.setMatrixAt(i, dummy.matrix);
  });

  // curbside trash-bag piles + fire hydrants
  const trash = [];
  const hydrants = [];
  {
    let seed = 77;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    W.segs.forEach((s, si) => {
      if (s.len < 30) return;
      const pa = W.nodes[s.a], pb = W.nodes[s.b];
      const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
      const nx = -uy, ny = ux;
      const curb = ROAD_HALF[s.cls] + 0.7;
      for (const side of [-1, 1]) {
        if (rnd() < 0.55) {
          const d = 8 + rnd() * (s.len - 16);
          const bx = pa[0] + ux * d + nx * curb * side, by = pa[1] + uy * d + ny * curb * side;
          const n = 1 + (rnd() * 3 | 0);
          for (let k = 0; k < n; k++) {
            trash.push({ x: bx + (rnd() - 0.5) * 1.6, y: by + (rnd() - 0.5) * 1.2, s: 0.34 + rnd() * 0.22 });
          }
        }
        if (s.cls === 1 && rnd() < 0.5) {
          const d = 10 + rnd() * (s.len - 20);
          hydrants.push({
            x: pa[0] + ux * d + nx * (curb + 0.9) * side,
            y: pa[1] + uy * d + ny * (curb + 0.9) * side,
          });
        }
      }
    });
  }
  const bagIM = makeInstanced(new THREE.SphereGeometry(1, 7, 5), trash.length, { color: 0x1e2026 });
  trash.forEach((b, i) => {
    dummy.position.set(b.x, b.s * 0.55, b.y);
    dummy.rotation.set(0, (i * 2.3) % 6.28, 0);
    dummy.scale.set(b.s, b.s * 0.62, b.s * 0.85);
    dummy.updateMatrix();
    bagIM.setMatrixAt(i, dummy.matrix);
  });
  const hydBody = new THREE.CylinderGeometry(0.15, 0.18, 0.55, 7);
  hydBody.translate(0, 0.28, 0);
  const hydIM = makeInstanced(hydBody, hydrants.length, { color: 0x9a5348 });
  const hydCap = new THREE.SphereGeometry(0.16, 6, 5);
  hydCap.translate(0, 0.6, 0);
  const hydCapIM = makeInstanced(hydCap, hydrants.length, { color: 0xb8b2a4 });
  hydrants.forEach((hd, i) => {
    dummy.position.set(hd.x, 0, hd.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hydIM.setMatrixAt(i, dummy.matrix);
    hydCapIM.setMatrixAt(i, dummy.matrix);
  });

  // trees
  const canopy = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    W.trees.length
  );
  W.trees.forEach((tr, i) => {
    dummy.position.set(tr.x, 2.6 + tr.r * 0.5, tr.y);
    dummy.rotation.set(0, (i * 1.7) % 6.28, 0);
    dummy.scale.set(tr.r, tr.r * 0.9, tr.r);
    dummy.updateMatrix();
    canopy.setMatrixAt(i, dummy.matrix);
    canopy.setColorAt(i, col3(tr.col));
  });
  canopy.instanceColor.needsUpdate = true;
  R3.scene.add(canopy);
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 2.9, 5);
  trunkGeo.translate(0, 1.45, 0);
  const trunks = makeInstanced(trunkGeo, W.trees.length, { color: 0x4a3a2c });
  W.trees.forEach((tr, i) => {
    dummy.position.set(tr.x, 0, tr.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });

  // parked cars: rounded body + dark glass cabin
  const pcarGeo = roundedSlab(4.3, 1.82, 0.62, 0.5, 0.28);
  const parked = new THREE.InstancedMesh(pcarGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), W.parked.length);
  const pcabGeo = roundedSlab(2.15, 1.58, 0.42, 0.42, 1.06);
  const parkedCabs = makeInstanced(pcabGeo, W.parked.length, { color: 0x1a1822 });
  W.parked.forEach((pc, i) => {
    dummy.position.set(pc.x, 0, pc.y);
    dummy.rotation.set(0, -pc.ang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    parked.setMatrixAt(i, dummy.matrix);
    parkedCabs.setMatrixAt(i, dummy.matrix);
    parked.setColorAt(i, col3(pc.col));
  });
  parked.instanceColor.needsUpdate = true;
  R3.scene.add(parked);

  // street lamps: pole + head + warm pool of light on the ground
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, 5.3, 5);
  poleGeo.translate(0, 2.65, 0);
  const poles = makeInstanced(poleGeo, W.lamps.length, { color: 0x2e2a34 });
  const headGeo = new THREE.SphereGeometry(0.2, 6, 5);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffc878 }), W.lamps.length);
  const glowT = glowTexture();
  const poolGeo = new THREE.PlaneGeometry(9, 9);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
    map: glowT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), W.lamps.length);
  W.lamps.forEach((l, i) => {
    dummy.position.set(l.x, 0, l.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, 5.35, l.y);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, 0.045, l.y);
    dummy.updateMatrix();
    pools.setMatrixAt(i, dummy.matrix);
  });
  R3.scene.add(heads);
  R3.scene.add(pools);

  // storefront awnings + hanging emoji signs
  const rests = W.restaurants.filter(r => r.fx !== undefined);
  const awnGeo = new THREE.BoxGeometry(3.6, 0.42, 1.5);
  const awnings = new THREE.InstancedMesh(awnGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), rests.length);
  rests.forEach((r, i) => {
    dummy.position.set(r.fx, 2.5, r.fy);
    dummy.rotation.set(0, -r.fang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    awnings.setMatrixAt(i, dummy.matrix);
    awnings.setColorAt(i, col3(r.awn || "#b8443a"));
  });
  awnings.instanceColor.needsUpdate = true;
  R3.scene.add(awnings);
  rests.forEach(r => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(r.emoji || "🍴"), transparent: true }));
    sp.scale.set(1.7, 1.7, 1);
    sp.position.set(r.fx, 3.6, r.fy);
    R3.scene.add(sp);
  });
  // warm storefront glass under each awning
  const shopGeo = new THREE.PlaneGeometry(3.3, 1.8);
  const shopIM = new THREE.InstancedMesh(shopGeo, new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  }), rests.length);
  rests.forEach((r, i) => {
    dummy.position.set(r.fx, 1.15, r.fy);
    dummy.rotation.set(0, -r.fang, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    shopIM.setMatrixAt(i, dummy.matrix);
  });
  R3.scene.add(shopIM);

  // route line + destination pin
  const routeGeo = new THREE.BufferGeometry();
  routeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 400), 3));
  R3.routeLine = new THREE.Line(routeGeo, new THREE.LineBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.9 }));
  R3.routeLine.frustumCulled = false;
  R3.scene.add(R3.routeLine);
  const pinGroup = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 12), new THREE.MeshBasicMaterial({ color: 0xff4d2e }));
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

/* painted street names: texture atlas + one merged quad mesh */
function buildLabels3D() {
  const freq = {};
  W.labels.forEach(l => freq[l.name] = (freq[l.name] || 0) + 1);
  const names = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 96);
  const rows = {};
  const atlas = document.createElement("canvas");
  atlas.width = 1024; atlas.height = 2048;
  const g = atlas.getContext("2d");
  g.font = "700 17px 'IBM Plex Mono', monospace";
  g.fillStyle = "#efe8d8";
  names.forEach((n, i) => {
    const y = i * 21;
    g.fillText(n.toUpperCase(), 4, y + 16);
    rows[n] = { v0: 1 - (y + 21) / 2048, v1: 1 - y / 2048, w: Math.min(1010, g.measureText(n.toUpperCase()).width) };
  });
  const tex = new THREE.CanvasTexture(atlas);
  const labeled = W.labels.filter(l => rows[l.name]);
  const nQ = labeled.length;
  const pos = new Float32Array(nQ * 12);
  const uv = new Float32Array(nQ * 8);
  const idx = new Uint32Array(nQ * 6);
  labeled.forEach((l, i) => {
    const row = rows[l.name];
    const wWorld = row.w * 0.075;             // ~17px glyphs → ~1.3m tall text
    const hWorld = 1.55;
    const ux = Math.cos(l.ang), uy = Math.sin(l.ang);
    const nx = -uy, ny = ux;
    const corners = [
      [l.x - ux * wWorld / 2 - nx * hWorld / 2, l.y - uy * wWorld / 2 - ny * hWorld / 2],
      [l.x + ux * wWorld / 2 - nx * hWorld / 2, l.y + uy * wWorld / 2 - ny * hWorld / 2],
      [l.x + ux * wWorld / 2 + nx * hWorld / 2, l.y + uy * wWorld / 2 + ny * hWorld / 2],
      [l.x - ux * wWorld / 2 + nx * hWorld / 2, l.y - uy * wWorld / 2 + ny * hWorld / 2],
    ];
    corners.forEach((c, k) => {
      pos[i * 12 + k * 3] = c[0];
      pos[i * 12 + k * 3 + 1] = 0.055;
      pos[i * 12 + k * 3 + 2] = c[1];
    });
    const u1 = row.w / 1024;
    const us = [[0, row.v1], [u1, row.v1], [u1, row.v0], [0, row.v0]];
    us.forEach((u, k) => { uv[i * 8 + k * 2] = u[0]; uv[i * 8 + k * 2 + 1] = u[1]; });
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  R3.scene.add(mesh);
}

/* ---------- a real cyclist ---------- */
function mkBike(detailed) {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x15121c });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xb9b2a2 });

  const mkWheel = x => {
    const wg = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 14), dark);
    wg.add(rim);
    for (let k = 0; k < 3; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.025, 0.025), frameMat);
      spoke.rotation.z = k * Math.PI / 3;
      wg.add(spoke);
    }
    wg.position.set(x, 0.34, 0);
    g.add(wg);
    return wg;
  };
  const wF = mkWheel(0.75), wR = mkWheel(-0.75);

  const down = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.07), frameMat);
  down.rotation.z = 0.5; down.position.set(0.2, 0.62, 0); g.add(down);
  const seatT = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.07), frameMat);
  seatT.rotation.z = -1.1; seatT.position.set(-0.32, 0.66, 0); g.add(seatT);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), frameMat);
  top.position.set(0.05, 0.92, 0); g.add(top);
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), frameMat);
  fork.position.set(0.72, 0.66, 0); fork.rotation.z = -0.25; g.add(fork);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.66), dark);
  bar.position.set(0.66, 1.02, 0); g.add(bar);

  // rider: capsule limbs, helmet with visor, hi-vis stripe on the back
  const jacket = new THREE.MeshLambertMaterial({ color: 0x2f6db5 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc9a381 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 3, 8), jacket);
  torso.rotation.z = -0.95;
  torso.position.set(0.08, 1.22, 0);
  g.add(torso);
  const viz = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.5, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xd6f22e })
  );
  viz.rotation.z = -0.95;
  viz.position.set(-0.08, 1.28, 0);
  g.add(viz);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 9, 7), dark);
  helmet.scale.set(1.1, 0.85, 1);
  helmet.position.set(0.52, 1.54, 0);
  g.add(helmet);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), skin);
  face.position.set(0.62, 1.44, 0);
  g.add(face);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 3, 6), jacket);
    arm.position.set(0.38, 1.22, 0.18 * s);
    arm.rotation.z = -2.05;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), skin);
    hand.position.set(0.6, 1.05, 0.2 * s);
    g.add(hand);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(-0.28, 0.92, 0.14 * s);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 3, 6), dark);
    leg.position.y = -0.24;
    hip.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.09), dark);
    shoe.position.set(0.04, -0.47, 0);
    hip.add(shoe);
    g.add(hip);
    legs.push(hip);
  }

  // rack + bag
  const bagMat = new THREE.MeshLambertMaterial({ color: 0xff4d2e });
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58), bagMat);
  bag.position.set(-0.82, 1.02, 0);
  g.add(bag);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), frameMat);
  rack.position.set(-0.78, 0.7, 0);
  g.add(rack);

  if (detailed) {
    const lightM = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
    lightM.position.set(0.95, 0.78, 0);
    g.add(lightM);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.set(4.6, 0.7, 0);
    g.add(beam);
  }
  g.userData = { wheels: [wF, wR], legs, jacket, bagMat };
  return g;
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
  const dark = new THREE.MeshLambertMaterial({ color: 0x15121c });

  // cars: rounded body + rounded cabin + wheels + mirrors + head/tail lights
  const carBody = roundedSlab(4.45, 1.86, 0.68, 0.52, 0.3);
  const carCab = roundedSlab(2.25, 1.6, 0.46, 0.45, 1.12);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 10);
  wheelGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.26, 8);
  hubGeo.rotateX(Math.PI / 2);
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x8a8a92 });
  R3.pools.cars = mkPool(45, () => {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    g.add(new THREE.Mesh(carBody, m));
    g.add(new THREE.Mesh(carCab, dark));
    for (const [wx, wz] of [[1.42, 0.88], [1.42, -0.88], [-1.42, 0.88], [-1.42, -0.88]]) {
      const wh = new THREE.Mesh(wheelGeo, dark);
      wh.position.set(wx, 0.36, wz);
      g.add(wh);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.set(wx, 0.36, wz);
      g.add(hub);
    }
    for (const mz of [1.02, -1.02]) {
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.2), dark);
      mir.position.set(0.95, 1.28, mz);
      g.add(mir);
    }
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 1.4), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
    hl.position.set(2.24, 0.72, 0);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 1.4), new THREE.MeshBasicMaterial({ color: 0xe03434 }));
    tl.position.set(-2.24, 0.72, 0);
    g.add(tl);
    g.userData.mat = m;
    return g;
  });

  // buses: body + white stripe + window band + wheels
  const busBody = new THREE.BoxGeometry(11, 2.9, 2.55);
  busBody.translate(0, 1.5, 0);
  R3.pools.buses = mkPool(16, () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(busBody, new THREE.MeshLambertMaterial({ color: 0x2a3f8f })));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(11.02, 0.55, 2.57), new THREE.MeshLambertMaterial({ color: 0xe9e4d6 }));
    stripe.position.y = 0.85;
    g.add(stripe);
    const wins = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.7, 2.58), dark);
    wins.position.y = 2.2;
    g.add(wins);
    for (const wx of [3.6, -3.6]) for (const wz of [1.15, -1.15]) {
      const wh = new THREE.Mesh(wheelGeo, dark);
      wh.scale.set(1.35, 1.35, 1.2);
      wh.position.set(wx, 0.48, wz);
      g.add(wh);
    }
    return g;
  });

  // pedestrians: torso + head + swinging legs (+ arms)
  const torsoGeo = new THREE.CapsuleGeometry(0.3, 0.5, 3, 8);
  torsoGeo.translate(0, 1.05, 0);
  const headGeo = new THREE.SphereGeometry(0.24, 8, 6);
  headGeo.translate(0, 1.68, 0);
  const legGeo = new THREE.BoxGeometry(0.13, 0.55, 0.13);
  legGeo.translate(0, -0.27, 0);
  R3.pools.peds = mkPool(100, () => {
    const g = new THREE.Group();
    const bm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const hm = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
    g.add(new THREE.Mesh(torsoGeo, bm));
    g.add(new THREE.Mesh(headGeo, hm));
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.62, 0.12 * s);
      hip.add(new THREE.Mesh(legGeo, dark));
      g.add(hip);
      legs.push(hip);
    }
    // stroller (hidden unless needed)
    const st = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), new THREE.MeshLambertMaterial({ color: 0xd8d4c8 }));
    tub.position.y = 0.62;
    st.add(tub);
    for (const wz of [0.2, -0.2]) for (const wx of [0.22, -0.22]) {
      const ww = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 6).rotateX(Math.PI / 2), dark);
      ww.position.set(wx, 0.1, wz);
      st.add(ww);
    }
    st.position.set(0.85, 0, 0);
    st.visible = false;
    g.add(st);
    g.userData = { mat: bm, hair: hm, legs, stroller: st };
    return g;
  });

  // rival riders + player
  R3.pools.riders = mkPool(18, () => mkBike(false));
  R3.player = mkBike(true);
  R3.player.visible = true;
  R3.scene.add(R3.player);

  // walking player
  const wg = new THREE.Group();
  wg.add(new THREE.Mesh(torsoGeo.clone(), new THREE.MeshLambertMaterial({ color: 0x2f6db5 })));
  wg.add(new THREE.Mesh(headGeo.clone(), dark));
  const wLegs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.62, 0.12 * s);
    hip.add(new THREE.Mesh(legGeo.clone(), dark));
    wg.add(hip);
    wLegs.push(hip);
  }
  const wBag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0xff4d2e }));
  wBag.position.set(-0.35, 1.15, 0);
  wg.add(wBag);
  wg.userData = { legs: wLegs, bag: wBag };
  wg.visible = false;
  R3.scene.add(wg);
  R3.walker = wg;

  // traffic signals: corner pole + mast arm hanging a head over the roadway
  R3.pools.signals = mkPool(20, () => {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2e2a34 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.6, 5), poleMat);
    pole.position.y = 2.8;
    g.add(pole);
    const lampMats = [];
    const cols = [0xff4d4d, 0xffd24d, 0x4dd06a];
    const mkHead = (x, y) => {
      const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.3), new THREE.MeshLambertMaterial({ color: 0x22202a }));
      headBox.position.set(x, y, 0);
      const parts = [headBox];
      for (let i = 0; i < 3; i++) {
        const m = lampMats[i] || new THREE.MeshBasicMaterial({ color: cols[i] });
        if (!lampMats[i]) lampMats.push(m);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), m);
        lamp.position.set(x + 0.14, y + 0.3 - i * 0.3, 0);
        parts.push(lamp);
      }
      return parts;
    };
    // pole-mounted head + arm assembly that swings toward the intersection
    const armGroup = new THREE.Group();
    mkHead(0, 4.3).forEach(p => g.add(p));
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.4, 5), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(2.2, 5.55, 0);
    armGroup.add(arm);
    mkHead(4.15, 4.85).forEach(p => armGroup.add(p));
    g.add(armGroup);
    g.userData.lamps = lampMats;
    g.userData.arm = armGroup;
    return g;
  });

  // open car doors
  R3.pools.doors = mkPool(8, () => {
    const d = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 1.1, 0.07),
      new THREE.MeshLambertMaterial({ color: 0x8a8578 })
    );
    d.position.y = 0.75;
    const g = new THREE.Group();
    g.add(d);
    g.userData.mat = d.material;
    return g;
  });

  // comic bursts as billboards
  R3.pools.fx = [];
  for (let i = 0; i < 12; i++) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 80;
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.visible = false;
    sp.userData = { canvas: c, tex, key: "" };
    R3.scene.add(sp);
    R3.pools.fx.push(sp);
  }

  // rain
  const rainN = 130;
  const rpos = new Float32Array(rainN * 6);
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute("position", new THREE.BufferAttribute(rpos, 3));
  R3.rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({
    color: 0x8fa8cc, transparent: true, opacity: 0.32,
  }));
  R3.rain.frustumCulled = false;
  R3.rain.visible = false;
  R3.scene.add(R3.rain);
}

/* ---------- per-frame ---------- */
function place(g, x, y, ang) {
  g.visible = true;
  g.position.set(x, 0, y);
  g.rotation.y = -ang;
}
function pedalAnim(g, dist) {
  const ph = dist * 2.2;
  g.userData.wheels[0].rotation.z = -dist / 0.34;
  g.userData.wheels[1].rotation.z = -dist / 0.34;
  g.userData.legs[0].rotation.z = 0.45 + Math.sin(ph) * 0.5;
  g.userData.legs[1].rotation.z = 0.45 + Math.sin(ph + Math.PI) * 0.5;
}
function walkAnim(legs, phase) {
  legs[0].rotation.z = Math.sin(phase) * 0.55;
  legs[1].rotation.z = Math.sin(phase + Math.PI) * 0.55;
}

function render3D(P, S, tp) {
  if (!R3.ready) { init3D(); if (!R3.ready) return false; }

  // player
  if (P.riding) {
    R3.player.visible = true;
    R3.walker.visible = false;
    place(R3.player, P.x, P.y, P.ang);
    R3.player.rotation.z = -(P.steer || 0) * 0.26;
    pedalAnim(R3.player, P.dist || 0);
    R3.player.userData.bagMat.color.set(P.carrying ? 0xff4d2e : 0xa83a26);
  } else {
    R3.player.visible = false;
    R3.walker.visible = true;
    place(R3.walker, P.x, P.y, P.ang);
    walkAnim(R3.walker.userData.legs, S.t * 7);
    R3.walker.userData.bag.visible = !!P.carrying;
  }

  // chase camera
  const hx = Math.cos(P.ang), hy = Math.sin(P.ang);
  const back = P.riding ? 13 : 9;
  const height = P.riding ? 6.2 : 5;
  R3.camPos.lerp(new THREE.Vector3(P.x - hx * back, height, P.y - hy * back), 0.09);
  R3.camera.position.copy(R3.camPos);
  R3.camLook.lerp(new THREE.Vector3(P.x + hx * 9, 1.2, P.y + hy * 9), 0.14);
  R3.camera.lookAt(R3.camLook);
  if (R3.stars) R3.stars.position.set(P.x, 0, P.y);
  if (R3.moon) R3.moon.position.set(P.x + 650, 420, P.y - 700);
  if (R3.shadows) {
    R3.sun.position.set(P.x + 120, 220, P.y - 80);
    R3.sun.target.position.set(P.x, 0, P.y);
  }

  // cars (culled)
  const cars = R3.pools.cars;
  cars.forEach(g => g.visible = false);
  let ciX = 0;
  for (const car of Traffic.cars) {
    if (ciX >= cars.length) break;
    const cp = carPos(car);
    if (Math.hypot(cp.x - P.x, cp.y - P.y) > 300) continue;
    const g = cars[ciX++];
    place(g, cp.x, cp.y, cp.ang);
    g.userData.mat.color.set(car.col);
  }

  // buses (culled)
  const buses = R3.pools.buses;
  buses.forEach(g => g.visible = false);
  let biX = 0;
  for (const bus of Buses.list) {
    if (biX >= buses.length) break;
    const bp = busPos(bus);
    if (Math.hypot(bp.x - P.x, bp.y - P.y) > 340) continue;
    place(buses[biX++], bp.x, bp.y, bp.ang);
  }

  // peds (render-culled so density stays near the player)
  const peds = R3.pools.peds;
  peds.forEach(g => g.visible = false);
  let pIdx = 0;
  Traffic.peds.forEach(ped => {
    if (pIdx >= peds.length) return;
    const pp = pedPos(ped);
    if (Math.hypot(pp.x - P.x, pp.y - P.y) > 260) return;
    const g = peds[pIdx++];
    place(g, pp.x, pp.y, Math.atan2(ped.hy, ped.hx));
    g.userData.mat.color.set(ped.col);
    g.userData.hair.color.set(ped.hair || "#2a2018");
    walkAnim(g.userData.legs, S.t * ped.speed * 5.5 + (ped.phase || 0));
    g.userData.stroller.visible = !!ped.stroller;
  });

  // rival riders
  const riders = R3.pools.riders;
  riders.forEach(g => g.visible = false);
  Traffic.riders.forEach((r, i) => {
    if (i >= riders.length) return;
    const rp = riderPos(r);
    const g = riders[i];
    place(g, rp.x, rp.y, rp.ang);
    g.userData.jacket.color.set(r.jacket);
    g.userData.bagMat.color.set(r.bag);
    pedalAnim(g, r.dist || 0);
  });

  // signal poles on their sidewalk corners, heads facing their street
  const sigs = R3.pools.signals;
  sigs.forEach(g => g.visible = false);
  let si = 0;
  for (const light of W.lights) {
    if (si >= sigs.length - 1) break;
    if (!light.corners) continue;
    if (Math.hypot(light.x - P.x, light.y - P.y) > 130) continue;
    for (const c of light.corners) {
      if (si >= sigs.length) break;
      const g = sigs[si++];
      place(g, c.x, c.y, c.ang);
      // swing the mast arm out over the intersection
      const toCenter = Math.atan2(light.y - c.y, light.x - c.x);
      g.userData.arm.rotation.y = -(toCenter - c.ang);
      const st = lightState(light, c.ang, S.gameT);
      const on = st === "r" ? 0 : st === "y" ? 1 : 2;
      g.userData.lamps.forEach((m, mi) => {
        const cols = [0xff4d4d, 0xffd24d, 0x4dd06a];
        m.color.set(mi === on ? cols[mi] : 0x2a2630);
      });
    }
  }

  // open car doors
  const doorPool = R3.pools.doors;
  doorPool.forEach(g => g.visible = false);
  if (typeof openDoors !== "undefined") {
    openDoors.forEach((pc, i) => {
      if (i >= doorPool.length) return;
      const g = doorPool[i];
      const doorX = pc.x - Math.sin(pc.ang) * -1.5 + Math.cos(pc.ang) * 0.7;
      const doorY = pc.y + Math.cos(pc.ang) * -1.5 + Math.sin(pc.ang) * 0.7;
      place(g, doorX, doorY, pc.ang + 1.1);
      g.userData.mat.color.set(pc.col);
    });
  }

  // comic bursts (billboards from the shared FX list)
  const fxPool = R3.pools.fx;
  fxPool.forEach(sp => sp.visible = false);
  const fxList = (typeof Game !== "undefined" && Game.FX) ? Game.FX : [];
  fxList.forEach((fx, i) => {
    if (i >= fxPool.length) return;
    const age = S.t - fx.t0;
    if (age < 0 || age > 1.3) return;
    const sp = fxPool[i];
    const key = fx.text + fx.color;
    if (sp.userData.key !== key) {
      sp.userData.key = key;
      const g = sp.userData.canvas.getContext("2d");
      g.clearRect(0, 0, 256, 80);
      g.font = "400 44px Anton, Impact, sans-serif";
      g.textAlign = "center";
      g.lineWidth = 9;
      g.strokeStyle = "#141020";
      g.strokeText(fx.text, 128, 56);
      g.fillStyle = fx.color;
      g.fillText(fx.text, 128, 56);
      sp.userData.tex.needsUpdate = true;
    }
    sp.visible = true;
    sp.position.set(fx.x, 3.6 + age * 2.2, fx.y);
    const sc = fx.size * (age < 0.18 ? 0.6 + 2.2 * age : 1);
    sp.scale.set(sc * 3.2, sc, 1);
    sp.material.opacity = age > 0.8 ? 1 - (age - 0.8) / 0.5 : 1;
  });

  // rain around the camera
  if (S.rain) {
    R3.rain.visible = true;
    const attr = R3.rain.geometry.getAttribute("position");
    const a = attr.array;
    for (let i = 0; i < 130; i++) {
      const rx = P.x + (((i * 73.7) % 90) - 45) + Math.sin(i * 9.1) * 8;
      const rz = P.y + (((i * 41.3) % 90) - 45);
      const fall = 24 - ((i * 3.7 + S.t * 26) % 24);
      a[i * 6] = rx; a[i * 6 + 1] = fall; a[i * 6 + 2] = rz;
      a[i * 6 + 3] = rx - 0.25; a[i * 6 + 4] = fall - 1.1; a[i * 6 + 5] = rz;
    }
    attr.needsUpdate = true;
  } else R3.rain.visible = false;

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
        posAttr.setXYZ(i, p[0], 0.3, p[1]);
      }
      R3.routeLine.geometry.setDrawRange(0, n);
      R3.routeLine.visible = true;
    } else R3.routeLine.visible = false;
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

  if (R3.retro) {
    R3.renderer.setRenderTarget(R3.rt);
    R3.renderer.render(R3.scene, R3.camera);
    R3.renderer.setRenderTarget(null);
    R3.renderer.render(R3.blitScene, R3.blitCam);
  } else {
    R3.renderer.render(R3.scene, R3.camera);
  }
  return true;
}
