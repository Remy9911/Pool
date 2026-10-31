/* Pool Party — TV screen (AirConsole screen.html) */
(function () {
  "use strict";

  // ------------------------------------------------------------------ config
  var Q = new URLSearchParams(location.search);
  var TEST = Q.has("test");
  var CFG = {
    worldH: 10,               // world units across the pool height
    radius: 0.95,             // float radius (world units)
    impulse: 4.4,             // velocity change per tap
    damping: 1.15,            // linear drag (per second)
    frozenDamping: 5,
    restitution: 0.92,
    tapCooldown: 0.11,        // seconds between taps per player
    giantScale: 1.45, giantMass: 2.3, turboMult: 1.85,
    shrinkDelay: Number(Q.get("shrinkDelay") || 15), shrinkTime: 30, shrinkMin: 0.5,
    boosterFirst: 2.5, boosterEvery: [3.5, 6], boosterLife: 9, boosterMax: 2,
    winsToWin: Number(Q.get("wins") || PP.WINS_TO_WIN),
    speed: Number(Q.get("speed") || 1)
  };

  // ------------------------------------------------------------------ DOM
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("game"), g = canvas.getContext("2d");
  var elOverlay = $("overlay"), elPanel = $("panel"), elHud = $("hud"), elMode = $("modeChip"), elMini = $("miniBoard");
  var elBanner = $("banner"), elBannerTop = $("bannerTop"), elBannerMain = $("bannerMain"), elToast = $("toast");
  var elSound = $("soundBtn"), elCredits = $("credits");

  // ------------------------------------------------------------------ state
  var W = 0, H = 0, DPR = 1, scale = 1, worldW = 17.8, edge = 0.4;
  var play = { x0: 0, y0: 0, x1: 0, y1: 0 };     // pool inner rect (world)
  var safe = { x0: 0, y0: 0, x1: 0, y1: 0 };     // current safe rect (shrinking mode)
  var players = [];                               // by slot
  var phase = "lobby";                            // lobby | intro | play | outro | results | champion
  var phaseT = 0;                                 // time in phase
  var roundTime = 0;
  var currentMode = 0;
  var matchRunning = false;
  var matchRound = 0;
  var roundsPlayed = 0;
  var lastWinner = -1, champion = -1, lastCancelled = false;
  var airCode = "";
  var boosters = [];
  var nextBoosterAt = 0;
  var shrinkAnnounced = false, shrinkWarned = false;
  var fx = [];                                    // effects
  var images = {};                                // per slot: {img, url, frozen}
  var shadowSprite = null, badgeSprites = {}, stripePattern = null;
  var time = 0;

  // ------------------------------------------------------------------ AirConsole
  var ac = new AirConsole({ translation: false, synchronize_time: false });

  ac.onReady = function (code) { airCode = code ? String(code) : ""; renderPanel(); };
  ac.onConnect = function (id) { onJoin(id); };
  ac.onDisconnect = function (id) { onLeave(id); };
  ac.onMessage = function (from, data) { onMessage(from, data); };
  ac.onDeviceProfileChange = function (id) { var p = byDevice(id); if (p) { p.name = nickname(id); renderAll(); } };

  function nickname(id) {
    var n = null;
    try { n = ac.getNickname(id); } catch (e) {}
    return (n && String(n).trim()) || ("Player " + id);
  }
  function profilePic(id) {
    try { return ac.getProfilePicture(id, 128) || ""; } catch (e) { return ""; }
  }
  function send(p, msg) { if (p && p.device != null) { try { ac.message(p.device, msg); } catch (e) {} } }

  // ------------------------------------------------------------------ players
  function byDevice(id) { for (var i = 0; i < players.length; i++) if (players[i] && players[i].device === id) return players[i]; return null; }
  function active() { return players.filter(function (p) { return p && p.active; }); }
  function inRound() { return players.filter(function (p) { return p && p.active && p.inRound; }); }
  function alive() { return players.filter(function (p) { return p && p.active && p.inRound && p.alive; }); }

  function makePlayer(slot, id) {
    var info = PP.slotInfo(slot);
    return {
      slot: slot, device: id, name: nickname(id), pic: profilePic(id),
      color: info.color, floatKey: info.floatKey, floatName: info.floatName, hue: info.hue,
      active: true, ready: false, vote: -1, wins: 0, prevWins: 0,
      inRound: false, alive: false,
      x: 0, y: 0, vx: 0, vy: 0, rot: 0, rotV: 0, scale: 1,
      mass: 1, lastTap: -9, outAnim: null,
      turboUntil: 0, giantUntil: 0, frozenUntil: 0, shield: false, shieldGrace: 0,
      bob: Math.random() * 6.28, trailT: 0
    };
  }

  function onJoin(id) {
    if (id === AirConsole.SCREEN) return;
    var p = byDevice(id);
    if (!p) {
      var slot = -1;
      for (var i = 0; i < PP.MAX_PLAYERS; i++) if (!players[i]) { slot = i; break; }
      if (slot < 0) for (i = 0; i < PP.MAX_PLAYERS; i++) if (players[i] && !players[i].active) { slot = i; break; }
      if (slot < 0) { try { ac.message(id, { t: "view", view: "full" }); } catch (e) {} return; }
      p = players[slot] = makePlayer(slot, id);
      ensureImage(slot);
      if (matchRunning) p.wins = 0;
    }
    p.active = true; p.ready = false;
    p.name = nickname(id); p.pic = profilePic(id) || p.pic;
    if (phase === "intro" || phase === "play" || phase === "outro") { p.inRound = false; p.alive = false; }
    else placeLobby(p);
    Sound.blip(true);
    renderAll();
    sendViews();
  }

  function onLeave(id) {
    var p = byDevice(id);
    if (!p) return;
    p.active = false; p.ready = false;
    if (p.inRound && p.alive && (phase === "play" || phase === "intro")) { p.alive = false; }
    if (!matchRunning && (phase === "lobby" || phase === "champion" || phase === "results")) players[p.slot] = null;
    renderAll();
    if (phase === "lobby" || phase === "results" || phase === "champion") { sendViews(); tryStart(); }
  }

  function onMessage(from, d) {
    var p = byDevice(from);
    if (!p || !d || typeof d !== "object") return;
    switch (d.t) {
      case "hello": sendView(p); break;
      case "vote":
        if (!matchRunning && (phase === "lobby" || phase === "champion") && d.mode >= 0 && d.mode < PP.MODES.length) {
          p.vote = d.mode | 0; Sound.blip(false); renderAll(); sendViews();
        }
        break;
      case "ready":
        if (phase === "lobby" || phase === "results" || phase === "champion") {
          if (!p.ready) { p.ready = true; Sound.blip(true); }
          renderAll(); sendViews(); tryStart();
        }
        break;
      case "tap":
        if (phase === "play") tap(p, Number(d.x) || 0, Number(d.y) || 0);
        break;
    }
  }

  // ------------------------------------------------------------------ modes / match
  function voteCounts() {
    var c = PP.MODES.map(function () { return 0; });
    active().forEach(function (p) { if (p.vote >= 0) c[p.vote]++; });
    return c;
  }
  function nextMode() {
    var c = voteCounts(), best = Math.max.apply(null, c);
    if (best === 0) return currentMode;
    if (c[currentMode] === best) return currentMode;
    return c.indexOf(best);
  }

  function tryStart() {
    if (!(phase === "lobby" || phase === "results" || phase === "champion")) return;
    var a = active();
    if (a.length < 2) return;
    for (var i = 0; i < a.length; i++) if (!a[i].ready) return;
    startRound();
  }

  function startRound() {
    if (!matchRunning) {
      currentMode = nextMode();
      players.forEach(function (p) { if (p) { p.wins = 0; p.prevWins = 0; } });
      matchRunning = true; matchRound = 0; lastWinner = -1; champion = -1;
    }
    matchRound++; roundsPlayed++;
    lastCancelled = false;
    players.forEach(function (p) { if (p) p.prevWins = p.wins; });

    var a = active();
    a.forEach(function (p, k) { resetFloat(p, spawnPoint(k, a.length)); p.inRound = true; p.alive = true; p.ready = false; });
    players.forEach(function (p) { if (p && !p.active) { p.inRound = false; p.alive = false; } });
    boosters = [];
    fx = fx.filter(function (f) { return f.persist; });
    setSafe(play);
    shrinkAnnounced = shrinkWarned = false;
    roundTime = 0;
    nextBoosterAt = CFG.boosterFirst;

    setPhase("intro");
    var matchPoint = a.some(function (p) { return p.wins === CFG.winsToWin - 1; });
    showBanner(matchPoint ? "MATCH POINT" : "ROUND " + matchRound, PP.MODES[currentMode].name, PP.MODES[currentMode].color);
    hidePanel();
    renderAll();
    sendViews();
  }

  function endRound(cancelled) {
    var survivors = alive().filter(function (p) { return !p.outAnim; });
    lastWinner = -1;
    lastCancelled = !!cancelled;
    if (!cancelled && survivors.length === 1) {
      var w = survivors[0];
      lastWinner = w.slot;
      w.wins++;
      send(w, { t: "ev", e: "win", vibrate: [80, 60, 200] });
      if (w.wins >= CFG.winsToWin) { champion = w.slot; matchRunning = false; }
    }
    players.forEach(function (p) { if (p) { p.ready = false; p.vx *= 0.3; p.vy *= 0.3; } });
    boosters = [];
    setPhase("outro");
  }

  function afterOutro() {
    if (champion >= 0) {
      setPhase("champion");
      Sound.champion();
      confetti();
      var c = players[champion];
      if (c) send(c, { t: "ev", e: "champion", vibrate: [100, 60, 100, 60, 300] });
    } else {
      setPhase("results");
      if (lastWinner >= 0) Sound.win();
    }
    setSafe(play);
    // floats drift back to the lobby line-up behind the panel
    active().forEach(function (p, k) { placeLobby(p); });
    renderAll();
    sendViews();
  }

  function setPhase(ph) { phase = ph; phaseT = 0; }

  // ------------------------------------------------------------------ geometry
  function spawnPoint(k, n) {
    var cx = (play.x0 + play.x1) / 2, cy = (play.y0 + play.y1) / 2;
    var rx = (play.x1 - play.x0) * 0.31, ry = (play.y1 - play.y0) * 0.29;
    var a = Math.PI * 2 * k / Math.max(2, n) + Math.PI * 0.75;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  }
  function placeLobby(p) {
    var a = active(), k = a.indexOf(p);
    if (k < 0) k = 0;
    var pt = spawnPoint(k, Math.max(2, a.length));
    resetFloat(p, pt);
    p.inRound = false; p.alive = true;
  }
  function resetFloat(p, pt) {
    p.x = pt.x; p.y = pt.y; p.vx = p.vy = 0; p.rot = 0; p.rotV = 0; p.scale = 1; p.mass = 1;
    p.turboUntil = p.giantUntil = p.frozenUntil = 0; p.shield = false; p.shieldGrace = 0; p.outAnim = null; p.lastTap = -9;
  }
  function setSafe(r) { safe = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }; }

  // ------------------------------------------------------------------ input
  function tap(p, dx, dy) {
    if (!p.inRound || !p.alive || p.outAnim) return;
    if (time < p.frozenUntil) return;
    if (time - p.lastTap < CFG.tapCooldown) return;
    var len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    dx /= len; dy /= len;
    p.lastTap = time;
    var r = CFG.radius * p.scale;
    var sx = p.x + dx * r * 1.05, sy = p.y + dy * r * 1.05;
    var mult = time < p.turboUntil ? CFG.turboMult : 1;
    p.vx -= dx * CFG.impulse * mult;
    p.vy -= dy * CFG.impulse * mult;
    p.rotV += (Math.random() - 0.5) * 1.2;
    addRipple(sx, sy, time < p.turboUntil ? "#ffb347" : "#ffffff", 1);
    droplets(sx, sy, dx, dy, 7);
    Sound.splash(mult > 1 ? 1.3 : 1);
  }

  // ------------------------------------------------------------------ simulation
  function step(dt) {
    time += dt; phaseT += dt;

    if (phase === "intro") {
      if (phaseT >= 1.5) { setPhase("play"); showBanner("", "GO!", "#ffffff", true); Sound.whistle(); inRound().forEach(function (p) { send(p, { t: "ev", e: "go", vibrate: 60 }); }); }
    } else if (phase === "play") {
      roundTime += dt;
      if (currentMode === 1) updateShrink();
      if (currentMode === 2) updateBoosters(dt);
      var ir = inRound();
      if (ir.length < 2) { endRound(true); }
      else if (alive().filter(function (p) { return !p.outAnim; }).length <= 1) endRound(false);
    } else if (phase === "outro") {
      if (phaseT >= 1.3) afterOutro();
    }

    // physics
    var list = players.filter(function (p) { return p && p.active && p.alive && !p.outAnim; });
    list.forEach(function (p) {
      var giant = time < p.giantUntil;
      var targetScale = giant ? CFG.giantScale : 1;
      p.scale += (targetScale - p.scale) * Math.min(1, dt * 6);
      p.mass = giant ? CFG.giantMass : 1;
      var damp = time < p.frozenUntil ? CFG.frozenDamping : CFG.damping;
      if (phase !== "play" && phase !== "intro") damp = 2.5;
      var k = 1 / (1 + damp * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rotV += (-p.rot * 3 - p.rotV * 1.6) * dt;       // spring back to upright
      p.rot += p.rotV * dt;
      if (time < p.turboUntil && Math.hypot(p.vx, p.vy) > 1.2) {
        p.trailT -= dt;
        if (p.trailT <= 0) { p.trailT = 0.035; bubble(p.x - p.vx * 0.06, p.y - p.vy * 0.06, "#ffb347"); }
      }
    });

    // collisions
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) collide(list[i], list[j]);

    // edges
    if (phase === "play") {
      list.forEach(function (p) { checkEdge(p); });
    } else {
      // keep floats inside the pool between rounds
      list.forEach(function (p) {
        var r = CFG.radius * p.scale;
        if (p.x < play.x0 + r) { p.x = play.x0 + r; p.vx = Math.abs(p.vx) * 0.5; }
        if (p.x > play.x1 - r) { p.x = play.x1 - r; p.vx = -Math.abs(p.vx) * 0.5; }
        if (p.y < play.y0 + r) { p.y = play.y0 + r; p.vy = Math.abs(p.vy) * 0.5; }
        if (p.y > play.y1 - r) { p.y = play.y1 - r; p.vy = -Math.abs(p.vy) * 0.5; }
      });
    }

    // out animations
    players.forEach(function (p) {
      if (!p || !p.outAnim) return;
      var a = p.outAnim; a.t += dt;
      p.x += a.vx * dt; p.y += a.vy * dt; a.vx *= 0.96; a.vy *= 0.96;
      p.rot += a.spin * dt;
      if (a.t > 0.9) { p.outAnim = null; p.alive = false; }
    });

    // effects
    for (var f = fx.length - 1; f >= 0; f--) {
      var e = fx[f]; e.t += dt;
      if (e.vx !== undefined) { e.x += e.vx * dt; e.y += e.vy * dt; if (e.g) e.vy += e.g * dt; if (e.drag) { e.vx *= 1 - e.drag * dt; e.vy *= 1 - e.drag * dt; } }
      if (e.t >= e.life) fx.splice(f, 1);
    }
  }

  function collide(a, b) {
    var ra = CFG.radius * a.scale * 0.92, rb = CFG.radius * b.scale * 0.92;   // ring body, not the outline
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = ra + rb;
    if (d >= min || d < 1e-6) return;
    var nx = dx / d, ny = dy / d, overlap = min - d;
    var ma = a.mass, mb = b.mass, inv = 1 / ma + 1 / mb;
    a.x -= nx * overlap * (1 / ma) / inv; a.y -= ny * overlap * (1 / ma) / inv;
    b.x += nx * overlap * (1 / mb) / inv; b.y += ny * overlap * (1 / mb) / inv;
    var rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv > 0) return;
    var jimp = -(1 + CFG.restitution) * rv / inv;
    a.vx -= jimp * nx / ma; a.vy -= jimp * ny / ma;
    b.vx += jimp * nx / mb; b.vy += jimp * ny / mb;
    var tang = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
    a.rotV -= tang * 0.25; b.rotV += tang * 0.25;
    var strength = Math.min(1, -rv / 6);
    if (strength > 0.12) {
      Sound.bump(strength);
      var cx = a.x + nx * ra, cy = a.y + ny * ra;
      addRipple(cx, cy, "#ffffff", 0.7);
    }
  }

  function checkEdge(p) {
    if (time < p.shieldGrace) return;
    var r = safe;
    var out = p.x < r.x0 || p.x > r.x1 || p.y < r.y0 || p.y > r.y1;   // centre over the edge = out
    if (!out) return;
    if (p.shield) {
      p.shield = false; p.shieldGrace = time + 0.7;
      var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      var dx = cx - p.x, dy = cy - p.y, l = Math.hypot(dx, dy) || 1;
      p.x = Math.min(Math.max(p.x, r.x0 + 0.3), r.x1 - 0.3);
      p.y = Math.min(Math.max(p.y, r.y0 + 0.3), r.y1 - 0.3);
      p.vx = dx / l * 7; p.vy = dy / l * 7;
      ring(p.x, p.y, "#2ec4ff", 0.5, 3.5, 0.45, 6);
      Sound.shield();
      toast(p.name + "'s shield saved them!", "shield", "#2ec4ff");
      send(p, { t: "ev", e: "shield", vibrate: [40, 30, 40, 30, 40] });
      return;
    }
    // knocked out
    var spd = Math.hypot(p.vx, p.vy) || 1;
    p.outAnim = { t: 0, vx: p.vx * 0.6, vy: p.vy * 0.6, spin: (Math.random() < 0.5 ? -1 : 1) * (4 + spd) };
    p.vx = p.vy = 0;
    bigSplash(p.x, p.y);
    floatText(p.x, p.y - 1.4, "OUT!", "#ffffff");
    Sound.out();
    send(p, { t: "ev", e: "out", vibrate: 300 });
    renderHud();
  }

  // ------------------------------------------------------------------ shrinking mode
  function updateShrink() {
    var t = roundTime;
    if (!shrinkWarned && t >= CFG.shrinkDelay - 5) { shrinkWarned = true; toast("Pool shrinks in 5 seconds…", "shrinking", PP.MODES[1].color); }
    if (t < CFG.shrinkDelay) { setSafe(play); return; }
    if (!shrinkAnnounced) {
      shrinkAnnounced = true;
      toast("The pool is shrinking!", "shrinking", PP.MODES[1].color);
      Sound.whistle();
      inRound().forEach(function (p) { if (p.alive) send(p, { t: "ev", e: "shrink", vibrate: [120, 60, 120] }); });
    }
    var k = Math.min(1, (t - CFG.shrinkDelay) / CFG.shrinkTime);
    k = k * k * (3 - 2 * k);
    var f = 1 - (1 - CFG.shrinkMin) * k;
    var cx = (play.x0 + play.x1) / 2, cy = (play.y0 + play.y1) / 2;
    var hw = (play.x1 - play.x0) / 2 * f, hh = (play.y1 - play.y0) / 2 * f;
    safe = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  }

  // ------------------------------------------------------------------ boosters
  var WEIGHTS = [25, 20, 20, 20, 15];
  function pickBooster() {
    var tot = WEIGHTS.reduce(function (a, b) { return a + b; }, 0), r = Math.random() * tot;
    for (var i = 0; i < WEIGHTS.length; i++) { if (r < WEIGHTS[i]) return i; r -= WEIGHTS[i]; }
    return 0;
  }
  function updateBoosters(dt) {
    if (roundTime >= nextBoosterAt) {
      if (boosters.length < CFG.boosterMax) spawnBooster();
      nextBoosterAt = roundTime + CFG.boosterEvery[0] + Math.random() * (CFG.boosterEvery[1] - CFG.boosterEvery[0]);
    }
    for (var i = boosters.length - 1; i >= 0; i--) {
      var b = boosters[i]; b.t += dt;
      if (b.t > CFG.boosterLife) { boosters.splice(i, 1); continue; }
      var al = alive();
      for (var j = 0; j < al.length; j++) {
        var p = al[j]; if (p.outAnim) continue;
        var reach = 0.55 + CFG.radius * p.scale * 0.9;
        if ((p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y) < reach * reach) {
          boosters.splice(i, 1); applyBooster(p, b); break;
        }
      }
    }
  }
  function spawnBooster() {
    var m = 1.8, best = null;
    for (var tries = 0; tries < 30; tries++) {
      var x = play.x0 + m + Math.random() * (play.x1 - play.x0 - 2 * m);
      var y = play.y0 + m + Math.random() * (play.y1 - play.y0 - 2 * m);
      var okk = alive().every(function (p) { return Math.hypot(p.x - x, p.y - y) > 2.3; }) &&
               boosters.every(function (b) { return Math.hypot(b.x - x, b.y - y) > 3; });
      best = { x: x, y: y };
      if (okk) break;
    }
    var type = pickBooster();
    boosters.push({ x: best.x, y: best.y, type: type, t: 0, seed: Math.random() * 6 });
    ring(best.x, best.y, "#ffffff", 0.3, 2.2, 0.45, 4);
  }
  function applyBooster(p, b) {
    var B = PP.BOOSTERS[b.type];
    glowBurst(b.x, b.y, B.color);
    Sound.pickup();
    switch (B.key) {
      case "turbo": p.turboUntil = time + B.seconds; break;
      case "giant": p.giantUntil = time + B.seconds; break;
      case "shield": p.shield = true; break;
      case "shockwave":
        ring(p.x, p.y, B.color, 0.6, 11, 0.6, 10); ring(p.x, p.y, "#ffffff", 0.4, 8, 0.5, 5);
        Sound.shockwave();
        alive().forEach(function (o) {
          if (o === p || o.outAnim) return;
          var dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
          if (d > 6) return;
          var s = (16 - 10 * d / 6) / o.mass;
          o.vx += dx / (d || 1) * s; o.vy += dy / (d || 1) * s; o.rotV += (Math.random() - 0.5) * 6;
        });
        break;
      case "freeze":
        ring(p.x, p.y, B.color, 0.6, 16, 0.8, 6);
        Sound.freeze();
        alive().forEach(function (o) {
          if (o === p || o.outAnim) return;
          o.frozenUntil = Math.max(o.frozenUntil, time + B.seconds);
          send(o, { t: "ev", e: "frozen", seconds: B.seconds, vibrate: 250 });
          for (var k = 0; k < 6; k++) sparkle(o.x, o.y, "#d8f3ff");
        });
        break;
    }
    toast(p.name + " got " + B.name + "!", B.key, B.color);
    send(p, { t: "ev", e: "booster", key: B.key, name: B.name, color: B.color, seconds: B.seconds, vibrate: [60, 40, 60] });
  }

  // ------------------------------------------------------------------ effects
  function addRipple(x, y, color, s) { fx.push({ kind: "ripple", x: x, y: y, t: 0, life: 0.7, color: color, s: s }); }
  function ring(x, y, color, r0, r1, life, w) { fx.push({ kind: "ring", x: x, y: y, t: 0, life: life, color: color, r0: r0, r1: r1, w: w || 4 }); }
  function glowBurst(x, y, color) { fx.push({ kind: "glow", x: x, y: y, t: 0, life: 0.45, color: color }); for (var i = 0; i < 10; i++) sparkle(x, y, color); }
  function droplets(x, y, dx, dy, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.6, sp = 2 + Math.random() * 3;
      fx.push({ kind: "drop", x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3, t: 0, life: 0.35 + Math.random() * 0.25, r: 0.05 + Math.random() * 0.06 });
    }
  }
  function bubble(x, y, color) { fx.push({ kind: "bubble", x: x + (Math.random() - 0.5) * 0.4, y: y + (Math.random() - 0.5) * 0.4, t: 0, life: 0.6, color: color, r: 0.12 + Math.random() * 0.12 }); }
  function sparkle(x, y, color) {
    var a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3;
    fx.push({ kind: "spark", x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 2.5, t: 0, life: 0.6 + Math.random() * 0.4, color: color, r: 0.06 + Math.random() * 0.06 });
  }
  function bigSplash(x, y) {
    ring(x, y, "#ffffff", 0.6, 3.2, 0.7, 6); ring(x, y, "#bff3ff", 0.3, 2.2, 0.55, 4);
    for (var i = 0; i < 22; i++) {
      var a = Math.random() * 6.28, sp = 2 + Math.random() * 5;
      fx.push({ kind: "drop", x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 2.5, t: 0, life: 0.5 + Math.random() * 0.4, r: 0.06 + Math.random() * 0.09 });
    }
  }
  function floatText(x, y, text, color) { fx.push({ kind: "text", x: x, y: y, vx: 0, vy: -1.2, t: 0, life: 1.1, text: text, color: color }); }
  function confetti() {
    var colors = ["#ffcf4a", "#ff6fae", "#3fdc8a", "#39c7ff", "#b07bff", "#ffffff"];
    for (var i = 0; i < 160; i++) {
      fx.push({ kind: "confetti", x: Math.random() * worldW, y: -0.5 - Math.random() * 6, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
        t: 0, life: 6 + Math.random() * 3, color: colors[i % colors.length], rot: Math.random() * 6, rs: (Math.random() - 0.5) * 10, w: 0.12 + Math.random() * 0.1 });
    }
  }

  // ------------------------------------------------------------------ images
  function loadImg(src) { return new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = src; }); }
  var baseImgs = {};
  var assetsReady = Promise.all(PP.FLOATS.map(function (f) { return loadImg(f.img).then(function (im) { baseImgs[f.key] = im; }); }));

  function ensureImage(slot) {
    if (images[slot]) return images[slot];
    var info = PP.slotInfo(slot);
    var rec = images[slot] = { img: null, url: info.img, frozen: null };
    assetsReady.then(function () {
      var base = baseImgs[info.floatKey];
      if (!base) return;
      var c = document.createElement("canvas"); c.width = base.width; c.height = base.height;
      var x = c.getContext("2d");
      if (info.hue) { x.filter = "hue-rotate(" + info.hue + "deg) saturate(1.15)"; }
      x.drawImage(base, 0, 0); x.filter = "none";
      rec.img = c;
      // UI thumbnail: crop transparent padding so the float fills its box
      try {
        var d = x.getImageData(0, 0, c.width, c.height).data, x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
        for (var yy = 0; yy < c.height; yy += 2) for (var xx = 0; xx < c.width; xx += 2) {
          if (d[(yy * c.width + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
        }
        var side = Math.max(x1 - x0, y1 - y0) + 8, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        var t = document.createElement("canvas"); t.width = t.height = 160;
        t.getContext("2d").drawImage(c, mx - side / 2, my - side / 2, side, side, 0, 0, 160, 160);
        rec.url = t.toDataURL("image/png");
      } catch (e) { if (info.hue) { try { rec.url = c.toDataURL("image/png"); } catch (e2) {} } }
      // frozen variant
      var f = document.createElement("canvas"); f.width = c.width; f.height = c.height;
      var fxx = f.getContext("2d"); fxx.drawImage(c, 0, 0);
      fxx.globalCompositeOperation = "source-atop"; fxx.fillStyle = "rgba(170, 225, 255, 0.62)"; fxx.fillRect(0, 0, f.width, f.height);
      rec.frozen = f;
      renderAll();
    });
    return rec;
  }
  function imgUrl(slot) { var r = ensureImage(slot); return r.url; }

  function makeSprites() {
    // soft shadow
    var s = document.createElement("canvas"); s.width = s.height = 128;
    var x = s.getContext("2d"), gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, "rgba(0,30,60,0.45)"); gr.addColorStop(1, "rgba(0,30,60,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); shadowSprite = s;

    // booster badges
    var paths = {
      turbo: "M13.5 2 5 13.4h5.6L9.2 22 19 9.9h-5.8z",
      giant: "M12 2.5 20 11h-4.8v10.5H8.8V11H4z",
      shield: "M12 2 20 5v6.4c0 5-3.4 8.9-8 10.6-4.6-1.7-8-5.6-8-10.6V5z",
      shockwave: "m12 1.5 2.3 6.2 6.6.3-5.2 4 1.8 6.4L12 14.8l-5.5 3.6 1.8-6.4-5.2-4 6.6-.3z"
    };
    PP.BOOSTERS.forEach(function (B) {
      var c = document.createElement("canvas"), S = 160; c.width = c.height = S;
      var b = c.getContext("2d"), R = S * 0.4, cx = S / 2;
      var halo = b.createRadialGradient(cx, cx, R * 0.8, cx, cx, S / 2);
      halo.addColorStop(0, hexA(B.color, 0.55)); halo.addColorStop(1, hexA(B.color, 0));
      b.fillStyle = halo; b.fillRect(0, 0, S, S);
      var body = b.createLinearGradient(0, cx - R, 0, cx + R);
      body.addColorStop(0, lighten(B.color, 0.35)); body.addColorStop(1, darken(B.color, 0.3));
      b.beginPath(); b.arc(cx, cx, R, 0, 7); b.fillStyle = body; b.fill();
      b.lineWidth = S * 0.045; b.strokeStyle = "#ffffff"; b.stroke();
      b.save(); b.beginPath(); b.ellipse(cx, cx - R * 0.45, R * 0.62, R * 0.32, 0, 0, 7); b.fillStyle = "rgba(255,255,255,0.22)"; b.fill(); b.restore();
      b.save(); b.translate(cx - R * 0.62, cx - R * 0.62); b.scale(R * 1.24 / 24, R * 1.24 / 24);
      if (B.key === "freeze") {
        b.strokeStyle = "#fff"; b.lineWidth = 2.3; b.lineCap = "round";
        b.stroke(new Path2D("M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8 20.2 7.2M9.2 3.8 12 6.2l2.8-2.4M9.2 20.2 12 17.8l2.8 2.4"));
      } else {
        b.fillStyle = "#fff"; b.shadowColor = "rgba(0,0,0,0.25)"; b.shadowBlur = 2; b.fill(new Path2D(paths[B.key]));
      }
      b.restore();
      badgeSprites[B.key] = c;
    });

    // danger stripes
    var p = document.createElement("canvas"); p.width = p.height = 48;
    var px = p.getContext("2d");
    px.fillStyle = "rgba(255, 70, 80, 0.30)"; px.fillRect(0, 0, 48, 48);
    px.strokeStyle = "rgba(120, 0, 20, 0.28)"; px.lineWidth = 12;
    px.beginPath(); px.moveTo(-12, 48); px.lineTo(48, -12); px.moveTo(12, 72); px.lineTo(72, 12); px.moveTo(-36, 24); px.lineTo(24, -36); px.stroke();
    stripePattern = g.createPattern(p, "repeat");
  }

  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; }
  function mix(hex, t, to) { var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, gg = n >> 8 & 255, b = n & 255; r += (to - r) * t; gg += (to - gg) * t; b += (to - b) * t; return "rgb(" + (r | 0) + "," + (gg | 0) + "," + (b | 0) + ")"; }
  function lighten(h, t) { return mix(h, t, 255); }
  function darken(h, t) { return mix(h, t, 0); }

  // ------------------------------------------------------------------ layout
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    scale = H / CFG.worldH; worldW = W / scale;
    var u = Math.min(W * 0.005625, H * 0.01);
    edge = (u * 1.6 + u * 0.45) / scale;
    var old = play;
    play = { x0: edge, y0: edge, x1: worldW - edge, y1: CFG.worldH - edge };
    if (phase !== "play") setSafe(play);
    else if (currentMode !== 1 || roundTime < CFG.shrinkDelay) setSafe(play);
    // keep floats inside if the pool got narrower
    players.forEach(function (p) { if (p && old.x1) { p.x = Math.min(p.x, play.x1 - 0.5); } });
    if (stripePattern === null) makeSprites();
  }

  // ------------------------------------------------------------------ render
  function render() {
    g.setTransform(DPR * scale, 0, 0, DPR * scale, 0, 0);
    g.clearRect(0, 0, worldW, CFG.worldH);

    // danger zone
    if (currentMode === 1 && (phase === "play" || phase === "outro") && (safe.x0 > play.x0 + 0.01)) drawDanger();

    // boosters
    boosters.forEach(drawBooster);

    // ripples under floats
    fx.forEach(function (e) { if (e.kind === "ripple") drawFx(e); });

    // floats sorted by y
    var list = players.filter(function (p) { return p && p.active && (p.alive || p.outAnim); });
    list.sort(function (a, b) { return a.y - b.y; });
    list.forEach(function (p) { drawShadow(p); });
    list.forEach(function (p) { drawFloat(p); });

    fx.forEach(function (e) { if (e.kind !== "ripple") drawFx(e); });

    // name tags
    if (phase === "intro" || phase === "play" || phase === "outro") list.forEach(drawTag);
  }

  function drawDanger() {
    var s = safe, p = play, m = 0.8;
    g.save();
    g.beginPath();
    g.rect(p.x0 - m, p.y0 - m, p.x1 - p.x0 + 2 * m, p.y1 - p.y0 + 2 * m);
    roundRectPath(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, 0.5, true);
    if (stripePattern && stripePattern.setTransform && window.DOMMatrix) {
      var off = (time * 40) % 48;
      stripePattern.setTransform(new DOMMatrix().scale(1 / (DPR * scale)).translate(off, 0));
      g.fillStyle = stripePattern;
    } else g.fillStyle = "rgba(255, 60, 80, 0.32)";
    g.fill("evenodd");
    g.restore();
    // edge glow
    var pulse = 0.7 + 0.3 * Math.sin(time * 6);
    g.save();
    g.shadowColor = "rgba(255, 120, 90," + pulse + ")"; g.shadowBlur = 24 * DPR;
    g.strokeStyle = "rgba(255, 230, 200," + (0.75 + 0.25 * pulse) + ")"; g.lineWidth = 0.1;
    roundRectPath(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, 0.5, false);
    g.stroke();
    g.restore();
  }

  function roundRectPath(x, y, w, h, r, reverse) {
    r = Math.min(r, w / 2, h / 2);
    if (!reverse) g.beginPath();
    g.moveTo(x + r, y);
    if (!reverse) {
      g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    } else {
      g.arcTo(x, y, x, y + h, r); g.arcTo(x, y + h, x + w, y + h, r);
      g.arcTo(x + w, y + h, x + w, y, r); g.arcTo(x + w, y, x, y, r);
    }
    g.closePath();
  }

  function drawBooster(b) {
    var spr = badgeSprites[PP.BOOSTERS[b.type].key]; if (!spr) return;
    var pop = Math.min(1, b.t / 0.35), s = pop < 1 ? Math.sin(pop * Math.PI / 2) * 1.15 : 1 + 0.05 * Math.sin(time * 4 + b.seed);
    if (b.t > CFG.boosterLife - 2 && (time * 6 % 1) > 0.6) return;
    var size = 1.55 * s, bob = 0.06 * Math.sin(time * 3 + b.seed);
    g.drawImage(spr, b.x - size / 2, b.y - size / 2 + bob, size, size);
  }

  function drawShadow(p) {
    if (!shadowSprite) return;
    var r = CFG.radius * p.scale, a = p.outAnim ? Math.max(0, 1 - p.outAnim.t / 0.6) : 1;
    g.globalAlpha = a;
    g.drawImage(shadowSprite, p.x - r * 1.25 + 0.12, p.y - r * 1.25 + 0.22, r * 2.5, r * 2.5);
    g.globalAlpha = 1;
  }

  function drawFloat(p) {
    var rec = images[p.slot]; if (!rec || !rec.img) return;
    var r = CFG.radius * p.scale, size = r * 3;     // image: ring width 256 of 384 px
    var frozen = time < p.frozenUntil;
    var bobS = 1 + 0.015 * Math.sin(time * 2.2 + p.bob);
    var alpha = 1, sc = 1;
    if (p.outAnim) { var k = p.outAnim.t / 0.9; alpha = Math.max(0, 1 - k * 1.1); sc = 1 - 0.45 * k; }
    g.save();
    g.translate(p.x, p.y); g.rotate(p.rot); g.scale(bobS * sc, bobS * sc);
    g.globalAlpha = alpha;
    if (time < p.turboUntil) {
      var left = p.turboUntil - time, ga = 0.55 + 0.25 * Math.sin(time * 14);
      if (left < 1.5 && (time * 6 % 1) > 0.6) ga *= 0.3;
      var gr = g.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.6);
      gr.addColorStop(0, "rgba(255,160,40," + ga + ")"); gr.addColorStop(1, "rgba(255,160,40,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 1.6, 0, 7); g.fill();
    }
    g.drawImage(frozen && rec.frozen ? rec.frozen : rec.img, -size / 2, -size / 2, size, size);
    if (p.shield) {
      var sr = r * 1.22 * (1 + 0.04 * Math.sin(time * 5));
      var bg = g.createRadialGradient(-sr * 0.3, -sr * 0.35, sr * 0.1, 0, 0, sr);
      bg.addColorStop(0, "rgba(255,255,255,0.35)"); bg.addColorStop(0.7, "rgba(80,200,255,0.12)"); bg.addColorStop(1, "rgba(80,200,255,0.35)");
      g.fillStyle = bg; g.beginPath(); g.arc(0, 0, sr, 0, 7); g.fill();
      g.lineWidth = 0.07; g.strokeStyle = "rgba(160,230,255,0.95)"; g.stroke();
      g.rotate(time * 1.8); g.lineWidth = 0.09; g.strokeStyle = "rgba(255,255,255,0.9)";
      g.beginPath(); g.arc(0, 0, sr * 0.88, -0.4, 0.4); g.stroke();
    }
    if (frozen) {
      g.rotate(-p.rot);
      for (var i = 0; i < 6; i++) {
        var a = i / 6 * 6.28 + time * 0.6, d = r * 1.05;
        drawFlake(Math.cos(a) * d, Math.sin(a) * d, 0.16);
      }
    }
    g.restore();
  }

  function drawFlake(x, y, s) {
    g.save(); g.translate(x, y); g.strokeStyle = "rgba(235,250,255,0.95)"; g.lineWidth = 0.035; g.lineCap = "round";
    for (var i = 0; i < 3; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke(); }
    g.restore();
  }

  function drawTag(p) {
    if (p.outAnim || !p.alive || !p.inRound) return;
    var r = CFG.radius * p.scale;
    var y = p.y + r * 1.25;
    g.save();
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    var px = p.x * scale, py = y * scale;
    var fs = Math.max(12, Math.round(scale * 0.34));
    g.font = "600 " + fs + "px Fredoka, 'Segoe UI', sans-serif";
    var label = p.name.length > 14 ? p.name.slice(0, 13) + "…" : p.name;
    var tw = g.measureText(label).width, padX = fs * 0.6, h = fs * 1.55;
    g.fillStyle = "rgba(8, 26, 52, 0.72)";
    pill(px - tw / 2 - padX, py, tw + padX * 2, h, h / 2); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, px, py + h / 2 + 1);
    g.strokeStyle = p.color; g.lineWidth = 2; pill(px - tw / 2 - padX, py, tw + padX * 2, h, h / 2); g.stroke();
    g.restore();
  }
  function pill(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function drawFx(e) {
    var k = e.t / e.life;
    switch (e.kind) {
      case "ripple": {
        var rr = 0.25 + k * 1.3 * e.s;
        g.strokeStyle = e.color === "#ffffff" ? "rgba(255,255,255," + (0.85 * (1 - k)) + ")" : hexA(e.color, 0.85 * (1 - k));
        g.lineWidth = 0.08 * (1 - k) + 0.02;
        g.beginPath(); g.arc(e.x, e.y, rr, 0, 7); g.stroke();
        g.beginPath(); g.arc(e.x, e.y, rr * 0.55, 0, 7); g.stroke();
        break;
      }
      case "ring": {
        var r2 = e.r0 + (e.r1 - e.r0) * (1 - (1 - k) * (1 - k));
        g.strokeStyle = e.color.charAt(0) === "#" ? hexA(e.color, 1 - k) : e.color;
        g.lineWidth = (e.w / 40) * (1 - k) + 0.02;
        g.beginPath(); g.arc(e.x, e.y, r2, 0, 7); g.stroke();
        break;
      }
      case "glow": {
        var gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, 0.8 + k * 2);
        gr.addColorStop(0, hexA(e.color, 0.8 * (1 - k))); gr.addColorStop(1, hexA(e.color, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(e.x, e.y, 0.8 + k * 2, 0, 7); g.fill();
        break;
      }
      case "drop":
        g.fillStyle = "rgba(255,255,255," + (0.9 * (1 - k)) + ")";
        g.beginPath(); g.arc(e.x, e.y, e.r * (1 - k * 0.5), 0, 7); g.fill();
        break;
      case "bubble":
        g.fillStyle = hexA(e.color, 0.55 * (1 - k));
        g.beginPath(); g.arc(e.x, e.y, e.r * (1 + k), 0, 7); g.fill();
        break;
      case "spark":
        g.fillStyle = e.color.charAt(0) === "#" ? hexA(e.color, 1 - k) : e.color;
        g.beginPath(); g.arc(e.x, e.y, e.r * (1 - k * 0.6), 0, 7); g.fill();
        break;
      case "text":
        g.save(); g.setTransform(DPR, 0, 0, DPR, 0, 0);
        var fs = Math.round(scale * 0.9 * (k < 0.15 ? 0.6 + k / 0.15 * 0.5 : 1.1 - (k - 0.15) * 0.1));
        g.font = "700 " + fs + "px Fredoka, 'Segoe UI', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        g.lineWidth = fs * 0.14; g.strokeStyle = "rgba(0,40,80,0.65)"; g.strokeText(e.text, e.x * scale, e.y * scale);
        g.fillStyle = e.color; g.fillText(e.text, e.x * scale, e.y * scale);
        g.restore();
        break;
      case "confetti":
        e.rot += e.rs * 0.016;
        g.save(); g.translate(e.x, e.y); g.rotate(e.rot); g.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
        g.fillStyle = e.color; g.fillRect(-e.w / 2, -e.w * 0.3, e.w, e.w * 0.6 * Math.abs(Math.cos(e.rot * 2)) + 0.03);
        g.restore();
        break;
    }
  }

  // ------------------------------------------------------------------ UI (DOM)
  function modeIcon(i, size) {
    var m = PP.MODES[i];
    return '<div class="mic" style="background:' + m.color + '">' + PP.ICONS[m.icon] + "</div>";
  }
  function pipsHtml(p, animateNew) {
    var h = '<div class="pips">';
    for (var i = 0; i < CFG.winsToWin; i++) {
      var on = i < p.wins, isNew = animateNew && on && i >= p.prevWins;
      h += '<div class="pip' + (on ? " on" : "") + (isNew ? " new" : "") + '"></div>';
    }
    return h + "</div>";
  }
  function joinBox() {
    var code = airCode ? airCode.replace(/(\d{3})(\d+)/, "$1 $2") : "";
    return '<div class="join"><div class="lbl">Join on your phone</div><div class="url">airconsole.com</div>' +
      (code ? '<div class="code">' + PP.escapeHtml(code) + "</div>" : "") + "</div>";
  }
  function modesHtml() {
    var c = voteCounts(), nm = nextMode();
    var h = '<div class="section-label">NEXT MODE · VOTE ON YOUR PHONE</div><div class="modes">';
    PP.MODES.forEach(function (m, i) {
      var dots = "";
      active().forEach(function (p) { if (p.vote === i) dots += '<div class="vdot" style="background:' + p.color + '"></div>'; });
      h += '<div class="mcard' + (i === nm ? " next" : "") + '">' + (i === nm ? '<div class="nexttag">NEXT</div>' : "") +
        modeIcon(i) + '<div><div class="mname">' + m.name + '</div><div class="mdesc">' + m.short + '</div><div class="votes">' + dots + "</div></div></div>";
    });
    return h + "</div>";
  }
  function playersGrid() {
    var h = '<div class="players">', shownEmpty = false;
    for (var i = 0; i < PP.MAX_PLAYERS; i++) {
      var p = players[i];
      if (!(p && p.active)) {
        if (shownEmpty) continue;
        shownEmpty = true;
        h += '<div class="pcard empty"><span class="pulse">Waiting for players…</span></div>';
        continue;
      }
      if (p && p.active) {
        h += '<div class="pcard' + (p.ready ? " ready" : "") + '" style="border-color:' + (p.ready ? "" : "transparent") + '">' +
          '<img class="fimg" src="' + imgUrl(p.slot) + '" alt="">' +
          '<div class="ptxt"><div class="pname" style="color:' + p.color + '">' + PP.escapeHtml(p.name) + '</div><div class="pfloat">' + p.floatName + "</div></div>" +
          '<div class="rdy">' + (p.ready ? "READY" : "NOT READY") + "</div></div>";
      }
    }
    return h + "</div>";
  }
  function standingsHtml(animate) {
    var rows = active().slice().sort(function (a, b) { return b.wins - a.wins || a.slot - b.slot; });
    var n = rows.length, champ = phase === "champion";
    var two = n > 4 || (champ && n > 3), compact = two || champ;
    var h = '<div class="standings' + (two ? " two" : "") + (compact ? " compact" : "") + '"' +
      (two ? ' style="grid-template-rows:repeat(' + Math.ceil(n / 2) + ',auto)"' : "") + ">";
    rows.forEach(function (p, i) {
      var win = (phase === "champion" ? p.slot === champion : p.slot === lastWinner);
      h += '<div class="srow' + (win ? " win" : "") + '"><div class="rank">' + (i + 1) + '</div>' +
        '<img class="fimg" src="' + imgUrl(p.slot) + '" alt="">' +
        '<div class="pname" style="color:' + p.color + '">' + PP.escapeHtml(p.name) + "<small>" + p.floatName + "</small></div>" +
        pipsHtml(p, animate) +
        '<div class="rdy' + (p.ready ? " on" : "") + '">' + (p.ready ? "READY" : "tap READY") + "</div></div>";
    });
    return h + "</div>";
  }
  function footer(text) {
    var a = active();
    var ready = a.filter(function (p) { return p.ready; }).length;
    var right = a.length < 2 ? '<span class="pulse">Waiting for at least 2 players…</span>' : '<span class="cta"><b>' + ready + "/" + a.length + "</b> ready</span>";
    return '<div class="foot"><span class="cta">' + text + "</span>" + right + "</div>";
  }

  var lastPanelPhase = "", animatePips = false;
  function renderPanel() {
    var h = "";
    if (phase === "lobby") {
      h = '<div class="head"><div class="logo">Pool Party<small>FIRST TO ' + CFG.winsToWin + " WINS</small></div>" + joinBox() + "</div>" +
        '<div class="section-label">PLAYERS · UP TO 8</div>' + playersGrid() + modesHtml() +
        footer("Vote a mode, then everyone taps <b>READY</b>");
    } else if (phase === "results") {
      var w = players[lastWinner];
      var title = lastCancelled ? "Round cancelled" : (w ? '<span style="color:' + w.color + '">' + PP.escapeHtml(w.name) + "</span> wins the round!" : "Draw!");
      var sub = PP.MODES[currentMode].name + " · Round " + matchRound + " · first to <b>" + CFG.winsToWin + "</b> wins";
      h = '<div class="hero">' + (w ? '<img class="big" src="' + imgUrl(w.slot) + '" alt="">' : "") +
        '<div class="headText"><div class="title">' + title + '</div><div class="sub">' + sub + "</div></div>" + joinBox() + "</div>" +
        standingsHtml(animatePips) + footer("Everyone tap <b>READY</b> for the next round");
    } else if (phase === "champion") {
      var c = players[champion];
      var t2 = c ? '<span style="color:' + c.color + '">' + PP.escapeHtml(c.name) + '</span> is the <span class="accent">champion!</span>' : "Match over";
      h = '<div class="hero small"><div class="trophy">' + PP.ICONS.trophy + "</div>" + (c ? '<img class="big" src="' + imgUrl(c.slot) + '" alt="">' : "") +
        '<div class="headText"><div class="title">' + t2 + '</div><div class="sub">' + PP.MODES[currentMode].name + " · " + matchRound + " rounds</div></div></div>" +
        standingsHtml(animatePips) + modesHtml() + footer("Vote the next mode, then everyone taps <b>READY</b>");
    }
    elPanel.innerHTML = h;
    if (lastPanelPhase !== phase) {
      elPanel.style.animation = "none"; void elPanel.offsetWidth; elPanel.style.animation = "";
      lastPanelPhase = phase;
    }
  }
  function showPanel() { elOverlay.classList.remove("off"); elHud.classList.add("hidden"); elCredits.classList.remove("hide"); }
  function hidePanel() { elOverlay.classList.add("off"); elCredits.classList.add("hide"); lastPanelPhase = ""; }

  function renderHud() {
    var m = PP.MODES[currentMode];
    elMode.innerHTML = modeIcon(currentMode) + "<span>" + m.name + "</span>";
    var h = "";
    inRound().forEach(function (p) {
      h += '<div class="mini' + (p.alive && !p.outAnim ? "" : " out") + '"><img src="' + imgUrl(p.slot) + '" alt="">' + pipsHtml(p, false) + "</div>";
    });
    elMini.innerHTML = h;
  }

  function renderAll() {
    if (phase === "lobby" || phase === "results" || phase === "champion") {
      animatePips = (phase !== "lobby") && lastPanelPhase !== phase;
      showPanel(); renderPanel();
    } else {
      elHud.classList.remove("hidden");
      renderHud();
    }
  }

  var bannerTimer = null;
  function showBanner(top, main, color, short) {
    elBannerTop.textContent = top || "";
    elBannerMain.textContent = main || "";
    elBannerTop.style.color = color && !short ? color : "";
    elBanner.classList.remove("show"); void elBanner.offsetWidth;
    elBanner.style.animationDuration = short ? "0.9s" : "1.6s";
    elBanner.classList.add("show");
  }

  var toastTimer = null;
  function toast(text, icon, color) {
    var ic = PP.ICONS[icon] ? '<div class="ti" style="background:' + color + '">' + PP.ICONS[icon] + "</div>" : "";
    elToast.innerHTML = ic + "<span>" + PP.escapeHtml(text) + "</span>";
    elToast.style.borderColor = color || "";
    elToast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.classList.remove("show"); }, 2200);
  }

  // ------------------------------------------------------------------ controller views
  function viewFor(p) {
    var m = PP.MODES[currentMode];
    var base = { t: "view", slot: p.slot, float: p.floatKey, floatName: p.floatName, hue: p.hue, color: p.color, name: p.name,
      wins: p.wins, winsToWin: CFG.winsToWin, mode: m.name, modeIdx: currentMode, modeColor: m.color };
    if (phase === "intro" || phase === "play" || phase === "outro") {
      base.view = "pad";
      base.spectating = !p.inRound;
      base.out = p.inRound && !p.alive;
      return base;
    }
    base.view = "ready";
    base.ready = p.ready;
    base.vote = p.vote;
    base.next = nextMode();
    base.counts = voteCounts();
    base.showModes = !matchRunning;
    var w = players[lastWinner], c = players[champion];
    if (phase === "lobby") { base.title = "You're in!"; base.sub = "Vote a mode, then tap READY"; }
    else if (phase === "champion") { base.title = p.slot === champion ? "You are the champion!" : ((c ? c.name : "Someone") + " wins the match"); base.sub = "Vote the next mode"; base.champion = p.slot === champion; }
    else if (lastCancelled) { base.title = "Round cancelled"; base.sub = "Wins: " + p.wins + " / " + CFG.winsToWin; }
    else { base.title = p.slot === lastWinner ? "You won the round!" : ((w ? w.name : "Nobody") + " won the round"); base.sub = "Your wins: " + p.wins + " / " + CFG.winsToWin; base.won = p.slot === lastWinner; }
    if (phase === "results") {
      base.board = active().slice().sort(function (a, b) { return b.wins - a.wins || a.slot - b.slot; }).map(function (q) {
        return { n: q.name, c: q.color, w: q.wins, f: q.floatKey, h: q.hue, me: q.slot === p.slot, r: q.ready };
      });
      base.round = matchRound;
    }
    return base;
  }
  function sendView(p) { if (p && p.active) send(p, viewFor(p)); }
  function sendViews() { active().forEach(sendView); }

  // ------------------------------------------------------------------ sound button
  Sound.onUnlockChange(function (okk) { elSound.classList.toggle("hidden", okk); });
  function unlockSound() { if (!Sound.unlocked) Sound.start(); }
  elSound.addEventListener("click", unlockSound);
  document.addEventListener("pointerdown", unlockSound, { once: false });
  document.addEventListener("keydown", unlockSound);
  setTimeout(function () { Sound.start().then(function (okk) { if (!okk) elSound.classList.remove("hidden"); }); }, 300);

  // ------------------------------------------------------------------ main loop
  var last = performance.now(), acc = 0, STEP = 1 / 120;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000) * CFG.speed; last = now;
    acc += dt;
    var guard = 0;
    while (acc >= STEP && guard++ < 60) { step(STEP); acc -= STEP; }
    render();
    // HUD refresh for eliminations (cheap)
    if (phase === "play" && (time * 4 | 0) !== (frame.lastHud | 0)) { frame.lastHud = time * 4; renderHud(); }
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  renderAll();
  requestAnimationFrame(frame);

  // ------------------------------------------------------------------ test hooks
  if (TEST) {
    window.__pp = {
      get phase() { return phase; }, get mode() { return currentMode; }, get matchRunning() { return matchRunning; },
      get matchRound() { return matchRound; }, get roundsPlayed() { return roundsPlayed; }, get champion() { return champion; },
      get lastWinner() { return lastWinner; }, get boosters() { return boosters.length; }, get safe() { return safe; }, get play() { return play; },
      players: function () { return players.filter(Boolean).map(function (p) { return { slot: p.slot, device: p.device, name: p.name, active: p.active, ready: p.ready, vote: p.vote, wins: p.wins, inRound: p.inRound, alive: p.alive, x: p.x, y: p.y, scale: p.scale, shield: p.shield, frozen: time < p.frozenUntil, turbo: time < p.turboUntil }; }); },
      cfg: CFG
    };
  }
})();
