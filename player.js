/*
 * QualityLock — player layer. Runs in the page (MAIN world) right after
 * inject.js, which hands over a small core API through window.__qlockCore.
 *
 * Adds the floating toolbar, the display engine (fit / fill / stretch / aspect,
 * zoom, rotate, flip, black-bar detection), ambient light and blur fill for
 * black bars, picture filters, speed, a timeline with hover previews, A-B loop,
 * snapshot, Picture-in-Picture, browser-window fullscreen, lights off, mouse
 * wheel / side-button controls and the on-screen notifications.
 *
 * What keeps it working across sites:
 *  - All UI lives in shadow roots inside top-layer popovers (core.mountOnTop),
 *    so it shows above fullscreen players and page CSS can't reach it.
 *  - No innerHTML anywhere: Trusted Types sites (YouTube) reject HTML strings.
 *  - Styles go in through adoptedStyleSheets (falls back to <style>).
 *  - The video is moved with the scale / rotate / translate properties, not
 *    transform: the browser's fullscreen stylesheet forces transform:none on a
 *    fullscreen <video>. Every inline value we write is put back on release.
 *  - Netflix and YouTube are seeked / paused / muted through their own player
 *    APIs (setting currentTime directly crashes Netflix's player).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.document) return;
  var G = window;
  var core = G.__qlockCore;
  try { delete G.__qlockCore; } catch (e) { /* ignore */ }
  if (!core || !core.hooks || core.hooks.attached) return;
  core.hooks.attached = true;

  var doc = G.document;
  var TAG = '[QualityLock]';
  var SITE = core.site;
  var noop = function () {};

  function now() { return Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function warn(msg, e) { try { G.console.warn(TAG, msg, e || ''); } catch (x) { /* ignore */ } }

  // ==================================================================
  // Settings (mirror of defaults.js; the bridge sends the merged object)
  // ==================================================================
  var BUTTONS = [
    ['play', true], ['back', true], ['fwd', true], ['speed', true],
    ['fill', true], ['display', true], ['backdrop', true], ['picture', true],
    ['rotate', false], ['loop', false], ['snapshot', false], ['lights', false],
    ['pip', true], ['winfs', true], ['fullscreen', true], ['stats', false]
  ];
  var DEF = {
    enabled: true,
    videoController: { enabled: true, showOsd: true },
    toolbar: {
      show: 'hover', layout: 'compact', theme: 'glass', autoHide: 3, accent: 'rose', primary: '#f2a7b5', secondary: '#c9a3e6',
      buttons: BUTTONS.map(function (b) { return { id: b[0], on: b[1] }; })
    },
    display: { rememberPerSite: false, smartCrop: true },
    picture: { brightness: 100, contrast: 100, saturation: 100, gamma: 100, warmth: 0, sharpness: 0, grayscale: 0 },
    backdrop: { mode: 'off', intensity: 80, blur: 50, rgbEffect: 'wave', rgbColor: '#8a5cff', rgbSpeed: 40, imageAt: 0 },
    playback: { speed: 1, rememberSpeed: true, speedStep: 0.25, seekStep: 10 },
    mouse: { wheelVolume: 'off', rightWheel: true, sideButtons: 'video', seekBackButton: 3, seekFwdButton: 4, volumeStep: 5, hideCursor: true }
  };
  var PICTURE_DEFAULT = DEF.picture;

  function merge(d, s) {
    if (Array.isArray(d)) return Array.isArray(s) ? s.slice() : d.slice();
    if (d && typeof d === 'object') {
      var o = {};
      for (var k in d) o[k] = merge(d[k], s && typeof s === 'object' && !Array.isArray(s) ? s[k] : undefined);
      return o;
    }
    return (s !== undefined && s !== null && typeof s === typeof d) ? s : d;
  }
  function normButtons(list) {
    var known = {};
    BUTTONS.forEach(function (b) { known[b[0]] = b[1]; });
    var out = [];
    var seen = {};
    (Array.isArray(list) ? list : []).forEach(function (b) {
      if (!b || !(b.id in known) || seen[b.id]) return;
      seen[b.id] = true;
      out.push({ id: b.id, on: b.on !== false });
    });
    BUTTONS.forEach(function (b) { if (!seen[b[0]]) out.push({ id: b[0], on: b[1] }); });
    return out;
  }

  var cfg = null;
  function refreshCfg() {
    var s = core.getSettings() || {};
    cfg = merge(DEF, s);
    cfg.enabled = s.enabled !== false;
    cfg.toolbar.buttons = normButtons(cfg.toolbar.buttons);
  }
  refreshCfg();

  var VERSION = '1.2.1';
  var retired = false; // the extension was updated or removed under this page
  function on() { return !retired && cfg.enabled && cfg.videoController.enabled; }

  // ==================================================================
  // Accent colours (presets, custom, or taken from the site / picture)
  // ==================================================================
  var ACCENTS = {
    rose: ['#f2a7b5', '#c9a3e6'], peach: ['#f7b98b', '#f29e9e'], amber: ['#f5c26b', '#e89b5a'], sand: ['#e3c9a1', '#c7a27e'],
    sage: ['#a8d5b5', '#8cc7c2'], sky: ['#9ec9f2', '#b4a7ee'], lavender: ['#c3b1f0', '#f0b3d6'], mono: ['#e6e6e6', '#a8a8a8']
  };
  var dynAccent = null;
  function hexOk(x) { return typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x); }
  function hexRgb(x) { return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]; }
  function rgbHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, hh = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh *= 60;
    }
    return [hh, s, l];
  }
  function hslHex(hh, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; } else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; } else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
    return '#' + [r, g, b].map(function (v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); }).join('');
  }
  function accent() {
    var a = cfg.toolbar.accent;
    if (a === 'custom' && hexOk(cfg.toolbar.primary)) return [cfg.toolbar.primary, hexOk(cfg.toolbar.secondary) ? cfg.toolbar.secondary : cfg.toolbar.primary];
    if (a === 'dynamic') return dynAccent || ACCENTS.rose;
    return ACCENTS[a] || ACCENTS.rose;
  }
  function onAccent(hex) {
    var c = hexRgb(hex);
    var lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return lum > 0.5 ? '#1d1a22' : '#ffffff';
  }
  function accentVars(el) {
    if (!el) return;
    var a = accent();
    el.style.setProperty('--accent', a[0]);
    el.style.setProperty('--accent2', a[1]);
    el.style.setProperty('--on-accent', onAccent(a[0]));
  }
  // A colour turned into a soft pastel pair; null for greys.
  function softPair(r, g, b) {
    var hsl = rgbHsl(r, g, b);
    if (hsl[1] < 0.2 || hsl[2] < 0.08 || hsl[2] > 0.95) return null;
    return [hslHex(hsl[0], clamp(hsl[1], 0.45, 0.72), 0.72), hslHex((hsl[0] + 36) % 360, clamp(hsl[1], 0.4, 0.62), 0.75)];
  }
  var colorCtx = null;
  function parseColor(str) {
    if (!colorCtx) { var c = doc.createElement('canvas'); c.width = c.height = 1; colorCtx = c.getContext('2d', { willReadFrequently: true }); }
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = String(str || '');
    var f = colorCtx.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(f)) return hexRgb(f);
    var m = f.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  // 'From site': the site's own brand colour (theme-color); if it has none or it's
  // grey, the most colourful part of the picture, so it follows the scene.
  var dynCv = null;
  function refreshDynamic() {
    if (cfg.toolbar.accent !== 'dynamic') return;
    var found = null;
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) { var c = parseColor(meta.getAttribute('content')); if (c) found = softPair(c[0], c[1], c[2]); }
    if (!found) {
      var v = targetVideo();
      if (v && !isDrm(v) && v.readyState >= 2 && v.videoWidth) {
        try {
          if (!dynCv) { dynCv = doc.createElement('canvas'); dynCv.width = 32; dynCv.height = 18; }
          var x = dynCv.getContext('2d');
          x.drawImage(v, 0, 0, 32, 18);
          var d = x.getImageData(0, 0, 32, 18).data, R = 0, Gg = 0, B = 0, W = 0;
          for (var i = 0; i < d.length; i += 4) {
            var hsl = rgbHsl(d[i], d[i + 1], d[i + 2]);
            if (hsl[2] < 0.12 || hsl[2] > 0.92) continue;
            var w = hsl[1] * hsl[1];
            R += d[i] * w; Gg += d[i + 1] * w; B += d[i + 2] * w; W += w;
          }
          if (W > 0.5) found = softPair(R / W, Gg / W, B / W);
        } catch (e) { /* frames not readable */ }
      }
    }
    if (!found) return;
    if (dynAccent) {
      // Only follow clear hue changes, so it doesn't flicker scene to scene.
      var h1 = rgbHsl.apply(null, hexRgb(found[0]))[0], h0 = rgbHsl.apply(null, hexRgb(dynAccent[0]))[0];
      var dh = Math.abs(h1 - h0); if (dh > 180) dh = 360 - dh;
      if (dh < 22) return;
    }
    dynAccent = found;
    if (tb.w) accentVars(tb.w);
    if (osdUi) accentVars(osdUi.box);
  }

  // Target for messages to the bridge in this same window.
  function selfOrigin() {
    return G.location.origin && G.location.origin !== 'null' && G.location.protocol !== 'file:' ? G.location.origin : '*';
  }
  function postPatch(patch) {
    try { G.postMessage({ __qlock: 'patch', patch: patch }, selfOrigin()); } catch (e) { /* ignore */ }
  }

  // Command shortcuts (chrome://extensions/shortcuts), passed along with commands.
  var keys = {};

  // ==================================================================
  // DOM + style helpers
  // ==================================================================
  function h(tag, props, kids) {
    var e = doc.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.style.cssText = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (kids) {
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c === null || c === undefined || c === false) continue;
        e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
      }
    }
    return e;
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) {
    var e = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, String(attrs[k]));
    if (text) e.textContent = text;
    return e;
  }

  function adopt(root, css) {
    try {
      var sh = new G.CSSStyleSheet();
      sh.replaceSync(css);
      root.adoptedStyleSheets = Array.prototype.slice.call(root.adoptedStyleSheets || []).concat([sh]);
      return sh;
    } catch (e) {
      var st = doc.createElement('style');
      st.textContent = css;
      var parent = root === doc ? (doc.head || doc.documentElement) : root;
      if (parent) parent.appendChild(st);
      return st;
    }
  }

  // Document-level rules: hidden cursor while idle in fullscreen.
  var DOC_CSS = 'html[data-qlock-idle],html[data-qlock-idle] *{cursor:none!important}';
  var docSheet = null;
  function ensureDocCss() {
    if (!doc.documentElement) return;
    if (docSheet && docSheet.nodeType === 1) { if (!docSheet.isConnected) docSheet = adopt(doc, DOC_CSS); return; }
    if (docSheet) {
      // Some sites replace document.adoptedStyleSheets wholesale.
      try {
        if (Array.prototype.indexOf.call(doc.adoptedStyleSheets, docSheet) !== -1) return;
        doc.adoptedStyleSheets = Array.prototype.slice.call(doc.adoptedStyleSheets).concat([docSheet]);
        return;
      } catch (e) { /* fall through */ }
    }
    docSheet = adopt(doc, DOC_CSS);
  }

  // Writes only when the value really differs (compared in the browser's own
  // serialization), so style observers can't feed themselves.
  var probeStyle = doc.createElement('div').style;
  function setImportant(el, prop, val) {
    probeStyle.setProperty(prop, val);
    if (el.style.getPropertyValue(prop) === probeStyle.getPropertyValue(prop) &&
        el.style.getPropertyPriority(prop) === 'important') return;
    el.style.setProperty(prop, val, 'important');
  }

  // Inline !important styles on page elements that can be put back exactly.
  // Pass longhands only (left/top, not inset): every value is read before any is written.
  function pinStyles(el, props) {
    var saved = {};
    var k;
    for (k in props) saved[k] = { v: el.style.getPropertyValue(k), p: el.style.getPropertyPriority(k) };
    for (k in props) setImportant(el, k, props[k]);
    return function restore() {
      for (var p in saved) {
        if (saved[p].v) el.style.setProperty(p, saved[p].v, saved[p].p);
        else el.style.removeProperty(p);
      }
    };
  }

  // ==================================================================
  // Which video, and where it is
  // ==================================================================
  function area(v) { return v ? (v.offsetWidth || v.clientWidth) * (v.offsetHeight || v.clientHeight) : 0; }

  function targetVideo() {
    var fs = doc.fullscreenElement;
    if (fs) {
      if (fs.tagName === 'VIDEO') return fs;
      if (fs.querySelectorAll) {
        var list = fs.querySelectorAll('video');
        var best = null;
        for (var i = 0; i < list.length; i++) if (!best || area(list[i]) > area(best)) best = list[i];
        if (best) return best;
      }
    }
    if (winfs.on && winfs.video && winfs.video.isConnected) return winfs.video;
    var v = core.mainVideo();
    return v && v.isConnected ? v : null;
  }

  function viewportRect() { return { left: 0, top: 0, width: G.innerWidth, height: G.innerHeight }; }
  function pointIn(r, x, y) { return r && x >= r.left && y >= r.top && x <= r.left + r.width && y <= r.top + r.height; }

  // Layout box of the video without our own transform (scale / rotate keep the
  // centre in place; the translate we applied is subtracted back out).
  function layoutRect(v) {
    var r = v.getBoundingClientRect();
    var w = v.offsetWidth || v.clientWidth || r.width;
    var hh = v.offsetHeight || v.clientHeight || r.height;
    var tx = styler.v === v ? styler.tx : 0;
    var ty = styler.v === v ? styler.ty : 0;
    var cx = r.left + r.width / 2 - tx;
    var cy = r.top + r.height / 2 - ty;
    return { left: cx - w / 2, top: cy - hh / 2, width: w, height: hh };
  }

  // rect: the area the video is shown in — the fullscreen viewport, or the
  // closest larger ancestor (YouTube sizes the <video> to the picture and paints
  // the bars on the player behind it), or the video box itself.
  // el: the element to fullscreen / fill the window with — the outermost
  // wrapper of that same size, so the site's own controls come along.
  function playerBox(v) {
    var fs = doc.fullscreenElement;
    if (fs && (fs === v || fs.contains(v))) return { el: fs, rect: viewportRect(), fs: true };
    if (winfs.on && winfs.player && winfs.player.contains(v)) return { el: winfs.player, rect: viewportRect(), fs: true };
    var L = layoutRect(v);
    var rect = L, rectEl = v, el = v;
    var a = L.width * L.height;
    if (!a) return { el: v, rect: L, fs: false };
    var node = v.parentElement;
    for (var i = 0; node && i < 8; i++, node = node.parentElement) {
      if (node === doc.body || node === doc.documentElement) break;
      var r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // zero-size wrappers
      if (r.left > L.left + 2 || r.top > L.top + 2 || r.right < L.left + L.width - 2 || r.bottom < L.top + L.height - 2) break;
      if (r.width * r.height > a * 2.6) break;
      var same = Math.abs(r.width - rect.width) <= 2 && Math.abs(r.height - rect.height) <= 2;
      if (same) { el = node; continue; }
      if (rectEl !== v) break; // a second size step is page layout, not the player
      rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      rectEl = node;
      el = node;
    }
    return { el: el, rect: rect, fs: false };
  }

  var csCache = { v: null, at: 0, fit: 'contain', pos: 'static', z: 'auto' };
  function videoCss(v) {
    if (csCache.v !== v || now() - csCache.at > 1000) {
      var cs = G.getComputedStyle(v);
      csCache = { v: v, at: now(), fit: cs.objectFit || 'contain', pos: cs.position, z: cs.zIndex };
    }
    return csCache;
  }

  // Size of the picture inside the video box at scale 1.
  function contentSize(v, L) {
    var rv = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0;
    var fit = videoCss(v).fit;
    if (!rv || fit === 'fill' || fit === 'cover') return { w: L.width, h: L.height };
    if (rv > L.width / L.height) return { w: L.width, h: L.width / rv };
    return { w: L.height * rv, h: L.height };
  }

  function isDrm(v) { return !!(v && v.mediaKeys); }

  // ==================================================================
  // Display engine: mode + zoom + stretch + rotation, recomputed live
  // ==================================================================
  var MODE_NAMES = { original: 'Original', fit: 'Fit to screen', fill: 'Fill (no bars)', stretch: 'Stretch to fill', aspect: 'Aspect' };
  // inner: bars inside the video — 0 detect, -1 none, -2 manual (barT / barL), >0 film shape.
  var disp = { mode: 'original', aspect: 0, zoom: 1, sx: 1, sy: 1, rot: 0, flip: false, inner: 0, barT: 0, barL: 0, barLink: false };
  var DISP_KEY = '__qlock_display';

  function aspectName(a) {
    var named = [[4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 9, '16:9'], [1.85, '1.85:1'], [2.0, '2:1'], [64 / 27, '21:9'], [2.39, '2.39:1'], [32 / 9, '32:9'], [1, '1:1']];
    for (var i = 0; i < named.length; i++) if (Math.abs(named[i][0] - a) < 0.012) return named[i][1];
    return a.toFixed(2) + ':1';
  }
  function dispLabel() {
    var base = disp.mode === 'aspect' ? aspectName(disp.aspect) : MODE_NAMES[disp.mode] || disp.mode;
    var extra = [];
    if (Math.abs(disp.zoom - 1) > 0.004) extra.push(Math.round(disp.zoom * 100) + '%');
    if (Math.abs(disp.sx - 1) > 0.004 || Math.abs(disp.sy - 1) > 0.004) extra.push('↔' + Math.round(disp.sx * 100) + ' ↕' + Math.round(disp.sy * 100));
    if (disp.rot) extra.push(disp.rot + '°');
    if (disp.flip) extra.push('mirrored');
    return base + (extra.length ? ' · ' + extra.join(' · ') : '');
  }

  function saveDisp() {
    if (!cfg.display.rememberPerSite) return;
    try { G.localStorage.setItem(DISP_KEY, JSON.stringify(disp)); } catch (e) { /* storage blocked */ }
  }
  function loadDisp() {
    if (!cfg.display.rememberPerSite) return;
    try {
      var d = JSON.parse(G.localStorage.getItem(DISP_KEY) || 'null');
      if (d && typeof d === 'object' && MODE_NAMES[d.mode]) {
        disp.mode = d.mode; disp.aspect = +d.aspect || 0;
        disp.zoom = clamp(+d.zoom || 1, 0.25, 4); disp.sx = clamp(+d.sx || 1, 0.25, 3); disp.sy = clamp(+d.sy || 1, 0.25, 3);
        disp.rot = [0, 90, 180, 270].indexOf(d.rot) !== -1 ? d.rot : 0; disp.flip = !!d.flip;
        disp.inner = typeof d.inner === 'number' && (d.inner === -1 || d.inner === -2 || (d.inner >= 0 && d.inner < 6)) ? d.inner : 0;
        disp.barT = clamp(+d.barT || 0, 0, 0.35); disp.barL = clamp(+d.barL || 0, 0, 0.35); disp.barLink = !!d.barLink;
      }
    } catch (e) { /* ignore */ }
  }


  // Black bars that are part of the video file (a 2.39:1 film encoded in a
  // 16:9 or 1.85:1 frame). disp.inner: 0 = detect, -1 = none, >0 = the film's
  // real shape, picked by hand when detection can't read the frames.
  function innerCrop(v, C) {
    if (disp.inner === -2) return disp.barT > 0.001 || disp.barL > 0.001 ? { t: disp.barT, b: disp.barT, l: disp.barL, r: disp.barL } : null;
    if (disp.inner < 0) return null;
    if (disp.inner > 0) {
      var fa = C.w / C.h, R = disp.inner;
      if (R > fa + 0.01) { var t = (1 - fa / R) / 2; return { t: t, b: t, l: 0, r: 0 }; }
      if (R < fa - 0.01) { var l = (1 - R / fa) / 2; return { t: 0, b: 0, l: l, r: l }; }
      return null;
    }
    return crop.cur && crop.v === v ? crop.cur : null;
  }

  function computeTransform(v) {
    var box = playerBox(v);
    var D = box.rect;
    var L = layoutRect(v);
    var C = contentSize(v, L);
    var C0 = C;
    var rotated = disp.rot % 180 !== 0;
    // Black bars baked into the picture itself: Fill / Stretch zoom past them,
    // the backdrop paints over them.
    var bars = rotated ? null : innerCrop(v, C0);
    var ic = disp.mode === 'fill' || disp.mode === 'stretch' ? bars : null;
    if (ic) C = { w: C.w * (1 - ic.l - ic.r), h: C.h * (1 - ic.t - ic.b) };
    var cw = rotated ? C.h : C.w;
    var ch = rotated ? C.w : C.h;
    var bx = 1, by = 1, u;
    if (cw > 1 && ch > 1 && D.width > 1 && D.height > 1) {
      if (disp.mode === 'fit' || (disp.mode === 'original' && rotated)) { u = Math.min(D.width / cw, D.height / ch); bx = by = u; }
      else if (disp.mode === 'fill') { u = Math.max(D.width / cw, D.height / ch); bx = by = u; }
      else if (disp.mode === 'stretch') { bx = D.width / cw; by = D.height / ch; }
      else if (disp.mode === 'aspect' && disp.aspect > 0) {
        var R = disp.aspect, tw, th;
        if (R > D.width / D.height) { tw = D.width; th = D.width / R; } else { th = D.height; tw = D.height * R; }
        bx = tw / cw; by = th / ch;
      }
    }
    var Sx = clamp(bx * disp.zoom * disp.sx, 0.1, 8);
    var Sy = clamp(by * disp.zoom * disp.sy, 0.1, 8);
    var ex = rotated ? Sy : Sx;
    var ey = rotated ? Sx : Sy;
    if (disp.flip) { if (rotated) ey = -ey; else ex = -ex; }
    var tx = 0, ty = 0;
    if (disp.mode !== 'original' || rotated) {
      tx = (D.left + D.width / 2) - (L.left + L.width / 2);
      ty = (D.top + D.height / 2) - (L.top + L.height / 2);
      if (Math.abs(tx) < 0.75) tx = 0;
      if (Math.abs(ty) < 0.75) ty = 0;
    }
    var identity = Math.abs(ex - 1) < 0.002 && Math.abs(ey - 1) < 0.002 && !disp.rot && !tx && !ty;
    // Where the real picture is on screen: the frame minus the bars inside it,
    // clipped to the player box.
    var fw = (rotated ? C0.h : C0.w) * Sx, fh = (rotated ? C0.w : C0.h) * Sy;
    var cx = L.left + L.width / 2 + tx, cy = L.top + L.height / 2 + ty;
    var pw = fw * (bars ? 1 - bars.l - bars.r : 1), ph = fh * (bars ? 1 - bars.t - bars.b : 1);
    var hole = {
      left: Math.max(D.left, cx - pw / 2), top: Math.max(D.top, cy - ph / 2),
      right: Math.min(D.left + D.width, cx + pw / 2), bottom: Math.min(D.top + D.height, cy + ph / 2)
    };
    var fl = Math.max(D.left, cx - fw / 2), ft = Math.max(D.top, cy - fh / 2);
    var frame = { left: fl, top: ft, width: Math.max(0, Math.min(D.left + D.width, cx + fw / 2) - fl), height: Math.max(0, Math.min(D.top + D.height, cy + fh / 2) - ft) };
    return { identity: identity, ex: ex, ey: ey, tx: tx, ty: ty, Sx: Sx, Sy: Sy, D: D, box: box,
      shown: { w: cw * Sx, h: ch * Sy }, hole: hole, bars: bars, frame: frame };
  }

  // Inline properties we own on the current video, put back on release.
  var styler = { v: null, saved: {}, guard: null, tx: 0, ty: 0 };
  function restoreProp(v, k) {
    var s = styler.saved[k];
    delete styler.saved[k];
    if (s.v) v.style.setProperty(k, s.v, s.p);
    else v.style.removeProperty(k);
  }
  function stylerRelease() {
    var v = styler.v;
    if (!v) return;
    if (styler.guard) styler.guard.disconnect();
    for (var k in styler.saved) restoreProp(v, k);
    styler.v = null;
    styler.tx = styler.ty = 0;
  }
  function stylerSet(v, props) {
    if (styler.v && styler.v !== v) stylerRelease();
    styler.v = v;
    for (var k in props) {
      var val = props[k];
      if (val === null || val === undefined) { if (k in styler.saved) restoreProp(v, k); continue; }
      if (!(k in styler.saved)) styler.saved[k] = { v: v.style.getPropertyValue(k), p: v.style.getPropertyPriority(k) };
      setImportant(v, k, val);
    }
    if (typeof MutationObserver === 'function') {
      if (!styler.guard) styler.guard = new MutationObserver(function () { requestApply(); });
      styler.guard.disconnect();
      styler.guard.observe(v, { attributes: true, attributeFilter: ['style'] });
    }
  }

  var applyRaf = 0;
  function requestApply() {
    if (applyRaf) return;
    applyRaf = G.requestAnimationFrame(function () { applyRaf = 0; applyAll(); });
  }

  var lastT = null;
  function applyAll() {
    var v = on() ? targetVideo() : null;
    if (!v) { stylerRelease(); backdropSync(null, null, false); tintOff(); lastT = null; return; }
    // Idle fast path: with no feature in use, don't measure the page every second.
    var bdWant = backdropWanted(v);
    if (!bdWant && dispIsDefault() && (pictureBypass || pictureIsDefault(picture()))) {
      stylerRelease(); bdTeardown(); tintOff(); lastT = null;
      return;
    }
    var t = computeTransform(v);
    lastT = t;
    var bdOn = backdropWanted(v) && !(isDrm(v) && bdFrames(backdrop().mode));
    var props = {};
    if (t.identity) {
      props.scale = props.rotate = props.translate = props['transform-origin'] = null;
    } else {
      props.scale = t.ex.toFixed(4) + ' ' + t.ey.toFixed(4);
      props.rotate = disp.rot ? disp.rot + 'deg' : null;
      props.translate = t.tx || t.ty ? t.tx.toFixed(1) + 'px ' + t.ty.toFixed(1) + 'px' : null;
      props['transform-origin'] = '50% 50%';
    }
    props.filter = pictureFilter(v);
    // (older versions put the backdrop behind the video and changed these)
    props['background-color'] = null;
    props.position = null;
    stylerSet(v, props);
    styler.tx = props.translate ? t.tx : 0;
    styler.ty = props.translate ? t.ty : 0;
    backdropSync(v, t, bdOn);
    tintSync(v, t);
  }

  function dispIsDefault() {
    return disp.mode === 'original' && !disp.rot && !disp.flip &&
      Math.abs(disp.zoom - 1) < 0.004 && Math.abs(disp.sx - 1) < 0.004 && Math.abs(disp.sy - 1) < 0.004;
  }
  function setMode(mode, aspect, quiet) {
    if (!MODE_NAMES[mode]) return;
    disp.mode = mode;
    disp.aspect = mode === 'aspect' ? +aspect || 16 / 9 : 0;
    disp.zoom = 1; disp.sx = 1; disp.sy = 1;
    applyAll(); saveDisp(); refreshUi();
    if (!quiet) {
      var desc = { original: 'Video as the site shows it', fit: 'Largest size without cropping', fill: 'Zoomed to remove black bars', stretch: 'Stretched edge to edge, nothing cropped', aspect: 'Forced aspect ratio' }[mode];
      osd(dispLabel(), desc, 'display');
    }
  }
  function setZoom(z, quiet) {
    disp.zoom = clamp(round2(z), 0.25, 4);
    applyAll(); saveDisp(); refreshUi();
    if (!quiet) osd('Zoom ' + Math.round(disp.zoom * 100) + '%', dispLabel(), 'display', (disp.zoom - 0.25) / 3.75);
  }
  function setStretch(axis, s, quiet) {
    if (axis === 'x') disp.sx = clamp(round2(s), 0.25, 3); else disp.sy = clamp(round2(s), 0.25, 3);
    applyAll(); saveDisp(); refreshUi();
    if (!quiet) osd(axis === 'x' ? '↔ Stretch left + right ' + Math.round(disp.sx * 100) + '%' : '↕ Stretch top + bottom ' + Math.round(disp.sy * 100) + '%', dispLabel(), 'display');
  }
  function rotateBy(deg) {
    disp.rot = ((disp.rot + deg) % 360 + 360) % 360;
    applyAll(); saveDisp(); refreshUi();
    osd('Rotate ' + disp.rot + '°', disp.rot ? 'Scaled to fit the screen' : 'Back to normal', 'rotate');
  }
  function toggleFlip() {
    disp.flip = !disp.flip;
    applyAll(); saveDisp(); refreshUi();
    osd(disp.flip ? 'Mirrored' : 'Mirror off', 'Flipped left to right', 'flip');
  }
  function resetDisplay() {
    disp = { mode: 'original', aspect: 0, zoom: 1, sx: 1, sy: 1, rot: 0, flip: false, inner: disp.inner, barT: disp.barT, barL: disp.barL, barLink: disp.barLink };
    quickIndex = 0;
    applyAll(); saveDisp(); refreshUi();
    osd('Original', 'Zoom, ratio and rotation reset', 'display');
  }
  function setBars(t, l, quiet) {
    disp.inner = -2;
    disp.barT = clamp(Math.round(t * 1000) / 1000, 0, 0.35);
    disp.barL = clamp(Math.round(l * 1000) / 1000, 0, 0.35);
    applyAll(); saveDisp(); refreshUi();
    if (!quiet) osd('Bars inside the video', 'Top + bottom ' + Math.round(disp.barT * 100) + '% · left + right ' + Math.round(disp.barL * 100) + '%', 'fill');
  }
  function setInner(x) {
    if (x === -2) {
      // Start manual from what's known: the detected bars, or a typical film.
      if (disp.barT < 0.001 && disp.barL < 0.001) {
        var v0 = targetVideo();
        if (crop.cur && crop.v === v0) { disp.barT = crop.cur.t; disp.barL = crop.cur.l; } else disp.barT = 0.12;
      }
      disp.inner = -2;
      applyAll(); saveDisp(); refreshUi();
      osd('Bars inside the video: manual', 'Set top + bottom and left + right to match the bars', 'fill');
      return;
    }
    disp.inner = x === -1 || (x > 0.5 && x < 6) ? x : 0;
    if (disp.mode !== 'fill' && disp.mode !== 'stretch' && disp.inner !== -1 && backdrop().mode === 'off') { disp.mode = 'fill'; disp.aspect = 0; disp.zoom = disp.sx = disp.sy = 1; }
    applyAll(); saveDisp(); refreshUi();
    osd(disp.inner > 0 ? 'Film shape ' + aspectName(disp.inner) : disp.inner < 0 ? 'Bars in the picture kept' : 'Detecting bars in the picture',
      disp.inner > 0 ? 'Zoomed past the black bars inside the video' : disp.inner < 0 ? 'Only the player’s own bars are filled' : 'Works when this video’s frames can be read', 'fill');
  }
  function toggleFill() {
    if (disp.mode === 'fill') setMode('original'); else setMode('fill');
  }

  var QUICK = [
    function () { setMode('fill'); },
    function () { setMode('stretch'); },
    function () { setMode('aspect', 16 / 9); },
    function () { setMode('aspect', 64 / 27); },
    function () { setMode('original', 0, true); setZoom(1.25); },
    function () { setMode('original', 0, true); setZoom(1.5); },
    function () { resetDisplay(); }
  ];
  var quickIndex = 0;
  function cycleQuick() {
    QUICK[quickIndex % QUICK.length]();
    quickIndex = (quickIndex + 1) % QUICK.length;
  }

  // --- black bars inside the picture (Fill mode) -----------------------
  // Samples a small copy of the frame and looks for near-black rows/columns at
  // the edges. Needs readable pixels: not DRM, not a cross-origin file.
  var crop = { v: null, blocked: false, cv: null, ctx: null, cand: null, hits: 0, cur: null, nextAt: 0, lastT: -1 };
  function cropSample(v) {
    if (!v || (disp.mode !== 'fill' && disp.mode !== 'stretch' && backdrop().mode === 'off') || disp.inner !== 0 || !cfg.display.smartCrop || disp.rot % 180) return;
    if (crop.v !== v) { crop.v = v; crop.blocked = false; crop.cur = null; crop.cand = null; crop.hits = 0; crop.nextAt = 0; }
    if (crop.blocked || isDrm(v) || v.readyState < 2 || !v.videoWidth || v.paused && crop.cur) return;
    if (now() < crop.nextAt) return;
    // Same frame as last time (paused): nothing new to look at.
    if (crop.lastT === v.currentTime) return;
    crop.lastT = v.currentTime;
    // Once of every second until the answer is stable, then every 15 s.
    crop.nextAt = now() + (crop.hits >= 3 ? 15000 : 1000);
    var W = 96;
    var H = clamp(Math.round(W * v.videoHeight / v.videoWidth), 24, 160);
    if (!crop.cv) {
      crop.cv = doc.createElement('canvas');
      // GPU canvas: the video frame is scaled down on the GPU and only this
      // small image is read back, not the full frame.
      crop.ctx = crop.cv.getContext('2d');
    }
    crop.cv.width = W; crop.cv.height = H;
    var data;
    try {
      crop.ctx.drawImage(v, 0, 0, W, H);
      data = crop.ctx.getImageData(0, 0, W, H).data;
    } catch (e) { crop.blocked = true; return; }
    function lum(i) { return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; }
    function rowDark(y) {
      var mx = 0, sum = 0;
      for (var x = 0; x < W; x++) { var l = lum((y * W + x) * 4); sum += l; if (l > mx) mx = l; }
      return mx < 42 && sum / W < 20;
    }
    function colDark(x) {
      var mx = 0, sum = 0;
      for (var y = 0; y < H; y++) { var l = lum((y * W + x) * 4); sum += l; if (l > mx) mx = l; }
      return mx < 42 && sum / H < 20;
    }
    var t = 0; while (t < H * 0.3 && rowDark(t)) t++;
    var b = 0; while (b < H * 0.3 && rowDark(H - 1 - b)) b++;
    var l = 0; while (l < W * 0.3 && colDark(l)) l++;
    var r = 0; while (r < W * 0.3 && colDark(W - 1 - r)) r++;
    // A dark scene is not a letterbox: the picture inside must have real content.
    var bright = false;
    for (var y = t; y < H - b && !bright; y += 2) for (var x = l; x < W - r; x += 3) if (lum((y * W + x) * 4) > 50) { bright = true; break; }
    if (!bright) return;
    // Letterboxes are symmetric; a dark sky on one side is not.
    var tb = Math.min(t, b), lr = Math.min(l, r);
    var cand = { t: tb >= 2 ? tb / H : 0, b: tb >= 2 ? tb / H : 0, l: lr >= 2 ? lr / W : 0, r: lr >= 2 ? lr / W : 0 };
    var same = crop.cand && Math.abs(cand.t - crop.cand.t) < 0.02 && Math.abs(cand.l - crop.cand.l) < 0.02;
    crop.cand = cand;
    crop.hits = same ? crop.hits + 1 : 1;
    if (crop.hits < 3) return;
    var next = cand.t || cand.l ? cand : null;
    var cur = crop.cur;
    var changed = !next !== !cur || (next && cur && (Math.abs(next.t - cur.t) > 0.01 || Math.abs(next.l - cur.l) > 0.01));
    if (changed) {
      crop.cur = next;
      applyAll(); refreshUi();
      if (next) osd('Black bars in the picture removed', 'Detected ' + Math.round((next.t + next.b + next.l + next.r) * 50) + '% bars inside the video', 'fill');
    }
  }

  // ==================================================================
  // Picture filters (CSS + one SVG filter for gamma / warmth / sharpness)
  // ==================================================================
  var livePicture = null;   // unsaved values while a slider is dragged
  var livePictureAt = 0;
  var pictureBypass = false;
  var fx = { svg: null, filter: null, ct: null, funcs: null, cm: null, conv: null, id: '', sig: '' };

  function picture() { return livePicture || cfg.picture; }
  function pictureIsDefault(p) {
    for (var k in PICTURE_DEFAULT) if (p[k] !== PICTURE_DEFAULT[k]) return false;
    return true;
  }

  function ensureSvgFilter(v, p) {
    var root = v.getRootNode && v.getRootNode();
    var parent = root && root !== doc && root.nodeType === 11 ? root : (doc.body || doc.documentElement);
    if (!parent) return '';
    if (!fx.svg) {
      fx.svg = svgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true', 'data-qlock-fx': '', style: 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none' });
      fx.filter = svgEl('filter', { 'color-interpolation-filters': 'sRGB', x: 0, y: 0, width: '100%', height: '100%' });
      fx.ct = svgEl('feComponentTransfer', {});
      fx.funcs = ['feFuncR', 'feFuncG', 'feFuncB'].map(function (n) {
        var f = svgEl(n, { type: 'gamma', amplitude: 1, exponent: 1, offset: 0 });
        fx.ct.appendChild(f);
        return f;
      });
      fx.cm = svgEl('feColorMatrix', { type: 'matrix', values: '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0' });
      fx.conv = svgEl('feConvolveMatrix', { order: 3, kernelMatrix: '0 0 0 0 1 0 0 0 0', divisor: 1, preserveAlpha: 'true', edgeMode: 'duplicate' });
      fx.svg.appendChild(fx.filter);
    }
    if (fx.svg.parentNode !== parent) parent.appendChild(fx.svg);
    var sig = p.gamma + '|' + p.sharpness;
    if (sig !== fx.sig) {
      fx.sig = sig;
      while (fx.filter.firstChild) fx.filter.removeChild(fx.filter.firstChild);
      if (p.gamma !== 100) fx.filter.appendChild(fx.ct);
      if (p.sharpness > 0) fx.filter.appendChild(fx.conv);
      var e = (100 / clamp(p.gamma, 10, 400)).toFixed(3);
      fx.funcs.forEach(function (f) { f.setAttribute('exponent', e); });
      var k = (clamp(p.sharpness, 0, 100) / 100 * 0.7).toFixed(3);
      fx.conv.setAttribute('kernelMatrix', ['0', -k, '0', -k, (1 + 4 * k).toFixed(3), -k, '0', -k, '0'].join(' '));
      // A fresh id makes the browser re-resolve the filter on the video.
      fx.id = 'qlock-fx-' + Math.random().toString(36).slice(2, 8);
      fx.filter.setAttribute('id', fx.id);
    }
    return fx.id;
  }

  function pictureCss(p, liveVideo) {
    var parts = [];
    if (liveVideo ? p.brightness > 100 : p.brightness !== 100) parts.push('brightness(' + (p.brightness / 100).toFixed(2) + ')');
    if (p.contrast !== 100) parts.push('contrast(' + (p.contrast / 100).toFixed(2) + ')');
    if (p.saturation !== 100) parts.push('saturate(' + (p.saturation / 100).toFixed(2) + ')');
    if (p.grayscale) parts.push('grayscale(' + (p.grayscale / 100).toFixed(2) + ')');
    return parts.join(' ');
  }

  function pictureFilter(v) {
    var p = picture();
    if (pictureBypass || pictureIsDefault(p)) return null;
    var parts = [];
    if (p.gamma !== 100 || p.sharpness > 0) {
      var id = ensureSvgFilter(v, p);
      if (id) parts.push('url("#' + id + '")');
    }
    // Brightness below 100% and warmth are drawn by the tint layer instead.
    var css = pictureCss(p, true);
    if (css) parts.push(css);
    return parts.length ? parts.join(' ') : null;
  }

  var PICTURE_PRESETS = [
    { id: 'original', name: 'Original', p: {} },
    { id: 'vivid', name: 'Vivid', p: { contrast: 110, saturation: 135, brightness: 102 } },
    { id: 'cinema', name: 'Cinema', p: { contrast: 110, saturation: 92, warmth: 12 } },
    { id: 'bright', name: 'Dark scenes', p: { brightness: 112, gamma: 130, contrast: 104 } },
    { id: 'night', name: 'Night', p: { brightness: 85, warmth: 65 } },
    { id: 'mono', name: 'Mono', p: { grayscale: 100, contrast: 112 } }
  ];
  function presetValues(pr) {
    var o = {};
    for (var k in PICTURE_DEFAULT) o[k] = k in pr.p ? pr.p[k] : PICTURE_DEFAULT[k];
    return o;
  }
  function activePreset(p) {
    for (var i = 0; i < PICTURE_PRESETS.length; i++) {
      var q = presetValues(PICTURE_PRESETS[i]);
      var same = true;
      for (var k in q) if (q[k] !== p[k]) { same = false; break; }
      if (same) return PICTURE_PRESETS[i].id;
    }
    return '';
  }

  function setPicture(p, save) {
    var o = {};
    for (var k in PICTURE_DEFAULT) o[k] = typeof p[k] === 'number' && isFinite(p[k]) ? Math.round(p[k]) : picture()[k];
    livePicture = o;
    livePictureAt = now();
    applyAll(); refreshUi();
    if (save) postPatch({ picture: o });
  }

  // ==================================================================
  // Layers in front of the video: backdrop strips and the picture tint
  // ==================================================================
  // Performance rules for everything drawn over the video:
  //  - plain rectangles only: no clip-path masks, no CSS filters, no blend modes;
  //  - the backdrop covers the bars only, never the picture, so the video keeps
  //    the browser's fast path (it can't when something sits on top of it);
  //  - one small source image is drawn per update (blurred inside the canvas)
  //    and shared by the strips, and it only redraws when the video shows a new
  //    frame — nothing runs while paused.
  var liveBackdrop = null;
  var liveBackdropAt = 0;
  var STRIPS = ['top', 'bottom', 'left', 'right'];
  var bd = { src: null, sctx: null, strips: {}, v: null, D: null, hole: null, bars: null, timer: 0, rvfc: 0, rvfcV: null, lastDraw: 0,
    primed: false, visible: false, mode: '', filter: 'none', over: 0, notedDrm: null, sig: '',
    img: null, imgAt: 0, imgAsked: -1 };
  var tint = { el: null, on: false };

  function backdrop() { return liveBackdrop || cfg.backdrop; }
  // Ambient light and blur fill copy the video's frames, which DRM forbids;
  // RGB light and the picture don't touch them and work everywhere.
  function bdFrames(mode) { return mode === 'ambient' || mode === 'blur'; }
  function bdAnimated(b) { return b.mode === 'rgb' && b.rgbEffect !== 'static'; }
  function backdropWanted(v) {
    var b = backdrop();
    return on() && b.mode !== 'off' && !!v && v.videoWidth > 0 && doc.fullscreenElement !== v;
  }

  // Size for a w×h canvas holding about `area` pixels: large enough that Chrome
  // keeps it on the GPU (very small canvases can be drawn in software, which
  // copies every video frame back from the GPU), small enough to cost nothing.
  function canvasFor(w, h, area, maxW) {
    var a = Math.max(0.01, w / Math.max(1, h));
    var cw = Math.sqrt(area * a);
    if (cw > maxW) cw = maxW;
    var ch = cw / a;
    return { w: Math.max(2, Math.round(cw)), h: Math.max(2, Math.round(ch)) };
  }

  function layerEl(name) {
    var el = doc.createElement(name === 'tint' ? 'div' : 'canvas');
    el.setAttribute(name === 'tint' ? 'data-qlock-tint' : 'data-qlock-backdrop', name);
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute';
    return el;
  }

  // Keeps our layers right after the video, in order: strips, then the tint.
  function layerOrder(v) {
    var parent = v.parentNode;
    if (!parent) return;
    var after = v;
    var list = [];
    if (bd.v === v) STRIPS.forEach(function (id) { var st = bd.strips[id]; if (st && st.on) list.push(st.el); });
    if (tint.on && tint.el) list.push(tint.el);
    list.forEach(function (el) {
      if (el.parentNode !== parent || el.previousSibling !== after) {
        try { parent.insertBefore(el, after.nextSibling); } catch (e) { return; }
      }
      after = el;
    });
  }

  // Places an absolutely positioned layer over a viewport rectangle; writes
  // styles only when something changed.
  function placeLayer(el, r, z, extra) {
    var op = el.offsetParent;
    var ox = -G.scrollX, oy = -G.scrollY;
    if (op && !(op === doc.body && G.getComputedStyle(op).position === 'static')) {
      var o = op.getBoundingClientRect();
      ox = o.left + op.clientLeft - op.scrollLeft;
      oy = o.top + op.clientTop - op.scrollTop;
    }
    var css = 'all:initial !important;position:absolute !important;display:block !important;pointer-events:none !important;' +
      'margin:0 !important;padding:0 !important;border:0 !important;' +
      'left:' + (r.left - ox).toFixed(1) + 'px !important;top:' + (r.top - oy).toFixed(1) + 'px !important;' +
      'width:' + Math.max(0, r.width).toFixed(1) + 'px !important;height:' + Math.max(0, r.height).toFixed(1) + 'px !important;' +
      'z-index:' + (z && z !== 'auto' ? z : 'auto') + ' !important;' + (extra || '');
    if (el.__qlCss !== css) { el.__qlCss = css; el.style.cssText = css; }
  }

  function backdropSync(v, t, active) {
    if (!active) {
      if (v && backdropWanted(v) && isDrm(v) && bdFrames(backdrop().mode) && bd.notedDrm !== v) {
        bd.notedDrm = v;
        osd('Ambient / blur fill unavailable', 'DRM-protected video: its frames can’t be read. RGB light and Image still work', 'backdrop');
      }
      bdTeardown();
      return;
    }
    var b = backdrop();
    if (!v.parentNode) { bdTeardown(); return; }
    if (bd.v !== v || bd.mode !== b.mode) { bdStop(); bd.primed = false; bd.mode = b.mode; }
    bd.v = v;
    bd.bars = t.bars;
    bd.D = t.D;
    bd.hole = t.hole;
    var D = t.D, H = t.hole;
    var holeOk = H.right - H.left > 4 && H.bottom - H.top > 4;
    var pic = b.mode === 'image';
    if (pic) bdWantImage(b);
    var rects = {
      top: { left: D.left, top: D.top, width: D.width, height: H.top - D.top },
      bottom: { left: D.left, top: H.bottom, width: D.width, height: D.top + D.height - H.bottom },
      left: { left: D.left, top: H.top, width: H.left - D.left, height: H.bottom - H.top },
      right: { left: H.right, top: H.top, width: D.left + D.width - H.right, height: H.bottom - H.top }
    };
    var ambient = b.mode === 'ambient';
    // Glows and blurs look the same from a tiny canvas; a picture needs real pixels.
    var S = pic ? canvasFor(D.width, D.height, 1000000, 2048) : canvasFor(D.width, D.height, 24000, 360);
    if (!bd.src) { bd.src = doc.createElement('canvas'); bd.sctx = bd.src.getContext('2d', { alpha: false }); }
    if (bd.src.width !== S.w || bd.src.height !== S.h) { bd.src.width = S.w; bd.src.height = S.h; bd.primed = false; }
    // RGB and the picture don't follow the video, so a settings change redraws them.
    var sig = [b.mode, b.blur, b.rgbEffect, b.rgbColor, b.rgbSpeed, bd.imgAt, Math.round(D.width), Math.round(D.height),
      Math.round(H.left - D.left), Math.round(H.top - D.top), Math.round(H.right - D.left), Math.round(H.bottom - D.top)].join('|');
    if (sig !== bd.sig) { bd.sig = sig; bd.primed = false; }
    // Blur as a share of the width, applied inside the small canvas.
    var soft = clamp(b.blur, 0, 100) / 100;
    var blurPx = (ambient ? 0.035 + soft * 0.06 : 0.006 + soft * 0.03) * S.w;
    bd.filter = 'blur(' + blurPx.toFixed(1) + 'px)' + (ambient ? ' saturate(1.6) brightness(1.08)' : ' brightness(0.8) saturate(1.2)');
    bd.over = Math.round(blurPx);
    var resized = false;
    bd.visible = false;
    STRIPS.forEach(function (id) {
      var r = rects[id];
      var st = bd.strips[id];
      if (!(holeOk && r.width > 1.5 && r.height > 1.5)) {
        if (st) { st.on = false; if (st.el.parentNode) st.el.parentNode.removeChild(st.el); }
        return;
      }
      if (!st) {
        st = bd.strips[id] = { el: layerEl(id), ctx: null, on: false, r: null };
        st.ctx = st.el.getContext('2d', { alpha: false });
      }
      st.on = true;
      st.r = r;
      bd.visible = true;
      var size = pic ? canvasFor(r.width, r.height, 400000, 2560) : canvasFor(r.width, r.height, 21000, 1024);
      if (st.el.width !== size.w || st.el.height !== size.h) { st.el.width = size.w; st.el.height = size.h; resized = true; }
    });
    layerOrder(v);
    var z = videoCss(v).z;
    var extra = 'opacity:' + (clamp(b.intensity, 0, 100) / 100).toFixed(2) + ' !important;';
    STRIPS.forEach(function (id) { var st = bd.strips[id]; if (st && st.on) placeLayer(st.el, st.r, z, extra); });
    if (!bd.visible) { bdStop(); return; }
    if (resized || !bd.primed) bdDraw();
    bdSchedule();
  }

  function bdDraw() {
    var v = bd.v, S = bd.src, x = bd.sctx;
    if (!v || !S || !x) return;
    var W = S.width, H = S.height;
    if (bd.mode === 'rgb') rgbPaint(x, W, H, backdrop(), now());
    else if (bd.mode === 'image') imagePaint(x, W, H, backdrop());
    else if (!framePaint(v, x, W, H)) return;
    bd.primed = true;
    var D = bd.D;
    STRIPS.forEach(function (id) {
      var st = bd.strips[id];
      if (!st || !st.on) return;
      var r = st.r, c = st.ctx;
      c.globalCompositeOperation = 'copy';
      c.imageSmoothingEnabled = true;
      c.drawImage(S, (r.left - D.left) / D.width * W, (r.top - D.top) / D.height * H,
        Math.max(0.5, r.width / D.width * W), Math.max(0.5, r.height / D.height * H), 0, 0, st.el.width, st.el.height);
    });
    bd.lastDraw = now();
  }

  // Ambient light / blur fill: the video's own picture.
  function framePaint(v, x, W, H) {
    if (v.readyState < 2 || !v.videoWidth) return false;
    var vw = v.videoWidth, vh = v.videoHeight, b = bd.bars;
    // Source: the real picture only, never the bars inside the video.
    var sx = b ? b.l * vw : 0, sy = b ? b.t * vh : 0;
    var sw = vw * (b ? 1 - b.l - b.r : 1), sh = vh * (b ? 1 - b.t - b.b : 1);
    if (sw < 2 || sh < 2) return false;
    var o = bd.over;
    try {
      x.filter = bd.filter;
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'medium';
      if (bd.mode === 'ambient') {
        // The picture stretched over the whole player box: each bar picks up the
        // colours of the nearest edge. Blending into the last frame keeps it calm.
        x.globalAlpha = bd.primed ? 0.25 : 1;
        x.drawImage(v, sx, sy, sw, sh, -o, -o, W + 2 * o, H + 2 * o);
      } else {
        var sc = Math.max((W + 2 * o) / sw, (H + 2 * o) / sh);
        var dw = sw * sc, dh = sh * sc;
        x.globalAlpha = bd.primed ? 0.6 : 1;
        x.drawImage(v, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    } catch (e) { return false; }
    return true;
  }

  // The picture's rectangle in source-canvas coordinates.
  function holeIn(W, H) {
    var D = bd.D, P = bd.hole;
    return { l: (P.left - D.left) / D.width * W, t: (P.top - D.top) / D.height * H,
      w: (P.right - P.left) / D.width * W, h: (P.bottom - P.top) / D.height * H };
  }

  var RGB_NAMES = { wave: 'Rainbow wave around the picture', cycle: 'Whole strip cycles through colours', breathe: 'Your colour, slowly breathing', static: 'Your colour, steady' };
  // RGB light, like an LED strip behind a TV: a light source the size of the
  // picture, blurred outwards, so the bars glow brightest next to the picture
  // and fade towards the edge. Softness 0 lights the bars evenly.
  function rgbPaint(x, W, H, b, t) {
    var P = holeIn(W, H);
    var soft = clamp(b.blur, 0, 100) / 100;
    var spd = clamp(b.rgbSpeed, 1, 100) / 100;
    var sec = t / 1000;
    var cx = P.l + P.w / 2, cy = P.t + P.h / 2;
    x.globalAlpha = 1;
    x.filter = 'none';
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    var fill, alpha = 1;
    var hue = (sec / (40 - 36 * spd) * 360) % 360; // one round in 40 s .. 4 s
    if (b.rgbEffect === 'wave' && typeof x.createConicGradient === 'function') {
      // The rainbow turns around the picture: one turn in 24 s .. 2 s.
      fill = x.createConicGradient(sec / (24 - 22 * spd) * Math.PI * 2, cx, cy);
      for (var i = 0; i <= 6; i++) fill.addColorStop(i / 6, 'hsl(' + i * 60 + ',100%,55%)');
    } else if (b.rgbEffect === 'wave' || b.rgbEffect === 'cycle') {
      fill = 'hsl(' + hue.toFixed(1) + ',100%,55%)';
    } else {
      fill = hexOk(b.rgbColor) ? b.rgbColor : '#8a5cff';
      // One breath in 7 s .. 1.2 s, never quite dark.
      if (b.rgbEffect === 'breathe') alpha = 0.12 + 0.88 * (0.5 - 0.5 * Math.cos(sec / (7 - 5.8 * spd) * Math.PI * 2));
    }
    var bar = Math.max(P.l, W - P.l - P.w, P.t, H - P.t - P.h, 1);
    var blurPx = soft * 0.9 * bar;
    var grow = bar * (1 - soft) + blurPx * 0.5;
    x.globalAlpha = alpha;
    x.filter = blurPx >= 0.5 ? 'blur(' + blurPx.toFixed(1) + 'px)' : 'none';
    x.fillStyle = fill;
    x.fillRect(P.l - grow, P.t - grow, P.w + 2 * grow, P.h + 2 * grow);
    x.filter = 'none';
    x.globalAlpha = 1;
  }

  // The user's picture over the whole player box, behind the video, so the
  // bars show its edges. Softness blurs it.
  function imagePaint(x, W, H, b) {
    x.globalAlpha = 1;
    x.filter = 'none';
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    var img = bd.img;
    if (!img) return;
    var blurPx = clamp(b.blur, 0, 100) / 100 * 0.02 * Math.max(W, H);
    var o = blurPx * 2;
    var sc = Math.max((W + 2 * o) / img.width, (H + 2 * o) / img.height);
    var dw = img.width * sc, dh = img.height * sc;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.filter = blurPx >= 0.5 ? 'blur(' + blurPx.toFixed(1) + 'px)' : 'none';
    try { x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (e) { /* closed bitmap */ }
    x.filter = 'none';
  }

  // The picture comes from extension storage through the bridge, asked for
  // only while image mode is on.
  function bdWantImage(b) {
    if (!b.imageAt) { if (bd.img) { bd.img = null; bd.imgAt = 0; } return; }
    if (bd.imgAt === b.imageAt || bd.imgAsked === b.imageAt) return;
    bd.imgAsked = b.imageAt;
    try { G.postMessage({ __qlock: 'needImage' }, selfOrigin()); } catch (e) { /* ignore */ }
  }
  G.addEventListener('message', function (e) {
    if (e.source !== G || !e.data || e.data.__qlock !== 'image') return;
    var at = +e.data.at || 0, blob = e.data.blob;
    if (!at || !blob || typeof G.createImageBitmap !== 'function') { bd.img = null; bd.imgAt = at; bd.sig = ''; applyAll(); return; }
    G.createImageBitmap(blob).then(function (img) {
      if (bd.img && bd.img.close) bd.img.close();
      bd.img = img; bd.imgAt = at; bd.sig = '';
      applyAll();
    }, function () { bd.imgAt = at; });
  });

  // Video modes redraw on new video frames only (requestVideoFrameCallback),
  // at most 8 a second for ambient light and 15 for blur fill. Animated RGB
  // runs at 25 a second; a steady colour and the picture are drawn once per change.
  function bdSchedule() {
    if (bd.rvfc || bd.timer || !bd.v || !bd.visible) return;
    var frames = bdFrames(bd.mode);
    if (!frames && !bdAnimated(backdrop())) return;
    var v = bd.v;
    var iv = bd.mode === 'ambient' ? 125 : frames ? 66 : 40;
    var wait = iv - (now() - bd.lastDraw);
    if (wait > 4) { bd.timer = G.setTimeout(function () { bd.timer = 0; bdSchedule(); }, wait); return; }
    if (frames && typeof v.requestVideoFrameCallback === 'function') {
      bd.rvfcV = v;
      bd.rvfc = v.requestVideoFrameCallback(function () { bd.rvfc = 0; bdTick(); });
    } else {
      bd.timer = G.setTimeout(function () { bd.timer = 0; bdTick(); }, iv);
    }
  }
  function bdTick() {
    if (!bd.v || !bd.v.isConnected || !bd.visible) return;
    if (!doc.hidden) bdDraw();
    bdSchedule();
  }
  function bdStop() {
    if (bd.timer) { G.clearTimeout(bd.timer); bd.timer = 0; }
    if (bd.rvfc && bd.rvfcV && bd.rvfcV.cancelVideoFrameCallback) { try { bd.rvfcV.cancelVideoFrameCallback(bd.rvfc); } catch (e) { /* ignore */ } }
    bd.rvfc = 0; bd.rvfcV = null;
  }

  function bdTeardown() {
    bdStop();
    // Picture mode's canvases are large; let their memory go too.
    STRIPS.forEach(function (id) {
      var st = bd.strips[id];
      if (st) { st.on = false; if (st.el.parentNode) st.el.parentNode.removeChild(st.el); if (st.el.width > 2) { st.el.width = 2; st.el.height = 2; } }
    });
    if (bd.src && bd.src.width * bd.src.height > 100000) { bd.src.width = 2; bd.src.height = 2; }
    bd.v = null;
    bd.visible = false;
    bd.primed = false;
  }

  // Dimming (brightness below 100%) and warmth as one see-through tint layer
  // instead of a filter: a filter makes the browser process every video frame
  // again, a tint is a single flat rectangle. Dimming this way is exact.
  function tintRgba(p, withDim) {
    var ad = withDim && p.brightness < 100 ? 1 - p.brightness / 100 : 0;
    var w = clamp(p.warmth, -100, 100) / 100;
    var col = w >= 0 ? [255, 136, 36] : [92, 162, 255];
    var aw = Math.abs(w) * (w >= 0 ? 0.26 : 0.18);
    var A = 1 - (1 - ad) * (1 - aw);
    if (A < 0.004) return null;
    var k = aw / A;
    return 'rgba(' + Math.round(col[0] * k) + ',' + Math.round(col[1] * k) + ',' + Math.round(col[2] * k) + ',' + A.toFixed(3) + ')';
  }
  function tintSync(v, t) {
    var rgba = v && t && !pictureBypass ? tintRgba(picture(), true) : null;
    if (!rgba) { tintOff(); return; }
    if (!tint.el) tint.el = layerEl('tint');
    tint.on = true;
    layerOrder(v);
    // With the backdrop on, tint the glow too so it matches the picture;
    // otherwise only the picture (black bars stay black).
    var r = bd.visible && bd.v === v ? t.D : t.frame;
    placeLayer(tint.el, r, videoCss(v).z, 'background:' + rgba + ' !important;');
  }
  function tintOff() {
    tint.on = false;
    if (tint.el && tint.el.parentNode) tint.el.parentNode.removeChild(tint.el);
  }

  var BD_MODES = ['off', 'ambient', 'blur', 'rgb', 'image'];
  var RGB_EFFECTS = ['wave', 'cycle', 'breathe', 'static'];
  function setBackdrop(b, save, quiet) {
    var cur = backdrop();
    var o = {
      mode: BD_MODES.indexOf(b.mode) !== -1 ? b.mode : cur.mode,
      intensity: typeof b.intensity === 'number' ? clamp(Math.round(b.intensity), 0, 100) : cur.intensity,
      blur: typeof b.blur === 'number' ? clamp(Math.round(b.blur), 0, 100) : cur.blur,
      rgbEffect: RGB_EFFECTS.indexOf(b.rgbEffect) !== -1 ? b.rgbEffect : cur.rgbEffect,
      rgbColor: hexOk(b.rgbColor) ? b.rgbColor.toLowerCase() : cur.rgbColor,
      rgbSpeed: typeof b.rgbSpeed === 'number' ? clamp(Math.round(b.rgbSpeed), 1, 100) : cur.rgbSpeed,
      imageAt: typeof b.imageAt === 'number' ? b.imageAt : cur.imageAt
    };
    liveBackdrop = o;
    liveBackdropAt = now();
    bd.notedDrm = null;
    applyAll(); refreshUi();
    if (save) postPatch({ backdrop: o });
    if (!quiet && (o.mode !== cur.mode || (o.mode === 'rgb' && o.rgbEffect !== cur.rgbEffect))) {
      var v = targetVideo();
      var names = { off: 'Backdrop off', ambient: 'Ambient light', blur: 'Blur fill', rgb: 'RGB light', image: 'Image backdrop' };
      var desc = o.mode === 'off' ? 'Black bars stay black'
        : v && isDrm(v) && bdFrames(o.mode) ? 'Not available: DRM-protected video. RGB light and Image still work'
        : v && doc.fullscreenElement === v ? 'Needs the player’s own fullscreen, not the bare video'
        : o.mode === 'ambient' ? 'Black bars glow with the picture’s edge colours'
        : o.mode === 'blur' ? 'Black bars filled with a soft blurred copy'
        : o.mode === 'rgb' ? RGB_NAMES[o.rgbEffect]
        : o.imageAt ? 'Your picture fills the black bars' : 'Choose a picture in the QualityLock popup (Display tab)';
      osd(names[o.mode], desc, 'backdrop');
    }
  }
  function cycleBackdrop() {
    var b = backdrop();
    var order = ['off', 'ambient', 'blur', 'rgb'].concat(b.imageAt ? ['image'] : []);
    var next = order[(order.indexOf(b.mode) + 1) % order.length];
    setBackdrop({ mode: next }, true);
  }

  // ==================================================================
  // Site adapters: Netflix / YouTube player APIs, plain <video> otherwise
  // ==================================================================
  function nfPlayer() {
    if (SITE !== 'netflix') return null;
    try {
      var vp = G.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      var ids = vp.getAllPlayerSessionIds();
      if (!ids || !ids.length) return null;
      var id = ids.filter(function (s) { return /watch/i.test(s); })[0] || ids[ids.length - 1];
      return vp.getVideoPlayerBySessionId(id) || null;
    } catch (e) { return null; }
  }
  function ytPlayer(v) {
    var mp = doc.getElementById('movie_player');
    return mp && typeof mp.setVolume === 'function' && (!v || mp.contains(v)) ? mp : null;
  }

  function seekTo(v, t) {
    var end = isFinite(v.duration) ? v.duration : (v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : Infinity);
    t = clamp(t, 0, Math.max(0, end - 0.3));
    var nf = nfPlayer();
    if (nf) {
      try {
        // Netflix's clock can be offset from the element's; seek relative to it.
        var off = nf.getCurrentTime() / 1000 - v.currentTime;
        nf.seek(Math.round((t + (isFinite(off) ? off : 0)) * 1000));
        return;
      } catch (e) { /* fall back */ }
    }
    var yt = ytPlayer(v);
    if (yt && typeof yt.seekTo === 'function') { try { yt.seekTo(t, true); return; } catch (e) { /* fall back */ } }
    try { v.currentTime = t; } catch (e) { /* not seekable */ }
  }
  function seekBy(v, dt) {
    if (!v) return;
    var target = clamp(v.currentTime + dt, 0, isFinite(v.duration) ? v.duration : Infinity);
    seekTo(v, target);
    var dur = isFinite(v.duration) ? ' / ' + fmt(v.duration) : '';
    osd((dt > 0 ? 'Forward ' : 'Back ') + Math.abs(dt) + ' s', fmt(target) + dur, dt < 0 ? 'back' : 'fwd');
  }

  function togglePlay(v) {
    if (!v) return;
    var nf = nfPlayer();
    if (nf) { try { if (nf.isPaused()) nf.play(); else nf.pause(); return; } catch (e) { /* fall back */ } }
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(noop); } else v.pause();
  }

  // ==================================================================
  // Volume: through the site's own player first (its API, or the volume
  // slider in its controls), so the player's slider, mute button and saved
  // level follow. The <video> element itself is the fallback.
  // ==================================================================
  function jwPlayer(v) {
    var c = v.closest && v.closest('.jwplayer');
    if (!c || !c.id || typeof G.jwplayer !== 'function') return null;
    try { var p = G.jwplayer(c.id); return p && typeof p.setVolume === 'function' && typeof p.getVolume() === 'number' ? p : null; } catch (e) { return null; }
  }
  function vjsPlayer(v) {
    var c = v.closest && v.closest('.video-js');
    if (!c) return null;
    var p = c.player;
    if (!p && G.videojs && typeof G.videojs.getPlayer === 'function') { try { p = G.videojs.getPlayer(c); } catch (e) { p = null; } }
    return p && typeof p.volume === 'function' && typeof p.muted === 'function' ? p : null;
  }

  // A volume <input type=range> in the player's own controls (Plyr, Shaka UI,
  // Twitch and many custom players). A slider the site turns out to ignore is
  // skipped from then on.
  var VOL_LABEL = /volume|lautst|volumen|громк|音量/i;
  var volSl = { v: null, el: null, at: 0, bad: null };
  function volSlider(v) {
    if (volSl.v === v && now() - volSl.at < 5000 && (!volSl.el || volSl.el.isConnected)) return volSl.el;
    var found = null;
    for (var node = v.parentElement, i = 0; node && i < 6 && !found; node = node.parentElement, i++) {
      if (node === doc.documentElement) break;
      var list = node.querySelectorAll('input[type="range"]');
      for (var j = 0; j < list.length && !found; j++) {
        var el = list[j];
        if (el === volSl.bad) continue;
        var lab = [el.getAttribute('aria-label'), el.title, el.name, el.id, el.getAttribute('class'),
          el.getAttribute('data-a-target'), el.getAttribute('data-testid'), el.getAttribute('data-plyr')].join(' ');
        if (VOL_LABEL.test(lab)) found = el;
      }
    }
    volSl.v = v; volSl.el = found; volSl.at = now();
    return found;
  }
  function rangeOf(el) {
    var min = el.min !== '' && isFinite(+el.min) ? +el.min : 0;
    var max = el.max !== '' && isFinite(+el.max) ? +el.max : 100;
    return [min, max > min ? max : min + 1];
  }
  var valueSetter = null;
  function setRangeValue(el, x) {
    // The native setter, so frameworks that track the value (React) see the change.
    try {
      valueSetter = valueSetter || Object.getOwnPropertyDescriptor(G.HTMLInputElement.prototype, 'value').set;
      valueSetter.call(el, String(x));
    } catch (e) { el.value = String(x); }
    el.dispatchEvent(new G.Event('input', { bubbles: true }));
    el.dispatchEvent(new G.Event('change', { bubbles: true }));
  }

  // { get: 0..1, muted, set(0..1), mute(bool) or null, slider } for the player around v.
  function siteVolume(v) {
    var yt = ytPlayer(v);
    if (yt) return {
      get: function () { return yt.getVolume() / 100; },
      muted: function () { return yt.isMuted(); },
      set: function (x) { yt.setVolume(Math.round(x * 100)); if (x > 0 && yt.isMuted()) yt.unMute(); },
      mute: function (m) { if (m) yt.mute(); else yt.unMute(); }
    };
    var nf = nfPlayer();
    if (nf) return {
      get: function () { return typeof nf.getVolume === 'function' ? +nf.getVolume() : v.volume; },
      muted: function () { return typeof nf.isMuted === 'function' ? nf.isMuted() : v.muted; },
      set: function (x) { nf.setVolume(x); if (x > 0 && nf.isMuted && nf.isMuted()) nf.setMuted(false); },
      mute: function (m) { nf.setMuted(m); }
    };
    var jw = jwPlayer(v);
    if (jw) return {
      get: function () { return jw.getVolume() / 100; },
      muted: function () { return jw.getMute(); },
      set: function (x) { jw.setVolume(Math.round(x * 100)); if (x > 0 && jw.getMute()) jw.setMute(false); },
      mute: function (m) { jw.setMute(m); }
    };
    var vj = vjsPlayer(v);
    if (vj) return {
      get: function () { return vj.volume(); },
      muted: function () { return vj.muted(); },
      set: function (x) { vj.volume(x); if (x > 0 && vj.muted()) vj.muted(false); },
      mute: function (m) { vj.muted(m); }
    };
    var sl = volSlider(v);
    if (sl) return {
      get: function () { var r = rangeOf(sl); return (+sl.value - r[0]) / (r[1] - r[0]); },
      muted: function () { return v.muted; },
      set: function (x) { var r = rangeOf(sl); setRangeValue(sl, Math.round((r[0] + x * (r[1] - r[0])) * 1e4) / 1e4); },
      mute: null,
      slider: sl
    };
    return null;
  }

  // The site's slider counts only if the video's volume followed it. If not,
  // the element is set directly and that slider is dropped. One check covers
  // a burst of wheel steps.
  var slWatch = null;
  function checkSlider(v, sl, vol) {
    var w = slWatch;
    if (!w || w.v !== v) {
      if (w) { G.clearTimeout(w.timer); w.v.removeEventListener('volumechange', w.hit); }
      w = slWatch = { v: v, moved: false, timer: 0 };
      w.hit = function () { w.moved = true; };
      v.addEventListener('volumechange', w.hit);
    }
    w.sl = sl; w.vol = vol;
    G.clearTimeout(w.timer);
    w.timer = G.setTimeout(function () {
      v.removeEventListener('volumechange', w.hit);
      slWatch = null;
      if (!w.moved && Math.abs(v.volume - w.vol) > 0.02) { volSl.bad = w.sl; volSl.at = 0; v.volume = w.vol; }
      if (w.vol > 0 && v.muted) v.muted = false;
    }, 250);
  }

  function isMuted(v) {
    var api = siteVolume(v);
    if (api) { try { return !!api.muted(); } catch (e) { /* fall back */ } }
    return v.muted;
  }
  // YouTube's loudness normalisation keeps video.volume below its own slider,
  // so the player's value is read where there is one.
  function getVolume(v) {
    var api = siteVolume(v);
    if (api) { try { var x = +api.get(); if (isFinite(x)) return clamp(x, 0, 1); } catch (e) { /* fall back */ } }
    return v.volume;
  }
  function setVolume(v, vol, quiet) {
    if (!v) return;
    vol = clamp(vol, 0, 1);
    var api = siteVolume(v);
    var done = false;
    if (api) { try { api.set(vol); done = true; } catch (e) { done = false; } }
    if (!done) { v.volume = vol; if (vol > 0 && v.muted) v.muted = false; }
    else if (api.slider) checkSlider(v, api.slider, vol);
    if (!quiet) osd('Volume ' + Math.round(vol * 100) + '%', vol === 0 ? 'Muted' : '', vol === 0 ? 'mute' : 'volume', vol);
    refreshUi();
  }
  function toggleMute(v) {
    if (!v) return;
    var muted = isMuted(v);
    var api = siteVolume(v);
    var done = false;
    if (api && api.mute) { try { api.mute(!muted); done = true; } catch (e) { done = false; } }
    if (!done) v.muted = !muted;
    osd(muted ? 'Sound on' : 'Muted', muted ? 'Volume ' + Math.round(getVolume(v) * 100) + '%' : '', muted ? 'volume' : 'mute');
    refreshUi();
  }
  // Scrolling up on a muted video unmutes it at its old level; scrolling down
  // keeps it muted.
  function changeVolume(v, d) {
    if (isMuted(v) && d < 0) { osd('Muted', 'Scroll up to unmute', 'mute', 0); return; }
    setVolume(v, Math.round((getVolume(v) + d) * 100) / 100);
  }

  // ==================================================================
  // Speed (remembered across videos when asked)
  // ==================================================================
  var speed = { desired: cfg.playback.rememberSpeed ? clamp(cfg.playback.speed, 0.07, 16) : 1, ourAt: 0, srcAt: 0 };

  function setSpeed(r, quiet) {
    r = clamp(Math.round(r * 100) / 100, 0.07, 16);
    speed.desired = r;
    var v = targetVideo();
    if (v) { speed.ourAt = now(); try { v.playbackRate = r; } catch (e) { /* ignore */ } }
    if (cfg.playback.rememberSpeed) postPatch({ playback: { speed: r } });
    if (!quiet) osd('Speed ' + fmtRate(r), r === 1 ? 'Normal' : '', 'speed', clamp((r - 0.25) / 3.75, 0, 1));
    refreshUi();
  }
  function fmtRate(r) { return (Math.round(r * 100) / 100).toString() + '×'; }
  function stepSpeed(dir) {
    var v = targetVideo();
    var cur = v ? v.playbackRate : speed.desired;
    var st = cfg.playback.speedStep || 0.25;
    var next = dir > 0 ? Math.floor(cur / st + 1e-6) * st + st : Math.ceil(cur / st - 1e-6) * st - st;
    setSpeed(clamp(next, 0.25, 16));
  }

  doc.addEventListener('ratechange', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || v !== targetVideo()) return;
    if (now() - speed.ourAt < 300) return;
    if (now() - speed.srcAt < 2500 && cfg.playback.rememberSpeed && Math.abs(v.playbackRate - speed.desired) > 0.01) {
      // The player reset the rate while loading a new video: put ours back.
      speed.ourAt = now();
      try { v.playbackRate = speed.desired; } catch (err) { /* ignore */ }
      return;
    }
    // Changed from the site's own menu: follow it.
    speed.desired = v.playbackRate;
    if (cfg.playback.rememberSpeed) postPatch({ playback: { speed: round2(v.playbackRate) } });
    refreshUi();
  }, true);

  function onNewSource(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    speed.srcAt = now();
    if (e.type === 'loadstart' && (v === targetVideo() || v === thumbs.v)) { loop.a = loop.b = null; thumbs.reset(v); crop.v = null; crop.cur = null; }
    if (e.type === 'loadedmetadata' || e.type === 'playing') {
      if (cfg.playback.rememberSpeed && Math.abs(v.playbackRate - speed.desired) > 0.01 && v === targetVideo()) {
        speed.ourAt = now();
        try { v.playbackRate = speed.desired; } catch (err) { /* ignore */ }
      }
      requestApply();
    }
  }
  ['loadstart', 'loadedmetadata', 'playing'].forEach(function (t) { doc.addEventListener(t, onNewSource, true); });
  doc.addEventListener('resize', function (e) { if (e.target && e.target.tagName === 'VIDEO') requestApply(); }, true);

  // ==================================================================
  // Picture-in-Picture, fullscreen, browser-window fullscreen, lights off
  // ==================================================================
  function togglePip(v) {
    if (doc.pictureInPictureElement) { doc.exitPictureInPicture().catch(noop); return; }
    if (!v) return;
    if (!doc.pictureInPictureEnabled) { osd('Picture-in-Picture', 'Not available here', 'pip'); return; }
    try {
      if (v.disablePictureInPicture) v.disablePictureInPicture = false;
      v.removeAttribute('disablepictureinpicture');
    } catch (e) { /* ignore */ }
    v.requestPictureInPicture().then(function () { refreshUi(); }).catch(function (e) {
      osd('Picture-in-Picture blocked', e && e.name === 'NotAllowedError' ? 'Use the toolbar button or the keyboard shortcut' : 'This player doesn’t allow it', 'pip');
    });
  }

  // The site's own fullscreen button, where there is one, keeps its player
  // layout and controls right. Clicked inside our user gesture, so it's allowed.
  var NATIVE_FS = {
    netflix: ['[data-uia="control-fullscreen-enter"]'],
    prime: ['.atvwebplayersdk-fullscreen-button'],
    other: ['.ytp-fullscreen-button']
  };
  function nativeFsButton(v, box) {
    var sels = NATIVE_FS[SITE] || NATIVE_FS.other;
    if (SITE === 'other' && !ytPlayer(v)) return null;
    for (var i = 0; i < sels.length; i++) {
      var b = (box.el && box.el.querySelector && box.el.querySelector(sels[i])) || doc.querySelector(sels[i]);
      if (b && b.isConnected && typeof b.click === 'function') return b;
    }
    return null;
  }

  function toggleFullscreen(v) {
    if (doc.fullscreenElement) { doc.exitFullscreen().catch(noop); return; }
    if (!v) return;
    if (winfs.on) winfsOff();
    var box = playerBox(v);
    var native = nativeFsButton(v, box);
    if (native) {
      native.click();
      // If the site ignored it, fall back to doing it ourselves.
      G.setTimeout(function () { if (!doc.fullscreenElement) requestFs(v, box); }, 400);
      return;
    }
    requestFs(v, box);
  }
  function requestFs(v, box) {
    var target = box.el || v;
    var p = target.requestFullscreen ? target.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && p.catch) {
      p.catch(function () { osd('Fullscreen blocked', 'Use the toolbar button or the site’s own button', 'fullscreen'); });
    }
  }

  var winfs = { on: false, player: null, video: null, restores: [], check: 0 };
  function winfsOn(v) {
    if (!v || winfs.on) return;
    if (doc.fullscreenElement) { doc.exitFullscreen().catch(noop); }
    var box = playerBox(v);
    var p = box.el || v;
    winfs.on = true; winfs.player = p; winfs.video = v; winfs.restores = [];
    var R = winfs.restores;
    R.push(pinStyles(p, {
      position: 'fixed', left: '0', top: '0', right: '0', bottom: '0',
      width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none', 'min-width': '0', 'min-height': '0',
      margin: '0', 'z-index': '2147483600', background: '#000', transform: 'none', 'border-radius': '0', 'box-sizing': 'border-box'
    }));
    // Ancestors must not trap a fixed child (transform, filter, contain...) or
    // keep it under the page (stacking contexts with low z-index).
    for (var a = parentOf(p); a && a !== doc.documentElement; a = parentOf(a)) {
      if (a === doc.body) break;
      R.push(pinStyles(a, {
        transform: 'none', filter: 'none', 'backdrop-filter': 'none', perspective: 'none', contain: 'none',
        'will-change': 'auto', 'clip-path': 'none', mask: 'none', 'content-visibility': 'visible', 'z-index': '2147483600'
      }));
    }
    if (doc.body) R.push(pinStyles(doc.body, { overflow: 'hidden' }));
    if (doc.documentElement) R.push(pinStyles(doc.documentElement, { overflow: 'hidden' }));
    fireResize();
    // Players that size the <video> in pixels catch up on resize; for the rest,
    // stretch the video (and its wrappers) to the new box.
    winfs.check = G.setTimeout(function () {
      winfs.check = 0;
      if (!winfs.on || !v.isConnected) return;
      var vr = v.getBoundingClientRect();
      if (vr.width * vr.height >= G.innerWidth * G.innerHeight * 0.8 || (vr.width >= G.innerWidth - 2 || vr.height >= G.innerHeight - 2)) return;
      for (var n = v; n && n !== p; n = parentOf(n)) {
        var props = { width: '100%', height: '100%', 'max-width': 'none', 'max-height': 'none' };
        var pos = G.getComputedStyle(n).position;
        if (pos === 'absolute' || pos === 'fixed') { props.left = '0'; props.top = '0'; props.right = 'auto'; props.bottom = 'auto'; props.margin = '0'; }
        if (n === v) props['object-fit'] = 'contain';
        R.push(pinStyles(n, props));
      }
      requestApply();
    }, 450);
    applyAll(); refreshUi();
    osd('Filling the browser window', 'Press Esc to go back', 'winfs');
  }
  function winfsOff() {
    if (!winfs.on) return;
    if (winfs.check) { G.clearTimeout(winfs.check); winfs.check = 0; }
    for (var i = winfs.restores.length - 1; i >= 0; i--) { try { winfs.restores[i](); } catch (e) { /* ignore */ } }
    winfs = { on: false, player: null, video: null, restores: [], check: 0 };
    fireResize();
    applyAll(); refreshUi();
  }
  function toggleWinfs(v) { if (winfs.on) winfsOff(); else winfsOn(v); }
  function parentOf(n) {
    if (n.parentElement) return n.parentElement;
    var r = n.getRootNode && n.getRootNode();
    return r && r.host ? r.host : null;
  }
  function fireResize() {
    try { G.dispatchEvent(new G.Event('resize')); } catch (e) { /* ignore */ }
    G.setTimeout(function () { try { G.dispatchEvent(new G.Event('resize')); } catch (e) { /* ignore */ } requestApply(); }, 250);
  }

  // Lights off: one transparent box over the player whose huge shadow dims the
  // rest of the page. No page element is moved or restacked.
  var lights = { on: false, el: null, timer: 0, key: '' };
  function lightsOn() {
    if (lights.on) return;
    lights.on = true;
    lights.el = h('div', { 'data-qlock-lights': '', 'aria-hidden': 'true' });
    lights.el.style.cssText = 'all:initial;position:fixed;z-index:2147483000;pointer-events:none;border-radius:4px;' +
      'box-shadow:0 0 0 200vmax rgba(0,0,0,.88);transition:opacity .3s ease;opacity:0;left:0;top:0;width:0;height:0;';
    (doc.body || doc.documentElement).appendChild(lights.el);
    var place = function () {
      var v = targetVideo();
      if (!lights.on) return;
      if (!v) { lightsOff(); return; }
      var r = playerBox(v).rect;
      var key = Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
      if (key !== lights.key) {
        lights.key = key;
        var s = lights.el.style;
        s.left = r.left + 'px'; s.top = r.top + 'px'; s.width = r.width + 'px'; s.height = r.height + 'px';
        s.opacity = '1';
      }
      lights.timer = G.setTimeout(place, 120);
    };
    place();
    refreshUi();
    osd('Lights off', 'Page around the video dimmed', 'lights');
  }
  function lightsOff() {
    if (!lights.on) return;
    lights.on = false;
    if (lights.timer) G.clearTimeout(lights.timer);
    if (lights.el && lights.el.parentNode) lights.el.parentNode.removeChild(lights.el);
    lights.el = null;
    lights.key = '';
    refreshUi();
  }

  // ==================================================================
  // A-B loop and snapshot
  // ==================================================================
  var loop = { a: null, b: null };
  function loopCycle(v) {
    if (!v) return;
    if (loop.a === null) {
      loop.a = v.currentTime;
      osd('Loop start (A) ' + fmt(loop.a), 'Press again at the end point (B)', 'loop');
    } else if (loop.b === null) {
      var t = v.currentTime;
      if (t < loop.a + 0.5) { loop.a = t; osd('Loop start (A) ' + fmt(t), 'B must come after A', 'loop'); return; }
      loop.b = t;
      seekTo(v, loop.a);
      osd('A-B loop on', fmt(loop.a) + ' → ' + fmt(loop.b), 'loop');
    } else {
      loop.a = loop.b = null;
      osd('A-B loop off', '', 'loop');
    }
    refreshUi();
  }
  G.setInterval(function () {
    if (loop.b === null) return;
    var v = targetVideo();
    if (v && !v.paused && v.currentTime >= loop.b) seekTo(v, loop.a);
  }, 150);

  function snapshot(v) {
    if (!v || !v.videoWidth) return;
    if (isDrm(v)) { osd('Snapshot unavailable', 'DRM-protected video can’t be captured', 'snapshot'); return; }
    var c = doc.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    var x = c.getContext('2d');
    var p = picture();
    if (!pictureBypass && !pictureIsDefault(p)) { try { x.filter = pictureCss(p) || 'none'; } catch (e) { /* ignore */ } }
    var name = ((doc.title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video') +
      ' ' + fmt(v.currentTime).replace(/:/g, '-') + '.png';
    try {
      x.drawImage(v, 0, 0);
      var warm = !pictureBypass && !pictureIsDefault(p) ? tintRgba(p, false) : null;
      if (warm) { x.filter = 'none'; x.fillStyle = warm; x.fillRect(0, 0, c.width, c.height); }
      c.toBlob(function (blob) {
        if (!blob) { osd('Snapshot failed', '', 'snapshot'); return; }
        var url = G.URL.createObjectURL(blob);
        var a = h('a', { href: url, download: name, style: 'display:none' });
        (doc.body || doc.documentElement).appendChild(a);
        a.click();
        a.parentNode.removeChild(a);
        G.setTimeout(function () { G.URL.revokeObjectURL(url); }, 10000);
        osd('Snapshot saved', name, 'snapshot');
      }, 'image/png');
    } catch (e) {
      osd('Snapshot blocked', 'The site serves this video from another origin', 'snapshot');
    }
  }

  // ==================================================================
  // Timeline hover previews
  // ==================================================================
  // Direct files get exact frames from a hidden second <video>. Streamed video
  // (MSE blob: URLs can't be opened twice) gets frames remembered while playing.
  var thumbs = {
    v: null, map: {}, order: [], pv: null, pvSrc: '', busy: false, want: -1, lastAt: 0, cv: null,
    BUCKET: 5, MAX: 240,
    reset: function (v) {
      if (v && this.v && v !== this.v) return;
      for (var k in this.map) { try { this.map[k].close(); } catch (e) { /* ignore */ } }
      this.map = {}; this.order = [];
      if (this.pv) { try { this.pv.removeAttribute('src'); this.pv.load(); } catch (e) { /* ignore */ } }
      this.pv = null; this.pvSrc = ''; this.busy = false; this.want = -1;
    },
    direct: function (v) {
      var s = v.currentSrc || '';
      return !v.srcObject && /^https?:/i.test(s);
    },
    sample: function (v) {
      if (!v || v.paused || v.readyState < 2 || isDrm(v) || this.direct(v) || !G.createImageBitmap) return;
      if (this.v !== v) { this.reset(); this.v = v; }
      var b = Math.floor(v.currentTime / this.BUCKET);
      if (this.map[b] || now() - this.lastAt < 900) return;
      this.lastAt = now();
      var self = this;
      var w = 160, hh = Math.max(40, Math.round(160 * v.videoHeight / v.videoWidth));
      G.createImageBitmap(v, { resizeWidth: w, resizeHeight: hh, resizeQuality: 'low' }).then(function (bm) {
        if (self.v !== v || self.map[b]) { bm.close(); return; }
        self.map[b] = bm; self.order.push(b);
        while (self.order.length > self.MAX) {
          var old = self.order.shift();
          try { self.map[old].close(); } catch (e) { /* ignore */ }
          delete self.map[old];
        }
      }).catch(noop);
    },
    // Draws a preview for time t into canvas c; returns whether one is shown.
    draw: function (v, t, c) {
      var x = c.getContext('2d');
      this.cv = c;
      if (isDrm(v)) return false;
      if (this.direct(v)) {
        if (!this.pv || this.pvSrc !== v.currentSrc) {
          this.reset();
          this.v = v;
          this.pv = doc.createElement('video');
          this.pv.muted = true; this.pv.preload = 'auto'; this.pv.playsInline = true;
          this.pvSrc = v.currentSrc;
          var self = this;
          this.pv.addEventListener('seeked', function () {
            self.busy = false;
            var cv = self.cv;
            try { cv.getContext('2d').drawImage(self.pv, 0, 0, cv.width, cv.height); cv.setAttribute('data-ok', ''); } catch (e) { /* ignore */ }
            if (self.want >= 0 && Math.abs(self.want - self.pv.currentTime) > 0.5) self.seekPv(self.want);
          });
          this.pv.addEventListener('error', function () { self.busy = false; });
          this.pv.src = v.currentSrc;
        }
        this.seekPv(t);
        return c.hasAttribute('data-ok');
      }
      var b = Math.floor(t / this.BUCKET);
      var bm = null;
      for (var d = 0; d <= 3 && !bm; d++) bm = this.map[b - d] || this.map[b + d] || null;
      if (!bm) return false;
      try { x.drawImage(bm, 0, 0, c.width, c.height); return true; } catch (e) { return false; }
    },
    seekPv: function (t) {
      this.want = t;
      if (this.busy || !this.pv) return;
      this.busy = true;
      try { this.pv.currentTime = t; } catch (e) { this.busy = false; }
    }
  };

  // ==================================================================
  // Icons (stroke icons on a 24 grid, built as SVG nodes)
  // ==================================================================
  var I = {
    play: [['path', { d: 'M8 5.3v13.4a1 1 0 0 0 1.5.86l10.8-6.7a1 1 0 0 0 0-1.72L9.5 4.44A1 1 0 0 0 8 5.3z', fill: 'currentColor', stroke: 'none' }]],
    pause: [['rect', { x: 6, y: 4.5, width: 4.2, height: 15, rx: 1.3, fill: 'currentColor', stroke: 'none' }], ['rect', { x: 13.8, y: 4.5, width: 4.2, height: 15, rx: 1.3, fill: 'currentColor', stroke: 'none' }]],
    back: [['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }], ['path', { d: 'M3 3v5h5' }]],
    fwd: [['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }], ['path', { d: 'M21 3v5h-5' }]],
    volume: [['polygon', { points: '11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5', fill: 'currentColor' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }], ['path', { d: 'M18.9 5.1a9.8 9.8 0 0 1 0 13.8' }]],
    volumeLow: [['polygon', { points: '11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5', fill: 'currentColor' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }]],
    mute: [['polygon', { points: '11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5', fill: 'currentColor' }], ['path', { d: 'M22 9l-6 6M16 9l6 6' }]],
    speed: [['path', { d: 'M12 14l4-4' }], ['path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }]],
    fill: [['rect', { x: 3, y: 7.5, width: 18, height: 9, rx: 1.6 }], ['path', { d: 'M12 1.8v3.4M10.2 3.5 12 1.7l1.8 1.8M12 22.2v-3.4M10.2 20.5 12 22.3l1.8-1.8' }]],
    display: [['path', { d: 'M6.13 1L6 16a2 2 0 0 0 2 2h15' }], ['path', { d: 'M1 6.13L16 6a2 2 0 0 1 2 2v15' }]],
    backdrop: [['rect', { x: 7, y: 8, width: 10, height: 8, rx: 1.5 }], ['path', { d: 'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5' }]],
    picture: [['path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }]],
    rotate: [['polyline', { points: '23 4 23 10 17 10' }], ['path', { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' }]],
    rotateL: [['polyline', { points: '1 4 1 10 7 10' }], ['path', { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' }]],
    flip: [['path', { d: 'M12 3v18', 'stroke-dasharray': '2 2.4' }], ['path', { d: 'M9 7.5 4 17h5zM15 7.5l5 9.5h-5z' }]],
    loop: [['polyline', { points: '17 1 21 5 17 9' }], ['path', { d: 'M3 11V9a4 4 0 0 1 4-4h14' }], ['polyline', { points: '7 23 3 19 7 15' }], ['path', { d: 'M21 13v2a4 4 0 0 1-4 4H3' }]],
    snapshot: [['path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }], ['circle', { cx: 12, cy: 13, r: 4 }]],
    lights: [['path', { d: 'M9 18h6M10 21.5h4' }], ['path', { d: 'M12 2.5a6.5 6.5 0 0 0-4 11.62c.68.55 1 1.38 1 2.25V17h6v-.63c0-.87.32-1.7 1-2.25A6.5 6.5 0 0 0 12 2.5z' }]],
    pip: [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2.2 }], ['rect', { x: 11.5, y: 11, width: 7.5, height: 6, rx: 1.2, fill: 'currentColor', stroke: 'none' }]],
    winfs: [['rect', { x: 2, y: 3.5, width: 20, height: 17, rx: 2.2 }], ['path', { d: 'M2 8h20' }], ['polyline', { points: '14 11.5 17 11.5 17 14.5' }], ['polyline', { points: '10 17.5 7 17.5 7 14.5' }]],
    fullscreen: [['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3' }]],
    exitFs: [['path', { d: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3' }]],
    stats: [['polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' }]],
    grip: [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]].map(function (p) { return ['circle', { cx: p[0], cy: p[1], r: 1.5, fill: 'currentColor', stroke: 'none' }]; }),
    layout: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.2 }], ['path', { d: 'M3 15h18' }], ['path', { d: 'M7 18h6' }]],
    close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
    reset: [['polyline', { points: '1 4 1 10 7 10' }], ['path', { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' }]]
  };
  function icon(name, label) {
    var s = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });
    (I[name] || []).forEach(function (p) { s.appendChild(svgEl(p[0], p[1])); });
    if (label) {
      s.appendChild(svgEl('text', { x: 12, y: 15.4, 'text-anchor': 'middle', 'font-size': label.length > 2 ? 6.4 : 7.6, 'font-weight': 700, fill: 'currentColor', stroke: 'none', 'font-family': 'system-ui, sans-serif' }, label));
    }
    return s;
  }
  function setIcon(btn, name, label) {
    var key = name + '|' + (label || '');
    if (btn.__icon === key) return;
    btn.__icon = key;
    var old = btn.querySelector('svg');
    var n = icon(name, label);
    if (old) btn.replaceChild(n, old); else btn.insertBefore(n, btn.firstChild);
  }

  // ==================================================================
  // Formatting
  // ==================================================================
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var hr = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (hr ? hr + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function clockAt(sec) {
    var d = new Date(now() + sec * 1000);
    try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  }

  // ==================================================================
  // On-screen notification (OSD)
  // ==================================================================
  var OSD_CSS = [
    ':host{all:initial}',
    '.o{display:flex;align-items:center;gap:11px;box-sizing:border-box;width:max-content;min-width:230px;max-width:min(520px,86vw);padding:10px 16px 10px 12px;border-radius:14px;',
    'background:rgba(14,16,20,.86);color:#fff;box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08) inset;',
    'backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);',
    'font:600 13.5px/1.25 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;transform:translateX(-50%) translateY(-6px);opacity:0;',
    'transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s;visibility:hidden;pointer-events:none;-webkit-font-smoothing:antialiased}',
    '.o.show{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0);transition:opacity .18s ease,transform .18s ease,visibility 0s}',
    '.ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent,#f2a7b5) 20%,transparent);color:var(--accent,#f2a7b5);flex:none}',
    '.ic svg{width:19px;height:19px}',
    '.tx{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}',
    '.t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.d{font-weight:500;font-size:11.5px;color:rgba(255,255,255,.66);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.d:empty{display:none}',
    '.bar{height:4px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden;margin-top:3px;width:100%}',
    '.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent,#f2a7b5),var(--accent2,#c9a3e6));border-radius:2px;transition:width .12s ease}',
    '@media (prefers-reduced-motion:reduce){.o,.bar i{transition:none}}'
  ].join('');
  var osdUi = null;
  var osdTimer = 0;

  function osd(title, desc, iconName, pct) {
    if (!doc.documentElement) return;
    if (!retired && (!cfg.videoController.showOsd || tb.panelId)) return; // an open panel already shows the value
    if (!osdUi) {
      var host = h('div', { 'data-qlock-osd': '' });
      var root = host.attachShadow({ mode: 'open' });
      adopt(root, OSD_CSS);
      var ic = h('div', { class: 'ic' });
      var t = h('div', { class: 't' });
      var d = h('div', { class: 'd' });
      var bar = h('div', { class: 'bar' }, [h('i')]);
      var box = h('div', { class: 'o', role: 'status', 'aria-live': 'polite' }, [ic, h('div', { class: 'tx' }, [t, d, bar])]);
      root.appendChild(box);
      osdUi = { host: host, box: box, ic: ic, t: t, d: d, bar: bar };
    }
    var u = osdUi;
    u.host.style.cssText = 'all:initial;position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;' +
      'display:block;width:0;height:0;pointer-events:none;z-index:2147483647;';
    var v = targetVideo();
    var r = v ? playerBox(v).rect : viewportRect();
    var vr = viewportRect();
    var top = Math.max(r.top, 0) + Math.min(56, Math.max(14, r.height * 0.07));
    if (tb.shown && tb.host && tb.host.isConnected) {
      var tr = tb.host.getBoundingClientRect();
      if (tr.top < Math.max(r.top, 0) + r.height / 2 && tr.bottom + 12 > top) top = tr.bottom + 12;
    }
    u.host.style.setProperty('left', (clamp(r.left + r.width / 2, 120, vr.width - 120)) + 'px', 'important');
    u.host.style.setProperty('top', clamp(top, 10, vr.height - 80) + 'px', 'important');
    if (!core.mountOnTop(u.host)) return;
    accentVars(u.box);
    while (u.ic.firstChild) u.ic.removeChild(u.ic.firstChild);
    u.ic.appendChild(icon(I[iconName] ? iconName : 'display'));
    u.t.textContent = title;
    u.d.textContent = desc || '';
    if (typeof pct === 'number') { u.bar.style.display = 'block'; u.bar.firstChild.style.width = Math.round(clamp(pct, 0, 1) * 100) + '%'; }
    else u.bar.style.display = 'none';
    // restart the fade-in
    u.box.classList.remove('show');
    void u.box.offsetWidth;
    u.box.classList.add('show');
    if (osdTimer) G.clearTimeout(osdTimer);
    osdTimer = G.setTimeout(function () { u.box.classList.remove('show'); }, 1500);
  }

  // ==================================================================
  // Floating toolbar
  // ==================================================================
  var TB_CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.w{position:relative;font:500 12px/1.2 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;color:var(--fg);',
    '-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}',
    '.w{--accent:#f2a7b5;--accent2:#c9a3e6;--on-accent:#1d1a22;--accent-fg:var(--accent)}',
    // Dark: solid, deep neutral with a faint top light.
    '.t-dark{--bg:linear-gradient(180deg,rgba(40,41,48,.97),rgba(23,24,29,.97));--panel:linear-gradient(180deg,rgba(36,37,44,.99),rgba(24,25,30,.99));',
    '--fg:#f2f3f6;--muted:#9ea4b0;--line:rgba(255,255,255,.08);--hover:rgba(255,255,255,.08);--press:rgba(255,255,255,.14);--track:rgba(255,255,255,.16);',
    '--shadow:0 14px 36px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.07),inset 0 1px 0 rgba(255,255,255,.07);--blur:blur(10px)}',
    '.t-light{--bg:rgba(255,255,255,.93);--panel:rgba(255,255,255,.98);--fg:#17181c;--muted:#5d6370;--line:rgba(0,0,0,.08);--hover:rgba(0,0,0,.05);',
    '--press:rgba(0,0,0,.1);--track:rgba(0,0,0,.13);--shadow:0 12px 30px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);',
    '--accent-fg:color-mix(in srgb,var(--accent) 52%,#000);--blur:blur(20px) saturate(160%)}',
    // Glass: frosted, lets the picture through, with a bright rim.
    '.t-glass{--bg:linear-gradient(180deg,rgba(255,255,255,.17),rgba(255,255,255,.05)),rgba(18,18,24,.26);',
    '--panel:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.03)),rgba(20,20,26,.7);--fg:#fff;--muted:rgba(255,255,255,.74);',
    '--line:rgba(255,255,255,.16);--hover:rgba(255,255,255,.14);--press:rgba(255,255,255,.22);--track:rgba(255,255,255,.26);',
    '--shadow:0 10px 36px rgba(0,0,0,.32),0 0 0 1px rgba(255,255,255,.18),inset 0 1px 0 rgba(255,255,255,.28);--blur:blur(26px) saturate(185%)}',
    '.t-glass .b svg,.t-glass .b .lb{filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))}',
    '.bar{display:flex;flex-direction:column;gap:4px;padding:4px;border-radius:15px;background:var(--bg);box-shadow:var(--shadow);',
    'backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);transition:opacity .22s ease,transform .22s ease,visibility 0s}',
    '.w.hide .bar,.w.hide .panel{opacity:0;transform:translateY(-3px);pointer-events:none;visibility:hidden;',
    'transition:opacity .22s ease,transform .22s ease,visibility 0s linear .22s}',
    '.w.hide .panel{display:none}',
    '.row{display:flex;align-items:center;gap:1px;flex-wrap:wrap}',
    'button{appearance:none;-webkit-appearance:none;border:0;margin:0;background:transparent;color:inherit;font:inherit;cursor:pointer;outline:none}',
    '.b{position:relative;height:32px;min-width:32px;padding:0 7px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-weight:650;transition:background .12s,color .12s}',
    '.b:hover{background:var(--hover)}.b:active{background:var(--press)}',
    '.b:focus-visible,.chip:focus-visible,.seg button:focus-visible,.sbtn:focus-visible{box-shadow:0 0 0 2px var(--accent)}',
    '.b.on{color:var(--accent-fg);background:color-mix(in srgb,var(--accent) 22%,transparent)}',
    '.b.open{background:var(--press)}',
    '.b svg{width:18px;height:18px;flex:none;display:block}',
    '.b .lb{font-size:12px;font-variant-numeric:tabular-nums;min-width:26px;text-align:center}',
    '.grip{cursor:grab;min-width:18px;width:18px;padding:0;color:var(--muted)}.grip:active{cursor:grabbing}',
    '.grip svg{width:14px;height:14px}',
    '.sep{width:1px;height:18px;background:var(--line);margin:0 3px;flex:none}',
    '.tl{display:none;align-items:center;gap:9px;padding:3px 8px 0}',
    '.w.x .tl{display:flex}',
    '.tm{font-variant-numeric:tabular-nums;font-size:11.5px;font-weight:600;color:var(--muted);min-width:36px}',
    '.tm.r{text-align:right;cursor:pointer}.tm.r:hover{color:var(--fg)}',
    '.sk{position:relative;flex:1;min-width:120px;height:20px;cursor:pointer;touch-action:none}',
    '.rail{position:absolute;left:0;right:0;top:8px;height:4px;border-radius:3px;background:var(--track);overflow:hidden;transition:height .12s,top .12s}',
    '.sk:hover .rail,.sk.drag .rail{top:7px;height:6px}',
    '.buf{position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--fg) 32%,transparent)}',
    '.ab{position:absolute;top:0;bottom:0;background:rgba(76,194,255,.55)}',
    '.pl{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--accent),var(--accent2))}',
    '.kn{position:absolute;top:4px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--accent);',
    'box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent);transform:scale(0);transition:transform .12s}',
    '.sk:hover .kn,.sk.drag .kn{transform:scale(1)}',
    '.pv{position:absolute;bottom:26px;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:5px;pointer-events:none}',
    '.sk:hover .pv,.sk.drag .pv{display:flex}',
    '.w.pv-below .pv{bottom:auto;top:62px;flex-direction:column-reverse}',
    '.pv canvas{width:168px;border-radius:9px;background:#000;box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.12);display:block}',
    '.pv.no canvas{display:none}',
    '.pv span{font:650 11.5px/1 inherit;font-variant-numeric:tabular-nums;padding:5px 8px;border-radius:7px;background:rgba(8,9,11,.86);color:#fff;white-space:nowrap}',
    '.vol{display:inline-flex;align-items:center}',
    '.vs{display:none;width:72px;margin:0 6px 0 0}',
    '.w.x .vs{display:block}',
    '.md{display:none;font-size:11px;font-weight:650;color:var(--muted);padding:0 6px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}',
    '.w.x .md{display:block}',
    '.panel{position:absolute;left:0;width:306px;max-height:calc(100vh - 110px);overflow:auto;padding:13px;border-radius:16px;background:var(--panel);',
    'box-shadow:var(--shadow);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);display:none;flex-direction:column;gap:11px;',
    'scrollbar-width:thin}',
    '.panel.open{display:flex}.panel.up{bottom:calc(100% + 8px)}.panel.down{top:calc(100% + 8px)}.panel.right{left:auto;right:0}',
    '.ph{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.ph b{font-size:13px;font-weight:700}',
    '.big{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}',
    '.lnk{font-size:11.5px;font-weight:650;color:var(--muted);padding:4px 7px;border-radius:7px}.lnk:hover{background:var(--hover);color:var(--fg)}',
    '.seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;padding:3px;border-radius:11px;background:var(--hover)}',
    '.seg button{height:28px;border-radius:8px;font-size:11.5px;font-weight:650;padding:0 4px;white-space:nowrap}',
    '.seg button:hover{background:var(--hover)}',
    '.seg button.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--on-accent)}',
    '.chips{display:flex;flex-wrap:wrap;gap:5px}',
    '.chip{height:27px;padding:0 10px;border-radius:14px;border:1px solid var(--line);font-size:11.5px;font-weight:650;font-variant-numeric:tabular-nums}',
    '.chip:hover{background:var(--hover)}.chip.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--on-accent);border-color:transparent}',
    '.chips.ar{display:grid;grid-template-columns:repeat(6,1fr)}.chips.ar .chip{padding:0}',
    '.chips.ar4{display:grid;grid-template-columns:repeat(4,1fr)}.chips.ar4 .chip{padding:0}',
    '.sl{display:grid;grid-template-columns:1fr auto;gap:3px 8px;align-items:center}',
    '.sl label{font-size:11.5px;font-weight:650;color:var(--muted)}',
    '.sl output{font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums}',
    '.sl input{grid-column:1/-1}',
    'input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:18px;background:transparent;margin:0;cursor:pointer}',
    'input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:3px;background:linear-gradient(to right,var(--accent),var(--accent2) var(--p,50%),var(--track) var(--p,50%))}',
    'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;margin-top:-5.5px;background:#fff;',
    'box-shadow:0 1px 4px rgba(0,0,0,.45),0 0 0 2px var(--accent)}',
    'input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 45%,transparent)}',
    'input[type=range]::-moz-range-track{height:4px;border-radius:3px;background:var(--track)}',
    'input[type=range]::-moz-range-progress{height:4px;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--accent2))}',
    'input[type=range]::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:#fff;box-shadow:0 0 0 2px var(--accent)}',
    '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '.sbtn{height:30px;border-radius:9px;border:1px solid var(--line);font-size:11.5px;font-weight:650;display:inline-flex;align-items:center;justify-content:center;gap:6px}',
    '.sbtn:hover{background:var(--hover)}.sbtn svg{width:15px;height:15px}.sbtn.on{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--on-accent);border-color:transparent}',
    '.note{font-size:11px;line-height:1.45;color:var(--muted)}',
    '.note.warn{color:#ffb4a8}',
    '.t-light .note.warn{color:#b3261e}',
    '.grp{display:flex;flex-direction:column;gap:9px}',
    '.crow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;font-weight:650;color:var(--muted);cursor:pointer}',
    '.clr{width:46px;height:26px;padding:0;border:1px solid var(--line);border-radius:8px;background:transparent;cursor:pointer}',
    '.clr::-webkit-color-swatch-wrapper{padding:3px}.clr::-webkit-color-swatch{border:0;border-radius:5px}',
    '.cust{display:flex;gap:6px}.cust input{flex:1;min-width:0;height:28px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);',
    'font:600 12px/1 inherit;padding:0 9px;outline:none}.cust input:focus{border-color:var(--accent)}',
    '.tip{position:absolute;z-index:9;padding:6px 9px;border-radius:8px;background:rgba(8,9,11,.92);color:#fff;font-size:11.5px;font-weight:600;',
    'white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s;box-shadow:0 6px 18px rgba(0,0,0,.4)}',
    '.tip.show{opacity:1}.tip kbd{font:inherit;font-weight:700;margin-left:7px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.16)}',
    '@media (prefers-reduced-motion:reduce){.bar,.kn,.rail,.tip{transition:none}}'
  ].join('');

  var TIPS = {
    play: 'Play / pause', back: 'Back', fwd: 'Forward', volume: 'Mute · scroll to change volume', speed: 'Playback speed',
    fill: 'Hide black bars', display: 'Zoom, aspect ratio & rotation', backdrop: 'Ambient light / blur fill for black bars',
    picture: 'Brightness, colour & night mode', rotate: 'Rotate 90°', loop: 'A-B loop', snapshot: 'Save this frame as PNG',
    lights: 'Lights off (dim the page)', pip: 'Picture-in-Picture', winfs: 'Fill the browser window', fullscreen: 'Fullscreen', stats: 'Stats for nerds'
  };
  var TIP_KEYS = {
    fill: 'toggle-fill', display: 'quick-ratio', backdrop: 'cycle-backdrop', speed: 'speed-up', pip: 'toggle-pip',
    winfs: 'window-fullscreen', lights: 'toggle-lights', back: 'seek-back', fwd: 'seek-forward', snapshot: 'snapshot'
  };
  var PANELS = { speed: true, display: true, backdrop: true, picture: true };

  var tb = {
    host: null, root: null, w: null, bar: null, row: null, tl: null, btn: {}, panel: null, panelId: '', panelApi: null,
    tip: null, tipTimer: 0, tipFor: null, enabled: cfg.toolbar.show !== 'manual', shown: false, force: 0,
    drag: null, sig: '', seek: null, vs: null, md: null, curT: null, durT: null, remaining: false,
    pos: { fx: 0.5, fy: 0.035 }
  };
  try {
    var savedPos = JSON.parse(G.localStorage.getItem('__qlock_tbpos') || 'null');
    if (savedPos && isFinite(savedPos.fx) && isFinite(savedPos.fy)) tb.pos = { fx: clamp(savedPos.fx, 0, 1), fy: clamp(savedPos.fy, 0, 1) };
  } catch (e) { /* storage blocked */ }

  function inToolbar(e) {
    if (!tb.host) return false;
    try { return e.composedPath().indexOf(tb.host) !== -1; } catch (x) { return false; }
  }

  function rangeFill(input) {
    var min = +input.min, max = +input.max, val = +input.value;
    input.style.setProperty('--p', ((val - min) / (max - min) * 100).toFixed(1) + '%');
  }
  function slider(label, min, max, step, value, fmtFn, onInput, onCommit, resetTo) {
    var out = h('output', { text: fmtFn(value) });
    var input = h('input', { type: 'range', min: min, max: max, step: step, value: value, 'aria-label': label });
    rangeFill(input);
    input.addEventListener('input', function () { out.textContent = fmtFn(+input.value); rangeFill(input); onInput(+input.value); });
    input.addEventListener('change', function () { if (onCommit) onCommit(+input.value); });
    if (resetTo !== undefined) {
      input.addEventListener('dblclick', function () { input.value = resetTo; input.dispatchEvent(new G.Event('input')); input.dispatchEvent(new G.Event('change')); });
    }
    var el = h('div', { class: 'sl', title: resetTo !== undefined ? 'Double-click to reset' : null }, [h('label', { text: label }), out, input]);
    return {
      el: el,
      set: function (v) {
        if (G.document.activeElement === tb.host && tb.root.activeElement === input) return;
        if (+input.value !== v) { input.value = v; rangeFill(input); }
        out.textContent = fmtFn(v);
      }
    };
  }
  function seg(options, value, onPick) {
    var btns = {};
    var el = h('div', { class: 'seg', role: 'radiogroup' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', role: 'radio', text: o[1], title: o[2] || null, onclick: function () { onPick(o[0]); } });
      btns[o[0]] = b;
      el.appendChild(b);
    });
    var api = { el: el, set: function (v) { for (var k in btns) { btns[k].classList.toggle('on', k === v); btns[k].setAttribute('aria-checked', k === v ? 'true' : 'false'); } } };
    api.set(value);
    return api;
  }

  // --- panels -------------------------------------------------------
  function buildSpeedPanel() {
    var v0 = targetVideo();
    var big = h('div', { class: 'big' });
    var s = slider('Speed', 0.25, 4, 0.05, v0 ? v0.playbackRate : speed.desired, fmtRate, function (r) { setSpeed(r, true); }, null, 1);
    var chips = h('div', { class: 'chips' });
    var chipEls = [];
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].forEach(function (r) {
      var c = h('button', { type: 'button', class: 'chip', text: fmtRate(r), onclick: function () { setSpeed(r, true); } });
      c.__r = r; chipEls.push(c); chips.appendChild(c);
    });
    var minus = h('button', { type: 'button', class: 'sbtn', text: '− ' + cfg.playback.speedStep, onclick: function () { stepSpeed(-1); } });
    var plus = h('button', { type: 'button', class: 'sbtn', text: '+ ' + cfg.playback.speedStep, onclick: function () { stepSpeed(1); } });
    var hint = keys['speed-up'] || keys['speed-down'] ? 'Shortcuts: ' + [keys['speed-down'], keys['speed-up']].filter(Boolean).join(' / ') : 'Tip: set speed keys at chrome://extensions/shortcuts';
    var el = h('div', {}, [
      h('div', { class: 'ph' }, [h('b', { text: 'Playback speed' }), big]),
      s.el, chips, h('div', { class: 'grid2' }, [minus, plus]),
      h('div', { class: 'note', text: (cfg.playback.rememberSpeed ? 'Remembered for the next video. ' : '') + hint })
    ]);
    return {
      el: el,
      update: function () {
        var v = targetVideo();
        var r = v ? v.playbackRate : speed.desired;
        big.textContent = fmtRate(r);
        s.set(clamp(r, 0.25, 4));
        chipEls.forEach(function (c) { c.classList.toggle('on', Math.abs(c.__r - r) < 0.001); });
      }
    };
  }

  // "Black bars inside the video": film shape / auto / manual sizes. Used by
  // Fill and Stretch (zoom past them) and by the backdrop (paint over them).
  function buildBarsControl() {
    var opts = [[0, 'Auto'], [2.39, '2.39'], [2.2, '2.20'], [2, '2.00'], [1.85, '1.85'], [-2, 'Manual'], [-1, 'None']];
    var row = h('div', { class: 'chips ar4' });
    var els = [];
    opts.forEach(function (o) {
      var c = h('button', { type: 'button', class: 'chip', text: o[1],
        title: o[0] === 0 ? 'Detect black bars inside the video automatically'
          : o[0] === -1 ? 'Don’t treat anything inside the video as bars'
          : o[0] === -2 ? 'Set the bar sizes yourself'
          : 'The film is ' + o[1] + ':1 — the rest of the frame is bars',
        onclick: function () { setInner(o[0]); } });
      c.__i = o[0]; els.push(c); row.appendChild(c);
    });
    var pct = function (x) { return (Math.round(x * 2) / 2) + '%'; };
    var top = slider('Top + bottom', 0, 35, 0.5, disp.barT * 100, pct, function (x) {
      setBars(x / 100, disp.barLink ? x / 100 : disp.barL, true);
    }, null, 0);
    var side = slider('Left + right', 0, 35, 0.5, disp.barL * 100, pct, function (x) {
      setBars(disp.barLink ? x / 100 : disp.barT, x / 100, true);
    }, null, 0);
    var link = h('button', { type: 'button', class: 'sbtn', title: 'Move both sliders together',
      onclick: function () { disp.barLink = !disp.barLink; if (disp.barLink) setBars(disp.barT, disp.barT, true); saveDisp(); refreshUi(); } }, ['Link top/bottom and left/right']);
    var manual = h('div', { style: 'display:flex;flex-direction:column;gap:9px' }, [top.el, side.el, link]);
    var note = h('div', { class: 'note' });
    return {
      el: h('div', { style: 'display:flex;flex-direction:column;gap:9px' }, [h('div', { class: 'sl' }, [h('label', { text: 'Black bars inside the video' })]), row, manual, note]),
      update: function () {
        els.forEach(function (c) { c.classList.toggle('on', c.__i === disp.inner); });
        manual.style.display = disp.inner === -2 ? 'flex' : 'none';
        top.set(Math.round(disp.barT * 200) / 2);
        side.set(Math.round(disp.barL * 200) / 2);
        link.classList.toggle('on', disp.barLink);
        var vv = targetVideo();
        var blocked = vv && ((crop.blocked && crop.v === vv) || isDrm(vv));
        note.textContent = disp.inner === -2 ? 'Fill zooms past these; the backdrop paints over them.'
          : disp.inner > 0 ? 'Treating everything outside a ' + aspectName(disp.inner) + ' picture as bars.'
          : disp.inner === -1 ? 'Nothing inside the video is treated as bars.'
          : blocked ? 'This site doesn’t let extensions read its frames, so Auto can’t see these bars. Pick the film’s shape or Manual.'
          : crop.cur && crop.v === vv ? 'Detected automatically.' : 'Auto checks the picture while Fill, Stretch or the backdrop is on.';
        note.classList.toggle('warn', disp.inner === 0 && !!blocked);
      }
    };
  }

  function buildDisplayPanel() {
    var modeSeg = seg([['original', 'Original', 'As the site shows it'], ['fit', 'Fit', 'Largest size without cropping'], ['fill', 'Fill', 'Zoom in until the black bars are gone'], ['stretch', 'Stretch', 'Stretch to the edges, nothing cropped']],
      disp.mode, function (m) { setMode(m); });
    var aspects = [[4 / 3, '4:3'], [16 / 9, '16:9'], [1.85, '1.85'], [64 / 27, '21:9'], [2.39, '2.39'], [32 / 9, '32:9']];
    var chips = h('div', { class: 'chips ar' });
    var chipEls = [];
    aspects.forEach(function (a) {
      var c = h('button', { type: 'button', class: 'chip', text: a[1], title: 'Force ' + aspectName(a[0]) + ' aspect ratio', onclick: function () { setMode('aspect', a[0]); } });
      c.__a = a[0]; chipEls.push(c); chips.appendChild(c);
    });
    var custom = h('input', { type: 'text', placeholder: 'Custom, e.g. 2.2:1 or 18:9', 'aria-label': 'Custom aspect ratio' });
    var applyCustom = function () {
      var m = String(custom.value).trim().match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
      var a = m ? +m[1] / +m[2] : +custom.value;
      if (a > 0.2 && a < 6) setMode('aspect', a); else custom.focus();
    };
    custom.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyCustom(); });
    var cust = h('div', { class: 'cust' }, [custom, h('button', { type: 'button', class: 'sbtn', text: 'Apply', style: 'padding:0 12px', onclick: applyCustom })]);
    var bars = buildBarsControl();
    var pctFmt = function (x) { return Math.round(x) + '%'; };
    var zoom = slider('Zoom', 25, 300, 1, disp.zoom * 100, pctFmt, function (x) { setZoom(x / 100, true); }, null, 100);
    var sx = slider('↔ Stretch left + right', 50, 200, 1, disp.sx * 100, pctFmt, function (x) { setStretch('x', x / 100, true); }, null, 100);
    var sy = slider('↕ Stretch top + bottom', 50, 200, 1, disp.sy * 100, pctFmt, function (x) { setStretch('y', x / 100, true); }, null, 100);
    var rotL = h('button', { type: 'button', class: 'sbtn', onclick: function () { rotateBy(-90); } }, [icon('rotateL'), 'Left']);
    var rotR = h('button', { type: 'button', class: 'sbtn', onclick: function () { rotateBy(90); } }, [icon('rotate'), 'Right']);
    var flip = h('button', { type: 'button', class: 'sbtn', onclick: toggleFlip }, [icon('flip'), 'Mirror']);
    var reset = h('button', { type: 'button', class: 'sbtn', onclick: resetDisplay }, [icon('reset'), 'Reset all']);
    var note = h('div', { class: 'note' });
    var el = h('div', {}, [
      h('div', { class: 'ph' }, [h('b', { text: 'Zoom & aspect ratio' })]),
      modeSeg.el, chips, cust,
      bars.el,
      zoom.el, sx.el, sy.el,
      h('div', { class: 'grid2' }, [rotL, rotR, flip, reset]),
      note
    ]);
    return {
      el: el,
      update: function () {
        modeSeg.set(disp.mode === 'aspect' ? '' : disp.mode);
        chipEls.forEach(function (c) { c.classList.toggle('on', disp.mode === 'aspect' && Math.abs(c.__a - disp.aspect) < 0.01); });
        zoom.set(Math.round(disp.zoom * 100));
        sx.set(Math.round(disp.sx * 100));
        sy.set(Math.round(disp.sy * 100));
        flip.classList.toggle('on', disp.flip);
        bars.update();
        var bits = [dispLabel()];
        if (disp.mode === 'fill' && crop.cur && crop.v === targetVideo()) bits.push('bars inside the picture removed');
        if (lastT) bits.push('showing ' + Math.round(lastT.Sx * 100) + '% × ' + Math.round(lastT.Sy * 100) + '%');
        note.textContent = bits.join(' · ');
      }
    };
  }

  function buildBackdropPanel() {
    var b = backdrop();
    var modeSeg = seg([['off', 'Off'], ['ambient', 'Ambient', 'The bars glow with the colours at the picture’s edges'],
      ['blur', 'Blur', 'The bars show a soft, blurred copy of the picture'], ['rgb', 'RGB', 'LED-strip style light around the picture. Works on Netflix and Prime too'],
      ['image', 'Image', 'Your own picture behind the video (choose it in the QualityLock popup)']],
      b.mode, function (m) { setBackdrop({ mode: m }, true); });
    var pctFmt = function (x) { return Math.round(x) + '%'; };
    var inten = slider('Intensity', 0, 100, 1, b.intensity, pctFmt, function (x) { setBackdrop({ intensity: x }, false, true); }, function (x) { setBackdrop({ intensity: x }, true, true); }, 80);
    var soft = slider('Softness', 0, 100, 1, b.blur, pctFmt, function (x) { setBackdrop({ blur: x }, false, true); }, function (x) { setBackdrop({ blur: x }, true, true); }, 50);
    // RGB light: effect, colour (breathe / static), speed (animated ones)
    var fx = h('div', { class: 'chips ar4' });
    var fxEls = [];
    [['wave', 'Wave'], ['cycle', 'Cycle'], ['breathe', 'Breathe'], ['static', 'Static']].forEach(function (f) {
      var c = h('button', { type: 'button', class: 'chip', text: f[1], title: RGB_NAMES[f[0]], onclick: function () { setBackdrop({ rgbEffect: f[0] }, true); } });
      c.__id = f[0]; fxEls.push(c); fx.appendChild(c);
    });
    var color = h('input', { type: 'color', class: 'clr', value: hexOk(b.rgbColor) ? b.rgbColor : '#8a5cff', 'aria-label': 'Light colour' });
    color.addEventListener('input', function () { setBackdrop({ rgbColor: color.value }, false, true); });
    color.addEventListener('change', function () { setBackdrop({ rgbColor: color.value }, true, true); });
    var colorRow = h('label', { class: 'crow' }, [h('span', { text: 'Colour' }), color]);
    var spd = slider('Speed', 1, 100, 1, b.rgbSpeed, pctFmt, function (x) { setBackdrop({ rgbSpeed: x }, false, true); }, function (x) { setBackdrop({ rgbSpeed: x }, true, true); }, 40);
    var rgbBox = h('div', { class: 'grp' }, [fx, colorRow, spd.el]);
    var note = h('div', { class: 'note' });
    var bars = buildBarsControl();
    var el = h('div', {}, [
      h('div', { class: 'ph' }, [h('b', { text: 'Black bar backdrop' })]),
      modeSeg.el, rgbBox, inten.el, soft.el, note, bars.el
    ]);
    return {
      el: el,
      update: function () {
        var c = backdrop();
        modeSeg.set(c.mode);
        inten.set(c.intensity); soft.set(c.blur); spd.set(c.rgbSpeed);
        rgbBox.style.display = c.mode === 'rgb' ? '' : 'none';
        fxEls.forEach(function (x) { x.classList.toggle('on', x.__id === c.rgbEffect); });
        colorRow.style.display = c.rgbEffect === 'breathe' || c.rgbEffect === 'static' ? '' : 'none';
        spd.el.style.display = c.rgbEffect === 'static' ? 'none' : '';
        if (hexOk(c.rgbColor) && tb.root.activeElement !== color && color.value !== c.rgbColor) color.value = c.rgbColor;
        bars.update();
        var v = targetVideo();
        var msg = c.mode === 'rgb' ? 'Lights the black bars like an LED strip behind the screen. Softness spreads the glow.'
          : c.mode === 'image' ? 'Softness blurs the picture. The picture is drawn inside this page, so the site can see it.'
          : 'Fills only the black bars, so the picture itself is never zoomed or cropped.';
        var warnMsg = '';
        if (v && isDrm(v) && bdFrames(c.mode)) warnMsg = 'This video is DRM-protected (Netflix, Prime and similar): browsers don’t let extensions read its frames, so ambient light and blur fill can’t be drawn. RGB light and Image still work.';
        else if (v && doc.fullscreenElement === v && c.mode !== 'off') warnMsg = 'The bare video is fullscreen, which hides everything behind it. Use the toolbar’s fullscreen button instead.';
        else if (c.mode === 'image' && !c.imageAt) warnMsg = 'No picture yet. Choose one in the QualityLock popup → Display → Black bar backdrop.';
        else if (c.mode !== 'off' && !bd.visible && bd.v) msg = 'No black bars right now — the picture already fills the player.';
        note.textContent = warnMsg || msg;
        note.classList.toggle('warn', !!warnMsg);
      }
    };
  }

  function buildPicturePanel() {
    var p = picture();
    var presets = h('div', { class: 'chips' });
    var presetEls = [];
    PICTURE_PRESETS.forEach(function (pr) {
      var c = h('button', { type: 'button', class: 'chip', text: pr.name, onclick: function () { setPicture(presetValues(pr), true); } });
      c.__id = pr.id; presetEls.push(c); presets.appendChild(c);
    });
    var pct = function (x) { return Math.round(x) + '%'; };
    var signed = function (x) { return (x > 0 ? '+' : '') + Math.round(x); };
    var rows = [
      ['brightness', 'Brightness', 40, 160, pct],
      ['contrast', 'Contrast', 40, 160, pct],
      ['saturation', 'Saturation', 0, 200, pct],
      ['gamma', 'Gamma (shadows)', 40, 220, pct],
      ['warmth', 'Warmth (night)', -100, 100, signed],
      ['sharpness', 'Sharpness', 0, 100, pct],
      ['grayscale', 'Grayscale', 0, 100, pct]
    ];
    var sliders = {};
    var els = rows.map(function (r) {
      var key = r[0];
      var s = slider(r[1], r[2], r[3], 1, p[key], r[4], function (x) { var o = {}; o[key] = x; setPicture(o, false); }, function (x) { var o = {}; o[key] = x; setPicture(o, true); }, PICTURE_DEFAULT[key]);
      sliders[key] = s;
      return s.el;
    });
    var cmp = h('button', { type: 'button', class: 'sbtn', title: 'Hold to see the original picture' }, ['Hold to compare']);
    var startCmp = function (e) { e.preventDefault(); pictureBypass = true; applyAll(); cmp.classList.add('on'); };
    var endCmp = function () { if (!pictureBypass) return; pictureBypass = false; applyAll(); cmp.classList.remove('on'); };
    cmp.addEventListener('pointerdown', startCmp);
    cmp.addEventListener('pointerup', endCmp);
    cmp.addEventListener('pointerleave', endCmp);
    var reset = h('button', { type: 'button', class: 'sbtn', onclick: function () { setPicture(presetValues(PICTURE_PRESETS[0]), true); } }, [icon('reset'), 'Reset']);
    var note = h('div', { class: 'note', text: 'Free: brightness below 100% and warmth (drawn as a light tint). Light: contrast, saturation, grayscale, brightness above 100%. Heavy: gamma, and sharpness most of all — keep them at default if playback stutters.' });
    var el = h('div', {}, [h('div', { class: 'ph' }, [h('b', { text: 'Picture' })]), presets].concat(els).concat([h('div', { class: 'grid2' }, [cmp, reset]), note]));
    return {
      el: el,
      update: function () {
        var q = picture();
        for (var k in sliders) sliders[k].set(q[k]);
        var act = activePreset(q);
        presetEls.forEach(function (c) { c.classList.toggle('on', c.__id === act); });
      }
    };
  }

  function openPanel(id) {
    if (tb.panelId === id) { closePanel(); return; }
    closePanel();
    var api = id === 'speed' ? buildSpeedPanel() : id === 'display' ? buildDisplayPanel() : id === 'backdrop' ? buildBackdropPanel() : id === 'picture' ? buildPicturePanel() : null;
    if (!api) return;
    tb.panelId = id;
    tb.panelApi = api;
    tb.panel = h('div', { class: 'panel open', role: 'dialog', 'aria-label': TIPS[id] });
    tb.panel.appendChild(api.el);
    api.el.style.cssText = 'display:flex;flex-direction:column;gap:11px';
    tb.w.appendChild(tb.panel);
    placePanel();
    api.update();
    if (tb.btn[id]) tb.btn[id].classList.add('open');
    hideTip();
  }
  function closePanel() {
    if (tb.panel && tb.panel.parentNode) tb.panel.parentNode.removeChild(tb.panel);
    if (tb.panelId && tb.btn[tb.panelId]) tb.btn[tb.panelId].classList.remove('open');
    tb.panel = null; tb.panelId = ''; tb.panelApi = null;
  }
  function placePanel() {
    if (!tb.panel || !tb.host) return;
    var r = tb.host.getBoundingClientRect();
    var up = r.top + r.height / 2 > G.innerHeight / 2;
    tb.panel.classList.toggle('up', up);
    tb.panel.classList.toggle('down', !up);
    tb.panel.classList.toggle('right', r.left + 306 > G.innerWidth - 8);
    tb.panel.style.maxHeight = Math.max(160, (up ? r.top : G.innerHeight - r.bottom) - 18) + 'px';
  }

  // --- tooltips -----------------------------------------------------
  function attachTip(el, textFn, keyName) {
    el.addEventListener('pointerenter', function () {
      if (tb.tipTimer) G.clearTimeout(tb.tipTimer);
      var key = keyName ? (keyName.charAt(0) === '=' ? keyName.slice(1) : keys[keyName]) : '';
      tb.tipTimer = G.setTimeout(function () { showTip(el, typeof textFn === 'function' ? textFn() : textFn, key); }, 380);
    });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('pointerdown', hideTip);
    el.setAttribute('aria-label', typeof textFn === 'function' ? textFn() : textFn);
  }
  function showTip(el, text, key) {
    if (!tb.tip || tb.panelId || tb.drag) return;
    while (tb.tip.firstChild) tb.tip.removeChild(tb.tip.firstChild);
    tb.tip.appendChild(doc.createTextNode(text));
    if (key) tb.tip.appendChild(h('kbd', { text: key }));
    var wr = tb.w.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    tb.tip.classList.add('show');
    var tw = tb.tip.offsetWidth;
    var left = clamp(er.left + er.width / 2 - tw / 2, 4, G.innerWidth - tw - 4) - wr.left;
    var below = wr.top < 46;
    tb.tip.style.left = left + 'px';
    tb.tip.style.top = (below ? er.bottom - wr.top + 8 : er.top - wr.top - tb.tip.offsetHeight - 8) + 'px';
    tb.tipFor = el;
  }
  function hideTip() {
    if (tb.tipTimer) { G.clearTimeout(tb.tipTimer); tb.tipTimer = 0; }
    if (tb.tip) tb.tip.classList.remove('show');
    tb.tipFor = null;
  }

  // --- build --------------------------------------------------------
  function tbSig() {
    return [cfg.toolbar.theme, cfg.toolbar.layout, cfg.toolbar.accent, cfg.toolbar.primary, cfg.toolbar.secondary,
      cfg.playback.seekStep, JSON.stringify(cfg.toolbar.buttons)].join('|');
  }

  function tbBuild() {
    if (!tb.host) {
      tb.host = h('div', { 'data-qlock-toolbar': '' });
      tb.root = tb.host.attachShadow({ mode: 'open' });
      adopt(tb.root, TB_CSS);
      // Keep our clicks, keys and wheel turns away from the player under us.
      ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu', 'touchstart', 'touchend', 'keydown', 'keyup', 'keypress']
        .forEach(function (t) { tb.host.addEventListener(t, function (e) { e.stopPropagation(); }); });
      tb.root.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePanel(); } });
    }
    tb.sig = tbSig();
    closePanel();
    while (tb.root.firstChild) tb.root.removeChild(tb.root.firstChild);
    tb.btn = {};
    var theme = ['dark', 'light', 'glass'].indexOf(cfg.toolbar.theme) !== -1 ? cfg.toolbar.theme : 'glass';
    tb.w = h('div', { class: 'w t-' + theme + (cfg.toolbar.layout === 'expanded' ? ' x' : '') + (tb.shown ? '' : ' hide') });
    accentVars(tb.w);
    tb.bar = h('div', { class: 'bar', role: 'toolbar', 'aria-label': 'QualityLock video controls' });
    tb.tl = buildTimeline();
    tb.row = h('div', { class: 'row' });

    var grip = h('button', { type: 'button', class: 'b grip', 'aria-label': 'Drag to move' }, [icon('grip')]);
    attachTip(grip, 'Drag to move · QualityLock ' + VERSION);
    grip.addEventListener('pointerdown', startDrag);
    tb.row.appendChild(grip);

    var step = String(cfg.playback.seekStep);
    cfg.toolbar.buttons.forEach(function (b) {
      if (!b.on) return;
      var id = b.id;
      var btn;
      btn = h('button', { type: 'button', class: 'b' });
      if (id === 'back' || id === 'fwd') setIcon(btn, id, step);
      else if (id === 'speed') { setIcon(btn, 'speed'); btn.appendChild(h('span', { class: 'lb', text: '1×' })); }
      else setIcon(btn, id === 'fullscreen' ? 'fullscreen' : id);
      if (id === 'speed' && cfg.toolbar.layout !== 'expanded') btn.removeChild(btn.querySelector('svg'));
      var tipFn = id === 'back' ? 'Back ' + step + ' s' : id === 'fwd' ? 'Forward ' + step + ' s'
        : id === 'loop' ? function () { return loop.a === null ? 'A-B loop: set start (A)' : loop.b === null ? 'A-B loop: set end (B)' : 'Clear A-B loop'; }
        : id === 'stats' ? TIPS.stats : TIPS[id];
      attachTip(btn, tipFn, id === 'stats' ? '=Alt+Shift+N' : TIP_KEYS[id]);
      btn.addEventListener('click', function () { buttonAction(id); });
      if (PANELS[id]) btn.setAttribute('aria-haspopup', 'dialog');
      tb.btn[id] = btn;
      tb.row.appendChild(btn);
    });

    tb.md = h('span', { class: 'md' });
    tb.row.appendChild(tb.md);
    tb.row.appendChild(h('span', { class: 'sep' }));
    var lay = h('button', { type: 'button', class: 'b' }, [icon('layout')]);
    attachTip(lay, function () { return cfg.toolbar.layout === 'expanded' ? 'Compact layout' : 'Expanded layout (timeline)'; });
    lay.addEventListener('click', function () {
      cfg.toolbar.layout = cfg.toolbar.layout === 'expanded' ? 'compact' : 'expanded';
      postPatch({ toolbar: { layout: cfg.toolbar.layout } });
      tbBuild(); tbUpdate(true);
    });
    tb.row.appendChild(lay);
    var close = h('button', { type: 'button', class: 'b' }, [icon('close')]);
    attachTip(close, 'Hide toolbar', 'toggle-video-hud');
    close.addEventListener('click', function () { setToolbar(false); });
    tb.row.appendChild(close);

    tb.bar.appendChild(tb.tl);
    tb.bar.appendChild(tb.row);
    tb.tip = h('div', { class: 'tip', role: 'tooltip' });
    tb.w.appendChild(tb.bar);
    tb.w.appendChild(tb.tip);
    tb.root.appendChild(tb.w);
  }

  function buttonAction(id) {
    var v = targetVideo();
    if (PANELS[id]) { openPanel(id); return; }
    if (id === 'play') togglePlay(v);
    else if (id === 'back') seekBy(v, -cfg.playback.seekStep);
    else if (id === 'fwd') seekBy(v, cfg.playback.seekStep);
    else if (id === 'fill') toggleFill();
    else if (id === 'rotate') rotateBy(90);
    else if (id === 'loop') loopCycle(v);
    else if (id === 'snapshot') snapshot(v);
    else if (id === 'lights') { if (lights.on) lightsOff(); else lightsOn(); }
    else if (id === 'pip') togglePip(v);
    else if (id === 'winfs') toggleWinfs(v);
    else if (id === 'fullscreen') toggleFullscreen(v);
    else if (id === 'stats') { core.toggleNerds(); }
    refreshUi();
  }

  function buildTimeline() {
    var cur = h('span', { class: 'tm', text: '0:00' });
    var dur = h('span', { class: 'tm r', text: '0:00', title: 'Click: elapsed / remaining' });
    dur.addEventListener('click', function () { tb.remaining = !tb.remaining; tbUpdate(true); });
    var rail = h('div', { class: 'rail' });
    var played = h('div', { class: 'pl' });
    var ab = h('div', { class: 'ab', style: 'display:none' });
    var knob = h('div', { class: 'kn' });
    var cv = h('canvas', { width: 160, height: 90 });
    var pt = h('span', { text: '0:00' });
    var pv = h('div', { class: 'pv no' }, [cv, pt]);
    rail.appendChild(ab);
    rail.appendChild(played);
    var sk = h('div', { class: 'sk', role: 'slider', tabindex: 0, 'aria-label': 'Seek' }, [rail, knob, pv]);
    var bufEls = [];

    function timeAt(x) {
      var v = targetVideo();
      var r = sk.getBoundingClientRect();
      var f = clamp((x - r.left) / Math.max(1, r.width), 0, 1);
      return { v: v, f: f, t: v && isFinite(v.duration) ? f * v.duration : 0, x: x - r.left, w: r.width };
    }
    function hover(x) {
      var a = timeAt(x);
      if (!a.v || !isFinite(a.v.duration)) { pv.style.display = 'none'; return; }
      pv.style.display = '';
      pv.style.left = clamp(a.x, 84, a.w - 84 > 84 ? a.w - 84 : 84) + 'px';
      pt.textContent = fmt(a.t) + (a.v ? '  ·  ' + (a.t >= a.v.currentTime ? '+' : '−') + fmt(Math.abs(a.t - a.v.currentTime)) : '');
      var vh = a.v.videoWidth ? Math.round(160 * a.v.videoHeight / a.v.videoWidth) : 90;
      if (cv.height !== vh) cv.height = vh;
      var ok = thumbs.draw(a.v, a.t, cv);
      pv.classList.toggle('no', !ok);
    }
    var dragging = false;
    sk.addEventListener('pointermove', function (e) { hover(e.clientX); if (dragging) { var a = timeAt(e.clientX); if (a.v) seekTo(a.v, a.t); } });
    sk.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      dragging = true; sk.classList.add('drag');
      try { sk.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      var a = timeAt(e.clientX);
      if (a.v) seekTo(a.v, a.t);
    });
    var end = function (e) { dragging = false; sk.classList.remove('drag'); try { sk.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ } };
    sk.addEventListener('pointerup', end);
    sk.addEventListener('pointercancel', end);
    sk.addEventListener('keydown', function (e) {
      var v = targetVideo();
      if (!v) return;
      if (e.key === 'ArrowLeft') { seekBy(v, -5); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { seekBy(v, 5); e.preventDefault(); }
    });

    tb.seek = {
      update: function (v) {
        var d = v && isFinite(v.duration) ? v.duration : 0;
        var t = v ? v.currentTime : 0;
        var live = v && !isFinite(v.duration);
        cur.textContent = fmt(t);
        dur.textContent = live ? 'LIVE' : tb.remaining ? '−' + fmt(d - t) : fmt(d);
        dur.title = d ? 'Ends at ' + clockAt((d - t) / Math.max(0.07, v.playbackRate || 1)) + (v.playbackRate !== 1 ? ' at ' + fmtRate(v.playbackRate) : '') + ' · click: elapsed / remaining' : '';
        var f = d ? t / d : 0;
        played.style.width = (f * 100).toFixed(2) + '%';
        knob.style.left = (f * 100).toFixed(2) + '%';
        sk.setAttribute('aria-valuetext', fmt(t) + (d ? ' of ' + fmt(d) : ''));
        var n = 0;
        if (v && d) {
          try {
            for (var i = 0; i < v.buffered.length && i < 12; i++, n++) {
              if (!bufEls[n]) { bufEls[n] = h('div', { class: 'buf' }); rail.insertBefore(bufEls[n], ab); }
              bufEls[n].style.display = '';
              bufEls[n].style.left = (v.buffered.start(i) / d * 100).toFixed(2) + '%';
              bufEls[n].style.width = ((v.buffered.end(i) - v.buffered.start(i)) / d * 100).toFixed(2) + '%';
            }
          } catch (e) { /* ignore */ }
        }
        for (; n < bufEls.length; n++) bufEls[n].style.display = 'none';
        if (d && loop.a !== null) {
          var bEnd = loop.b !== null ? loop.b : t;
          ab.style.display = '';
          ab.style.left = (loop.a / d * 100).toFixed(2) + '%';
          ab.style.width = (Math.max(0.3, (bEnd - loop.a) / d * 100)).toFixed(2) + '%';
        } else ab.style.display = 'none';
      }
    };
    return h('div', { class: 'tl' }, [cur, sk, dur]);
  }

  // --- drag + placement --------------------------------------------
  function startDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    var grip = e.currentTarget;
    var r = tb.host.getBoundingClientRect();
    tb.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    hideTip();
    function move(ev) {
      if (!tb.drag) return;
      var v = targetVideo();
      var R = visibleBox(v);
      var w = tb.host.offsetWidth, hh = tb.host.offsetHeight;
      var left = clamp(ev.clientX - tb.drag.dx, 0, G.innerWidth - w);
      var top = clamp(ev.clientY - tb.drag.dy, 0, G.innerHeight - hh);
      tb.pos.fx = R.width - w > 0 ? clamp((left - R.left) / (R.width - w), 0, 1) : 0.5;
      tb.pos.fy = R.height - hh > 0 ? clamp((top - R.top) / (R.height - hh), 0, 1) : 0;
      placeToolbar(v);
    }
    function up() {
      tb.drag = null;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.removeEventListener('lostpointercapture', up);
      try { G.localStorage.setItem('__qlock_tbpos', JSON.stringify(tb.pos)); } catch (x) { /* ignore */ }
      placePanel();
    }
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    // The grip can be rebuilt mid-drag; without this the toolbar stayed pinned.
    grip.addEventListener('lostpointercapture', up);
  }

  function visibleBox(v) {
    var vr = viewportRect();
    if (!v) return vr;
    var r = playerBox(v).rect;
    var left = Math.max(r.left, 0), top = Math.max(r.top, 0);
    var right = Math.min(r.left + r.width, vr.width), bottom = Math.min(r.top + r.height, vr.height);
    if (right - left < 60 || bottom - top < 40) return vr;
    return { left: left, top: top, width: right - left, height: bottom - top };
  }

  function placeToolbar(v) {
    if (!tb.host) return;
    var R = visibleBox(v);
    var w = tb.host.offsetWidth, hh = tb.host.offsetHeight;
    var maxW = Math.max(220, R.width - 12);
    tb.bar.style.maxWidth = maxW + 'px';
    var left = R.left + tb.pos.fx * Math.max(0, R.width - w);
    var top = R.top + tb.pos.fy * Math.max(0, R.height - hh);
    left = clamp(left, 4, Math.max(4, G.innerWidth - w - 4));
    top = clamp(top, 4, Math.max(4, G.innerHeight - hh - 4));
    tb.host.style.setProperty('left', left.toFixed(0) + 'px', 'important');
    tb.host.style.setProperty('top', top.toFixed(0) + 'px', 'important');
    tb.w.classList.toggle('pv-below', top < 150);
  }

  // --- visibility -----------------------------------------------------
  var ptr = { x: -1, y: -1, at: 0, inWin: false };
  function bigEnough(v, box) {
    if (box.fs) return true;
    var r = box.rect;
    if (r.width < 300 || r.height < 168) return false;
    return r.width * r.height >= 0.16 * G.innerWidth * G.innerHeight;
  }

  function setToolbar(onOff, quiet) {
    tb.enabled = onOff;
    if (onOff) { tb.force = now() + 3500; ptr.at = now(); }
    else closePanel();
    tbUpdate(true);
    var k = keys['toggle-video-hud'];
    if (!quiet) osd(onOff ? 'Toolbar on' : 'Toolbar hidden', onOff ? (k ? k + ' hides it' : '') : (k ? k + ' brings it back' : 'Bring it back from the QualityLock popup'), 'layout');
  }

  function idleMs() { return (cfg.toolbar.autoHide > 0 ? cfg.toolbar.autoHide : 3) * 1000; }

  var idleAttr = false;
  function setIdleCursor(idle) {
    if (idle === idleAttr || !doc.documentElement) return;
    idleAttr = idle;
    if (idle) { ensureDocCss(); doc.documentElement.setAttribute('data-qlock-idle', ''); }
    else doc.documentElement.removeAttribute('data-qlock-idle');
  }

  var lastUiAt = 0;
  function tbUpdate(full) {
    var v = on() ? targetVideo() : null;
    if (!v) {
      if (tb.host && tb.host.isConnected) { closePanel(); tb.host.parentNode.removeChild(tb.host); }
      tb.shown = false;
      setIdleCursor(false);
      return;
    }
    var box = playerBox(v);
    var fsLike = box.fs;
    var t = now();
    var idle = t - ptr.at;
    var overVideo = ptr.inWin && pointIn(box.rect, ptr.x, ptr.y);
    // Read from the pointer position, not enter/leave events: those go missing
    // when the toolbar is re-mounted under a still pointer (fullscreen, window
    // fill), which left it stuck on screen.
    var overTb = tb.shown && ptr.inWin && !!tb.bar && pointIn(tb.bar.getBoundingClientRect(), ptr.x, ptr.y);
    var pinned = !!tb.panelId || !!tb.drag || t < tb.force;
    // Auto-hide: shown while the mouse moves over the video, gone once it rests.
    // Resting on the toolbar itself gets a few seconds more to read tooltips.
    var want = tb.enabled && bigEnough(v, box) &&
      (cfg.toolbar.show === 'always' || pinned || (overTb ? idle < idleMs() + 5000 : overVideo && idle < idleMs()));

    // Idle cursor in fullscreen / window fill.
    setIdleCursor(cfg.mouse.hideCursor && fsLike && overVideo && !pinned && !overTb && idle > Math.max(2000, idleMs()));

    if (!want && !tb.host) return;
    if (!tb.host || tb.sig !== tbSig()) tbBuild();
    if (want && !tb.host.isConnected) {
      tb.host.style.cssText = 'all:initial;position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;' +
        'overflow:visible;display:block;width:auto;height:auto;z-index:2147483647;';
      if (!core.mountOnTop(tb.host)) return;
      full = true;
    }
    if (!tb.host.isConnected) return;
    if (want !== tb.shown) {
      tb.shown = want;
      tb.w.classList.toggle('hide', !want);
      tb.host.style.setProperty('pointer-events', want ? 'auto' : 'none', 'important');
      if (!want) { hideTip(); }
    }
    if (!want && !full) return;
    placeToolbar(v);
    if (tb.panel) placePanel();
    if (!full && t - lastUiAt < 200) return;
    lastUiAt = t;
    refreshButtons(v);
  }

  function refreshButtons(v) {
    var B = tb.btn;
    if (B.play) { setIcon(B.play, v.paused ? 'play' : 'pause'); B.play.setAttribute('aria-label', v.paused ? 'Play' : 'Pause'); }
    if (B.speed) {
      var lb = B.speed.querySelector('.lb');
      if (lb) lb.textContent = fmtRate(v.playbackRate || 1);
      B.speed.classList.toggle('on', Math.abs((v.playbackRate || 1) - 1) > 0.001);
    }
    if (B.fill) B.fill.classList.toggle('on', disp.mode === 'fill');
    if (B.display) B.display.classList.toggle('on', disp.mode !== 'original' && disp.mode !== 'fill' || Math.abs(disp.zoom - 1) > 0.004 || Math.abs(disp.sx - 1) > 0.004 || Math.abs(disp.sy - 1) > 0.004 || disp.rot !== 0 || disp.flip);
    if (B.backdrop) B.backdrop.classList.toggle('on', backdrop().mode !== 'off');
    if (B.picture) B.picture.classList.toggle('on', !pictureIsDefault(picture()));
    if (B.rotate) B.rotate.classList.toggle('on', disp.rot !== 0);
    if (B.loop) B.loop.classList.toggle('on', loop.a !== null);
    if (B.lights) B.lights.classList.toggle('on', lights.on);
    if (B.pip) B.pip.classList.toggle('on', doc.pictureInPictureElement === v);
    if (B.winfs) B.winfs.classList.toggle('on', winfs.on);
    if (B.fullscreen) setIcon(B.fullscreen, doc.fullscreenElement ? 'exitFs' : 'fullscreen');
    if (B.stats) B.stats.classList.toggle('on', !!(core.nerdsOn && core.nerdsOn()));
    if (tb.md) tb.md.textContent = disp.mode === 'original' && !disp.rot && !disp.flip && Math.abs(disp.zoom - 1) < 0.004 && Math.abs(disp.sx - 1) < 0.004 && Math.abs(disp.sy - 1) < 0.004 ? '' : dispLabel();
    if (cfg.toolbar.layout === 'expanded' && tb.seek) tb.seek.update(v);
    if (tb.panelApi) tb.panelApi.update();
  }

  function refreshUi() { if (tb.host) tbUpdate(true); }

  // Pointer tracking (cheap; the work happens in one animation frame).
  var uiRaf = 0;
  function onPointer(e) {
    // Only real movement counts: page scripts and hover updates can send
    // pointermove without the pointer moving, which kept the toolbar up.
    if (!e.isTrusted || (e.type === 'pointermove' && ptr.inWin && e.clientX === ptr.x && e.clientY === ptr.y)) return;
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.at = now(); ptr.inWin = true;
    if (!uiRaf) uiRaf = G.requestAnimationFrame(function () { uiRaf = 0; tbUpdate(false); });
  }
  G.addEventListener('pointermove', onPointer, { capture: true, passive: true });
  G.addEventListener('pointerdown', function (e) {
    onPointer(e);
    if (tb.panelId && !inToolbar(e)) closePanel();
  }, { capture: true, passive: true });
  G.addEventListener('pointerout', function (e) { if (!e.relatedTarget) { ptr.inWin = false; } }, { capture: true, passive: true });
  G.addEventListener('blur', function () { ptr.inWin = false; });
  G.addEventListener('resize', function () { requestApply(); tbUpdate(true); });
  G.addEventListener('scroll', function () { if (tb.shown) tbUpdate(false); }, { capture: true, passive: true });

  G.setInterval(function () {
    if (!on()) { if (tb.host || idleAttr) tbUpdate(true); return; }
    if (tb.shown || tb.panelId || cfg.toolbar.show === 'always' || now() - ptr.at < idleMs() + 8000) tbUpdate(false);
    // Remember frames for timeline previews while the expanded layout is in use.
    var v = tb.enabled && cfg.toolbar.layout === 'expanded' ? targetVideo() : null;
    if (v) thumbs.sample(v);
  }, 250);

  // ==================================================================
  // Mouse: wheel volume, right-button + wheel, side buttons seek
  // ==================================================================
  var mouse = { right: false, rightUsed: false, acc: 0, accAt: 0 };
  function overVideoAt(v, x, y) { return v && pointIn(playerBox(v).rect, x, y); }

  G.addEventListener('wheel', function (e) {
    if (!on() || e.ctrlKey || inToolbar(e)) return;
    var v = targetVideo();
    if (!v || !overVideoAt(v, e.clientX, e.clientY)) return;
    var fsLike = !!doc.fullscreenElement || winfs.on;
    var use = (mouse.right && cfg.mouse.rightWheel) || cfg.mouse.wheelVolume === 'always' || (cfg.mouse.wheelVolume === 'fullscreen' && fsLike);
    if (!use) return;
    e.preventDefault();
    e.stopPropagation();
    if (mouse.right) mouse.rightUsed = true;
    // Trackpads send many small deltas: add them up into steps.
    var dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (now() - mouse.accAt > 400) mouse.acc = 0;
    mouse.accAt = now();
    mouse.acc += dy;
    if (Math.abs(mouse.acc) < 50) return;
    var dir = mouse.acc < 0 ? 1 : -1;
    mouse.acc = 0;
    changeVolume(v, dir * cfg.mouse.volumeStep / 100);
  }, { capture: true, passive: false });

  // Which way a mouse button seeks: -1 back, 1 forward, 0 not bound. The left
  // and right buttons are never taken over.
  function seekDir(b) {
    if (b === 0 || b === 2) return 0;
    return b === cfg.mouse.seekBackButton ? -1 : b === cfg.mouse.seekFwdButton ? 1 : 0;
  }

  function sideButtonOk(e) {
    if (!on() || cfg.mouse.sideButtons === 'off' || inToolbar(e)) return null;
    var v = targetVideo();
    if (!v || !(isFinite(v.duration) && v.duration > 0)) return null;
    var fsLike = !!doc.fullscreenElement || winfs.on;
    if (cfg.mouse.sideButtons === 'page' || fsLike || overVideoAt(v, e.clientX, e.clientY)) return v;
    return null;
  }

  G.addEventListener('mousedown', function (e) {
    if (e.button === 2) {
      var v = on() && cfg.mouse.rightWheel ? targetVideo() : null;
      mouse.right = !!(v && overVideoAt(v, e.clientX, e.clientY));
      mouse.rightUsed = false;
    } else {
      var dir = seekDir(e.button);
      var sv = dir && sideButtonOk(e);
      if (!sv) return;
      e.preventDefault(); // also stops middle-click autoscroll
      e.stopPropagation();
      seekBy(sv, dir * cfg.playback.seekStep);
    }
  }, true);
  // Back / forward navigation (and middle-click link opening) fires on the
  // release; cancel it there too.
  ['mouseup', 'pointerup', 'auxclick'].forEach(function (t) {
    G.addEventListener(t, function (e) {
      if (e.button === 2 && t === 'mouseup') {
        mouse.right = false;
        if (mouse.rightUsed) G.setTimeout(function () { mouse.rightUsed = false; }, 400);
      }
      if (seekDir(e.button) && sideButtonOk(e)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  });
  G.addEventListener('contextmenu', function (e) {
    if (mouse.rightUsed) { e.preventDefault(); e.stopPropagation(); mouse.rightUsed = false; mouse.right = false; }
  }, true);

  // ==================================================================
  // Keyboard (in-page nudges; the rest are extension commands)
  // ==================================================================
  G.addEventListener('keydown', function (e) {
    if (!on()) return;
    var tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.key === 'Escape' && !doc.fullscreenElement && !(inToolbar(e) && tb.panelId)) {
      if (winfs.on) { winfsOff(); e.preventDefault(); e.stopPropagation(); return; }
      if (lights.on) { lightsOff(); return; }
    }
    if (inToolbar(e)) return;
    if (!(e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey)) return;
    if (!targetVideo()) return;
    var done = true;
    if (e.key === '+' || e.key === '=') setZoom(disp.zoom + 0.05);
    else if (e.key === '_' || e.key === '-') setZoom(disp.zoom - 0.05);
    else if (e.key === 'ArrowUp') setStretch('y', disp.sy + 0.05);
    else if (e.key === 'ArrowDown') setStretch('y', disp.sy - 0.05);
    else if (e.key === 'ArrowRight') setStretch('x', disp.sx + 0.05);
    else if (e.key === 'ArrowLeft') setStretch('x', disp.sx - 0.05);
    else if (e.key === ')' || e.code === 'Digit0') resetDisplay();
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ==================================================================
  // Toolbar input shield
  // ==================================================================
  // Some players (often embeds, mostly in fullscreen) grab every click with a
  // capture listener and stop it before it reaches anything else, which made the
  // toolbar dead. Our window listener runs before any page script's, so events
  // aimed at the toolbar are stopped here and replayed inside its shadow root as
  // non-composed copies the page can't see. The real event's default action
  // (focus, slider dragging, typing) still happens.
  var SHIELD = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'mousemove',
    'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel', 'keydown', 'keyup', 'keypress', 'input',
    'touchstart', 'touchmove', 'touchend'];
  var COPY_KEYS = ['clientX', 'clientY', 'screenX', 'screenY', 'pageX', 'pageY', 'offsetX', 'offsetY', 'movementX', 'movementY',
    'button', 'buttons', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'detail', 'pointerId', 'pointerType', 'isPrimary',
    'width', 'height', 'pressure', 'deltaX', 'deltaY', 'deltaZ', 'deltaMode', 'key', 'code', 'location', 'repeat',
    'data', 'inputType'];
  function shield(e) {
    if (e.__qlockCopy || !tb.host || !tb.host.isConnected || !tb.root || !inToolbar(e)) return;
    var target = e.composedPath()[0];
    e.stopImmediatePropagation();
    if (e.type === 'wheel' || e.type === 'contextmenu') e.preventDefault();
    if (!target || target === tb.host || !tb.root.contains(target)) return;
    var init = { bubbles: e.bubbles, cancelable: e.cancelable, composed: false };
    for (var i = 0; i < COPY_KEYS.length; i++) if (COPY_KEYS[i] in e) init[COPY_KEYS[i]] = e[COPY_KEYS[i]];
    var copy;
    try { copy = new e.constructor(e.type, init); } catch (x) { copy = new G.Event(e.type, init); }
    try { Object.defineProperty(copy, '__qlockCopy', { value: true }); } catch (x) { copy.__qlockCopy = true; }
    target.dispatchEvent(copy);
  }
  SHIELD.forEach(function (t) { G.addEventListener(t, shield, { capture: true, passive: false }); });

  // ==================================================================
  // Actions from the popup, commands and the bridge
  // ==================================================================
  function num(p, k, d) { return p && typeof p[k] === 'number' && isFinite(p[k]) ? p[k] : d; }

  function handleAction(action, p) {
    if (p && p.keys && typeof p.keys === 'object') {
      keys = {};
      for (var k in p.keys) if (typeof p.keys[k] === 'string') keys[k] = p.keys[k];
    }
    var v = targetVideo();
    switch (action) {
      case 'setKeys': return;
      case 'toggleHud':
      case 'toggleToolbar': setToolbar(!tb.enabled || !tb.shown); return;
      case 'cycle': cycleQuick(); return;
      case 'zoomIn': setZoom(disp.zoom + 0.05); return;
      case 'zoomOut': setZoom(disp.zoom - 0.05); return;
      case 'reset': resetDisplay(); return;
      case 'setMode': setMode(String(p && p.mode), num(p, 'aspect', 0)); return;
      case 'setAspect': setMode('aspect', num(p, 'aspect', 16 / 9)); return;
      case 'fixRatio': setMode('fill'); return;
      case 'stretchFill': setMode('stretch'); return;
      case 'preset169': setMode('aspect', 16 / 9); return;
      case 'preset219': setMode('aspect', 64 / 27); return;
      case 'toggleFill': toggleFill(); return;
      case 'setZoom': setZoom(num(p, 'zoom', 1), true); return;
      case 'setStretchX': setStretch('x', num(p, 'scaleX', 1), true); return;
      case 'setStretchY': setStretch('y', num(p, 'scaleY', 1), true); return;
      case 'rotateCw': rotateBy(90); return;
      case 'rotateCcw': rotateBy(-90); return;
      case 'flip': toggleFlip(); return;
      case 'setInner': setInner(num(p, 'inner', 0)); return;
      case 'setBars': setBars(num(p, 't', disp.barT), num(p, 'l', disp.barL), !!(p && p.quiet)); return;
      case 'setBarLink': disp.barLink = !!(p && p.on); if (disp.barLink) setBars(disp.barT, disp.barT, true); saveDisp(); refreshUi(); return;
      case 'pictureLive': if (p && p.picture) setPicture(p.picture, false); return;
      case 'pictureCompare': pictureBypass = !!(p && p.on); applyAll(); return;
      case 'backdropLive': if (p && p.backdrop) setBackdrop(p.backdrop, false, true); return;
      case 'cycleBackdrop': cycleBackdrop(); return;
      case 'setSpeed': setSpeed(num(p, 'speed', 1), !!(p && p.quiet)); return;
      case 'speedUp': stepSpeed(1); return;
      case 'speedDown': stepSpeed(-1); return;
      case 'speedReset': setSpeed(1); return;
      case 'seekBack': seekBy(v, -cfg.playback.seekStep); return;
      case 'seekFwd': seekBy(v, cfg.playback.seekStep); return;
      case 'togglePlay': togglePlay(v); return;
      case 'toggleMute': toggleMute(v); return;
      case 'setVolume': setVolume(v, num(p, 'volume', 1), true); return;
      case 'pip': togglePip(v); return;
      case 'fullscreen': toggleFullscreen(v); return;
      case 'winfs': toggleWinfs(v); return;
      case 'lights': if (lights.on) lightsOff(); else lightsOn(); return;
      case 'snapshot': snapshot(v); return;
      case 'loop': loopCycle(v); return;
      case 'toggleStats': core.toggleNerds(); refreshUi(); return;
      default: return;
    }
  }

  function snapshotState() {
    var v = targetVideo();
    var b = backdrop();
    var s = {
      hasVideo: !!v,
      drm: isDrm(v),
      display: { mode: disp.mode, aspect: disp.aspect, zoom: disp.zoom, sx: disp.sx, sy: disp.sy, rot: disp.rot, flip: disp.flip,
        label: dispLabel(), effX: lastT ? lastT.Sx : 1, effY: lastT ? lastT.Sy : 1, cropDetected: !!(crop.cur && crop.v === v), inner: disp.inner, barT: disp.barT, barL: disp.barL, barLink: disp.barLink, cropBlocked: !!(crop.blocked && crop.v === v) || isDrm(v) },
      backdrop: { mode: b.mode, intensity: b.intensity, blur: b.blur, drawing: !!bd.v, visible: bd.visible,
        imageLoaded: !!bd.img && bd.imgAt === b.imageAt,
        blocked: v ? (isDrm(v) && bdFrames(b.mode) ? 'drm' : doc.fullscreenElement === v ? 'bare-fullscreen' : '') : '' },
      picture: picture(),
      toolbar: { enabled: tb.enabled, shown: tb.shown },
      accent: accent(),
      winfs: winfs.on, lights: lights.on, pip: !!doc.pictureInPictureElement, fullscreen: !!doc.fullscreenElement,
      loop: { a: loop.a, b: loop.b }
    };
    if (v) {
      s.playback = { rate: v.playbackRate, paused: v.paused, volume: getVolume(v), muted: isMuted(v),
        time: v.currentTime, duration: isFinite(v.duration) ? v.duration : null };
    }
    return s;
  }

  function onSettings() {
    var prevShow = cfg.toolbar.show;
    var prevRemember = cfg.display.rememberPerSite;
    refreshCfg();
    if (livePicture && (now() - livePictureAt > 2500 || JSON.stringify(livePicture) === JSON.stringify(cfg.picture))) livePicture = null;
    if (liveBackdrop && (now() - liveBackdropAt > 2500 || JSON.stringify(liveBackdrop) === JSON.stringify(cfg.backdrop))) liveBackdrop = null;
    if (cfg.toolbar.show !== prevShow) tb.enabled = cfg.toolbar.show !== 'manual';
    if (cfg.display.rememberPerSite && !prevRemember) saveDisp();
    if (!cfg.display.rememberPerSite && prevRemember) { try { G.localStorage.removeItem(DISP_KEY); } catch (e) { /* ignore */ } }
    if (!on()) { winfsOff(); lightsOff(); setIdleCursor(false); }
    applyAll();
    tbUpdate(true);
  }

  var tickN = 0;
  // The extension was reloaded or updated: this copy keeps running in the page
  // until it's refreshed, so take everything down and say so.
  core.hooks.retire = function () {
    if (retired) return;
    retired = true;
    closePanel();
    winfsOff(); lightsOff(); setIdleCursor(false);
    stylerRelease(); bdTeardown();
    if (tb.host && tb.host.parentNode) tb.host.parentNode.removeChild(tb.host);
    osd('QualityLock was updated', 'Refresh this page to use the new version', 'reset');
  };
  core.hooks.settings = onSettings;
  core.hooks.action = handleAction;
  core.hooks.snapshot = snapshotState;
  core.hooks.fullscreen = function () {
    closePanel();
    if (doc.fullscreenElement && winfs.on) winfsOff();
    applyAll();
    tbUpdate(true);
  };
  core.hooks.tick = function () {
    tickN++;
    if (tickN % 5 === 0 && tb.shown) refreshDynamic();
    applyAll();
    if (disp.mode === 'fill' || disp.mode === 'stretch' || backdrop().mode !== 'off') cropSample(targetVideo());
    if (idleAttr || tb.host) ensureDocCss();
  };

  loadDisp();
  if (cfg.display.rememberPerSite && disp.mode !== 'original') G.setTimeout(applyAll, 500);
})();
