/* ============ world.js — map, graph, routing, lights, static scenery ============ */
"use strict";

const W = {
  nodes: [], ways: [], segs: [], adj: [], adjBike: [],
  restaurants: [], signals: new Set(), lights: [], nodeLight: {},
  grid: new Map(), GRID: 40,
  parked: [], lamps: [], trees: [], busRoutes: [],
  lots: [], lotGrid: new Map(), LOTGRID: 80, crosswalks: [], labels: [],
  paths: {}, bikePaths: null, dashPaths: {},
  minimapCanvas: null, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  ready: false,
};

/* road half-widths (asphalt) + sidewalk width, meters */
const ROAD_HALF = { 1: 4.7, 2: 6.8, 3: 8.5 };
const SIDEWALK = 4.0;

function segKey(x, y) { return ((x + 2048) << 12) | (y + 2048); }

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

async function loadWorld() {
  const data = await (await fetch("map.json")).json();
  W.nodes = data.nodes;
  W.ways = data.ways;
  W.restaurants = data.restaurants;
  data.signals.forEach(i => W.signals.add(i));

  const n = W.nodes.length;
  W.adj = Array.from({ length: n }, () => []);
  W.adjBike = Array.from({ length: n }, () => []);

  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  W.nodes.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
  W.bounds = { minX, minY, maxX, maxY };

  // Build directed segments
  W.ways.forEach((way, wi) => {
    for (let i = 0; i < way.n.length - 1; i++) {
      const a = way.n[i], b = way.n[i + 1];
      const pa = W.nodes[a], pb = W.nodes[b];
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      const seg = { a, b, len, cls: way.c, oneway: way.o, name: way.name, way: wi, ang: Math.atan2(dy, dx) };
      const si = W.segs.length;
      W.segs.push(seg);
      W.adj[a].push({ to: b, seg: si, rev: false });
      if (!way.o) W.adj[b].push({ to: a, seg: si, rev: true });
      W.adjBike[a].push({ to: b, seg: si, rev: false });
      W.adjBike[b].push({ to: a, seg: si, rev: true });
      // spatial hash: insert into all cells the segment bbox touches (padded)
      const pad = ROAD_HALF[way.c] + SIDEWALK + 4;
      const cx0 = Math.floor((Math.min(pa[0], pb[0]) - pad) / W.GRID), cx1 = Math.floor((Math.max(pa[0], pb[0]) + pad) / W.GRID);
      const cy0 = Math.floor((Math.min(pa[1], pb[1]) - pad) / W.GRID), cy1 = Math.floor((Math.max(pa[1], pb[1]) + pad) / W.GRID);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const k = segKey(cx, cy);
        if (!W.grid.has(k)) W.grid.set(k, []);
        W.grid.get(k).push(si);
      }
    }
  });

  // bus routes (real MTA routes stitched from OSM relations)
  (data.buses || []).forEach(b => {
    let L = 0;
    const cum = [0];
    for (let i = 1; i < b.pts.length; i++) {
      L += Math.hypot(b.pts[i][0] - b.pts[i - 1][0], b.pts[i][1] - b.pts[i - 1][1]);
      cum.push(L);
    }
    if (L > 500) W.busRoutes.push({ name: b.ref, pts: b.pts, cum, len: L });
  });

  buildLights();
  buildParkedCars();
  buildLamps();
  buildTrees();
  buildLots();
  buildCrosswalks();
  buildLabels();
  buildPaths();
  buildMinimap();
  W.ready = true;
}

/* ---- traffic lights: cluster signal nodes within 30m into controllers ---- */
function buildLights() {
  const sig = [...W.signals];
  const used = new Set();
  for (const s of sig) {
    if (used.has(s)) continue;
    const cluster = [s]; used.add(s);
    const p = W.nodes[s];
    for (const t of sig) {
      if (used.has(t)) continue;
      const q = W.nodes[t];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 30) { cluster.push(t); used.add(t); }
    }
    let cx = 0, cy = 0;
    cluster.forEach(i => { cx += W.nodes[i][0]; cy += W.nodes[i][1]; });
    cx /= cluster.length; cy /= cluster.length;
    const li = W.lights.length;
    W.lights.push({ x: cx, y: cy, nodes: cluster, offset: (li * 7.3) % 24 });
    cluster.forEach(i => W.nodeLight[i] = li);
  }
}

/* phase for approach angle at time t: returns 'g','y','r' */
const LIGHT_CYCLE = 26;
function lightState(light, approachAng, t) {
  const ph = (t + light.offset) % LIGHT_CYCLE;
  // NS = angle mostly vertical (|sin| > |cos|)
  const ns = Math.abs(Math.sin(approachAng)) > Math.abs(Math.cos(approachAng));
  if (ns) {
    if (ph < 11) return "g";
    if (ph < 13) return "y";
    return "r";
  } else {
    if (ph < 13) return "r";
    if (ph < 24) return "g";
    return "y";
  }
}

/* ---- parked cars along curbs of every street ---- */
const CAR_COLORS = ["#4c5468", "#5f5a50", "#6b7280", "#3a3e48", "#7e7a6a", "#8a4038", "#54423a", "#3f4a5c", "#8a8a8a", "#2e323a", "#9a9588", "#3f5a50", "#6a4a68", "#a04a30"];
function buildParkedCars() {
  const rand = mulberry(1973);
  W.segs.forEach((s, si) => {
    if (s.len < 18) return;
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
    const nx = -uy, ny = ux;
    const half = ROAD_HALF[s.cls];
    const curb = half - 1.15; // parking lane center
    for (const side of [-1, 1]) {
      if (s.cls === 3 && side === -1 && rand() < 0.5) continue; // avenues: some no-parking
      let d = 8 + rand() * 6;
      while (d < s.len - 8) {
        if (rand() < 0.82) {
          const x = pa[0] + ux * d + nx * curb * side;
          const y = pa[1] + uy * d + ny * curb * side;
          W.parked.push({ x, y, ang: s.ang, col: CAR_COLORS[(rand() * CAR_COLORS.length) | 0], seg: si, door: 0 });
        }
        d += 5.4 + rand() * 2.2;
      }
    }
  });
}

/* ---- street lamps: at nodes + spaced along segments ---- */
function buildLamps() {
  const rand = mulberry(42);
  const seen = new Set();
  W.segs.forEach(s => {
    if (!seen.has(s.a)) { seen.add(s.a); const p = W.nodes[s.a]; W.lamps.push({ x: p[0], y: p[1], r: 15 + rand() * 5 }); }
    if (s.len > 70) {
      const pa = W.nodes[s.a], pb = W.nodes[s.b];
      const steps = Math.floor(s.len / 55);
      for (let i = 1; i <= steps; i++) {
        const f = i / (steps + 1);
        W.lamps.push({ x: pa[0] + (pb[0] - pa[0]) * f, y: pa[1] + (pb[1] - pa[1]) * f, r: 12 + rand() * 5 });
      }
    }
  });
}

/* ---- street trees: brownstone Brooklyn is leafy ---- */
const TREE_COLORS = ["#3e7a44", "#4c8a4a", "#356b3e", "#57944e", "#6aa054"];
function buildTrees() {
  const rand = mulberry(212);
  W.segs.forEach(s => {
    if (s.len < 26) return;
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
    const nx = -uy, ny = ux;
    const off = ROAD_HALF[s.cls] + SIDEWALK * 0.72;
    for (const side of [-1, 1]) {
      let d = 10 + rand() * 10;
      while (d < s.len - 10) {
        if (rand() < (s.cls === 1 ? 0.75 : 0.45)) {
          W.trees.push({
            x: pa[0] + ux * d + nx * off * side,
            y: pa[1] + uy * d + ny * off * side,
            r: 1.7 + rand() * 1.6,
            col: TREE_COLORS[(rand() * TREE_COLORS.length) | 0],
          });
        }
        d += 13 + rand() * 9;
      }
    }
  });
}

/* ---- building lots: brownstone rows aligned to each street's frontage ---- */
const LOT_COLORS = ["#4e382e", "#59402f", "#61452f", "#523e40", "#493a46", "#5c483a", "#553f30", "#5e4343", "#473b42", "#66503c", "#513c35", "#443847"];
function lotKey(cx, cy) { return ((cx + 1024) << 11) | (cy + 1024); }
function buildLots() {
  const rand = mulberry(505);
  W.segs.forEach(s => {
    if (s.len < 24) return;
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
    const nx = -uy, ny = ux;
    const setback = ROAD_HALF[s.cls] + SIDEWALK;
    for (const side of [-1, 1]) {
      let d = 6 + rand() * 4;
      while (d < s.len - 12) {
        const fw = 7.5 + rand() * 6;          // frontage width
        if (d + fw > s.len - 5) break;
        const depth = 11 + rand() * 7;
        const cx = pa[0] + ux * (d + fw / 2) + nx * (setback + depth / 2) * side;
        const cy = pa[1] + uy * (d + fw / 2) + ny * (setback + depth / 2) * side;
        const lot = {
          x: cx, y: cy, ang: s.ang, w: fw - 0.6, depth,
          col: LOT_COLORS[(rand() * LOT_COLORS.length) | 0],
          lit: rand() < 0.65, side,
        };
        W.lots.push(lot);
        const k = lotKey(Math.floor(cx / W.LOTGRID), Math.floor(cy / W.LOTGRID));
        if (!W.lotGrid.has(k)) W.lotGrid.set(k, []);
        W.lotGrid.get(k).push(lot);
        d += fw + 0.5;
      }
    }
  });
}
function lotsNear(x0, y0, x1, y1) {
  const out = [];
  const cx0 = Math.floor(x0 / W.LOTGRID), cx1 = Math.floor(x1 / W.LOTGRID);
  const cy0 = Math.floor(y0 / W.LOTGRID), cy1 = Math.floor(y1 / W.LOTGRID);
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const arr = W.lotGrid.get(lotKey(cx, cy));
    if (arr) out.push(...arr);
  }
  return out;
}

/* ---- crosswalks at signalized approaches ---- */
function buildCrosswalks() {
  const seen = new Set();
  W.lights.forEach(light => {
    for (const si of nearbySegs(light.x, light.y)) {
      const s = W.segs[si];
      for (const [nid, other] of [[s.a, s.b], [s.b, s.a]]) {
        const p = W.nodes[nid];
        if (Math.hypot(p[0] - light.x, p[1] - light.y) > 15) continue;
        const key = nid + ":" + si;
        if (seen.has(key)) continue;
        seen.add(key);
        const q = W.nodes[other];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 16) continue;
        const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L;
        W.crosswalks.push({
          x: p[0] + ux * 7.5, y: p[1] + uy * 7.5,
          ang: Math.atan2(uy, ux), half: ROAD_HALF[s.cls],
        });
      }
    }
  });
}

/* ---- street name labels along the centerline, OSM-style ---- */
function buildLabels() {
  W.ways.forEach(way => {
    if (!way.name) return;
    let sinceLabel = 90; // meters since the last label on this way
    for (let i = 0; i < way.n.length - 1; i++) {
      const pa = W.nodes[way.n[i]], pb = W.nodes[way.n[i + 1]];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      sinceLabel += len;
      if (len > 42 && sinceLabel > 130) {
        sinceLabel = 0;
        W.labels.push({
          x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2,
          ang: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]),
          name: way.name,
        });
      }
    }
  });
}

/* ---- prerendered Path2D per street class + bike lanes + center dashes ---- */
function buildPaths() {
  for (const c of [1, 2, 3]) W.paths[c] = new Path2D();
  for (const c of [2, 3]) W.dashPaths[c] = new Path2D();
  W.bikePaths = new Path2D();
  W.ways.forEach(way => {
    const p = W.paths[way.c];
    const pts = way.n.map(i => W.nodes[i]);
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (way.c >= 2) {
      const d = W.dashPaths[way.c];
      d.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) d.lineTo(pts[i][0], pts[i][1]);
    }
    if (way.cycle || way.c === 3) {
      // bike lane offset to the right of travel direction
      const off = ROAD_HALF[way.c] - 2.6;
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
        const l = Math.hypot(dx, dy); if (l < 1) continue;
        const nx = -dy / l, ny = dx / l;
        W.bikePaths.moveTo(pts[i][0] + nx * off, pts[i][1] + ny * off);
        W.bikePaths.lineTo(pts[i + 1][0] + nx * off, pts[i + 1][1] + ny * off);
      }
    }
  });
}

/* ---- minimap prerender ---- */
function buildMinimap() {
  const c = document.createElement("canvas");
  const S = 440;
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#16151d"; g.fillRect(0, 0, S, S);
  const b = W.bounds;
  const scale = Math.min(S / (b.maxX - b.minX), S / (b.maxY - b.minY)) * 0.94;
  const ox = (S - (b.maxX - b.minX) * scale) / 2, oy = (S - (b.maxY - b.minY) * scale) / 2;
  W.mmXform = { scale, ox: ox - b.minX * scale, oy: oy - b.minY * scale };
  g.lineCap = "round";
  W.ways.forEach(way => {
    g.strokeStyle = way.c === 3 ? "#5c5340" : way.c === 2 ? "#46423a" : "#363331";
    g.lineWidth = way.c === 3 ? 3 : way.c === 2 ? 2.2 : 1.2;
    g.beginPath();
    const pts = way.n.map(i => W.nodes[i]);
    g.moveTo(pts[0][0] * scale + W.mmXform.ox, pts[0][1] * scale + W.mmXform.oy);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] * scale + W.mmXform.ox, pts[i][1] * scale + W.mmXform.oy);
    g.stroke();
  });
  W.minimapCanvas = c;
}

/* ---- geometry queries ---- */
function nearbySegs(x, y) {
  const cx = Math.floor(x / W.GRID), cy = Math.floor(y / W.GRID);
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const arr = W.grid.get(segKey(cx + i, cy + j));
    if (arr) out.push(...arr);
  }
  return out;
}

/* closest point on street network: returns {d, seg, t, nx, ny} */
function closestStreet(x, y) {
  let best = null;
  for (const si of nearbySegs(x, y)) {
    const s = W.segs[si];
    const pa = W.nodes[s.a], pb = W.nodes[s.b];
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
    let t = ((x - pa[0]) * dx + (y - pa[1]) * dy) / (s.len * s.len);
    t = Math.max(0, Math.min(1, t));
    const px = pa[0] + dx * t, py = pa[1] + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) best = { d, seg: si, t, px, py };
  }
  return best;
}

function nearestNode(x, y) {
  const st = closestStreet(x, y);
  if (!st) return 0;
  const s = W.segs[st.seg];
  return st.t < 0.5 ? s.a : s.b;
}

/* A* over node graph. bike=true ignores oneway. Returns array of node indices or null. */
function astar(from, to, bike) {
  const adj = bike ? W.adjBike : W.adj;
  const N = W.nodes.length;
  const gScore = new Float64Array(N).fill(Infinity);
  const fScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const tp = W.nodes[to];
  const h = i => { const p = W.nodes[i]; return Math.hypot(p[0] - tp[0], p[1] - tp[1]); };
  gScore[from] = 0; fScore[from] = h(from);
  const open = [from];
  const inOpen = new Set([from]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    inOpen.delete(cur);
    if (cur === to) {
      const path = [cur];
      let c = cur;
      while (came[c] !== -1) { c = came[c]; path.push(c); }
      return path.reverse();
    }
    for (const e of adj[cur]) {
      const tg = gScore[cur] + W.segs[e.seg].len;
      if (tg < gScore[e.to]) {
        came[e.to] = cur; gScore[e.to] = tg; fScore[e.to] = tg + h(e.to);
        if (!inOpen.has(e.to)) { open.push(e.to); inOpen.add(e.to); }
      }
    }
  }
  return null;
}

function pathLength(path) {
  let L = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = W.nodes[path[i]], b = W.nodes[path[i + 1]];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}
