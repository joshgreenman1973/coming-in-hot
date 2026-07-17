/* ============ game.js — player, orders, economy, rendering, loop ============ */
"use strict";

const Game = {};
(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mmCanvas = document.getElementById("minimap");
  const mmCtx = mmCanvas.getContext("2d");
  let DPR = Math.min(devicePixelRatio || 1, 2);

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * DPR; canvas.height = innerHeight * DPR;
  }
  addEventListener("resize", resize); resize();

  /* ---------- state ---------- */
  const P = {
    x: 0, y: 0, ang: -Math.PI / 2, speed: 0, steer: 0,
    riding: true, walkX: 0, walkY: 0,
    battery: 1, food: 1, carrying: false,
    knock: 0, crashCd: 0, dist: 0, wobble: 0,
  };
  const bike = { x: 0, y: 0, ang: 0 }; // where the bike is parked when walking

  const S = {
    running: false, over: false,
    t: 0, gameT: 0,            // seconds since shift start; gameT for lights
    earned: 0, tips: 0, fees: 0, deliveries: 0, crashes: 0, tickets: 0, bestTip: 0,
    rain: false, muted: false,
    order: null, offer: null, offerT: 0, nextOfferT: 4,
    route: null, routeT: 0, phase: "idle", // idle | topickup | waiting | todrop | walking
    waitT: 0, msgT: 0,
  };
  const SHIFT_LEN = 480; // 8 real min = 6pm→2am

  /* ---------- input ---------- */
  const keys = {};
  addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (e.key === "Enter") acceptOffer();
    if (e.key === "Escape") declineOffer();
    if (e.key.toLowerCase() === "m") { S.muted = !S.muted; toast(S.muted ? "Sound off" : "Sound on"); }
    if (e.key.toLowerCase() === "e") interact();
  });
  addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

  // touch
  const touch = { gas: 0, brake: 0, left: 0, right: 0 };
  function bindTouch(id, prop) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = e => { e.preventDefault(); touch[prop] = 1; };
    const off = e => { e.preventDefault(); touch[prop] = 0; };
    el.addEventListener("touchstart", on); el.addEventListener("touchend", off);
    el.addEventListener("touchcancel", off);
  }
  bindTouch("t-gas", "gas"); bindTouch("t-brake", "brake");
  bindTouch("t-left", "left"); bindTouch("t-right", "right");
  const tE = document.getElementById("t-e");
  if (tE) tE.addEventListener("touchstart", e => { e.preventDefault(); if (S.offer) acceptOffer(); else interact(); });
  const isTouch = matchMedia("(pointer: coarse)").matches;

  /* ---------- audio ---------- */
  let AC = null, master = null;
  function audio() {
    if (!AC) { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.25; master.connect(AC.destination); }
    if (AC.state === "suspended") AC.resume();
    return AC;
  }
  function tone(freq, dur, type, vol, when, slide) {
    if (S.muted || !AC) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || "square"; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(slide, AC.currentTime + (when || 0) + dur);
    g.gain.setValueAtTime(0, AC.currentTime + (when || 0));
    g.gain.linearRampToValueAtTime(vol || 0.12, AC.currentTime + (when || 0) + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + (when || 0) + dur);
    o.connect(g); g.connect(master);
    o.start(AC.currentTime + (when || 0)); o.stop(AC.currentTime + (when || 0) + dur + 0.05);
  }
  function noise(dur, vol) {
    if (S.muted || !AC) return;
    const len = AC.sampleRate * dur, buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource(); src.buffer = buf;
    const g = AC.createGain(); g.gain.value = vol || 0.3;
    src.connect(g); g.connect(master); src.start();
  }
  Game.honk = pos => { const d = Math.hypot(pos.x - P.x, pos.y - P.y); tone(392, 0.28, "sawtooth", Math.max(0.02, 0.14 - d * 0.002)); tone(329, 0.28, "sawtooth", Math.max(0.015, 0.1 - d * 0.002)); };
  Game.doorSound = () => tone(180, 0.3, "sawtooth", 0.08, 0, 320);
  const dingSound = () => { tone(880, 0.12, "sine", 0.14); tone(1320, 0.25, "sine", 0.12, 0.1); };
  const cashSound = () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, "triangle", 0.13, i * 0.06)); };
  const thud = () => { noise(0.18, 0.4); tone(70, 0.25, "sine", 0.25, 0, 40); };

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  function toast(msg, kind) {
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    $("toast-stack").appendChild(el);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3200);
  }
  const fmtMoney = v => "$" + v.toFixed(2);
  function fmtClock() {
    const mins = 18 * 60 + Math.floor(S.t);
    let h = Math.floor(mins / 60) % 24, m = mins % 60;
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + String(m).padStart(2, "0") + " " + ap;
  }
  function hashInt(n) { n = ((n >> 16) ^ n) * 0x45d9f3b; n = ((n >> 16) ^ n) * 0x45d9f3b; return (n >> 16) ^ n; }

  function addressFor(nodeIdx) {
    // find a named segment near this node
    let name = "";
    for (const e of W.adjBike[nodeIdx]) { const s = W.segs[e.seg]; if (s.name) { name = s.name; break; } }
    if (!name) name = "the corner";
    const num = 80 + (Math.abs(hashInt(nodeIdx)) % 780);
    return num + " " + name;
  }

  /* ---------- orders ---------- */
  function makeOffer() {
    for (let tries = 0; tries < 30; tries++) {
      const r = W.restaurants[(Math.random() * W.restaurants.length) | 0];
      const dToR = Math.hypot(r.x - P.x, r.y - P.y);
      if (dToR > 700) continue;
      const rNode = nearestNode(r.x, r.y);
      // destination 350–1400m away
      const dNode = (Math.random() * W.nodes.length) | 0;
      const dp = W.nodes[dNode];
      const crow = Math.hypot(dp[0] - r.x, dp[1] - r.y);
      if (crow < 350 || crow > 1400) continue;
      const path = astar(rNode, dNode, true);
      if (!path || path.length < 2) continue;
      const len = pathLength(path);
      const estSec = dToR / 6 + len / 6.5 + 45;
      const fee = 3 + len * 0.0016 + Math.random() * 1.2;
      const tipBase = 1.5 + Math.random() * 4.5 + len * 0.0018;
      S.offer = {
        rest: r, restNode: rNode, destNode: dNode,
        destX: dp[0], destY: dp[1], addr: addressFor(dNode),
        fee, tipBase: tipBase * (S.rain ? 1.35 : 1),
        est: estSec, deadline: 0, routeLen: len,
      };
      S.offerT = 12;
      renderOffer();
      $("offer-card").classList.remove("hidden");
      dingSound();
      return;
    }
    S.nextOfferT = 3; // retry soon
  }

  function renderOffer() {
    const o = S.offer;
    const totalEst = o.fee + o.tipBase;
    $("offer-body").innerHTML =
      `<div class="t-head">NEW ORDER · ${fmtClock()}</div>
       <div class="t-rest">${o.rest.name}</div>
       <div class="t-cuisine">${o.rest.cuisine || "food"}</div>
       <div class="t-rule"></div>
       <div class="t-row"><span>Deliver to</span><b class="t-addr">${o.addr}</b></div>
       <div class="t-row"><span>Trip</span><b>${(o.routeLen / 1609 * 1.1).toFixed(1)} mi</b></div>
       <div class="t-row"><span>Quoted</span><b>${Math.ceil(o.est / 60)} min</b></div>
       <div class="t-rule"></div>
       <div class="t-row"><span>Est. payout</span><span class="t-money">${fmtMoney(totalEst)}</span></div>`;
  }

  function acceptOffer() {
    if (!S.offer || !S.running) return;
    S.order = S.offer;
    S.offer = null;
    $("offer-card").classList.add("hidden");
    S.order.deadline = S.t + S.order.est * 1.4;
    S.order.acceptT = S.t;
    S.phase = "topickup";
    P.food = 1; P.carrying = false;
    computeRoute();
    updateTicket();
    tone(660, 0.1, "sine", 0.12);
  }
  function declineOffer() {
    if (!S.offer) return;
    S.offer = null;
    $("offer-card").classList.add("hidden");
    S.nextOfferT = 5 + Math.random() * 8;
  }

  function updateTicket() {
    const o = S.order;
    if (!o) { $("order-ticket").classList.add("hidden"); return; }
    const status = S.phase === "topickup" ? "RIDE TO PICKUP" :
                   S.phase === "waiting" ? "KITCHEN IS FINISHING…" :
                   S.phase === "todrop" ? "FOOD ON BOARD — GO" :
                   "PARK + WALK IT IN";
    const left = Math.max(0, o.deadline - S.t);
    $("ticket-body").innerHTML =
      `<div class="t-head">ACTIVE ORDER</div>
       <div class="t-rest">${o.rest.name}</div>
       <div class="t-rule"></div>
       <div class="t-row"><span>To</span><b class="t-addr">${o.addr}</b></div>
       <div class="t-row"><span>Clock</span><b>${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}</b></div>
       <div class="t-rule"></div>
       <div class="t-status">${status}</div>`;
    $("order-ticket").classList.remove("hidden");
  }

  function computeRoute() {
    const o = S.order;
    if (!o) { S.route = null; return; }
    const from = nearestNode(P.x, P.y);
    const to = S.phase === "topickup" || S.phase === "waiting" ? o.restNode : o.destNode;
    S.route = astar(from, to, true);
    S.routeT = 0;
  }

  function targetPoint() {
    const o = S.order;
    if (!o) return null;
    if (S.phase === "topickup" || S.phase === "waiting") return { x: o.rest.x, y: o.rest.y, label: o.rest.name };
    return { x: o.destX, y: o.destY, label: o.addr };
  }

  function deliverPayout() {
    const o = S.order;
    const elapsed = S.t - o.acceptT;
    const timeFactor = elapsed <= o.est ? 1.15 : Math.max(0.25, 1.15 - (elapsed - o.est) / o.est * 1.3);
    const foodFactor = 0.35 + 0.65 * P.food;
    const tip = Math.max(0, o.tipBase * timeFactor * foodFactor + (Math.random() - 0.35));
    const total = o.fee + tip;
    S.earned += total; S.fees += o.fee; S.tips += tip; S.deliveries++;
    S.bestTip = Math.max(S.bestTip, tip);
    cashSound();
    $("earnings").classList.remove("bump"); void $("earnings").offsetWidth; $("earnings").classList.add("bump");
    toast(`Delivered · ${fmtMoney(o.fee)} fee + ${fmtMoney(tip)} tip`, "cash");
    if (tip < 1) toast("Stiffed on the tip. It happens.", "bad");
    else if (P.food < 0.6) toast("Food arrived shaken up — tip took a hit", "bad");
    S.order = null; S.phase = "idle"; S.route = null; P.carrying = false;
    updateTicket();
    S.nextOfferT = 5 + Math.random() * 9;
  }

  /* ---------- interactions ---------- */
  let prompt = null; // {text}
  let progress = null; // {label, t, dur, done}

  function interact() {
    if (!S.running) return;
    if (P.riding) {
      // dismount if slow
      if (Math.abs(P.speed) < 1.2) {
        P.riding = false;
        bike.x = P.x; bike.y = P.y; bike.ang = P.ang;
        if (S.phase === "todrop") { S.phase = "walking"; updateTicket(); }
        tone(300, 0.08, "square", 0.08);
      } else toast("Slow down to park", "bad");
    } else {
      const d = Math.hypot(bike.x - P.x, bike.y - P.y);
      if (d < 6) {
        P.riding = true;
        P.x = bike.x; P.y = bike.y; P.ang = bike.ang; P.speed = 0;
        if (S.phase === "walking") { S.phase = "todrop"; updateTicket(); }
        tone(400, 0.08, "square", 0.08);
      }
    }
  }

  /* ---------- player physics ---------- */
  function updatePlayer(dt) {
    const up = keys.w || keys.arrowup || touch.gas;
    const down = keys.s || keys.arrowdown || touch.brake;
    const left = keys.a || keys.arrowleft || touch.left;
    const right = keys.d || keys.arrowright || touch.right;

    if (!P.riding) {
      // walking
      const wspd = 2.6;
      let vx = 0, vy = 0;
      if (up) vy -= 1; if (down) vy += 1; if (left) vx -= 1; if (right) vx += 1;
      const l = Math.hypot(vx, vy);
      if (l > 0) {
        vx /= l; vy /= l;
        const nx = P.x + vx * wspd * dt, ny = P.y + vy * wspd * dt;
        const st = closestStreet(nx, ny);
        if (st && st.d < ROAD_HALF[W.segs[st.seg].cls] + SIDEWALK + 6) { P.x = nx; P.y = ny; }
        P.ang = Math.atan2(vy, vx);
      }
      return;
    }

    if (P.knock > 0) { P.knock -= dt; P.speed *= 0.94; }

    const st = closestStreet(P.x, P.y);
    const seg = st ? W.segs[st.seg] : null;
    const onSidewalk = st && seg && st.d > ROAD_HALF[seg.cls] + 0.5;
    const grip = S.rain ? 0.72 : 1;

    // battery + top speed
    const battOK = P.battery > 0.12;
    let vmax = battOK ? 11.2 : 5.6;               // ~25 mph / ~12 mph
    if (onSidewalk) vmax = Math.min(vmax, 4.2);
    if (P.knock > 0) vmax = Math.min(vmax, 2);

    const accel = battOK ? 4.2 : 2.2;
    if (up) { P.speed = Math.min(vmax, P.speed + accel * dt); P.battery = Math.max(0, P.battery - dt * 0.00042 * (P.speed + 3)); }
    else if (down) P.speed = P.speed > 0.3 ? Math.max(0, P.speed - (S.rain ? 5.5 : 8.5) * dt) : Math.max(-2.2, P.speed - 2.5 * dt);
    else P.speed *= (1 - 0.35 * dt);

    // steering (bicycle-ish)
    const steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
    P.steer += (steerTarget - P.steer) * Math.min(1, dt * (S.rain ? 6 : 9));
    const sf = Math.min(1, Math.abs(P.speed) / 3.5);
    P.ang += P.steer * 2.4 * sf * grip * dt * Math.sign(P.speed || 1);
    if (onSidewalk) P.wobble = Math.min(1, P.wobble + dt * 2); else P.wobble *= (1 - dt * 3);

    const nx = P.x + Math.cos(P.ang) * P.speed * dt;
    const ny = P.y + Math.sin(P.ang) * P.speed * dt;

    // building collision: cannot leave street + sidewalk envelope
    const stN = closestStreet(nx, ny);
    if (stN) {
      const lim = ROAD_HALF[W.segs[stN.seg].cls] + SIDEWALK;
      if (stN.d > lim) {
        // slide along: project back toward street
        const px = stN.px, py = stN.py;
        const dx = nx - px, dy = ny - py;
        const dd = Math.hypot(dx, dy) || 1;
        P.x = px + dx / dd * lim; P.y = py + dy / dd * lim;
        if (P.speed > 4) { P.food = Math.max(0, P.food - 0.08); thud(); }
        P.speed *= 0.35;
      } else { P.x = nx; P.y = ny; }
    } else { P.x = nx; P.y = ny; }

    // map bounds
    const B = W.bounds, M = 20;
    P.x = Math.max(B.minX + M, Math.min(B.maxX - M, P.x));
    P.y = Math.max(B.minY + M, Math.min(B.maxY - M, P.y));

    P.dist += Math.abs(P.speed) * dt;

    /* --- collisions --- */
    if (P.crashCd > 0) { P.crashCd -= dt; }
    else {
      // moving cars
      for (const car of Traffic.cars) {
        const cp = carPos(car);
        const d = Math.hypot(cp.x - P.x, cp.y - P.y);
        if (d < 2.3) {
          const closing = Math.abs(P.speed) + car.speed;
          if (closing > 2.5) crash("Clipped by a car", 0.3);
          else { P.speed *= 0.3; }
          break;
        }
      }
      // parked cars
      if (Math.abs(P.speed) > 2) {
        for (const pc of W.parked) {
          const dx = pc.x - P.x, dy = pc.y - P.y;
          if (dx * dx + dy * dy < 4.6) {
            if (pc.door > 0) crash("DOORED", 0.42);
            else crash("Hit a parked car", 0.18);
            break;
          }
        }
      } else if (P.speed > 3) {}
      // open doors (wider zone than the car body)
      for (const pc of openDoors) {
        const doorX = pc.x - Math.sin(pc.ang) * -2.0, doorY = pc.y + Math.cos(pc.ang) * -2.0;
        const d = Math.hypot(doorX - P.x, doorY - P.y);
        if (d < 1.7 && Math.abs(P.speed) > 3) { crash("DOORED", 0.42); break; }
      }
      // pedestrians
      for (const ped of Traffic.peds) {
        const pp = pedPos(ped);
        if (Math.hypot(pp.x - P.x, pp.y - P.y) < 1.5 && Math.abs(P.speed) > 2) {
          crash("You clipped a pedestrian", 0.25);
          S.earned = Math.max(0, S.earned - 5);
          toast("-$5.00 · watch the sidewalk", "bad");
          break;
        }
      }
      // red-light ticket (rare)
      if (Math.abs(P.speed) > 4 && seg) {
        for (const ni of [seg.a, seg.b]) {
          const li = W.nodeLight[ni];
          if (li === undefined) continue;
          const np = W.nodes[ni];
          const d = Math.hypot(np[0] - P.x, np[1] - P.y);
          if (d < 6 && lightState(W.lights[li], P.ang, S.gameT) === "r") {
            if (Math.random() < 0.0025) {
              S.tickets++; S.earned = Math.max(0, S.earned - 25);
              toast("Red-light ticket · -$25.00", "bad");
              tone(740, 0.5, "square", 0.1, 0, 700);
              P.crashCd = 3;
            }
          }
        }
      }
    }

    function crash(msg, dmg) {
      S.crashes++;
      P.crashCd = 2.2; P.knock = 1.1;
      P.speed = Math.min(P.speed, 0.8);
      if (P.carrying) P.food = Math.max(0, P.food - dmg);
      thud();
      toast(msg + (P.carrying ? " · food took a hit" : ""), "bad");
    }
  }

  /* ---------- order state machine ---------- */
  function updateOrders(dt) {
    if (S.offer) {
      S.offerT -= dt;
      $("offer-timer-bar").style.width = Math.max(0, S.offerT / 12 * 100) + "%";
      if (S.offerT <= 0) declineOffer();
    } else if (!S.order && S.phase === "idle") {
      S.nextOfferT -= dt;
      if (S.nextOfferT <= 0 && S.t < SHIFT_LEN - 60) makeOffer();
    }

    prompt = null;
    const o = S.order;
    if (!o) {
      if (!P.riding) {
        const d = Math.hypot(bike.x - P.x, bike.y - P.y);
        if (d < 6) prompt = { text: "<b>E</b> — hop on the bike" };
      }
      return;
    }

    if (S.phase === "topickup") {
      const d = Math.hypot(o.rest.x - P.x, o.rest.y - P.y);
      if (d < 16 && Math.abs(P.speed) < 1) {
        S.phase = "waiting";
        S.waitT = 1.5 + Math.random() * (Math.random() < 0.2 ? 6 : 2.5); // sometimes the kitchen is slow
        updateTicket();
      } else if (d < 30) prompt = { text: "Stop at <b>" + o.rest.name + "</b> to pick up" };
    } else if (S.phase === "waiting") {
      const d = Math.hypot(o.rest.x - P.x, o.rest.y - P.y);
      if (d > 18) { S.phase = "topickup"; progress = null; updateTicket(); return; }
      if (!progress) progress = { label: "WAITING ON THE KITCHEN", t: 0, dur: S.waitT };
      progress.t += dt;
      if (progress.t >= progress.dur) {
        progress = null;
        P.carrying = true; P.food = 1;
        S.phase = "todrop";
        computeRoute(); updateTicket();
        dingSound();
        toast("Order up — " + o.rest.name);
      }
    } else if (S.phase === "todrop" || S.phase === "walking") {
      const d = Math.hypot(o.destX - P.x, o.destY - P.y);
      if (P.riding) {
        if (d < 28) prompt = { text: "<b>E</b> — park the bike, walk it in" };
      } else {
        if (d < 8) {
          if (!progress) progress = { label: "HANDING IT OFF", t: 0, dur: 1.2 };
          progress.t += dt;
          if (progress.t >= progress.dur) { progress = null; deliverPayout(); }
        } else {
          const bd = Math.hypot(bike.x - P.x, bike.y - P.y);
          prompt = bd < 6 && d > 40 ? { text: "<b>E</b> — hop on the bike" } : { text: "Walk to the door · " + Math.round(d) + "m" };
        }
      }
      // ticking clock anxiety
      if (S.t > o.deadline && !o.lateWarned) { o.lateWarned = true; toast("You're past the quote — tip is melting", "bad"); }
    }

    // route recompute if strayed
    if (S.route && P.riding) {
      S.routeT += dt;
      if (S.routeT > 1.5) {
        S.routeT = 0;
        let minD = 1e9;
        for (const ni of S.route) { const p = W.nodes[ni]; const d = Math.hypot(p[0] - P.x, p[1] - P.y); if (d < minD) minD = d; }
        if (minD > 70) computeRoute();
      }
    }
  }

  /* ---------- rendering ---------- */
  let roofPattern = null;
  function makeRoofPattern() {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#211d20"; g.fillRect(0, 0, 96, 96);
    const rnd = mulberry(7);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 96, y = rnd() * 96, w = 8 + rnd() * 18, h = 8 + rnd() * 18;
      const shade = ["#262126", "#2a2326", "#252028", "#2d2624", "#231f24"][(rnd() * 5) | 0];
      g.fillStyle = shade; g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,.03)"; g.fillRect(x, y, w, 1.5);
    }
    // occasional lit window
    for (let i = 0; i < 10; i++) {
      g.fillStyle = "rgba(255,190,90," + (0.05 + rnd() * 0.1) + ")";
      g.fillRect(rnd() * 94, rnd() * 94, 2, 2);
    }
    roofPattern = ctx.createPattern(c, "repeat");
  }

  let lampSprite = null;
  function makeLampSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,190,100,.09)");
    grad.addColorStop(0.4, "rgba(255,170,70,.035)");
    grad.addColorStop(1, "rgba(255,160,60,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    lampSprite = c;
  }

  const cam = { x: 0, y: 0, z: 3.4 };
  function render() {
    const w = canvas.width, h = canvas.height;
    const zBase = (isTouch ? 4.6 : 5.8) * DPR;
    const zoomOut = Math.min(0.55, Math.abs(P.speed) * 0.045);
    const zTarget = zBase * (1 - zoomOut * 0.25);
    cam.z += (zTarget - cam.z) * 0.03;
    const lookX = P.x + Math.cos(P.ang) * Math.min(30, P.speed * 2.6) * (P.riding ? 1 : 0);
    const lookY = P.y + Math.sin(P.ang) * Math.min(30, P.speed * 2.6) * (P.riding ? 1 : 0);
    cam.x += (lookX - cam.x) * 0.06; cam.y += (lookY - cam.y) * 0.06;

    const z = cam.z;
    const vw = w / z, vh = h / z;
    const vx0 = cam.x - vw / 2, vy0 = cam.y - vh / 2;

    // rooftops base
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1d191c"; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(z, 0, 0, z, -vx0 * z, -vy0 * z);
    if (roofPattern) {
      ctx.save(); ctx.fillStyle = roofPattern;
      const sc = 0.55; ctx.scale(sc, sc);
      ctx.fillRect(vx0 / sc, vy0 / sc, vw / sc, vh / sc);
      ctx.restore();
    }

    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // sidewalk casing
    for (const c of [3, 2, 1]) {
      ctx.strokeStyle = "#39343a";
      ctx.lineWidth = (ROAD_HALF[c] + SIDEWALK) * 2;
      ctx.stroke(W.paths[c]);
    }
    // asphalt
    for (const c of [3, 2, 1]) {
      ctx.strokeStyle = c === 3 ? "#232227" : "#26252a";
      ctx.lineWidth = ROAD_HALF[c] * 2;
      ctx.stroke(W.paths[c]);
    }
    // center dashes on bigger streets
    ctx.strokeStyle = "rgba(230,220,160,.28)";
    ctx.lineWidth = 0.35;
    ctx.setLineDash([4, 6]);
    for (const c of [3, 2]) ctx.stroke(W.dashPaths[c]);
    ctx.setLineDash([]);
    // bike lanes
    ctx.strokeStyle = "rgba(60,160,90,.30)";
    ctx.lineWidth = 1.6;
    ctx.stroke(W.bikePaths);

    // route
    if (S.route && S.route.length > 1) {
      ctx.strokeStyle = "rgba(255,179,71,.55)";
      ctx.lineWidth = 1.7;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -S.t * 14;
      ctx.beginPath();
      const p0 = W.nodes[S.route[0]];
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < S.route.length; i++) { const p = W.nodes[S.route[i]]; ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // parked cars (culled)
    for (const pc of W.parked) {
      if (pc.x < vx0 - 10 || pc.x > vx0 + vw + 10 || pc.y < vy0 - 10 || pc.y > vy0 + vh + 10) continue;
      ctx.save(); ctx.translate(pc.x, pc.y); ctx.rotate(pc.ang);
      ctx.fillStyle = pc.col;
      roundRect(-2.2, -0.95, 4.4, 1.9, 0.5); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.28)";
      roundRect(-0.9, -0.8, 1.9, 1.6, 0.3); ctx.fill();
      if (pc.door > 0) {
        ctx.strokeStyle = pc.col; ctx.lineWidth = 0.28;
        ctx.beginPath(); ctx.moveTo(0.3, -0.95); ctx.lineTo(1.15, -2.1); ctx.stroke();
      }
      ctx.restore();
    }

    // traffic lights (dots at signal nodes near view)
    for (const light of W.lights) {
      if (light.x < vx0 - 20 || light.x > vx0 + vw + 20 || light.y < vy0 - 20 || light.y > vy0 + vh + 20) continue;
      const stNS = lightState(light, Math.PI / 2, S.gameT);
      const stEW = lightState(light, 0, S.gameT);
      drawLightDot(light.x - 2.6, light.y - 2.6, stNS, true);
      drawLightDot(light.x + 2.6, light.y - 2.6, stEW, false);
    }

    // moving cars
    for (const car of Traffic.cars) {
      const cp = carPos(car);
      ctx.save(); ctx.translate(cp.x, cp.y); ctx.rotate(cp.ang);
      // headlight cone
      ctx.fillStyle = "rgba(255,240,190,.07)";
      ctx.beginPath(); ctx.moveTo(2, -0.7); ctx.lineTo(11, -2.6); ctx.lineTo(11, 2.6); ctx.lineTo(2, 0.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = car.col;
      roundRect(-2.25, -1, 4.5, 2, 0.5); ctx.fill();
      ctx.fillStyle = "rgba(10,10,14,.4)";
      roundRect(-0.9, -0.85, 2, 1.7, 0.3); ctx.fill();
      ctx.fillStyle = "#fff2c8"; ctx.fillRect(2.05, -0.85, 0.3, 0.5); ctx.fillRect(2.05, 0.35, 0.3, 0.5);
      ctx.fillStyle = "#e33"; ctx.fillRect(-2.3, -0.85, 0.25, 0.5); ctx.fillRect(-2.3, 0.35, 0.25, 0.5);
      ctx.restore();
    }

    // pedestrians
    for (const ped of Traffic.peds) {
      const pp = pedPos(ped);
      ctx.fillStyle = ped.col;
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 0.55, 0, 7); ctx.fill();
      if (ped.dog) { ctx.fillStyle = "#8a6f52"; ctx.beginPath(); ctx.arc(pp.x + 1.1, pp.y + 0.4, 0.3, 0, 7); ctx.fill(); }
    }

    // restaurant + destination markers
    const tp = targetPoint();
    if (tp) {
      const pulse = 1 + Math.sin(S.t * 5) * 0.18;
      ctx.strokeStyle = S.phase === "todrop" || S.phase === "walking" ? "rgba(111,224,138,.8)" : "rgba(255,77,46,.8)";
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 7 * pulse, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 2.2, 0, 7); ctx.stroke();
      ctx.font = "600 3.2px 'IBM Plex Mono'";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(244,239,228,.95)";
      ctx.fillText(tp.label, tp.x, tp.y - 9 * pulse);
    }

    // parked bike (when walking)
    if (!P.riding) drawBike(bike.x, bike.y, bike.ang, false);

    // player
    if (P.riding) drawBike(P.x, P.y, P.ang, true);
    else {
      ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(P.ang);
      ctx.fillStyle = "#f4efe4"; ctx.beginPath(); ctx.arc(0, 0, 0.7, 0, 7); ctx.fill();
      if (P.carrying) { ctx.fillStyle = "#ff4d2e"; ctx.fillRect(-0.4, -1.3, 0.9, 0.7); }
      ctx.restore();
    }

    // night: lamp glow
    ctx.globalCompositeOperation = "lighter";
    for (const lamp of W.lamps) {
      if (lamp.x < vx0 - 40 || lamp.x > vx0 + vw + 40 || lamp.y < vy0 - 40 || lamp.y > vy0 + vh + 40) continue;
      ctx.drawImage(lampSprite, lamp.x - lamp.r, lamp.y - lamp.r, lamp.r * 2, lamp.r * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    // rain
    if (S.rain) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "rgba(180,200,230,.13)";
      ctx.lineWidth = 1 * DPR;
      ctx.beginPath();
      const t = S.t * 900;
      for (let i = 0; i < 60; i++) {
        const rx = (i * 379 + t) % (w + 200) - 100;
        const ry = (i * 211 + t * 1.7) % (h + 80) - 40;
        ctx.moveTo(rx, ry); ctx.lineTo(rx - 4 * DPR, ry + 14 * DPR);
      }
      ctx.stroke();
    }

    // vignette
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(8,8,14,0)");
    vg.addColorStop(1, "rgba(6,6,12,.55)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

  function drawLightDot(x, y, st, ns) {
    ctx.fillStyle = st === "g" ? "#4dd06a" : st === "y" ? "#ffd24d" : "#ff4d4d";
    ctx.beginPath(); ctx.arc(x, y, 0.75, 0, 7); ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBike(x, y, ang, ridden) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    if (ridden && P.wobble > 0.1) ctx.rotate(Math.sin(S.t * 22) * 0.06 * P.wobble);
    // headlight
    if (ridden) {
      ctx.fillStyle = "rgba(255,250,220,.1)";
      ctx.beginPath(); ctx.moveTo(1, -0.4); ctx.lineTo(9, -2.4); ctx.lineTo(9, 2.4); ctx.lineTo(1, 0.4); ctx.closePath(); ctx.fill();
    }
    // wheels
    ctx.strokeStyle = "#111"; ctx.lineWidth = 0.34;
    ctx.beginPath(); ctx.moveTo(0.85, 0); ctx.lineTo(1.55, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.lineTo(-0.8, 0); ctx.stroke();
    // frame
    ctx.strokeStyle = "#e8e2d2"; ctx.lineWidth = 0.22;
    ctx.beginPath(); ctx.moveTo(-1.1, 0); ctx.lineTo(1.1, 0); ctx.stroke();
    // rider
    if (ridden) {
      ctx.fillStyle = "#2f6db5"; // rain-jacket blue
      ctx.beginPath(); ctx.ellipse(0.1, 0, 0.85, 0.55, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#1c1c22"; ctx.beginPath(); ctx.arc(0.5, 0, 0.34, 0, 7); ctx.fill(); // helmet
    }
    // delivery bag on the rack
    ctx.fillStyle = P.carrying || !ridden ? "#ff4d2e" : "#a83a26";
    ctx.fillRect(-1.85, -0.5, 1.0, 1.0);
    ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 0.08; ctx.strokeRect(-1.85, -0.5, 1.0, 1.0);
    ctx.restore();
  }

  /* ---------- minimap ---------- */
  function renderMinimap() {
    mmCtx.setTransform(1, 0, 0, 1, 0, 0);
    mmCtx.drawImage(W.minimapCanvas, 0, 0);
    const X = W.mmXform;
    const mx = v => v * X.scale + X.ox, my = v => v * X.scale + X.oy;
    if (S.route) {
      mmCtx.strokeStyle = "rgba(255,179,71,.8)"; mmCtx.lineWidth = 2;
      mmCtx.beginPath();
      const p0 = W.nodes[S.route[0]];
      mmCtx.moveTo(mx(p0[0]), my(p0[1]));
      for (let i = 1; i < S.route.length; i++) { const p = W.nodes[S.route[i]]; mmCtx.lineTo(mx(p[0]), my(p[1])); }
      mmCtx.stroke();
    }
    const tp = targetPoint();
    if (tp) {
      mmCtx.fillStyle = S.phase === "todrop" || S.phase === "walking" ? "#6fe08a" : "#ff4d2e";
      mmCtx.beginPath(); mmCtx.arc(mx(tp.x), my(tp.y), 5, 0, 7); mmCtx.fill();
    }
    if (!P.riding) { mmCtx.fillStyle = "#58c7f3"; mmCtx.beginPath(); mmCtx.arc(mx(bike.x), my(bike.y), 3.4, 0, 7); mmCtx.fill(); }
    mmCtx.fillStyle = "#f4efe4";
    mmCtx.beginPath(); mmCtx.arc(mx(P.x), my(P.y), 4.4, 0, 7); mmCtx.fill();
    mmCtx.strokeStyle = "rgba(244,239,228,.6)"; mmCtx.lineWidth = 1.4;
    mmCtx.beginPath(); mmCtx.arc(mx(P.x), my(P.y), 7.5, 0, 7); mmCtx.stroke();
  }

  /* ---------- HUD ---------- */
  let lastHud = 0;
  function renderHud() {
    if (S.t - lastHud > 0.2) {
      lastHud = S.t;
      $("clock").textContent = fmtClock();
      $("earnings").textContent = fmtMoney(S.earned);
      $("speed-num").textContent = Math.round(Math.abs(P.speed) * 2.237);
      $("batt-bar").style.width = (P.battery * 100) + "%";
      $("batt-bar").className = P.battery < 0.15 ? "low" : "";
      $("food-row").style.visibility = P.carrying ? "visible" : "hidden";
      $("food-bar").style.width = (P.food * 100) + "%";
      const st = closestStreet(P.x, P.y);
      $("street-label").textContent = st && W.segs[st.seg].name ? W.segs[st.seg].name : "";
      if (S.order) updateTicket();
    }
    const pEl = $("interact-prompt");
    if (prompt) { pEl.innerHTML = prompt.text; pEl.classList.remove("hidden"); }
    else pEl.classList.add("hidden");
    const pw = $("progress-wrap");
    if (progress) {
      pw.classList.remove("hidden");
      $("progress-label").textContent = progress.label;
      $("progress-bar").style.width = Math.min(100, progress.t / progress.dur * 100) + "%";
    } else pw.classList.add("hidden");
  }

  /* ---------- shift end ---------- */
  function endShift() {
    S.running = false; S.over = true;
    const best = Math.max(S.earned, +(localStorage.getItem("deliverista-best") || 0));
    localStorage.setItem("deliverista-best", best);
    const perHr = S.earned / (SHIFT_LEN / 3600) / 60; // per game-hour ≈ per real 60s… show per shift instead
    const grade = S.earned >= 120 ? "S" : S.earned >= 85 ? "A" : S.earned >= 55 ? "B" : S.earned >= 30 ? "C" : "D";
    $("shift-summary").innerHTML =
      `<div class="t-head">SHIFT RECEIPT · 6:00 PM – 2:00 AM</div>
       <div class="t-rest">Grade: ${grade}</div>
       <div class="t-rule"></div>
       <div class="t-row"><span>Deliveries</span><b>${S.deliveries}</b></div>
       <div class="t-row"><span>Base fees</span><b>${fmtMoney(S.fees)}</b></div>
       <div class="t-row"><span>Tips</span><b>${fmtMoney(S.tips)}</b></div>
       <div class="t-row"><span>Best tip</span><b>${fmtMoney(S.bestTip)}</b></div>
       <div class="t-row"><span>Miles ridden</span><b>${(P.dist / 1609).toFixed(1)}</b></div>
       <div class="t-row"><span>Crashes</span><b>${S.crashes}</b></div>
       <div class="t-row"><span>Tickets</span><b>${S.tickets}</b></div>
       <div class="t-rule"></div>
       <div class="t-row"><span><b>TOTAL</b></span><span class="t-money">${fmtMoney(S.earned)}</span></div>
       <div class="t-row"><span>Personal best</span><b>${fmtMoney(best)}</b></div>
       <div class="t-rule"></div>`;
    $("shift-end").classList.remove("hidden");
    $("hud").classList.add("hidden");
  }

  /* ---------- main loop ---------- */
  let last = 0, lastTick = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    tick(ts);
  }
  // fallback ticker: keeps the sim alive when rAF is throttled (backgrounded tab)
  setInterval(() => {
    const now = performance.now();
    if (now - lastTick > 90) tick(now);
  }, 33);
  function simUpdate(dt) {
    S.t += dt; S.gameT += dt;
    updatePlayer(dt);
    updateCars(dt, S.gameT, P);
    updatePeds(dt, P.x, P.y);
    updateDoors(dt, { ...P, riding: P.riding });
    updateOrders(dt);
    if (S.t >= SHIFT_LEN) { endShift(); }
  }
  function tick(ts) {
    if (!W.ready) return;
    lastTick = performance.now();
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (S.running) {
      simUpdate(dt);
      renderHud();
    }
    render();
    if (S.running) renderMinimap();
  }
  requestAnimationFrame(loop);
  // deterministic stepper for scripted playtests: advance the sim n seconds
  Game.step = (secs, dtStep) => {
    const dt = dtStep || 1 / 60;
    for (let t = 0; t < secs && S.running; t += dt) simUpdate(dt);
    renderHud(); render();
    if (S.running) renderMinimap();
  };
  Game.keys = keys;

  /* ---------- boot ---------- */
  function startShift() {
    // spawn near Smith & Union-ish (center-west of map)
    const start = closestStreet(-600, 300) || closestStreet(0, 0);
    if (start) { P.x = start.px; P.y = start.py; }
    P.speed = 0; P.battery = 1; P.riding = true; P.carrying = false;
    P.dist = 0; P.knock = 0;
    Object.assign(S, {
      running: true, over: false, t: 0, earned: 0, tips: 0, fees: 0,
      deliveries: 0, crashes: 0, tickets: 0, bestTip: 0,
      order: null, offer: null, nextOfferT: 3.5, phase: "idle", route: null,
      rain: Math.random() < 0.3,
    });
    Traffic.cars = []; Traffic.peds = [];
    cam.x = P.x; cam.y = P.y;
    cam.z = (isTouch ? 4.6 : 5.8) * DPR;
    $("title-screen").classList.add("fading");
    $("shift-end").classList.add("hidden");
    $("hud").classList.remove("hidden");
    if (isTouch) $("touch-ui").classList.remove("hidden");
    audio();
    toast(S.rain ? "Rain tonight — tips run hot, brakes run long" : "Clear night. Dinner rush is on.");
  }

  document.getElementById("start-btn").addEventListener("click", startShift);
  document.getElementById("again-btn").addEventListener("click", startShift);
  document.getElementById("about-btn").addEventListener("click", () => $("about-pop").classList.toggle("hidden"));
  document.getElementById("about-close").addEventListener("click", () => $("about-pop").classList.add("hidden"));

  Game.debug = () => ({ t: S.t, running: S.running, phase: S.phase, x: P.x, y: P.y, speed: P.speed, cars: Traffic.cars.length, peds: Traffic.peds.length, offer: !!S.offer, order: !!S.order });
  Game.S = S; Game.P = P;

  makeRoofPattern(); makeLampSprite();
  loadWorld().then(() => {
    $("title-map-note").textContent =
      W.restaurants.length + " real restaurants · the real streets of Carroll Gardens, Boerum Hill, Gowanus + Park Slope";
    const btn = document.getElementById("start-btn");
    btn.disabled = false;
  }).catch(err => {
    $("title-map-note").textContent = "Map failed to load — " + err.message;
  });
})();
