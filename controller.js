/* Pool Party — phone controller (AirConsole controller.html) */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var ac = new AirConsole({ orientation: AirConsole.ORIENTATION_PORTRAIT, translation: false });

  var views = { wait: $("vWait"), full: $("vFull"), ready: $("vReady"), pad: $("vPad") };
  var state = { vote: -1, next: 0, counts: [0, 0, 0], view: "wait", ready: false, me: null };

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].classList.toggle("hidden", k !== name); });
    state.view = name;
  }

  function buzz(p) {
    if (!p) return;
    var ms = Array.isArray(p) ? p.reduce(function (a, b) { return a + b; }, 0) : p;
    try { if (ac.vibrate) { ac.vibrate(Math.min(ms, 600)); return; } } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {}
  }

  // ---------- modes ----------
  var modesEl = $("modes");
  PP.MODES.forEach(function (m, i) {
    var el = document.createElement("div");
    el.className = "mode";
    el.innerHTML = '<div class="check">✓</div><div class="mic" style="background:' + m.color + '">' + PP.ICONS[m.icon] + '</div>' +
      '<div class="mt"><div class="mn">' + m.name + '</div><div class="md">' + m.short + '</div></div><div class="cnt">0</div>';
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      state.vote = i;
      ac.message(AirConsole.SCREEN, { t: "vote", mode: i });
      renderModes(); buzz(15);
    });
    modesEl.appendChild(el);
  });
  function renderModes() {
    for (var i = 0; i < modesEl.children.length; i++) {
      var c = modesEl.children[i];
      c.classList.toggle("mine", i === state.vote);
      c.style.borderColor = i === state.vote ? PP.MODES[i].color : "transparent";
      c.querySelector(".cnt").textContent = state.counts[i] || 0;
      var tag = c.querySelector(".tag");
      if (i === state.next) { if (!tag) { tag = document.createElement("div"); tag.className = "tag"; tag.textContent = "NEXT"; c.appendChild(tag); } }
      else if (tag) tag.remove();
    }
  }

  function pips(el, wins, total) {
    var h = "";
    for (var i = 0; i < total; i++) h += '<div class="pip' + (i < wins ? " on" : "") + '"></div>';
    el.innerHTML = h;
  }

  function applyMe(d) {
    state.me = d;
    var src = (PP.FLOATS.filter(function (f) { return f.key === d.float; })[0] || PP.FLOATS[0]).img;
    [$("rImg"), $("pImg")].forEach(function (im) {
      if (im.getAttribute("src") !== src) im.src = src;
      im.style.filter = (d.hue ? "hue-rotate(" + d.hue + "deg) saturate(1.15) " : "") + "drop-shadow(0 6px 8px rgba(0,30,60,0.35))";
    });
    document.documentElement.style.setProperty("--me", d.color || "#2ec5c5");
  }

  // ---------- ready view ----------
  var readyBtn = $("readyBtn");
  function showReady(d) {
    applyMe(d);
    $("rName").textContent = (d.name || "") + " · " + (d.floatName || "");
    $("rTitle").textContent = d.title || "";
    $("rTitle").classList.toggle("gold", !!(d.won || d.champion));
    $("rSub").textContent = d.sub || "";
    pips($("rPips"), d.wins || 0, d.winsToWin || PP.WINS_TO_WIN);
    $("rPips").classList.toggle("hidden", !!d.showModes && !d.champion && (d.wins || 0) === 0);
    if (typeof d.vote === "number" && d.vote >= 0) state.vote = d.vote;
    if (typeof d.next === "number") state.next = d.next;
    if (d.counts) state.counts = d.counts;
    $("modesWrap").classList.toggle("hidden", !d.showModes);
    var hasBoard = !d.showModes && d.board && d.board.length;
    $("boardWrap").classList.toggle("hidden", !hasBoard);
    if (hasBoard) {
      $("boardLabel").textContent = "STANDINGS · ROUND " + (d.round || 1) + " · FIRST TO " + (d.winsToWin || PP.WINS_TO_WIN);
      var bh = "";
      d.board.forEach(function (q, i) {
        var src = (PP.FLOATS.filter(function (f) { return f.key === q.f; })[0] || PP.FLOATS[0]).img;
        var pp = "";
        for (var k = 0; k < (d.winsToWin || PP.WINS_TO_WIN); k++) pp += '<div class="pip' + (k < q.w ? " on" : "") + '"></div>';
        bh += '<div class="brow' + (q.me ? " me" : "") + '"><div class="brank">' + (i + 1) + '</div>' +
          '<img src="' + src + '" alt="" style="filter:' + (q.h ? "hue-rotate(" + q.h + "deg) saturate(1.15)" : "none") + '">' +
          '<div class="bname" style="color:' + q.c + '">' + PP.escapeHtml(q.n) + '</div>' +
          '<div class="pips small">' + pp + '</div>' +
          '<div class="bok' + (q.r ? " on" : "") + '">✓</div></div>';
      });
      $("board").innerHTML = bh;
      $("board").classList.toggle("dense", d.board.length > 5);
    }
    renderModes();
    state.ready = !!d.ready;
    readyBtn.classList.toggle("done", state.ready);
    readyBtn.querySelector("span").textContent = state.ready ? "Ready — waiting for others" : "READY";
    show("ready");
  }
  readyBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (state.ready) return;
    state.ready = true;
    ac.message(AirConsole.SCREEN, { t: "ready" });
    readyBtn.classList.add("done");
    readyBtn.querySelector("span").textContent = "Ready — waiting for others";
    buzz(30);
  });

  // ---------- pad ----------
  var pad = $("pad"), aim = $("aim"), arrow = $("arrow");
  function showPad(d) {
    applyMe(d);
    var m = PP.MODES[d.modeIdx] || PP.MODES[0];
    $("pMode").innerHTML = '<div class="mic" style="background:' + m.color + '">' + PP.ICONS[m.icon] + "</div><span>" + m.name + "</span>";
    pips($("pPips"), d.wins || 0, d.winsToWin || PP.WINS_TO_WIN);
    $("outCover").classList.toggle("hidden", !d.out);
    $("specCover").classList.toggle("hidden", !d.spectating);
    if (state.view !== "pad") { $("frozen").classList.add("hidden"); hideBanner(); }
    show("pad");
  }

  var lastTap = 0;
  pad.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    var now = performance.now();
    if (now - lastTap < 55) return;
    lastTap = now;
    var r = aim.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = e.clientX - cx, dy = e.clientY - cy, len = Math.hypot(dx, dy);
    if (len < 6) return;
    ac.message(AirConsole.SCREEN, { t: "tap", x: dx / len, y: dy / len });
    // feedback: ripple at the finger, arrow showing where you go, little kick
    var rp = document.createElement("div"); rp.className = "ripple";
    rp.style.left = e.clientX + "px"; rp.style.top = e.clientY + "px";
    document.body.appendChild(rp); setTimeout(function () { rp.remove(); }, 520);
    var ang = Math.atan2(-dy, -dx) * 180 / Math.PI;
    arrow.style.transform = "rotate(" + ang + "deg)";
    arrow.classList.remove("show"); void arrow.offsetWidth; arrow.classList.add("show");
    aim.classList.add("kick"); setTimeout(function () { aim.classList.remove("kick"); }, 110);
    buzz(12);
  });

  // ---------- banners / events ----------
  var bannerTimer = null;
  function banner(text, color, seconds) {
    var b = $("banner"), bar = $("bannerBar");
    $("bannerText").textContent = text;
    b.style.background = color || "#2a3f5f";
    var dur = Math.max(1.6, seconds || 0);
    bar.style.display = seconds ? "block" : "none";
    bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth;
    bar.style.transition = "width " + dur + "s linear"; bar.style.width = "0%";
    b.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, dur * 1000);
  }
  function hideBanner() { $("banner").classList.remove("show"); }
  function flash(color) {
    var f = document.createElement("div"); f.className = "flash"; f.style.background = color;
    document.body.appendChild(f); setTimeout(function () { f.remove(); }, 650);
  }
  var frozenTimer = null;
  function frozen(sec) {
    var f = $("frozen"); f.classList.remove("hidden");
    clearTimeout(frozenTimer); frozenTimer = setTimeout(function () { f.classList.add("hidden"); }, sec * 1000);
  }

  function onEvent(d) {
    switch (d.e) {
      case "go": banner("GO!", "#2cc56c", 0); break;
      case "out": $("outCover").classList.remove("hidden"); $("frozen").classList.add("hidden"); break;
      case "win": flash("rgba(255,207,74,0.8)"); break;
      case "champion": flash("rgba(255,207,74,0.9)"); break;
      case "booster": banner(d.name + "!", d.color, d.seconds); flash(d.color); break;
      case "frozen": frozen(d.seconds || 2.5); break;
      case "shrink": banner("POOL SHRINKING!", "#ff6b5c", 0); break;
      case "shield": banner("SHIELD SAVED YOU!", "#2ec4ff", 0); break;
    }
  }

  ac.onMessage = function (from, d) {
    if (from !== AirConsole.SCREEN || !d) return;
    if (d.vibrate) buzz(d.vibrate);
    if (d.t === "view") {
      if (d.view === "full") show("full");
      else if (d.view === "ready") showReady(d);
      else if (d.view === "pad") showPad(d);
    } else if (d.t === "ev") onEvent(d);
  };
  ac.onReady = function () { ac.message(AirConsole.SCREEN, { t: "hello" }); };
  // In case the screen was slow to answer
  setTimeout(function () { if (state.view === "wait") ac.message(AirConsole.SCREEN, { t: "hello" }); }, 1500);
  setTimeout(function () { if (state.view === "wait") ac.message(AirConsole.SCREEN, { t: "hello" }); }, 4000);
})();
