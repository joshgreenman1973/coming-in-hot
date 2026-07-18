/* ============ actors.js — traffic cars, pedestrians, door hazards ============ */
"use strict";

const Traffic = {
  cars: [], peds: [], MAX_CARS: 34, MAX_PEDS: 62,
  doorTimer: 0,
};

/* speed limits m/s by class (city ~25mph on avenues, slower on side streets) */
const CAR_SPEED = { 1: 6.5, 2: 9.5, 3: 11.5 };
const MOVING_COLORS = ["#d8d2be", "#98a2ae", "#c33b2f", "#3f6fae", "#7d5340", "#b8b8b8", "#3fae6a", "#e8e0cc", "#e0862f", "#f0c93c"]; // last = taxi

function laneOffsetFor(seg, rev) {
  // drive on the right side of travel direction
  const half = ROAD_HALF[seg.cls];
  const lane = seg.cls >= 2 ? half * 0.42 : half * 0.34;
  return rev ? -lane : lane;
}

function carPos(car) {
  const s = W.segs[car.seg];
  const pa = W.nodes[s.a], pb = W.nodes[s.b];
  const f = car.rev ? 1 - car.t : car.t;
  const x = pa[0] + (pb[0] - pa[0]) * f, y = pa[1] + (pb[1] - pa[1]) * f;
  const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
  const dir = car.rev ? -1 : 1;
  const off = laneOffsetFor(s, car.rev);
  return { x: x - uy * off, y: y + ux * off, ang: Math.atan2(uy * dir, ux * dir), ux: ux * dir, uy: uy * dir };
}

function spawnCar(px, py, minD, maxD) {
  // pick a random directed segment within ring around player
  for (let tries = 0; tries < 24; tries++) {
    const si = (Math.random() * W.segs.length) | 0;
    const s = W.segs[si];
    const pa = W.nodes[s.a];
    const d = Math.hypot(pa[0] - px, pa[1] - py);
    if (d < minD || d > maxD) continue;
    const rev = !s.oneway && Math.random() < 0.5;
    const col = Math.random() < (s.cls === 3 ? 0.18 : 0.05) ? "#f0c93c" : MOVING_COLORS[(Math.random() * (MOVING_COLORS.length - 1)) | 0];
    Traffic.cars.push({
      seg: si, rev, t: Math.random(), speed: 0,
      max: CAR_SPEED[s.cls] * (0.85 + Math.random() * 0.3),
      col, honk: 0, stopped: 0, len: 4.5,
    });
    return true;
  }
  return false;
}

function nextSegForCar(car) {
  const s = W.segs[car.seg];
  const endNode = car.rev ? s.a : s.b;
  const opts = W.adj[endNode].filter(e => {
    // don't u-turn unless dead end
    const ns = W.segs[e.seg];
    const sameStreet = e.seg === car.seg;
    return !sameStreet;
  });
  const pool = opts.length ? opts : W.adj[endNode];
  if (!pool.length) return null;
  // prefer continuing straight-ish
  const pos = carPos(car);
  let best = null, bestScore = -2;
  const pick = Math.random();
  if (pick < 0.65) {
    for (const e of pool) {
      const ns = W.segs[e.seg];
      const dir = e.rev ? -1 : 1;
      const pa = W.nodes[ns.a], pb = W.nodes[ns.b];
      const ux = (pb[0] - pa[0]) / ns.len * dir, uy = (pb[1] - pa[1]) / ns.len * dir;
      const score = ux * pos.ux + uy * pos.uy;
      if (score > bestScore) { bestScore = score; best = e; }
    }
  } else best = pool[(Math.random() * pool.length) | 0];
  return best;
}

function updateCars(dt, gameT, player) {
  const px = player.x, py = player.y;
  // cull far cars, spawn near
  Traffic.cars = Traffic.cars.filter(c => {
    const p = carPos(c);
    return Math.hypot(p.x - px, p.y - py) < 480;
  });
  while (Traffic.cars.length < Traffic.MAX_CARS) {
    if (!spawnCar(px, py, 140, 430)) break;
  }

  for (const car of Traffic.cars) {
    const s = W.segs[car.seg];
    const pos = carPos(car);
    let target = car.max;

    // red light ahead?
    const endNode = car.rev ? s.a : s.b;
    const distToEnd = (car.rev ? car.t : 1 - car.t) * s.len;
    const li = W.nodeLight[endNode];
    if (li !== undefined && distToEnd < 14 && distToEnd > 2.5) {
      const st = lightState(W.lights[li], pos.ang, gameT);
      if (st === "r" || (st === "y" && distToEnd > 7)) target = 0;
    }

    // car ahead? (same-direction proximity cone)
    for (const other of Traffic.cars) {
      if (other === car) continue;
      const op = carPos(other);
      const dx = op.x - pos.x, dy = op.y - pos.y;
      const ahead = dx * pos.ux + dy * pos.uy;
      if (ahead > 0 && ahead < 13) {
        const lat = Math.abs(-dy * pos.ux + dx * pos.uy);
        if (lat < 2.4) {
          const sameDir = op.ux * pos.ux + op.uy * pos.uy > 0.3;
          if (sameDir) target = Math.min(target, Math.max(0, (ahead - 6) * 1.2));
        }
      }
    }

    // player ahead → brake early + honk
    const pdx = px - pos.x, pdy = py - pos.y;
    const pAhead = pdx * pos.ux + pdy * pos.uy;
    if (pAhead > 0 && pAhead < 18 && Math.abs(-pdy * pos.ux + pdx * pos.uy) < 2.6) {
      target = Math.min(target, Math.max(0, (pAhead - 5.5) * 1.1));
      if (pAhead < 9 && car.speed > 1 && car.honk <= 0) { car.honk = 3 + Math.random() * 4; Game && Game.honk(pos); }
    }
    if (car.honk > 0) car.honk -= dt;

    // accelerate/brake toward target
    if (car.speed < target) car.speed = Math.min(target, car.speed + 3.2 * dt);
    else car.speed = Math.max(target, car.speed - 7 * dt);

    // advance
    car.t += (car.speed * dt / s.len) * (car.rev ? 1 : 1);
    if (car.t >= 1) {
      const nxt = nextSegForCar(car);
      if (!nxt) { car.t = 0.99; car.speed = 0; car.dead = true; continue; }
      car.seg = nxt.seg; car.rev = nxt.rev; car.t = 0;
      car.max = CAR_SPEED[W.segs[nxt.seg].cls] * (0.85 + Math.random() * 0.3);
    }
  }
  Traffic.cars = Traffic.cars.filter(c => !c.dead);
}

/* ---- pedestrians: sidewalk walkers ---- */
function spawnPed(px, py) {
  for (let tries = 0; tries < 20; tries++) {
    const si = (Math.random() * W.segs.length) | 0;
    const s = W.segs[si];
    const pa = W.nodes[s.a];
    const d = Math.hypot(pa[0] - px, pa[1] - py);
    if (d < 60 || d > 380) continue;
    const side = Math.random() < 0.5 ? -1 : 1;
    const stroller = Math.random() < (Traffic.strollerP || 0);
    Traffic.peds.push({
      seg: si, t: Math.random(), side, dir: Math.random() < 0.5 ? -1 : 1,
      speed: stroller ? 0.9 + Math.random() * 0.4 : 1.1 + Math.random() * 0.7,
      col: ["#e2cfae", "#96a2bc", "#c08484", "#88ac8a", "#c4b558", "#ab94cc", "#d89a6a", "#7ab8b0"][(Math.random() * 8) | 0],
      hair: ["#241d18", "#4a3524", "#6b5138", "#b8a06a", "#8a8a8a", "#3a2a30", "#101014"][(Math.random() * 7) | 0],
      phase: Math.random() * 7,
      cross: null, dog: !stroller && Math.random() < 0.12, stroller,
      hx: 1, hy: 0,
    });
    return true;
  }
  return false;
}

function sidewalkPos(ped, side) {
  const s = W.segs[ped.seg];
  const pa = W.nodes[s.a], pb = W.nodes[s.b];
  const x = pa[0] + (pb[0] - pa[0]) * ped.t, y = pa[1] + (pb[1] - pa[1]) * ped.t;
  const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
  const off = (ROAD_HALF[s.cls] + SIDEWALK * 0.55) * side;
  return { x: x - uy * off, y: y + ux * off };
}

function pedPos(ped) {
  if (ped.cross) {
    const c = ped.cross;
    return { x: c.x0 + (c.x1 - c.x0) * c.p, y: c.y0 + (c.y1 - c.y0) * c.p };
  }
  return sidewalkPos(ped, ped.side);
}

/* step off the curb and cross the roadway to the other sidewalk */
function startCross(ped) {
  ped.t = Math.max(0.03, Math.min(0.97, ped.t));
  const a = sidewalkPos(ped, ped.side);
  const b = sidewalkPos(ped, -ped.side);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  ped.cross = { x0: a.x, y0: a.y, x1: b.x, y1: b.y, p: 0, len };
}

function updatePeds(dt, px, py) {
  Traffic.peds = Traffic.peds.filter(p => {
    const pos = pedPos(p);
    return Math.hypot(pos.x - px, pos.y - py) < 420;
  });
  while (Traffic.peds.length < Traffic.MAX_PEDS) {
    if (!spawnPed(px, py)) break;
  }
  for (const ped of Traffic.peds) {
    if (ped.cross) {
      ped.cross.p += ped.speed * dt / ped.cross.len;
      ped.hx = (ped.cross.x1 - ped.cross.x0) / ped.cross.len;
      ped.hy = (ped.cross.y1 - ped.cross.y0) / ped.cross.len;
      if (ped.cross.p >= 1) { ped.side *= -1; ped.cross = null; }
      continue;
    }
    const s = W.segs[ped.seg];
    const pa2 = W.nodes[s.a], pb2 = W.nodes[s.b];
    ped.hx = (pb2[0] - pa2[0]) / s.len * ped.dir;
    ped.hy = (pb2[1] - pa2[1]) / s.len * ped.dir;
    ped.t += ped.dir * ped.speed * dt / s.len;
    // jaywalkers step out mid-block without warning
    if (Math.random() < dt * 0.01) { startCross(ped); continue; }
    if (ped.t < 0 || ped.t > 1) {
      const node = ped.t < 0 ? s.a : s.b;
      // corners: many peds cross the street they're on before continuing
      if (Math.random() < 0.5) { startCross(ped); continue; }
      const opts = W.adjBike[node];
      if (!opts.length) { ped.dead = true; continue; }
      const e = opts[(Math.random() * opts.length) | 0];
      ped.seg = e.seg;
      ped.dir = e.rev ? -1 : 1;
      ped.t = e.rev ? 1 : 0;
    }
  }
  Traffic.peds = Traffic.peds.filter(p => !p.dead);
}

/* ---- city buses: follow real MTA route polylines, stop for pickups ---- */
const Buses = { list: [] };

function initBuses() {
  Buses.list = [];
  W.busRoutes.forEach((route, ri) => {
    const n = Math.max(1, Math.round(route.len / 900)); // one bus per ~900m of route
    for (let i = 0; i < n; i++) {
      Buses.list.push({
        route: ri, d: (route.len * (i + Math.random() * 0.5)) / n,
        speed: 0, max: 8.2, dwell: 0, nextStop: 0,
      });
    }
    // deterministic stop points every ~280m
    route.stops = [];
    for (let s = 140; s < route.len - 60; s += 260 + (ri * 37) % 90) route.stops.push(s);
  });
}

function busPos(bus) {
  const r = W.busRoutes[bus.route];
  const cum = r.cum, pts = r.pts;
  let d = bus.d % r.len;
  // binary search cum for segment
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const segLen = cum[lo + 1] - cum[lo] || 1;
  const f = (d - cum[lo]) / segLen;
  const a = pts[lo], b = pts[lo + 1];
  const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
  return { x, y, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function updateBuses(dt, player) {
  for (const bus of Buses.list) {
    const r = W.busRoutes[bus.route];
    if (bus.dwell > 0) { bus.dwell -= dt; bus.speed = 0; continue; }
    let target = bus.max;
    const pos = busPos(bus);
    // player directly ahead → brake + honk
    const pdx = player.x - pos.x, pdy = player.y - pos.y;
    const hx = Math.cos(pos.ang), hy = Math.sin(pos.ang);
    const ahead = pdx * hx + pdy * hy;
    if (ahead > 0 && ahead < 16 && Math.abs(-pdy * hx + pdx * hy) < 2.6) {
      target = Math.min(target, Math.max(0, (ahead - 7) * 1.1));
      if (ahead < 11 && bus.speed > 2 && typeof Game !== "undefined") Game.busHonk(pos);
    }
    if (bus.speed < target) bus.speed = Math.min(target, bus.speed + 1.6 * dt);
    else bus.speed = Math.max(target, bus.speed - 5 * dt);
    const before = bus.d % r.len;
    bus.d = (bus.d + bus.speed * dt) % r.len;
    // stop at the next bus stop we cross
    for (const s of r.stops) {
      if (before < s && bus.d >= s) { bus.dwell = 2.5 + Math.random() * 3.5; bus.speed = 0; break; }
    }
  }
}

/* ---- rival deliveristas: everywhere at dinner time, thinner late ---- */
const RIDER_JACKETS = ["#e8524a", "#4aa8e8", "#58c78a", "#e8a53a", "#b06ae0", "#e8e8de"];
const RIDER_BAGS = ["#d43a2a", "#1fa8a0", "#e07820", "#2a56d4"];
Traffic.riders = [];
Traffic.riderTarget = 10;

function spawnRider(px, py) {
  for (let tries = 0; tries < 20; tries++) {
    const si = (Math.random() * W.segs.length) | 0;
    const s = W.segs[si];
    const pa = W.nodes[s.a];
    const d = Math.hypot(pa[0] - px, pa[1] - py);
    if (d < 60 || d > 400) continue;
    Traffic.riders.push({
      seg: si, rev: Math.random() < 0.5, t: Math.random(),
      speed: 0, max: 7.5 + Math.random() * 3.5,
      jacket: RIDER_JACKETS[(Math.random() * RIDER_JACKETS.length) | 0],
      bag: RIDER_BAGS[(Math.random() * RIDER_BAGS.length) | 0],
      obeys: Math.random() < 0.3,
    });
    return true;
  }
  return false;
}

function riderPos(r) {
  const s = W.segs[r.seg];
  const pa = W.nodes[s.a], pb = W.nodes[s.b];
  const f = r.rev ? 1 - r.t : r.t;
  const x = pa[0] + (pb[0] - pa[0]) * f, y = pa[1] + (pb[1] - pa[1]) * f;
  const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
  const dir = r.rev ? -1 : 1;
  const off = (ROAD_HALF[s.cls] - 1.5) * dir;
  return { x: x - uy * off, y: y + ux * off, ang: Math.atan2(uy * dir, ux * dir), ux: ux * dir, uy: uy * dir };
}

function updateRiders(dt, gameT, player) {
  Traffic.riders = Traffic.riders.filter(r => {
    const p = riderPos(r);
    return Math.hypot(p.x - player.x, p.y - player.y) < 460;
  });
  while (Traffic.riders.length < Traffic.riderTarget) {
    if (!spawnRider(player.x, player.y)) break;
  }
  for (const r of Traffic.riders) {
    const s = W.segs[r.seg];
    const pos = riderPos(r);
    let target = r.max;
    // red lights: most deliveristas roll them
    const endNode = r.rev ? s.a : s.b;
    const distToEnd = (r.rev ? r.t : 1 - r.t) * s.len;
    const li = W.nodeLight[endNode];
    if (li !== undefined && distToEnd < 10 && distToEnd > 2) {
      const st = lightState(W.lights[li], pos.ang, gameT);
      if (st === "r") target = r.obeys ? 0 : r.max * 0.55;
    }
    // don't rear-end the player
    const pdx = player.x - pos.x, pdy = player.y - pos.y;
    const pAhead = pdx * pos.ux + pdy * pos.uy;
    if (pAhead > 0 && pAhead < 9 && Math.abs(-pdy * pos.ux + pdx * pos.uy) < 1.6) {
      target = Math.min(target, Math.max(0.8, (pAhead - 2.5) * 1.6));
    }
    // or each other
    for (const o of Traffic.riders) {
      if (o === r) continue;
      const op = riderPos(o);
      const dx = op.x - pos.x, dy = op.y - pos.y;
      const ahead = dx * pos.ux + dy * pos.uy;
      if (ahead > 0 && ahead < 6 && Math.abs(-dy * pos.ux + dx * pos.uy) < 1.2) {
        target = Math.min(target, Math.max(1, (ahead - 2) * 1.8));
      }
    }
    if (r.speed < target) r.speed = Math.min(target, r.speed + 5 * dt);
    else r.speed = Math.max(target, r.speed - 8 * dt);
    r.dist = (r.dist || 0) + r.speed * dt;
    r.t += r.speed * dt / s.len;
    if (r.t >= 1) {
      const opts = W.adjBike[endNode].filter(e => e.seg !== r.seg);
      const pool = opts.length ? opts : W.adjBike[endNode];
      if (!pool.length) { r.dead = true; continue; }
      let best = null, bestScore = -2;
      if (Math.random() < 0.7) {
        for (const e of pool) {
          const ns = W.segs[e.seg];
          const dir = e.rev ? -1 : 1;
          const npa = W.nodes[ns.a], npb = W.nodes[ns.b];
          const ux = (npb[0] - npa[0]) / ns.len * dir, uy = (npb[1] - npa[1]) / ns.len * dir;
          const score = ux * pos.ux + uy * pos.uy;
          if (score > bestScore) { bestScore = score; best = e; }
        }
      } else best = pool[(Math.random() * pool.length) | 0];
      r.seg = best.seg; r.rev = best.rev; r.t = 0;
    }
  }
  Traffic.riders = Traffic.riders.filter(r => !r.dead);
}

/* ---- door hazard: parked car near player swings a door ---- */
const openDoors = [];
function updateDoors(dt, player) {
  Traffic.doorTimer -= dt;
  if (Traffic.doorTimer <= 0 && player.riding && player.speed > 4) {
    Traffic.doorTimer = 10 + Math.random() * 12;
    // find parked car ahead of player within door-zone
    const hx = Math.cos(player.ang), hy = Math.sin(player.ang);
    let cand = null;
    for (const pc of W.parked) {
      const dx = pc.x - player.x, dy = pc.y - player.y;
      const ahead = dx * hx + dy * hy;
      if (ahead < 12 || ahead > 42) continue;
      const lat = Math.abs(-dy * hx + dx * hy);
      if (lat > 3.4 || lat < 1.0) continue;
      if (pc.door > 0) continue;
      cand = pc; break;
    }
    if (cand && Math.random() < 0.5) {
      cand.door = 3.5; // seconds open
      openDoors.push(cand);
      if (typeof Game !== "undefined") { Game.doorSound(); Game.doorBurst(cand); }
    }
  }
  for (let i = openDoors.length - 1; i >= 0; i--) {
    openDoors[i].door -= dt;
    if (openDoors[i].door <= 0) { openDoors[i].door = 0; openDoors.splice(i, 1); }
  }
}
