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
    knock: 0, crashCd: 0, dist: 0, wobble: 0, sidewalkT: 0,
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
    if (e.key.toLowerCase() === "v") toggleView();
    if (e.key.toLowerCase() === "e") interact();
  });
  addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

  // touch (pointer events so it also works with mouse-drag on hybrids)
  const touch = { gas: 0, brake: 0, left: 0, right: 0 };
  function bindTouch(id, prop) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = e => { e.preventDefault(); touch[prop] = 1; el.classList.add("pressed"); };
    const off = e => { e.preventDefault(); touch[prop] = 0; el.classList.remove("pressed"); };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("pointerleave", off);
  }
  bindTouch("t-gas", "gas"); bindTouch("t-brake", "brake");
  bindTouch("t-left", "left"); bindTouch("t-right", "right");
  const tE = document.getElementById("t-e");
  if (tE) tE.addEventListener("pointerdown", e => { e.preventDefault(); interact(); });
  const isTouch = matchMedia("(pointer: coarse)").matches || innerWidth < 500;
  if (isTouch) document.body.classList.add("touch");
  const EKEY = () => isTouch ? "P" : "E";

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
  Game.honk = pos => {
    const d = Math.hypot(pos.x - P.x, pos.y - P.y);
    tone(392, 0.28, "sawtooth", Math.max(0.02, 0.14 - d * 0.002));
    tone(329, 0.28, "sawtooth", Math.max(0.015, 0.1 - d * 0.002));
    burst(pos.x, pos.y - 2.5, "HONK!", "#ffd24d", 2.6);
  };
  let lastBusHonk = -9;
  Game.busHonk = pos => {
    if (S.t - lastBusHonk < 2.5) return;
    lastBusHonk = S.t;
    tone(180, 0.6, "sawtooth", 0.16); tone(150, 0.6, "sawtooth", 0.13);
    burst(pos.x, pos.y - 3, "HOOONK!", "#ffd24d", 3.4);
  };
  Game.doorSound = () => tone(180, 0.3, "sawtooth", 0.08, 0, 320);
  Game.doorBurst = pc => burst(pc.x, pc.y - 2, "CLACK!", "#f7f1e3", 2.2);

  /* ---------- comic bursts (world-space) ---------- */
  const FX = [];
  function burst(x, y, text, color, size) {
    FX.push({ x, y, text, color, size: size || 2.6, t0: S.t });
    if (FX.length > 14) FX.shift();
  }
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
  const shiftT = () => S.t - (S.tutConsumed || 0);
  function fmtClock() {
    const mins = 18 * 60 + Math.floor(shiftT());
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
  const ORDER_TYPES = [
    { key: "standard", w: 0.55, badge: "", tipMult: 1, feeAdd: 0, dlMult: 1.25, frag: 1, items: [2, 4] },
    { key: "rush", w: 0.16, badge: "🔥 HOT RUSH", cls: "rush", tipMult: 1.55, feeAdd: 0.5, dlMult: 0.8, frag: 1, items: [1, 3] },
    { key: "big", w: 0.15, badge: "🎉 BIG ORDER", cls: "big", tipMult: 1.35, feeAdd: 3, dlMult: 1.5, frag: 1.25, items: [4, 7], heavy: true },
    { key: "fragile", w: 0.14, badge: "🥤 SOUP + DRINKS", cls: "fragile", tipMult: 1.25, feeAdd: 0, dlMult: 1.3, frag: 2.1, items: [2, 4] },
  ];
  const MENU = [
    ["pizza", ["grandma slice", "pepperoni pie", "garlic knots", "calzone", "caesar salad", "baked ziti"]],
    ["mexican", ["al pastor tacos", "carnitas burrito", "chips + guac", "elote", "horchata", "quesadilla"]],
    ["japanese", ["spicy tuna roll", "salmon avocado roll", "miso soup", "gyoza", "chirashi bowl", "seaweed salad"]],
    ["sushi", ["dragon roll", "salmon nigiri", "miso soup", "edamame", "rainbow roll"]],
    ["chinese", ["pork dumplings", "lo mein", "general tso's", "scallion pancakes", "hot + sour soup", "fried rice"]],
    ["thai", ["pad thai", "green curry", "spring rolls", "tom yum", "mango sticky rice", "drunken noodles"]],
    ["coffee", ["oat milk latte", "cold brew", "croissant", "avocado toast", "matcha", "everything bagel"]],
    ["cafe", ["cappuccino", "BLT on a roll", "granola bowl", "iced chai", "banana bread"]],
    ["burger", ["smash burger", "waffle fries", "black + white shake", "onion rings", "spicy chicken sando"]],
    ["american", ["smash burger", "waffle fries", "milkshake", "cobb salad", "wings", "mac + cheese"]],
    ["italian", ["rigatoni alla vodka", "chicken parm", "tiramisu", "caprese", "focaccia", "linguine vongole"]],
    ["indian", ["chicken tikka masala", "garlic naan", "samosas", "saag paneer", "mango lassi", "biryani"]],
    ["seafood", ["lobster roll", "shrimp basket", "clam chowder", "fish tacos", "crab cakes"]],
    ["middle eastern", ["chicken shawarma", "falafel plate", "hummus + pita", "baba ganoush", "baklava"]],
    ["korean", ["bulgogi bowl", "kimchi fried rice", "tteokbokki", "korean fried chicken", "japchae"]],
    ["bakery", ["dozen bagels", "black + white cookie", "babka", "rugelach", "seven-layer cake"]],
    ["ice_cream", ["two-scoop sundae", "banana split", "milkshake", "pint to go"]],
    ["juice", ["green smoothie", "acai bowl", "fresh-squeezed OJ", "ginger shot"]],
  ];
  const DEFAULT_ITEMS = ["dinner special", "house salad", "seltzer", "dessert of the day", "side of fries"];

  /* plausible menu pricing by item category, rounded like a real menu */
  const PRICE_DRINK = ["latte", "brew", "coffee", "matcha", "chai", "seltzer", "soda", "oj", "juice", "lassi", "horchata", "smoothie", "ginger shot", "cappuccino", "tea"];
  const PRICE_DESSERT = ["tiramisu", "cookie", "cake", "baklava", "babka", "sundae", "split", "pint", "sticky rice", "cannoli", "rugelach", "banana bread", "croissant", "dessert"];
  const PRICE_SIDE = ["fries", "knots", "spring rolls", "edamame", "samosas", "naan", "pita", "hummus", "guac", "elote", "salad", "soup", "scallion pancakes", "gyoza", "onion rings", "seaweed", "focaccia", "caprese", "bagel", "toast", "side"];
  function itemPrice(name) {
    const n = name.toLowerCase();
    let lo = 13, hi = 21; // mains
    if (PRICE_DRINK.some(k => n.includes(k))) { lo = 3; hi = 7; }
    else if (PRICE_DESSERT.some(k => n.includes(k))) { lo = 5; hi = 10; }
    else if (PRICE_SIDE.some(k => n.includes(k))) { lo = 5; hi = 9; }
    else if (n.includes("milkshake") || n.includes("shake")) { lo = 7; hi = 10; }
    const raw = lo + Math.random() * (hi - lo);
    const cents = [0, 0.5, 0.95][(Math.random() * 3) | 0];
    return Math.max(2, Math.floor(raw)) + cents;
  }
  function itemsFor(cuisine, type) {
    const c = (cuisine || "").toLowerCase();
    let pool = DEFAULT_ITEMS;
    for (const [k, v] of MENU) if (c.includes(k)) { pool = v; break; }
    const n = type.items[0] + ((Math.random() * (type.items[1] - type.items[0] + 1)) | 0);
    const out = [];
    const used = new Set();
    let subtotal = 0;
    for (let i = 0; i < n; i++) {
      const it = pool[(Math.random() * pool.length) | 0];
      if (used.has(it)) continue;
      used.add(it);
      const q = Math.random() < 0.25 ? 2 : 1;
      const price = itemPrice(it) * q;
      subtotal += price;
      out.push({ q, name: it, price });
    }
    return { list: out, subtotal };
  }

  function pickType() {
    let r = Math.random(), acc = 0;
    for (const t of ORDER_TYPES) { acc += t.w; if (r <= acc) return t; }
    return ORDER_TYPES[0];
  }

  function makeOffer(nearby) {
    for (let tries = 0; tries < 30; tries++) {
      const r = W.restaurants[(Math.random() * W.restaurants.length) | 0];
      const dToR = Math.hypot(r.x - P.x, r.y - P.y);
      if (dToR > (nearby ? 380 : 700)) continue;
      const rNode = nearestNode(r.x, r.y);
      const dNode = (Math.random() * W.nodes.length) | 0;
      const dp = W.nodes[dNode];
      const crow = Math.hypot(dp[0] - r.x, dp[1] - r.y);
      if (nearby ? (crow < 200 || crow > 480) : (crow < 300 || crow > 1600)) continue;
      const path = astar(rNode, dNode, true);
      if (!path || path.length < 2) continue;
      const len = pathLength(path);
      const type = pickType();
      const order = itemsFor(r.cuisine, type);
      // curbside pickup point: the closest rideable spot to the restaurant
      const stp = closestStreet(r.x, r.y);
      const pickX = stp ? stp.px : r.x, pickY = stp ? stp.py : r.y;
      const estSec = dToR / 7 + len / 7.5 + 40;
      const fee = 3 + len * 0.0016 + type.feeAdd + Math.random() * 1.2;
      const tipBase = (1.5 + Math.random() * 4.5 + len * 0.0018 + order.subtotal * 0.04) * type.tipMult;
      // the door sits on a building frontage near the corner, not in the intersection
      let doorX = dp[0], doorY = dp[1];
      const de = W.adjBike[dNode][0];
      if (de) {
        const ds = W.segs[de.seg];
        const dpa = W.nodes[ds.a], dpb = W.nodes[ds.b];
        const dux = (dpb[0] - dpa[0]) / ds.len, duy = (dpb[1] - dpa[1]) / ds.len;
        const dSide = Math.random() < 0.5 ? -1 : 1;
        const along = Math.min(14, ds.len * 0.35) * (de.rev ? -1 : 1);
        const dOff = ROAD_HALF[ds.cls] + SIDEWALK + 1.2;
        doorX = dp[0] + dux * along - duy * dOff * dSide;
        doorY = dp[1] + duy * along + dux * dOff * dSide;
      }
      S.offer = {
        rest: r, restNode: rNode, destNode: dNode, pickX, pickY,
        destX: doorX, destY: doorY, addr: addressFor(dNode),
        fee, tipBase: tipBase * (S.rain ? 1.35 : 1),
        est: estSec, deadline: 0, routeLen: len,
        type, items: order.list, subtotal: order.subtotal,
      };
      S.offerT = nearby ? 45 : 12;
      renderOffer();
      $("offer-card").classList.remove("hidden");
      if (isTouch && tE) tE.classList.remove("attn");
      dingSound();
      return;
    }
    S.nextOfferT = 3; // retry soon
  }

  function itemLines(o, max) {
    const lines = o.items.slice(0, max).map(it =>
      `<div class="t-item"><span><span class="q">${it.q}×</span>${it.name}</span><span>$${it.price.toFixed(2)}</span></div>`).join("");
    const more = o.items.length > max ? `<div class="t-item"><span>…+${o.items.length - max} more</span></div>` : "";
    return lines + more;
  }

  function renderOffer() {
    const o = S.offer;
    const totalEst = o.fee + o.tipBase;
    const badge = o.type.badge ? `<span class="t-badge ${o.type.cls}">${o.type.badge}</span>` : "";
    $("offer-body").innerHTML =
      `<div class="t-head"><span>NEW ORDER · ${fmtClock()}</span>${badge}</div>
       <div class="t-rest">${o.rest.name}</div>
       <div class="t-cuisine">${o.rest.cuisine || "food"}</div>
       <div class="t-rule"></div>
       ${itemLines(o, 4)}
       <div class="t-rule"></div>
       <div class="t-row"><span>Deliver to</span><b class="t-addr">${o.addr}</b></div>
       <div class="t-row"><span>Trip</span><b>${(o.routeLen / 1609 * 1.1).toFixed(1)} mi</b></div>
       <div class="t-row"><span>Quoted</span><b>${Math.ceil(o.est * o.type.dlMult / 60)} min</b></div>
       <div class="t-rule"></div>
       <div class="t-row"><span>Est. payout</span><span class="t-money">${fmtMoney(totalEst)}</span></div>`;
  }

  function acceptOffer() {
    if (!S.offer || !S.running) return;
    S.order = S.offer;
    S.offer = null;
    $("offer-card").classList.add("hidden");
    S.order.deadline = S.t + S.order.est * S.order.type.dlMult;
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
    const left = o.deadline - S.t;
    const clockStr = left >= 0
      ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`
      : `<span class="t-clock-late">−${Math.floor(-left / 60)}:${String(Math.floor(-left % 60)).padStart(2, "0")}</span>`;
    const badge = o.type.badge ? `<span class="t-badge ${o.type.cls}">${o.type.badge}</span>` : "";
    $("ticket-body").innerHTML =
      `<div class="t-head"><span>ACTIVE ORDER</span>${badge}</div>
       <div class="t-rest">${o.rest.name}</div>
       <div class="t-rule"></div>
       ${itemLines(o, 3)}
       <div class="t-rule"></div>
       <div class="t-row"><span>To</span><b class="t-addr">${o.addr}</b></div>
       <div class="t-row"><span>Clock</span><b>${clockStr}</b></div>
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
    if (S.phase === "topickup" || S.phase === "waiting") return { x: o.pickX, y: o.pickY, label: o.rest.name };
    return { x: o.destX, y: o.destY, label: o.addr };
  }

  /* ---------- GPS navigation ---------- */
  let navManeuver = null;   // {x, y} of next turn, for the world chevron
  let navCache = "";
  function dirArrow(a) {
    if (S.view === "ride") {
      // heading-up view: arrows are relative to the way you're facing
      const rel = normAng(a - P.ang);
      const dirs = ["⬆", "↗", "➡", "↘", "⬇", "↙", "⬅", "↖"];
      return dirs[Math.round(((rel + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
    }
    const dirs = ["➡", "↘", "⬇", "↙", "⬅", "↖", "⬆", "↗"];
    return dirs[Math.round((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
  }
  function fmtDist(m) {
    const ft = m * 3.28084;
    if (ft > 950) return (m / 1609).toFixed(1) + " mi";
    return (Math.round(ft / 10) * 10 || 10) + " ft";
  }
  function streetNameBetween(a, b) {
    for (const e of W.adjBike[a]) if (e.to === b) { const n = W.segs[e.seg].name; if (n) return n; }
    return "";
  }
  function normAng(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }
  function routeNearest(r) {
    let best = { d: Infinity, i: 0, t: 0 };
    for (let i = 0; i < r.length - 1; i++) {
      const a = W.nodes[r[i]], b = W.nodes[r[i + 1]];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1;
      let t = ((P.x - a[0]) * dx + (P.y - a[1]) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(P.x - (a[0] + dx * t), P.y - (a[1] + dy * t));
      if (d < best.d) best = { d, i, t };
    }
    return best;
  }
  function computeManeuver() {
    const r = S.route;
    const near = routeNearest(r);
    if (near.d > 40) return { arrow: "⟳", main: "Rerouting…", sub: "", cls: "offroute", man: null };
    // distance from the player's projection to each vertex ahead
    const distTo = i => {
      let d = 0;
      const a0 = W.nodes[r[near.i]], b0 = W.nodes[r[near.i + 1]];
      d += Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) * (1 - near.t);
      for (let k = near.i + 1; k < i; k++) {
        const a = W.nodes[r[k]], b = W.nodes[r[k + 1]];
        d += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      return d;
    };
    const rem = distTo(r.length - 1) + near.d;
    const o = S.order;
    const dest = S.phase === "topickup" || S.phase === "waiting" ? o.rest.name : o.addr;
    const eta = Math.max(1, Math.round(rem / 7 / 60 * 10) / 10);
    // walk forward looking for the next real turn
    for (let i = near.i + 1; i < r.length - 1; i++) {
      const p0 = W.nodes[r[i - 1]], p1 = W.nodes[r[i]], p2 = W.nodes[r[i + 1]];
      const angIn = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const angOut = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      const turn = normAng(angOut - angIn) * 180 / Math.PI;
      const dTo = distTo(i);
      if (Math.abs(turn) > 28) {
        const st = streetNameBetween(r[i], r[i + 1]);
        const hard = Math.abs(turn) > 55;
        const dir = turn > 0 ? "right" : "left";
        const arrow = hard ? (turn > 0 ? "➡" : "⬅") : (turn > 0 ? "↗" : "↖");
        return {
          arrow,
          main: (hard ? "Turn " : "Bear ") + dir + (st ? " · " + st : ""),
          sub: fmtDist(Math.max(5, dTo)) + " · " + fmtDist(rem) + " to " + dest + " · " + eta + " min",
          cls: "", man: { x: W.nodes[r[i]][0], y: W.nodes[r[i]][1] },
        };
      }
    }
    const endP = W.nodes[r[r.length - 1]];
    return {
      arrow: "⚑",
      main: (S.phase === "topickup" || S.phase === "waiting" ? "Pickup ahead — " : "Drop ahead — ") + dest,
      sub: fmtDist(rem) + " · straight shot",
      cls: "arrive", man: { x: endP[0], y: endP[1] },
    };
  }
  function navUpdate() {
    const el = $("nav-banner");
    let show = false, arrow = "⬆", main = "", sub = "", cls = "";
    navManeuver = null;
    const tp = targetPoint();
    if (S.running && !S.order && !Tut.active) {
      // always tell the player what's happening, even between orders
      show = true;
      if (S.offer) {
        arrow = "🔔"; main = "New order — " + S.offer.rest.name;
        sub = isTouch ? "Tap ACCEPT or PASS on the ticket" : "Enter to accept · Esc to pass";
        cls = "offroute";
      } else {
        arrow = "🛵"; main = "Waiting for the next order…";
        sub = "Cruise — the app will ping you";
        cls = "idle";
      }
    } else if (S.running && S.order && tp) {
      show = true;
      if (!P.riding) {
        const d = Math.hypot(tp.x - P.x, tp.y - P.y);
        arrow = dirArrow(Math.atan2(tp.y - P.y, tp.x - P.x));
        main = S.phase === "walking" || S.phase === "todrop" ? "Walk it in" : "Back to the bike";
        sub = fmtDist(d) + " to the door";
        cls = "arrive";
      } else if (S.route && S.route.length > 1) {
        const nav = computeManeuver();
        arrow = nav.arrow; main = nav.main; sub = nav.sub; cls = nav.cls;
        navManeuver = nav.man;
      } else {
        main = "Head to " + tp.label;
        arrow = dirArrow(Math.atan2(tp.y - P.y, tp.x - P.x));
      }
    }
    const sig = show + arrow + main + sub + cls;
    if (sig !== navCache) {
      navCache = sig;
      el.classList.toggle("hidden", !show);
      el.className = show ? ("" + cls) : "hidden";
      el.id = "nav-banner";
      $("nav-arrow").textContent = arrow;
      $("nav-main").textContent = main;
      $("nav-sub").textContent = sub;
    }
  }

  function deliverPayout() {
    const o = S.order;
    const elapsed = S.t - o.acceptT;
    const quote = o.est * o.type.dlMult;
    const late = S.t > o.deadline;
    const foodFactor = 0.35 + 0.65 * P.food;
    let tip, verdict;
    if (late) {
      tip = 0;
      verdict = "cold";
    } else {
      const timeFactor = elapsed <= quote * 0.85 ? 1.3 : 1.1 - (elapsed / quote) * 0.35;
      tip = Math.max(0, o.tipBase * timeFactor * foodFactor + (Math.random() - 0.35));
      verdict = elapsed < quote * 0.85 && P.food > 0.85 ? "perfect" : "ok";
    }
    const total = o.fee + tip;
    S.earned += total; S.fees += o.fee; S.tips += tip; S.deliveries++;
    S.bestTip = Math.max(S.bestTip, tip);
    $("earnings").classList.remove("bump"); void $("earnings").offsetWidth; $("earnings").classList.add("bump");
    if (verdict === "cold") {
      tone(220, 0.35, "square", 0.1, 0, 140);
      burst(P.x, P.y - 3, "FOOD COLD · NO TIP!", "#ff5a5a", 3.2);
      toast(`Past the quote — food went cold. Fee only: ${fmtMoney(o.fee)}`, "bad");
    } else if (verdict === "perfect") {
      cashSound();
      burst(P.x, P.y - 3, "PERFECT! +" + fmtMoney(total), "#ffd24d", 3.4);
      toast(`Perfect delivery · ${fmtMoney(o.fee)} fee + ${fmtMoney(tip)} tip`, "cash");
    } else {
      cashSound();
      burst(P.x, P.y - 3, "+" + fmtMoney(total), "#4fdf7d", 3.2);
      toast(`Delivered · ${fmtMoney(o.fee)} fee + ${fmtMoney(tip)} tip`, "cash");
      if (tip < 1) toast("Stiffed on the tip. It happens.", "bad");
      else if (P.food < 0.6) toast("Food arrived shaken up — tip took a hit", "bad");
    }
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
      if (Math.abs(P.speed) < 2) {
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

    // top speed
    const heavy = P.carrying && S.order && S.order.type.heavy;
    let vmax = 12.5;                               // ~28 mph
    if (heavy) vmax *= 0.92;
    if (onSidewalk) vmax = Math.min(vmax, 5.5);
    if (P.knock > 0) vmax = Math.min(vmax, 2.5);

    const accel = 6.5 * (heavy ? 0.85 : 1);
    if (up) P.speed = Math.min(vmax, P.speed + accel * dt);
    else if (down) P.speed = P.speed > 0.3 ? Math.max(0, P.speed - (S.rain ? 6.5 : 9.5) * dt) : Math.max(-3.2, P.speed - 3 * dt);
    else P.speed *= (1 - 0.3 * dt);

    // steering (bicycle-ish, forgiving)
    const steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
    P.steer += (steerTarget - P.steer) * Math.min(1, dt * (S.rain ? 8 : 12));
    const sf = Math.min(1, Math.abs(P.speed) / 2.4);
    P.ang += P.steer * 3.1 * sf * grip * dt * Math.sign(P.speed || 1);

    // lane assist: when not steering and roughly parallel to the street, glide along it
    if (!steerTarget && seg && st.d < ROAD_HALF[seg.cls] + 1.5 && Math.abs(P.speed) > 2) {
      const d1 = normAng(seg.ang - P.ang);
      const d2 = normAng(seg.ang + Math.PI - P.ang);
      const dmin = Math.abs(d1) < Math.abs(d2) ? d1 : d2;
      if (Math.abs(dmin) < 0.75) P.ang += dmin * Math.min(1, dt * 3.6);
    }

    // co-pilot brake assist: ease off before you plow into something ahead
    if (Math.abs(P.speed) > 1.8) {
      const hx = Math.cos(P.ang), hy = Math.sin(P.ang);
      const reach = 4.5 + Math.abs(P.speed) * 0.9;
      const capFor = (ox, oy, latW, rch) => {
        const dx = ox - P.x, dy = oy - P.y;
        if (dx > rch || dx < -rch || dy > rch || dy < -rch) return;
        const ahead = dx * hx + dy * hy;
        if (ahead < 0.5 || ahead > rch) return;
        if (Math.abs(-dy * hx + dx * hy) > latW) return;
        P.speed = Math.min(P.speed, Math.max(1.6, (ahead - 1.4) * 1.8));
      };
      for (const car of Traffic.cars) { const cp = carPos(car); capFor(cp.x, cp.y, 1.7, reach); }
      for (const bus of Buses.list) { const bp = busPos(bus); capFor(bp.x, bp.y, 2.5, reach + 2); }
      for (const pc of openDoors) capFor(pc.x - Math.sin(pc.ang) * -2.0, pc.y + Math.cos(pc.ang) * -2.0, 1.6, reach);
      for (const ped of Traffic.peds) { if (ped.cross) { const pp = pedPos(ped); capFor(pp.x, pp.y, 1.5, reach); } }
      for (const pc of W.parked) capFor(pc.x, pc.y, 1.3, 6);
    }
    if (onSidewalk) P.wobble = Math.min(1, P.wobble + dt * 2); else P.wobble *= (1 - dt * 3);

    // sidewalk riding: warnings first, then fines
    if (onSidewalk && Math.abs(P.speed) > 2.5) {
      P.sidewalkT += dt;
      if (P.sidewalkT > 4) {
        P.sidewalkT = 0;
        if (Math.random() < 0.45) {
          S.sidewalkFines++;
          S.earned = Math.max(0, S.earned - 3);
          burst(P.x, P.y - 2.5, "SIDEWALK FINE!", "#ff5a5a", 2.8);
          toast("-$3.00 · riding on the sidewalk", "bad");
          tone(740, 0.4, "square", 0.09, 0, 500);
        } else {
          toast("Pedestrians glaring — get off the sidewalk", "bad");
        }
      }
    } else P.sidewalkT = Math.max(0, P.sidewalkT - dt * 2);

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
        if (P.speed > 7) { P.food = Math.max(0, P.food - 0.04); thud(); }
        P.speed *= Math.abs(P.speed) > 6 ? 0.7 : 0.95;
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
        if (d < 1.9) {
          const closing = Math.abs(P.speed) + car.speed;
          if (closing > 7) crash("Clipped by a car", 0.2);
          else { P.speed *= 0.5; }
          break;
        }
      }
      // buses
      for (const bus of Buses.list) {
        const bp = busPos(bus);
        const dx = bp.x - P.x, dy = bp.y - P.y;
        if (dx * dx + dy * dy > 36) continue;
        // oriented check against the 11m bus body
        const hx = Math.cos(bp.ang), hy = Math.sin(bp.ang);
        const lon = Math.abs(dx * hx + dy * hy), lat = Math.abs(-dx * hy + dy * hx);
        if (lon < 6.2 && lat < 2.0) {
          const rn = W.busRoutes[bus.route].name;
          if (Math.abs(P.speed) + bus.speed > 6) crash("Clipped by the " + rn, 0.25);
          else P.speed *= 0.3;
          break;
        }
      }
      // parked cars
      if (Math.abs(P.speed) > 5) {
        for (const pc of W.parked) {
          const dx = pc.x - P.x, dy = pc.y - P.y;
          if (dx * dx + dy * dy < 3.0) {
            if (pc.door > 0) crash("DOORED", 0.32);
            else crash("Hit a parked car", 0.08);
            break;
          }
        }
      }
      // open doors (wider zone than the car body)
      for (const pc of openDoors) {
        const doorX = pc.x - Math.sin(pc.ang) * -2.0, doorY = pc.y + Math.cos(pc.ang) * -2.0;
        const d = Math.hypot(doorX - P.x, doorY - P.y);
        if (d < 1.6 && Math.abs(P.speed) > 5) { crash("DOORED", 0.32); break; }
      }
      // pedestrians
      for (const ped of Traffic.peds) {
        const pp = pedPos(ped);
        if (Math.hypot(pp.x - P.x, pp.y - P.y) < 1.2 && Math.abs(P.speed) > 4) {
          if (ped.stroller) {
            crash("YOU HIT A STROLLER", 0.35);
            S.earned = Math.max(0, S.earned - 15);
            toast("-$15.00 · a stroller. Seriously.", "bad");
          } else {
            crash("You clipped a pedestrian", 0.25);
            S.earned = Math.max(0, S.earned - 5);
            toast("-$5.00 · watch where you're going", "bad");
          }
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
      P.crashCd = 2.6; P.knock = 0.45;
      P.speed = Math.min(P.speed, 1.2);
      const frag = S.order ? S.order.type.frag : 1;
      if (P.carrying) P.food = Math.max(0, P.food - dmg * frag);
      thud();
      burst(P.x + Math.cos(P.ang) * 2, P.y + Math.sin(P.ang) * 2 - 1.5,
        msg === "DOORED" ? "DOORED!" : "WHAM!", "#ff5a5a", 3.4);
      toast(msg + (P.carrying ? " · food took a hit" : ""), "bad");
    }
  }

  /* ---------- order state machine ---------- */
  function updateOrders(dt) {
    if (S.offer) {
      S.offerT -= dt;
      $("offer-timer-bar").style.width = Math.max(0, S.offerT / 12 * 100) + "%";
      if (S.offerT <= 0) declineOffer();
    } else if (!S.order && S.phase === "idle" && (!Tut.active || Tut.wantOffer)) {
      S.nextOfferT -= dt;
      if (S.nextOfferT <= 0 && shiftT() < SHIFT_LEN - 60) makeOffer(Tut.active);
    }

    prompt = null;
    const o = S.order;
    if (!o) {
      if (!P.riding) {
        const d = Math.hypot(bike.x - P.x, bike.y - P.y);
        if (d < 6) prompt = { text: "<b>" + EKEY() + "</b> — hop on the bike" };
      }
      return;
    }

    if (S.phase === "topickup") {
      const d = Math.hypot(o.pickX - P.x, o.pickY - P.y);
      if (d < 16 && Math.abs(P.speed) < 1) {
        S.phase = "waiting";
        S.waitT = 1.5 + Math.random() * (Math.random() < 0.2 ? 6 : 2.5); // sometimes the kitchen is slow
        updateTicket();
      } else if (d < 30) prompt = { text: "Stop at <b>" + o.rest.name + "</b> to pick up" };
    } else if (S.phase === "waiting") {
      const d = Math.hypot(o.pickX - P.x, o.pickY - P.y);
      if (d > 18) { S.phase = "topickup"; progress = null; updateTicket(); return; }
      if (!progress) progress = { label: "WAITING ON THE KITCHEN", t: 0, dur: S.waitT };
      progress.t += dt;
      if (progress.t >= progress.dur) {
        progress = null;
        P.carrying = true; P.food = 1;
        S.phase = "todrop";
        computeRoute(); updateTicket();
        dingSound();
        burst(P.x, P.y - 3, "ORDER UP!", "#ffb347", 3);
        toast("Order up — " + o.rest.name);
      }
    } else if (S.phase === "todrop" || S.phase === "walking") {
      const d = Math.hypot(o.destX - P.x, o.destY - P.y);
      if (P.riding) {
        if (d < 28) prompt = { text: "<b>" + EKEY() + "</b> — park the bike, walk it in" };
      } else {
        if (d < 8) {
          if (!progress) progress = { label: "HANDING IT OFF", t: 0, dur: 1.2 };
          progress.t += dt;
          if (progress.t >= progress.dur) { progress = null; deliverPayout(); }
        } else {
          const bd = Math.hypot(bike.x - P.x, bike.y - P.y);
          prompt = bd < 6 && d > 40 ? { text: "<b>" + EKEY() + "</b> — hop on the bike" } : { text: "Walk to the door · " + fmtDist(d) };
        }
      }
      // ticking clock anxiety
      if (S.t > o.deadline && !o.lateWarned) { o.lateWarned = true; toast("You're past the quote — tip is melting", "bad"); }
    }

    // route recompute if strayed
    if (S.route && P.riding) {
      S.routeT += dt;
      if (S.routeT > 1) {
        S.routeT = 0;
        if (routeNearest(S.route).d > 35) computeRoute();
      }
    }
  }

  /* ---------- rendering ---------- */
  let roofPattern = null;
  function makeRoofPattern() {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#2c2531"; g.fillRect(0, 0, 96, 96);
    const rnd = mulberry(7);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 96, y = rnd() * 96, w = 8 + rnd() * 18, h = 8 + rnd() * 18;
      const shade = ["#443229", "#4c3630", "#3c3541", "#513b2e", "#3a3040", "#463a33", "#54413b"][(rnd() * 7) | 0];
      g.fillStyle = shade; g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,220,170,.06)"; g.fillRect(x, y, w, 1.5);
    }
    // lit windows + the odd bodega neon
    for (let i = 0; i < 16; i++) {
      g.fillStyle = "rgba(255,200,110," + (0.1 + rnd() * 0.16) + ")";
      g.fillRect(rnd() * 94, rnd() * 94, 2, 2);
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = ["rgba(80,230,200,.2)", "rgba(255,120,190,.2)", "rgba(160,240,90,.18)"][(rnd() * 3) | 0];
      g.fillRect(rnd() * 92, rnd() * 92, 2.5, 2.5);
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

  const cam = { x: 0, y: 0, z: 3.4, rot: 0 };
  function render() {
    const w = canvas.width, h = canvas.height;
    const rideCam = S.view === "ride";
    const zBase = (isTouch ? 4.6 : 5.8) * DPR * (rideCam ? 1.16 : 1);
    const zoomOut = Math.min(0.6, Math.abs(P.speed) * 0.05);
    const zTarget = zBase * (1 - zoomOut * (rideCam ? 0.3 : 0.25));
    cam.z += (zTarget - cam.z) * 0.03;
    const look = rideCam ? Math.min(16, 5 + Math.abs(P.speed) * 1.3) : Math.min(30, Math.abs(P.speed) * 2.6);
    const lookX = P.x + Math.cos(P.ang) * look * (P.riding ? 1 : 0.3);
    const lookY = P.y + Math.sin(P.ang) * look * (P.riding ? 1 : 0.3);
    const follow = rideCam ? 0.12 : 0.06;
    cam.x += (lookX - cam.x) * follow; cam.y += (lookY - cam.y) * follow;
    const rotTarget = rideCam ? P.ang + Math.PI / 2 : 0;
    cam.rot += normAng(rotTarget - cam.rot) * (rideCam ? 0.09 : 0.16);
    if (!rideCam && Math.abs(normAng(cam.rot)) < 0.005) cam.rot = 0;
    const rot = cam.rot;

    const z = cam.z;
    const ax = w / 2, ay = rideCam ? h * 0.62 : h / 2;
    cam.ax = ax; cam.ay = ay;
    // culling bounds: circle that covers the (possibly rotated) viewport
    const R = Math.hypot(w, h) / (2 * z) + 16;
    const vx0 = cam.x - R, vy0 = cam.y - R, vw = R * 2, vh = R * 2;
    // draws a glyph/text upright regardless of camera rotation
    const upright = (x, y, fn) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); fn(); ctx.restore(); };

    // block-interior base
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#332b38"; ctx.fillRect(0, 0, w, h);
    ctx.translate(ax, ay); ctx.scale(z, z); ctx.rotate(-rot); ctx.translate(-cam.x, -cam.y);

    // brownstone rows, aligned to each street like a real map
    for (const lot of lotsNear(vx0, vy0, vx0 + vw, vy0 + vh)) {
      ctx.save();
      ctx.translate(lot.x, lot.y);
      ctx.rotate(lot.ang);
      const hw = lot.w / 2, hd = lot.depth / 2;
      ctx.fillStyle = lot.col;
      ctx.fillRect(-hw, -hd, lot.w, lot.depth);
      // lighter facade edge on the street side
      ctx.fillStyle = "rgba(255,220,170,.12)";
      if (lot.side === 1) ctx.fillRect(-hw, -hd, lot.w, 0.9);
      else ctx.fillRect(-hw, hd - 0.9, lot.w, 0.9);
      if (lot.lit) {
        ctx.fillStyle = "rgba(255,205,120,.5)";
        ctx.fillRect(-hw + lot.w * 0.3, lot.side === 1 ? -hd + 1.6 : hd - 2.4, 0.8, 0.8);
      }
      ctx.restore();
    }

    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // sidewalk casing
    for (const c of [3, 2, 1]) {
      ctx.strokeStyle = "#4c4652";
      ctx.lineWidth = (ROAD_HALF[c] + SIDEWALK) * 2;
      ctx.stroke(W.paths[c]);
    }
    // asphalt
    for (const c of [3, 2, 1]) {
      ctx.strokeStyle = c === 3 ? "#302f38" : "#34333c";
      ctx.lineWidth = ROAD_HALF[c] * 2;
      ctx.stroke(W.paths[c]);
    }
    // center dashes on bigger streets
    ctx.strokeStyle = "rgba(240,225,160,.4)";
    ctx.lineWidth = 0.35;
    ctx.setLineDash([4, 6]);
    for (const c of [3, 2]) ctx.stroke(W.dashPaths[c]);
    ctx.setLineDash([]);
    // crosswalks at signalized corners
    ctx.fillStyle = "rgba(238,235,225,.16)";
    for (const cw of W.crosswalks) {
      if (cw.x < vx0 - 10 || cw.x > vx0 + vw + 10 || cw.y < vy0 - 10 || cw.y > vy0 + vh + 10) continue;
      ctx.save();
      ctx.translate(cw.x, cw.y);
      ctx.rotate(cw.ang);
      for (let yy = -cw.half + 0.7; yy <= cw.half - 0.5; yy += 1.15) ctx.fillRect(-1.15, yy, 2.3, 0.55);
      ctx.restore();
    }
    // bike lanes
    ctx.strokeStyle = "rgba(72,190,110,.42)";
    ctx.lineWidth = 1.6;
    ctx.stroke(W.bikePaths);

    // gps route: soft glow + thin animated cyan dashes (thin so it never reads as traffic)
    if (S.route && S.route.length > 1) {
      ctx.beginPath();
      const p0 = W.nodes[S.route[0]];
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < S.route.length; i++) { const p = W.nodes[S.route[i]]; ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = "rgba(63,216,255,.16)";
      ctx.lineWidth = 2.8;
      ctx.stroke();
      ctx.strokeStyle = "rgba(63,216,255,.9)";
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2.6, 2.2]);
      ctx.lineDashOffset = -S.t * 10;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // pulsing chevron ring at the next turn
    if (navManeuver) {
      const pu = 1 + Math.sin(S.t * 6) * 0.22;
      ctx.strokeStyle = "rgba(63,216,255,.95)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(navManeuver.x, navManeuver.y, 3.4 * pu, 0, 7); ctx.stroke();
      ctx.strokeStyle = "rgba(63,216,255,.35)";
      ctx.beginPath(); ctx.arc(navManeuver.x, navManeuver.y, 5.6 * pu, 0, 7); ctx.stroke();
    }

    // street trees (canopies over the curb line)
    for (const tr of W.trees) {
      if (tr.x < vx0 - 6 || tr.x > vx0 + vw + 6 || tr.y < vy0 - 6 || tr.y > vy0 + vh + 6) continue;
      ctx.fillStyle = "rgba(20,40,22,.35)";
      ctx.beginPath(); ctx.arc(tr.x + 0.5, tr.y + 0.6, tr.r, 0, 7); ctx.fill();
      ctx.fillStyle = tr.col;
      ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,220,.14)";
      ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.3, tr.y - tr.r * 0.3, tr.r * 0.45, 0, 7); ctx.fill();
    }

    // street name labels along the centerline, flipped to stay readable
    ctx.font = "600 2.1px 'IBM Plex Mono'";
    ctx.textAlign = "center";
    for (const lb of W.labels) {
      if (lb.x < vx0 - 30 || lb.x > vx0 + vw + 30 || lb.y < vy0 - 30 || lb.y > vy0 + vh + 30) continue;
      let a = lb.ang;
      if (Math.cos(a - rot) < 0) a += Math.PI;
      ctx.save();
      ctx.translate(lb.x, lb.y);
      ctx.rotate(a);
      ctx.strokeStyle = "rgba(20,16,24,.75)";
      ctx.lineWidth = 0.45;
      ctx.strokeText(lb.name, 0, 0.7);
      ctx.fillStyle = "rgba(238,232,215,.62)";
      ctx.fillText(lb.name, 0, 0.7);
      ctx.restore();
    }

    // restaurant storefronts: awning + emoji on the street frontage
    ctx.textAlign = "center";
    for (const r of W.restaurants) {
      if (r.fx === undefined) continue;
      if (r.fx < vx0 - 5 || r.fx > vx0 + vw + 5 || r.fy < vy0 - 5 || r.fy > vy0 + vh + 5) continue;
      ctx.save();
      ctx.translate(r.fx, r.fy);
      ctx.rotate(r.fang);
      ctx.fillStyle = r.awn;
      roundRect(-2, -1.15, 4, 2.3, 0.5); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.3)";
      ctx.fillRect(-2, -1.15, 4, 0.5);
      ctx.restore();
      upright(r.fx, r.fy, () => { ctx.font = "2.2px sans-serif"; ctx.fillText(r.emoji || "🍴", 0, 0.8); });
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

    // buses (real MTA routes)
    ctx.textAlign = "center";
    for (const bus of Buses.list) {
      const bp = busPos(bus);
      if (bp.x < vx0 - 15 || bp.x > vx0 + vw + 15 || bp.y < vy0 - 15 || bp.y > vy0 + vh + 15) continue;
      ctx.save(); ctx.translate(bp.x, bp.y); ctx.rotate(bp.ang);
      ctx.fillStyle = "rgba(255,240,190,.08)";
      ctx.beginPath(); ctx.moveTo(5.4, -1.1); ctx.lineTo(15, -3.2); ctx.lineTo(15, 3.2); ctx.lineTo(5.4, 1.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#2a3f8f";
      roundRect(-5.6, -1.5, 11.2, 3, 0.7); ctx.fill();
      ctx.fillStyle = "#e9e4d6";
      roundRect(-5.6, -1.5, 11.2, 1.1, 0.5); ctx.fill();
      ctx.fillStyle = "#ffd23c"; ctx.fillRect(5.1, -1.2, 0.5, 2.4);
      ctx.fillStyle = "rgba(15,18,30,.5)";
      for (let wx = -4.6; wx < 4.4; wx += 1.4) ctx.fillRect(wx, -1.35, 0.9, 0.75);
      ctx.restore();
      const nm = W.busRoutes[bus.route].name;
      upright(bp.x, bp.y, () => {
        ctx.font = "700 1.9px 'IBM Plex Mono'";
        ctx.fillStyle = "#fff";
        ctx.fillText(nm, 0, 0.7);
      });
    }

    // pedestrians (crossers pop a little more; some push strollers early on)
    for (const ped of Traffic.peds) {
      const pp = pedPos(ped);
      if (ped.stroller) {
        ctx.save();
        ctx.translate(pp.x + ped.hx * 0.95, pp.y + ped.hy * 0.95);
        ctx.rotate(Math.atan2(ped.hy, ped.hx));
        ctx.fillStyle = "#d8d4c8";
        roundRect(-0.5, -0.32, 1.0, 0.64, 0.2); ctx.fill();
        ctx.strokeStyle = "rgba(20,16,24,.6)"; ctx.lineWidth = 0.12; ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = ped.col;
      ctx.beginPath(); ctx.arc(pp.x, pp.y, ped.cross ? 0.68 : 0.6, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(20,16,24,.6)"; ctx.lineWidth = 0.16; ctx.stroke();
      if (ped.dog) { ctx.fillStyle = "#8a6f52"; ctx.beginPath(); ctx.arc(pp.x + 1.1, pp.y + 0.4, 0.32, 0, 7); ctx.fill(); }
    }

    // restaurant + destination markers: big labeled map pin
    const tp = targetPoint();
    if (tp) {
      const isDrop = S.phase === "todrop" || S.phase === "walking";
      const col = isDrop ? "#5fd685" : "#ff4d2e";
      const pulse = 1 + Math.sin(S.t * 5) * 0.18;
      ctx.strokeStyle = isDrop ? "rgba(111,224,138,.85)" : "rgba(255,77,46,.85)";
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 7 * pulse, 0, 7); ctx.stroke();
      ctx.strokeStyle = isDrop ? "rgba(111,224,138,.3)" : "rgba(255,77,46,.3)";
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 11 * pulse, 0, 7); ctx.stroke();
      upright(tp.x, tp.y, () => {
        const bounce = Math.abs(Math.sin(S.t * 3)) * 1.3;
        ctx.translate(0, -bounce);
        // pin
        ctx.strokeStyle = "rgba(20,16,24,.8)"; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -4.6); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = 0.55;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -4.6); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, -6, 2.4, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(20,16,24,.8)"; ctx.lineWidth = 0.35; ctx.stroke();
        ctx.fillStyle = "#16121c";
        ctx.font = "2.6px sans-serif";
        ctx.fillText(isDrop ? "🏠" : "🍜", 0, -5.1);
        // label chip
        ctx.font = "700 2.6px 'IBM Plex Mono'";
        const tw = ctx.measureText(tp.label).width;
        ctx.fillStyle = "rgba(18,15,24,.88)";
        roundRect(-tw / 2 - 1.4, -12.4, tw + 2.8, 3.6, 0.9); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 0.22; ctx.stroke();
        ctx.fillStyle = "#f7f1e3";
        ctx.fillText(tp.label, 0, -9.8);
      });
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

    // comic bursts
    for (let i = FX.length - 1; i >= 0; i--) {
      const fx = FX[i];
      const age = S.t - fx.t0;
      if (age > 1.3 || age < 0) { FX.splice(i, 1); continue; }
      const pop = age < 0.18 ? age / 0.18 : 1;
      const alpha = age > 0.8 ? 1 - (age - 0.8) / 0.5 : 1;
      ctx.save();
      ctx.translate(fx.x, fx.y - age * 1.6);
      ctx.rotate(rot - 0.06 + 0.04 * Math.sin(age * 20));
      ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      ctx.font = "400 " + fx.size + "px Anton";
      ctx.textAlign = "center";
      ctx.globalAlpha = alpha;
      ctx.lineWidth = fx.size * 0.18;
      ctx.strokeStyle = "#1a1420";
      ctx.strokeText(fx.text, 0, 0);
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.text, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
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
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, "rgba(10,8,16,0)");
    vg.addColorStop(1, "rgba(10,8,16,.34)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

    // gps edge arrow: points to the next turn (or the target) when it's off-screen
    const navPt = navManeuver || targetPoint();
    if (navPt && S.order && P.riding) {
      const dxw = navPt.x - cam.x, dyw = navPt.y - cam.y;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const sx = ax + z * (dxw * cr + dyw * sr);
      const sy = ay + z * (-dxw * sr + dyw * cr);
      const m = 52 * DPR;
      if (sx < m || sx > w - m || sy < m || sy > h - m) {
        const cxs = Math.max(m, Math.min(w - m, sx));
        const cys = Math.max(m, Math.min(h - m, sy));
        const ang = Math.atan2(sy - cys, sx - cxs);
        ctx.save();
        ctx.translate(cxs, cys);
        ctx.rotate(ang);
        const sc = DPR * (1 + Math.sin(S.t * 6) * 0.12);
        ctx.fillStyle = "rgba(63,216,255,.95)";
        ctx.beginPath();
        ctx.moveTo(16 * sc, 0); ctx.lineTo(-8 * sc, -10 * sc); ctx.lineTo(-3 * sc, 0); ctx.lineTo(-8 * sc, 10 * sc);
        ctx.closePath();
        ctx.strokeStyle = "rgba(16,20,30,.8)"; ctx.lineWidth = 2.5 * DPR; ctx.stroke();
        ctx.fill();
        ctx.restore();
      }
    }
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
      $("food-row").style.visibility = P.carrying ? "visible" : "hidden";
      $("food-bar").style.width = (P.food * 100) + "%";
      const st = closestStreet(P.x, P.y);
      $("street-label").textContent = st && W.segs[st.seg].name ? W.segs[st.seg].name : "";
      if (S.order) updateTicket();
      navUpdate();
      if (isTouch && tE) tE.classList.toggle("attn", !!prompt);
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

  /* ---------- tutorial: guided first ride ---------- */
  const Tut = { active: false, step: 0, timer: 0, steered: 0, brakeArm: false, braked: false, wantOffer: false };
  const TUT_STEPS = [
    { main: () => isTouch ? "Hold ▲ to get rolling" : "Hold W or ↑ to get rolling", sub: () => "Your ebike tops out at 28 mph", done: () => P.speed > 6 },
    { main: () => isTouch ? "Steer with ◀ and ▶" : "Steer with A and D", sub: () => "Carve a turn or two", done: () => Tut.steered > 0.9 },
    { main: () => isTouch ? "Brake with ▼" : "Brake with S or ↓", sub: () => "Get moving, then stop hard", done: () => Tut.braked },
    { main: () => "The green banner is your GPS", sub: () => "It'll call the turns; the cyan line marks the way", timer: 5 },
    { main: () => "Order coming in — take it", sub: () => isTouch ? "Tap ACCEPT" : "Press Enter to accept", enter: () => { Tut.wantOffer = true; S.nextOfferT = 1; }, done: () => !!S.order },
    { main: () => "Ride the cyan line to the restaurant", sub: () => "Stop inside the red ring", done: () => S.phase === "waiting" || P.carrying },
    { main: () => "Kitchen's finishing up", sub: () => "Hold tight", done: () => P.carrying },
    { main: () => "Now deliver it", sub: () => "Dodge cars, buses, doors + walkers — shaken food shrinks the tip", done: () => S.order && Math.hypot(S.order.destX - P.x, S.order.destY - P.y) < 30 },
    { main: () => isTouch ? "Stop, then tap P to park" : "Stop, then press E to park", sub: () => "Bikes don't fit through doors", done: () => !P.riding },
    { main: () => "Walk it to the door", sub: () => "Fast + intact = fat tip", done: () => S.deliveries > 0 },
  ];
  function tutStart() {
    Object.assign(Tut, { active: true, step: 0, timer: 0, steered: 0, brakeArm: false, braked: false, wantOffer: false });
    S.tutConsumed = 0;
    $("tut").classList.remove("hidden");
    tutShow();
  }
  function tutShow() {
    const st = TUT_STEPS[Tut.step];
    $("tut-step").textContent = "FIRST RIDE · " + (Tut.step + 1) + "/" + TUT_STEPS.length;
    $("tut-main").textContent = st.main();
    $("tut-sub").textContent = st.sub ? st.sub() : "";
    if (st.enter) st.enter();
  }
  function tutEnd(skipped) {
    Tut.active = false;
    $("tut").classList.add("hidden");
    try { localStorage.setItem("cominginhot-tut", "1"); } catch (e) {}
    if (!skipped) {
      burst(P.x, P.y - 3, "YOU'RE HIRED!", "#4fdf7d", 3.6);
      toast("That's the job. Shift starts now — the clock is running");
    }
    S.nextOfferT = 4;
  }
  function updateTutorial(dt) {
    if (!Tut.active) return;
    S.tutConsumed = (S.tutConsumed || 0) + dt;
    if (keys.a || keys.d || keys.arrowleft || keys.arrowright || touch.left || touch.right) {
      if (P.speed > 2) Tut.steered += dt;
    }
    if (P.speed > 4.5) Tut.brakeArm = true;
    if (Tut.brakeArm && (keys.s || keys.arrowdown || touch.brake) && P.speed < 1.2) Tut.braked = true;
    const st = TUT_STEPS[Tut.step];
    let adv = false;
    if (st.timer !== undefined) {
      Tut.timer += dt;
      adv = Tut.timer >= st.timer;
    } else adv = st.done();
    if (adv) {
      Tut.timer = 0;
      tone(880, 0.1, "sine", 0.12); tone(1175, 0.16, "sine", 0.1, 0.09);
      Tut.step++;
      if (Tut.step >= TUT_STEPS.length) tutEnd(false);
      else tutShow();
    }
  }

  /* ---------- shift end ---------- */
  function endShift() {
    S.running = false; S.over = true;
    const best = Math.max(S.earned, +(localStorage.getItem("cominginhot-best") || 0));
    localStorage.setItem("cominginhot-best", best);
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
       <div class="t-row"><span>Sidewalk fines</span><b>${S.sidewalkFines}</b></div>
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
    updateBuses(dt, P);
    updatePeds(dt, P.x, P.y);
    updateDoors(dt, { ...P, riding: P.riding });
    updateOrders(dt);
    updateTutorial(dt);
    // stroller hour: the early-evening sidewalks belong to families
    Traffic.strollerP = shiftT() < 110 ? 0.16 : 0.03;
    if (shiftT() >= SHIFT_LEN) { endShift(); }
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
      deliveries: 0, crashes: 0, tickets: 0, bestTip: 0, sidewalkFines: 0,
      order: null, offer: null, nextOfferT: 3.5, phase: "idle", route: null,
      rain: Math.random() < 0.3,
    });
    Traffic.cars = []; Traffic.peds = [];
    initBuses();
    cam.x = P.x; cam.y = P.y;
    cam.z = (isTouch ? 4.6 : 5.8) * DPR;
    let wantTut = false;
    try { wantTut = !localStorage.getItem("cominginhot-tut"); } catch (e) {}
    if (S.forceTut) { wantTut = true; S.forceTut = false; }
    if (wantTut) tutStart();
    else {
      Tut.active = false; $("tut").classList.add("hidden");
      setTimeout(() => { if (S.running && !S.order) toast("Wait for a ticket, ACCEPT it, then follow the cyan line"); }, 1200);
    }
    $("title-screen").classList.add("fading");
    $("shift-end").classList.add("hidden");
    $("hud").classList.remove("hidden");
    if (isTouch) $("touch-ui").classList.remove("hidden");
    audio();
    toast(S.rain ? "Rain tonight — tips run hot, brakes run long" : "Clear night. Dinner rush is on.");
  }

  function setView(v) {
    S.view = v;
    try { localStorage.setItem("cominginhot-view", v); } catch (e) {}
    $("view-btn").textContent = v === "ride" ? "🚴 ride cam" : "🧭 bird's eye";
  }
  function toggleView() { setView(S.view === "ride" ? "north" : "ride"); }
  setView(localStorage.getItem("cominginhot-view") || "ride");

  document.getElementById("start-btn").addEventListener("click", startShift);
  document.getElementById("again-btn").addEventListener("click", startShift);
  document.getElementById("accept-btn").addEventListener("click", acceptOffer);
  document.getElementById("decline-btn").addEventListener("click", declineOffer);
  document.getElementById("view-btn").addEventListener("click", toggleView);
  document.getElementById("tut-skip").addEventListener("click", () => tutEnd(true));
  document.getElementById("tut-btn").addEventListener("click", () => { S.forceTut = true; startShift(); });
  document.getElementById("about-btn").addEventListener("click", () => $("about-pop").classList.toggle("hidden"));
  document.getElementById("about-close").addEventListener("click", () => $("about-pop").classList.add("hidden"));

  Game.debug = () => ({ t: S.t, running: S.running, phase: S.phase, x: P.x, y: P.y, speed: P.speed, cars: Traffic.cars.length, peds: Traffic.peds.length, offer: !!S.offer, order: !!S.order });
  Game.S = S; Game.P = P;

  const CUISINE_EMOJI = [
    ["pizza", "🍕"], ["mexican", "🌮"], ["japanese", "🍣"], ["sushi", "🍣"], ["chinese", "🥡"],
    ["thai", "🍜"], ["noodle", "🍜"], ["ramen", "🍜"], ["coffee", "☕"], ["cafe", "☕"],
    ["burger", "🍔"], ["american", "🍔"], ["italian", "🍝"], ["indian", "🍛"], ["seafood", "🦞"],
    ["middle eastern", "🥙"], ["greek", "🥙"], ["falafel", "🥙"], ["korean", "🍲"], ["bakery", "🥐"],
    ["ice cream", "🍦"], ["dessert", "🍦"], ["juice", "🥤"], ["smoothie", "🥤"], ["bagel", "🥯"],
    ["sandwich", "🥪"], ["deli", "🥪"], ["breakfast", "🍳"], ["chicken", "🍗"], ["barbecue", "🍖"],
    ["vegan", "🥗"], ["vegetarian", "🥗"], ["french", "🥖"], ["donut", "🍩"], ["steak", "🥩"],
  ];
  function emojiFor(cuisine) {
    const c = (cuisine || "").toLowerCase().replace(/_/g, " ");
    for (const [k, v] of CUISINE_EMOJI) if (c.includes(k)) return v;
    return "🍴";
  }

  /* invented names — locations are real, the shingles are ours */
  const CLEVER = [
    ["pizza", ["Crust Almighty", "Slice Slice Baby", "Pie Hard", "Rolling in Dough", "The Upper Crust", "Saucy by Nature", "Dough or Die", "The Marinara Trench", "Fold Finger", "Grandma's Square Deal", "Brick Oven Broadcast", "The Pepperoni Papers"]],
    ["mexican", ["Juan in a Million", "Taco 'Bout It", "Holy Guacamole", "Nacho Average Spot", "The Quesadilla Question", "Elote in Common", "Al Pastor Presente", "Salsa Non Grata", "Frijole Fantastic"]],
    ["chinese", ["Wok This Way", "Dim Sum & Then Some", "Wok and Roll", "The Dumpling Precinct", "Lo Mein Event", "Fortune Favors", "Chopstick Symphony", "The Szechuan Solution"]],
    ["japanese", ["Roll Models", "Miso Hungry", "Tuna Turner", "Nori or Never", "The Wasabi Method", "Rice Rice Baby", "Tempura Tantrum", "Big in Gowanus"]],
    ["sushi", ["Roll Models", "Raw Deal", "The Maki Marker", "Nigiri, Please", "Uni & Only", "Sashimi Sashimi"]],
    ["thai", ["Thai Me Over", "Basil Instinct", "Thai Breaker", "Curry Up Slowly", "The Lemongrass Ceiling", "Pad Thai Fighter", "Tom Yum Tom"]],
    ["coffee", ["Brewed Awakening", "The Daily Grind", "Deja Brew", "Pour Decisions", "Grounds for Appeal", "Bean There", "Steamed & Esteemed", "The Percolator", "Cream of the Crop", "Latte da Brooklyn", "Central Perk Slope", "Sufficient Grounds"]],
    ["cafe", ["The Slow Sip", "Crumb & Get It", "The Morning Person", "Toast of the Town", "The Sit & Stay", "Butter Believe It", "The Long Table"]],
    ["burger", ["Bun Intended", "Grill Seekers", "Well Done, Brooklyn", "The Medium Rare", "Smash Hit", "Patty Season", "The Burger Bureau"]],
    ["american", ["The Blue Plate Special", "Fork in the Road", "The Regular", "Comfort Zone", "The House Special", "Gravy Train", "The Standing Reservation"]],
    ["italian", ["Pasta La Vista", "Penne for Your Thoughts", "Basta Pasta", "The Al Dente Social", "Gnocchi on Wood", "Vodka Sauce Vinny's", "Parm & Ready", "The Rigatoni Report", "Carbonara Copy"]],
    ["indian", ["Naan Negotiable", "Curry Favor", "Naan of Your Business", "The Tikka Ticker", "Biryani & Sons", "The Paneer Frontier", "Ghee Whiz"]],
    ["seafood", ["The Codfather", "Oh My Cod", "Squid Pro Quo", "Holy Mackerel", "Shell Game", "A Fish Called Gowanus", "Clam & Prejudice", "The Lobster Lobby"]],
    ["middle eastern", ["Pita Pan", "The Hummus Among Us", "Shawarma Karma", "Falafel So Good", "Za'atar Manner", "The Tahini Treaty", "Laffa Riot"]],
    ["greek", ["Feta Compli", "The Gyro Next Door", "Olive You Too", "Opa Doncha Know", "The Acropolis Annex"]],
    ["korean", ["Seoul Food", "Seoul Train", "Kimchi Confidential", "Gochujang Gang", "Bibim Bop City", "The Banchan Branch"]],
    ["bakery", ["Flour Power", "Bread Winners", "Knead to Know", "Against the Grain", "Loafing Around", "Crumb Together", "The Proofing Ground", "Rise & Slope", "Babka to the Future"]],
    ["bagel", ["The Hole Story", "Schmear Campaign", "Everything & Then Some", "Lox in Translation", "The Boiled & the Beautiful"]],
    ["ice cream", ["The Cold Shoulder", "Churn Baby Churn", "Scoop Dreams", "Floats Your Boat", "The Sundae Times"]],
    ["dessert", ["Just Desserts", "The Sugar Rush", "Sweet Nothings", "The Last Course"]],
    ["juice", ["Juice Springsteen", "Squeeze the Day", "The Pulp Section", "Kale Me Maybe", "Blend It Like Brooklyn"]],
    ["sandwich", ["Between the Breads", "Hero Worship", "The Reuben Hood", "Wrap Sheet", "Club Sandwich Club"]],
    ["deli", ["The Corner Counter", "Cold Cut Committee", "Pastrami Mommy", "The Pickle Clause", "Sliced & Diced"]],
    ["breakfast", ["Sunny Side Up", "Hash It Out", "The Early Bird", "Egged On", "The Benedict Arnold", "Waffle House Rules"]],
    ["chicken", ["Wing It", "The Coop", "Bird Is the Word", "Cluck & Cover", "The Pecking Order"]],
    ["barbecue", ["License to Grill", "Low & Slow", "The Brisket Case", "Smoke Signals", "Rub It In"]],
    ["vegan", ["Romaine Calm", "The Beet Goes On", "Lettuce Entertain You", "Turnip the Volume", "Plant B"]],
    ["vegetarian", ["Romaine Calm", "The Beet Goes On", "Herbivore Society", "The Garden Variety"]],
    ["french", ["Crepe Expectations", "Baguette About It", "The French Correction", "Beurre It All", "Quiche Me Quick"]],
    ["ramen", ["Broth in Translation", "The Noodle Incident", "Slurp Slope", "Ramen Holiday"]],
    ["noodle", ["The Noodle Incident", "Use Your Noodle", "Slurp's Up"]],
    ["steak", ["Raising the Steaks", "The Rare Occasion", "Prime Time"]],
    ["donut", ["Hole Foods", "The Glaze District", "Donut Disturb", "Sprinkle Sprinkle"]],
    ["smoothie", ["Squeeze the Day", "The Blender Bender", "Smooth Operator"]],
    ["spanish", ["The Tapas Agenda", "Paella by Starlight", "Jamon Around"]],
    ["caribbean", ["Jerk of All Trades", "The Island Hop", "Oxtail of Two Cities"]],
    ["vietnamese", ["Pho Sure", "What the Pho", "Banh Mi & You", "Pho Real", "The Banh Mi Boys"]],
  ];
  const CLEVER_GENERIC = ["The Hungry Local", "Fork & Dagger", "The Corner Table", "The Midnight Special", "Gowanus Gourmet", "The Brownstone Bite", "Second Helping", "The Late Plate", "Dinner Bell", "The Neighborhood Standard", "Off the Menu", "The Usual Spot", "Stoop Supper", "The Slope Social", "Canal Street Eats", "The Double Shift", "House Rules", "The Open Sign", "Two Wheels Tavern", "The Last Bite"];
  const CLEVER_SUFFIX = ["Kitchen", "Canteen", "Counter", "Table", "Spot", "Provisions", "Social", "Diner", "Club", "Grubhouse", "Larder", "Commissary", "Hideout", "Standby", "Supper Club", "Lunch Counter", "Hangout", "Galley", "Mess Hall", "Pantry"];
  const CLEVER_ADJ = ["Hungry", "Rolling", "Crooked", "Lucky", "Smiling", "Wandering", "Copper", "Velvet", "Rusty", "Golden", "Midnight", "Sunday", "Patient", "Borrowed", "Humming", "Peckish", "Double-Parked", "Off-Duty", "Second-Story", "Well-Fed"];
  const CLEVER_NOUN = ["Spoon", "Fork", "Ladle", "Kettle", "Radish", "Pigeon", "Anchor", "Lantern", "Stoop", "Turnstile", "Hydrant", "Fire Escape", "Dumbwaiter", "Icebox", "Percolator", "Rooftop", "Water Tower", "Bodega Cat", "Tomato", "Meatball"];

  function assignCleverNames() {
    const rand = mulberry(9001);
    const used = new Set();
    W.restaurants.forEach(r => {
      const c = (r.cuisine || "").toLowerCase().replace(/_/g, " ");
      let pool = CLEVER_GENERIC;
      for (const [k, v] of CLEVER) if (c.includes(k)) { pool = v.concat(CLEVER_GENERIC); break; }
      let name = null;
      for (let tries = 0; tries < 12; tries++) {
        const cand = pool[(rand() * pool.length) | 0];
        if (!used.has(cand)) { name = cand; break; }
      }
      if (!name) {
        const st = (r.street || r.stName || "Brooklyn").replace(/ (Street|Avenue|Place|Road|Court|Boulevard)$/i, "");
        for (let tries = 0; tries < 4 && !name; tries++) {
          const cand = "The " + st + " " + CLEVER_SUFFIX[(rand() * CLEVER_SUFFIX.length) | 0];
          if (!used.has(cand)) name = cand;
        }
        for (let tries = 0; tries < 14 && !name; tries++) {
          const cand = "The " + CLEVER_ADJ[(rand() * CLEVER_ADJ.length) | 0] + " " + CLEVER_NOUN[(rand() * CLEVER_NOUN.length) | 0];
          if (!used.has(cand)) name = cand;
        }
        if (!name) {
          const base = "The " + st + " " + CLEVER_SUFFIX[(rand() * CLEVER_SUFFIX.length) | 0];
          let n = 2;
          name = base + " No. " + n;
          while (used.has(name)) { n++; name = base + " No. " + n; }
        }
      }
      used.add(name);
      r.name = name;
    });
  }

  const AWNING_COLORS = ["#b8443a", "#3a7a52", "#3a5f9a", "#a86a2a", "#7a4a8a", "#2a7a7a", "#9a3a5f"];
  function assignFrontages() {
    const rand = mulberry(717);
    W.restaurants.forEach(r => {
      const st = closestStreet(r.x, r.y);
      if (!st) return;
      const seg = W.segs[st.seg];
      let vx = r.x - st.px, vy = r.y - st.py;
      const L = Math.hypot(vx, vy);
      if (L < 0.5) { vx = -Math.sin(seg.ang); vy = Math.cos(seg.ang); }
      else { vx /= L; vy /= L; }
      const off = ROAD_HALF[seg.cls] + SIDEWALK + 1.6;
      r.fx = st.px + vx * off;
      r.fy = st.py + vy * off;
      r.fang = seg.ang;
      r.stName = seg.name;
      r.awn = AWNING_COLORS[(rand() * AWNING_COLORS.length) | 0];
    });
  }

  makeLampSprite();
  loadWorld().then(() => {
    W.restaurants.forEach(r => r.emoji = emojiFor(r.cuisine));
    assignFrontages();
    assignCleverNames();
    const nBus = new Set(W.busRoutes.map(r => r.name)).size;
    $("title-map-note").textContent =
      W.restaurants.length + " restaurants (real spots, invented names) · " + (nBus ? nBus + " real bus lines · " : "") +
      "the real streets of Carroll Gardens, Boerum Hill, Gowanus + Park Slope";
    const btn = document.getElementById("start-btn");
    btn.disabled = false;
  }).catch(err => {
    $("title-map-note").textContent = "Map failed to load — " + err.message;
  });
})();
