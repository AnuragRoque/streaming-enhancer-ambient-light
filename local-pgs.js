// QualityLock player: Blu-ray picture subtitles (PGS, "S_HDMV/PGS" in MKV),
// for local-subs.js.
//
// A PGS track is a run of display sets. Each is a few segments: a composition
// (which objects go where on a frame the size of the disc's video), windows,
// palettes and objects (run-length coded pictures). Objects and palettes last
// for an "epoch", so a later display set can show them again or recolour them.
// screens() turns a track's blocks into timed screens, like text cues;
// picture() draws one part of a screen into a canvas, when it's shown.
//
// window.qlockPgs → { screens, picture }
(function () {
  'use strict';

  var PDS = 0x14, ODS = 0x15, PCS = 0x16, END = 0x80;
  var LONGEST = 10; // seconds, for a last screen nothing clears

  function u16(b, p) { return b[p] << 8 | b[p + 1]; }
  function byte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  // One palette entry (limited-range YCbCr, BT.709 for HD, BT.601 below) as
  // RGBA packed for a little-endian Uint32Array over ImageData.
  function rgba(Y, cr, cb, a, hd) {
    var y = 1.164 * (Y - 16), r, g, b;
    cr -= 128;
    cb -= 128;
    if (hd) { r = y + 1.793 * cr; g = y - 0.213 * cb - 0.533 * cr; b = y + 2.112 * cb; }
    else { r = y + 1.596 * cr; g = y - 0.392 * cb - 0.813 * cr; b = y + 2.017 * cb; }
    return (a << 24 | byte(b) << 16 | byte(g) << 8 | byte(r)) >>> 0;
  }

  // blocks: [{ start, data }] in time order, data being a block's bytes: one
  // or more segments (type, 16-bit size, body). → [{ start, end, w, h, parts }],
  // a part being { x, y, crop, obj: { w, h, rle }, pal }.
  function screens(blocks) {
    var out = [], pals = {}, objs = {}, parts = {}, set = null, w = 1920, h = 1080;
    function close(at) {
      var last = out[out.length - 1];
      if (last && last.end < 0) last.end = Math.min(at, last.start + LONGEST);
    }
    // A display set is done: its composition can now find its objects.
    function finish() {
      if (!set) return;
      var c = set.pcs, shown = [];
      set = null;
      close(c.start);
      c.objects.forEach(function (o) {
        var obj = objs[o.id], pal = pals[c.pal];
        if (obj && pal) shown.push({ x: o.x, y: o.y, crop: o.crop, obj: obj, pal: pal });
      });
      if (shown.length) out.push({ start: c.start, end: -1, w: c.w, h: c.h, parts: shown, text: '', plain: '' });
    }
    blocks.forEach(function (bl) {
      var b = bl.data, p = 0;
      while (p + 3 <= b.length) {
        var type = b[p], n = u16(b, p + 1), d = b.subarray(p + 3, p + 3 + n);
        p += 3 + n;
        if (type === PCS) {
          finish();
          if (d.length < 11) continue;
          w = u16(d, 0) || w;
          h = u16(d, 2) || h;
          // Epoch start: what came before is gone.
          if (d[7] & 0x80) { pals = {}; objs = {}; parts = {}; }
          var c = { start: bl.start, w: w, h: h, pal: d[9], objects: [] }, q = 11;
          for (var i = 0; i < d[10] && q + 8 <= d.length; i++) {
            var o = { id: u16(d, q), x: u16(d, q + 4), y: u16(d, q + 6), crop: null };
            if (d[q + 3] & 0x80 && q + 16 <= d.length) {
              o.crop = { x: u16(d, q + 8), y: u16(d, q + 10), w: u16(d, q + 12), h: u16(d, q + 14) };
              q += 8;
            }
            q += 8;
            c.objects.push(o);
          }
          set = { pcs: c };
        } else if (type === PDS && d.length >= 2) {
          // A new version of a palette: the entries it lists, the rest as they were.
          var pal = pals[d[0]] ? new Uint32Array(pals[d[0]]) : new Uint32Array(256), hd = h > 576;
          for (var k = 2; k + 5 <= d.length; k += 5) pal[d[k]] = rgba(d[k + 1], d[k + 2], d[k + 3], d[k + 4], hd);
          pals[d[0]] = pal;
        } else if (type === ODS && d.length >= 4) {
          // An object can be split over several segments: first, middle…, last.
          var id = u16(d, 0), seq = d[3];
          if (seq & 0x80) {
            if (d.length < 11) continue;
            parts[id] = { w: u16(d, 7), h: u16(d, 9), list: [d.subarray(11)] };
          } else if (parts[id]) parts[id].list.push(d.subarray(4));
          if (seq & 0x40 && parts[id]) {
            var pt = parts[id], len = 0, at = 0;
            pt.list.forEach(function (x) { len += x.length; });
            var rle = new Uint8Array(len);
            pt.list.forEach(function (x) { rle.set(x, at); at += x.length; });
            objs[id] = { w: pt.w, h: pt.h, rle: rle };
            delete parts[id];
          }
        } else if (type === END) finish();
      }
    });
    finish();
    close(Infinity);
    return out;
  }

  // One part of a screen as a canvas the object's size.
  function picture(part) {
    var o = part.obj, W = o.w, H = o.h, cv = document.createElement('canvas');
    cv.width = W || 1;
    cv.height = H || 1;
    if (!W || !H) return cv;
    var img = new ImageData(W, H), px = new Uint32Array(img.data.buffer), pal = part.pal;
    var b = o.rle, n = b.length, p = 0, x = 0, y = 0;
    // A byte is one pixel of that colour; 0 starts a run (or ends the line).
    while (p < n && y < H) {
      var c = b[p++], run = 1;
      if (c === 0) {
        var f = b[p++];
        if (!f) { x = 0; y++; continue; }
        run = f & 0x3F;
        if (f & 0x40) run = run << 8 | b[p++];
        c = f & 0x80 ? b[p++] : 0;
      }
      if (run > W - x) run = W - x;
      var col = pal[c];
      if (col) for (var i = y * W + x, e = i + run; i < e; i++) px[i] = col;
      x += run;
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    return cv;
  }

  window.qlockPgs = { screens: screens, picture: picture };
})();
