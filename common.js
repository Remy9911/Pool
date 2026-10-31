/* Pool Party — shared definitions for the TV screen and the phone controller. */
(function (root) {
  "use strict";

  var PP = {};

  PP.WINS_TO_WIN = 5;
  PP.MAX_PLAYERS = 8;

  // Game modes (index is sent over the wire)
  PP.MODES = [
    { key: "classic",   name: "Classic",        short: "Push everyone out. Last float wins.",          color: "#2ec5c5", icon: "classic" },
    { key: "shrinking", name: "Shrinking Pool", short: "After 15 s the pool closes in.",               color: "#ff6b5c", icon: "shrinking" },
    { key: "boosters",  name: "Booster Mayhem", short: "Grab turbo, giant, shield, shockwave, freeze.", color: "#9b6bff", icon: "boosters" }
  ];

  // Floats: four characters; players 5–8 reuse them with a hue shift.
  PP.FLOATS = [
    { key: "donut",  name: "Donut",      img: "float-donut.png" },
    { key: "melon",  name: "Watermelon", img: "float-melon.png" },
    { key: "duck",   name: "Duck",       img: "float-duck.png" },
    { key: "purple", name: "Purple",     img: "float-purple.png" }
  ];

  // One colour + hue shift per player slot.
  PP.SLOTS = [
    { float: 0, hue: 0,   color: "#ff6fae" },
    { float: 1, hue: 0,   color: "#3fdc8a" },
    { float: 2, hue: 0,   color: "#ffd23f" },
    { float: 3, hue: 0,   color: "#b07bff" },
    { float: 0, hue: 150, color: "#39c7ff" },
    { float: 1, hue: 200, color: "#ff8a3d" },
    { float: 2, hue: 160, color: "#7cf0e6" },
    { float: 3, hue: 120, color: "#ff5d6c" }
  ];

  PP.BOOSTERS = [
    { key: "turbo",     name: "TURBO",     color: "#ff9f1c", seconds: 6,   desc: "Stronger splashes" },
    { key: "giant",     name: "GIANT",     color: "#3ddc84", seconds: 7,   desc: "Huge and heavy" },
    { key: "shield",    name: "SHIELD",    color: "#2ec4ff", seconds: 0,   desc: "Saves you once" },
    { key: "shockwave", name: "SHOCKWAVE", color: "#ff4fa3", seconds: 0,   desc: "Blast everyone away" },
    { key: "freeze",    name: "FREEZE",    color: "#9ad8ff", seconds: 2.5, desc: "Freeze the others" }
  ];

  PP.slotInfo = function (slot) {
    var s = PP.SLOTS[slot % PP.SLOTS.length];
    var f = PP.FLOATS[s.float];
    return { float: f, floatKey: f.key, floatName: f.name, img: f.img, hue: s.hue, color: s.color };
  };

  PP.escapeHtml = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // Small inline SVG icons used in both UIs (white glyphs, 24x24 viewBox).
  PP.ICONS = {
    classic: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
    shrinking: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2.4"/><rect x="7.5" y="7.5" width="9" height="9" rx="2.5" fill="currentColor"/></svg>',
    boosters: '<svg viewBox="0 0 24 24"><path d="M13.5 2 5 13.4h5.6L9.2 22 19 9.9h-5.8z" fill="currentColor"/></svg>',
    turbo: '<svg viewBox="0 0 24 24"><path d="M13.5 2 5 13.4h5.6L9.2 22 19 9.9h-5.8z" fill="currentColor"/></svg>',
    giant: '<svg viewBox="0 0 24 24"><path d="M12 2.5 20 11h-4.8v10.5H8.8V11H4z" fill="currentColor"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 2 20 5v6.4c0 5-3.4 8.9-8 10.6-4.6-1.7-8-5.6-8-10.6V5z" fill="currentColor"/></svg>',
    shockwave: '<svg viewBox="0 0 24 24"><path d="m12 1.5 2.3 6.2 6.6.3-5.2 4 1.8 6.4L12 14.8l-5.5 3.6 1.8-6.4-5.2-4 6.6-.3z" fill="currentColor"/></svg>',
    freeze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7"/><path d="m9 3.5 3 2.5 3-2.5M9 20.5l3-2.5 3 2.5M2.8 10.6l3.9-.6-1-3.8M21.2 13.4l-3.9.6 1 3.8M2.8 13.4l3.9.6-1 3.8M21.2 10.6l-3.9-.6 1-3.8"/></svg>',
    trophy: '<svg viewBox="0 0 64 64"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#f5a623"/></linearGradient></defs><path d="M18 6h28v14c0 9-6 16-14 16s-14-7-14-16z" fill="url(#tg)"/><path d="M18 10H8v4c0 7 5 12 12 12M46 10h10v4c0 7-5 12-12 12" fill="none" stroke="#f5b83d" stroke-width="4"/><rect x="28" y="35" width="8" height="10" fill="#f5a623"/><rect x="18" y="45" width="28" height="8" rx="3" fill="url(#tg)"/><rect x="14" y="53" width="36" height="6" rx="3" fill="#e0901a"/><path d="M27 14h10" stroke="#fff6c9" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>'
  };

  root.PP = PP;
})(window);
