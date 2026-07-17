/* ============ actors.js — traffic cars, pedestrians, door hazards ============ */
"use strict";

const Traffic = {
  cars: [], peds: [], MAX_CARS: 55, MAX_PEDS: 70,
  doorTimer: 0,
};

/* speed limits m/s by class (city ~25mph on avenues, slower on side streets) */
const CAR_SPEED = { 1: 6.5, 2: 9.5, 3: 11.5 };
const MOVING_COLORS = ["#c9c2ae", "#8f959e", "#5a616b", "#3d434c", "#7d5340", "#a8a8a8", "#333840", "#e0d9c5", "#57636e", "#f0c93c"]; // last = taxi

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

    // player ahead → brake + honk
    const pdx = px - pos.x, pdy = py - pos.y;
    const pAhead = pdx * pos.ux + pdy * pos.uy;
    if (pAhead > 0 && pAhead < 12 && Math.abs(-pdy * pos.ux + pdx * pos.uy) < 2.2) {
      target = Math.min(target, Math.max(0, (pAhead - 4.5) * 1.4));
      if (pAhead < 8 && car.speed > 1 && car.honk <= 0) { car.honk = 3 + Math.random() * 4; Game && Game.honk(pos); }
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
    Traffic.peds.push({
      seg: si, t: Math.random(), side, dir: Math.random() < 0.5 ? -1 : 1,
      speed: 1.1 + Math.random() * 0.7,
      col: ["#c9b8a0", "#8a92a8", "#a87878", "#7f9a80", "#b0a34e", "#9a86b8"][(Math.random() * 6) | 0],
      crossing: 0, dog: Math.random() < 0.12,
    });
    return true;
  }
  return false;
}

function pedPos(ped) {
  const s = W.segs[ped.seg];
  const pa = W.nodes[s.a], pb = W.nodes[s.b];
  const x = pa[0] + (pb[0] - pa[0]) * ped.t, y = pa[1] + (pb[1] - pa[1]) * ped.t;
  const ux = (pb[0] - pa[0]) / s.len, uy = (pb[1] - pa[1]) / s.len;
  const off = (ROAD_HALF[s.cls] + SIDEWALK * 0.55) * ped.side * (1 - ped.crossing) ;
  return { x: x - uy * off, y: y + ux * off };
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
    const s = W.segs[ped.seg];
    ped.t += ped.dir * ped.speed * dt / s.len;
    // occasionally cross the street
    if (ped.crossing > 0) {
      ped.crossing = Math.max(0, ped.crossing - dt * 0.25);
      if (ped.crossing === 0) ped.side *= -1;
    } else if (Math.random() < dt * 0.012) ped.crossing = 1;
    if (ped.t < 0 || ped.t > 1) {
      // hop to adjacent segment
      const node = ped.t < 0 ? s.a : s.b;
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

/* ---- door hazard: parked car near player swings a door ---- */
const openDoors = [];
function updateDoors(dt, player) {
  Traffic.doorTimer -= dt;
  if (Traffic.doorTimer <= 0 && player.riding && player.speed > 4) {
    Traffic.doorTimer = 4 + Math.random() * 7;
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
      if (typeof Game !== "undefined") Game.doorSound();
    }
  }
  for (let i = openDoors.length - 1; i >= 0; i--) {
    openDoors[i].door -= dt;
    if (openDoors[i].door <= 0) { openDoors[i].door = 0; openDoors.splice(i, 1); }
  }
}
