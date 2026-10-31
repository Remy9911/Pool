/* Pool Party — sound: music + water ambience (files) and synthesized effects (Web Audio). */
(function (root) {
  "use strict";

  var ctx = null, master = null, sfxBus = null, noiseBuf = null;
  var music = null, ambience = null;
  var unlocked = false;
  var listeners = [];

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function initMedia() {
    if (music) return;
    music = new Audio("music.mp3"); music.loop = true; music.volume = 0.32; music.preload = "auto";
    ambience = new Audio("water-ambience.mp3"); ambience.loop = true; ambience.volume = 0.22; ambience.preload = "auto";
  }

  function tryStart() {
    initMedia();
    var c = ensureCtx();
    var p1 = c && c.state !== "running" ? c.resume() : Promise.resolve();
    var p2 = music.play();
    var p3 = ambience.play();
    return Promise.all([p1, p2 || Promise.resolve(), p3 || Promise.resolve()]).then(function () {
      if (c && c.state !== "running") throw new Error("ctx");
      unlocked = true;
      listeners.forEach(function (f) { f(true); });
      return true;
    }).catch(function () {
      listeners.forEach(function (f) { f(false); });
      return false;
    });
  }

  function now() { return ctx ? ctx.currentTime : 0; }
  function ok() { return ctx && ctx.state === "running"; }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function noise(t, dur, f0, f1, q, vol, type) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var flt = ctx.createBiquadFilter(); flt.type = type || "bandpass"; flt.Q.value = q || 1;
    flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    var g = ctx.createGain(); env(g, t, 0.01, vol, dur);
    src.connect(flt); flt.connect(g); g.connect(sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.1);
  }

  function tone(t, f0, f1, dur, vol, type) {
    var o = ctx.createOscillator(); o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = ctx.createGain(); env(g, t, 0.008, vol, dur);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }

  var Sound = {
    get unlocked() { return unlocked; },
    onUnlockChange: function (f) { listeners.push(f); },
    start: tryStart,
    musicVolume: function (v) { if (music) music.volume = v; },

    splash: function (strength) {
      if (!ok()) return; var t = now(); var s = strength || 1;
      noise(t, 0.22, 2600 + Math.random() * 900, 500, 0.9, 0.22 * s);
      tone(t, 520 + Math.random() * 160, 260, 0.12, 0.06 * s, "sine");
    },
    bump: function (strength) {
      if (!ok()) return; var t = now(); var s = Math.min(1, strength);
      tone(t, 150, 70, 0.16, 0.35 * s, "sine");
      noise(t, 0.08, 900, 300, 1.2, 0.08 * s);
    },
    out: function () {
      if (!ok()) return; var t = now();
      noise(t, 0.6, 3200, 200, 0.7, 0.4);
      tone(t, 620, 120, 0.55, 0.16, "triangle");
    },
    pickup: function () {
      if (!ok()) return; var t = now();
      [880, 1175, 1568].forEach(function (f, i) { tone(t + i * 0.06, f, f * 1.01, 0.22, 0.12, "triangle"); });
    },
    shockwave: function () {
      if (!ok()) return; var t = now();
      tone(t, 120, 40, 0.6, 0.5, "sine");
      noise(t, 0.7, 1800, 120, 0.6, 0.35, "lowpass");
    },
    freeze: function () {
      if (!ok()) return; var t = now();
      [1760, 2349, 2637, 3136].forEach(function (f, i) { tone(t + i * 0.05, f, f, 0.35, 0.05, "sine"); });
      noise(t, 0.5, 6000, 3000, 2, 0.06, "highpass");
    },
    shield: function () {
      if (!ok()) return; var t = now();
      tone(t, 300, 900, 0.25, 0.15, "triangle"); noise(t, 0.2, 2000, 4000, 1, 0.1);
    },
    whistle: function () {
      if (!ok()) return; var t = now();
      var o = ctx.createOscillator(); o.type = "triangle";
      var lfo = ctx.createOscillator(); lfo.frequency.value = 28; var lg = ctx.createGain(); lg.gain.value = 60;
      lfo.connect(lg); lg.connect(o.frequency); o.frequency.value = 2100;
      var g = ctx.createGain(); env(g, t, 0.02, 0.12, 0.45);
      o.connect(g); g.connect(sfxBus); o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
    },
    blip: function (up) {
      if (!ok()) return; var t = now();
      tone(t, up ? 660 : 520, up ? 990 : 520, 0.1, 0.08, "triangle");
    },
    win: function () {
      if (!ok()) return; var t = now();
      [523, 659, 784, 1047].forEach(function (f, i) { tone(t + i * 0.1, f, f, 0.3, 0.13, "triangle"); });
    },
    champion: function () {
      if (!ok()) return; var t = now();
      var seq = [523, 659, 784, 1047, 784, 1047, 1319];
      seq.forEach(function (f, i) { tone(t + i * 0.12, f, f, i === seq.length - 1 ? 0.8 : 0.22, 0.14, "triangle"); });
      noise(t + 0.85, 0.6, 5000, 2000, 0.8, 0.05, "highpass");
    }
  };

  root.Sound = Sound;
})(window);
