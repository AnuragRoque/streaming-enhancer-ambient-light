// QualityLock player: subtitles (used by local.js).
//
// Subtitle files (.srt, .vtt, .ass, .ssa) from disk, from the folder a video came
// from, from inside the video (MKV text tracks and Blu-ray picture tracks, read
// by local-mkv.js and local-pgs.js), or downloaded from OpenSubtitles. This page draws them itself, not the
// browser's captions, so they can be moved in time: a delay, or the sync list,
// where clicking the line being spoken lines every line up with the video.
//
// window.qlockSubs(ctx) → api. ctx gives the shared bits of local.js:
//   video(), videoFile(), toast(), flash(), el(), item(), chips(), closeMenu(), showUi()
(function () {
  'use strict';

  var SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
  var REACT = 0.3; // seconds between hearing a line and clicking it

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(t) {
    var neg = t <= -1;
    t = Math.floor(Math.abs(t));
    var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (neg ? '−' : '') + (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtDelay(d) {
    var a = Math.abs(d);
    return d === 0 ? 'Original timing' : a.toFixed(a < 10 ? 1 : 0) + ' s ' + (d > 0 ? 'later' : 'earlier');
  }
  function save(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* storage blocked */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function bareName(name) { return name.replace(/\.[^.]+$/, ''); }

  // ==================================================================
  // Reading and parsing
  // ==================================================================
  var ENCODINGS = [['', 'Auto'], ['windows-1251', 'Cyrillic'], ['windows-1256', 'Arabic'], ['windows-1250', 'Central European'],
    ['windows-1253', 'Greek'], ['windows-1254', 'Turkish'], ['windows-1255', 'Hebrew'], ['windows-874', 'Thai'],
    ['gbk', 'Chinese, simplified'], ['big5', 'Chinese, traditional'], ['shift_jis', 'Japanese'], ['euc-kr', 'Korean']];
  // Older subtitle files are rarely UTF-8. Without a byte-order mark, UTF-8 is
  // tried first and Western (Windows-1252) is the fallback; others by hand.
  function decode(buf, enc) {
    var b = new Uint8Array(buf);
    if (!enc) {
      if (b[0] === 0xFF && b[1] === 0xFE) enc = 'utf-16le';
      else if (b[0] === 0xFE && b[1] === 0xFF) enc = 'utf-16be';
      else {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { enc = 'windows-1252'; }
      }
    }
    return new TextDecoder(enc).decode(b);
  }

  // "01:02:03,456", "02:03.456", ASS "1:02:03.45".
  function parseTime(s) {
    var m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s);
    if (!m) return NaN;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / Math.pow(10, m[4].length);
  }
  // SRT and WebVTT: blocks with a "start --> end" line, then the text.
  function parseSrt(text) {
    var cues = [];
    text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).forEach(function (block) {
      var lines = block.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var a = lines[i].indexOf('-->');
        if (a === -1) continue;
        var start = parseTime(lines[i].slice(0, a)), end = parseTime(lines[i].slice(a + 3));
        var body = lines.slice(i + 1).join('\n').trim();
        if (!isNaN(start) && !isNaN(end) && body) cues.push({ start: start, end: Math.max(end, start + 0.3), text: body });
        return;
      }
    });
    return cues;
  }
  // ASS / SSA: "Dialogue:" lines under [Events], fields named by its "Format:" line.
  function parseAss(text) {
    var cues = [], fmtF = null, events = false;
    text.replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (/^\s*\[events\]/i.test(line)) { events = true; return; }
      if (/^\s*\[/.test(line)) { events = false; return; }
      if (!events) return;
      if (/^format\s*:/i.test(line)) { fmtF = line.replace(/^format\s*:/i, '').split(',').map(function (s) { return s.trim().toLowerCase(); }); return; }
      if (!fmtF || !/^dialogue\s*:/i.test(line)) return;
      var parts = line.replace(/^dialogue\s*:/i, '').split(',');
      var body = parts.slice(fmtF.length - 1).join(',')
        .replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
      var start = parseTime(parts[fmtF.indexOf('start')] || ''), end = parseTime(parts[fmtF.indexOf('end')] || '');
      // Drawings (\p1) leave vector commands as text.
      if (!body || isNaN(start) || isNaN(end) || /^m\s+-?\d/.test(body)) return;
      cues.push({ start: start, end: Math.max(end, start + 0.3), text: body });
    });
    return cues;
  }
  function parse(text, name) {
    var cues = /\.(ass|ssa)$/i.test(name) || /^\s*\[script info\]/i.test(text) ? parseAss(text) : parseSrt(text);
    cues.sort(function (a, b) { return a.start - b.start; });
    cues.forEach(function (c) { c.plain = plain(c.text); });
    return cues.filter(function (c, i) { return !isAd(c.plain, i, cues.length); });
  }
  // Lines subtitle sites put in their files ("Watch Online Movies… www.osdb.link",
  // "Advertise your product or brand here…"), and links or credits in the first
  // and last few lines.
  function isAd(s, i, n) {
    return /osdb\.link|opensubtitles\.(org|com)|advertise your product|become vip member|rate this subtitle/i.test(s) ||
      ((i < 3 || i >= n - 3) && /\bwww\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|\b(subtitles?|subbed|synced?|sync|corrections?|corrected|ripped|encoded) (and corrections )?(by|from)\b/i.test(s));
  }

  var ENT = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: '\'' };
  function entities(s) { return s.replace(/&(amp|lt|gt|nbsp|quot|apos);/g, function (m, n) { return ENT[n]; }); }
  function plain(s) { return entities(s.replace(/\{\\[^}]*\}/g, '').replace(/<[^>]+>/g, '')).replace(/\s*\n\s*/g, ' ').trim(); }
  // Cue text as DOM: one span per line, keeping italic, bold and underline only.
  function cueDom(s, into) {
    s.replace(/\{\\[^}]*\}/g, '').split('\n').forEach(function (line) {
      var span = document.createElement('span');
      span.className = 'ln';
      var stack = [span], re = /<(\/?)([a-z]+)[^>]*>/gi, last = 0, m;
      function text(t) { if (t) stack[stack.length - 1].appendChild(document.createTextNode(entities(t))); }
      while ((m = re.exec(line))) {
        text(line.slice(last, m.index));
        last = re.lastIndex;
        var tag = m[2].toLowerCase();
        if (tag !== 'i' && tag !== 'b' && tag !== 'u') continue;
        if (!m[1]) { var e = document.createElement(tag); stack[stack.length - 1].appendChild(e); stack.push(e); }
        else if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tag) stack.pop();
      }
      text(line.slice(last));
      if (span.textContent.trim()) into.appendChild(span);
    });
  }

  // Language from a file name ("Movie.en.srt", "Movie.English.srt") or a code.
  var names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'language' }); } catch (e) { names = null; }
  function langName(code) {
    if (!code) return '';
    try { return names ? names.of(code) : code; } catch (e) { return code; }
  }
  function userLang() {
    var l = (navigator.language || 'en').toLowerCase();
    if (l === 'pt-br') return 'pt-br';
    if (l.indexOf('pt') === 0) return 'pt-pt';
    if (l === 'zh-tw' || l === 'zh-hk') return 'zh-tw';
    if (l.indexOf('zh') === 0) return 'zh-cn';
    return l.slice(0, 2);
  }

  // ==================================================================
  // The subtitles themselves
  // ==================================================================
  window.qlockSubs = function (ctx) {
    var stage = $('stage'), out = $('subs'), side = $('side'), ccBtn = $('ccBtn'), input = $('subInput');
    var tracks = [];   // { label, name, file?, bytes?, text?, enc, cues?, src: 'file' | 'web' | 'saved' | 'inner', track?, pgs?, picture? }
    var cur = null, last = null, cues = [], offset = 0, shownKey = '', lastK = -2;
    var token = 0;

    var size = load('qlp:subSize') || 'm';
    var look = load('qlp:subLook') || 'outline';
    var SIZES = { s: 0.8, m: 1, l: 1.25, xl: 1.5 };
    function applyLook() {
      out.style.setProperty('--subs', String(SIZES[size] || 1));
      out.classList.toggle('box', look === 'box');
      out.classList.toggle('outline', look !== 'box');
    }
    applyLook();

    function videoKey() { var f = ctx.videoFile(); return f ? f.name + ':' + f.size : ''; }
    // Timing belongs to a subtitle file, so the delay is kept per video and track.
    function delayKey() { return 'qlp:subdelay:' + videoKey() + '|' + (cur ? cur.name : ''); }

    // ---------- timing: which cues are showing ----------
    function cueAt(t) {
      var lo = 0, hi = cues.length - 1, k = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (cues[mid].start <= t) { k = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return k;
    }
    function update(time) {
      var v = ctx.video();
      if (!v || !cur) return;
      var t = (typeof time === 'number' ? time : v.currentTime) - offset;
      var k = cueAt(t);
      var on = [];
      // Overlapping cues: look back a few.
      for (var j = k; j >= 0 && j > k - 6; j--) if (cues[j].end > t) on.unshift(j);
      var key = on.join(',');
      if (key !== shownKey) {
        shownKey = key;
        out.textContent = '';
        if (cur.pgs) showPic(on.map(function (i) { return cues[i]; }));
        else on.forEach(function (i) { cueDom(cues[i].text, out); });
      }
      if (k !== lastK) { lastK = k; syncHighlight(k); }
    }
    // Every presented frame while playing (exact), events when not.
    var pending = 0, pendingAt = 0;
    function schedule() {
      var v = ctx.video();
      if (pending || !v || !cur || v.paused) return;
      pendingAt = Date.now();
      if (v.requestVideoFrameCallback) pending = v.requestVideoFrameCallback(function (now, meta) { pending = 0; update(meta.mediaTime); schedule(); });
      else pending = requestAnimationFrame(function () { pending = 0; update(); schedule(); });
    }
    // A frame callback can be lost when the video's source changes.
    function unstick() {
      var v = ctx.video();
      if (!pending || Date.now() - pendingAt < 1500 || !v) return;
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(pending); else cancelAnimationFrame(pending);
      pending = 0;
    }
    var wired = null;
    function wire(v) {
      if (wired === v) return;
      wired = v;
      v.addEventListener('play', schedule);
      ['seeked', 'pause', 'timeupdate', 'loadedmetadata'].forEach(function (t) { v.addEventListener(t, function () { unstick(); update(); schedule(); }); });
      v.addEventListener('resize', repaintPic);
      picWatch.observe(v, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    function clearOut() { out.textContent = ''; shownKey = ''; lastK = -2; if (picOn.length) showPic([]); }

    // ---------- picture subtitles (PGS): drawn over the video ----------
    // The disc's frame (the subtitles' own size) is laid over the picture,
    // covering it, centred: a movie cropped to 2.40:1 gets its subtitles back
    // in the black bars, where the disc has them. Kept on screen, and above the
    // control bar while it shows; Size scales them about their bottom middle.
    var pic = $('subpic'), picCtx = pic.getContext('2d'), picOn = [], picCache = new Map();
    function showPic(list) { picOn = list; paintPic(); }
    function partCanvas(part) {
      var c = picCache.get(part);
      if (!c) {
        c = window.qlockPgs.picture(part);
        picCache.set(part, c);
        if (picCache.size > 16) picCache.delete(picCache.keys().next().value);
      }
      return c;
    }
    function paintPic() {
      var W = stage.clientWidth, H = stage.clientHeight, r = window.devicePixelRatio || 1;
      var cw = Math.round(W * r), ch = Math.round(H * r);
      if (pic.width !== cw || pic.height !== ch) { pic.width = cw; pic.height = ch; }
      picCtx.setTransform(1, 0, 0, 1, 0, 0);
      picCtx.clearRect(0, 0, cw, ch);
      var v = ctx.video();
      if (!picOn.length || !v || !v.videoWidth) return;
      // Where the picture is: the video box (with player.js's zoom), then its object-fit.
      var sr = stage.getBoundingClientRect(), vr = v.getBoundingClientRect(), fit = getComputedStyle(v).objectFit;
      var bx = vr.left - sr.left, by = vr.top - sr.top, bw = vr.width, bh = vr.height;
      if (fit !== 'fill') {
        var f = (fit === 'cover' ? Math.max : Math.min)(bw / v.videoWidth, bh / v.videoHeight);
        bx += (bw - v.videoWidth * f) / 2;
        by += (bh - v.videoHeight * f) / 2;
        bw = v.videoWidth * f;
        bh = v.videoHeight * f;
      }
      var low = H - (stage.classList.contains('idle') ? 8 : 138), z = SIZES[size] || 1;
      picCtx.setTransform(r, 0, 0, r, 0, 0);
      picCtx.imageSmoothingQuality = 'high';
      picOn.forEach(function (scr) {
        var s = Math.max(bw / scr.w, bh / scr.h), ox = bx + (bw - scr.w * s) / 2, oy = by + (bh - scr.h * s) / 2;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        scr.parts.forEach(function (p) {
          var c = p.crop || p.obj;
          x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x + c.w); y1 = Math.max(y1, p.y + c.h);
        });
        var k = s * z, mid = (x0 + x1) / 2, cx = ox + mid * s, bottom = oy + y1 * s, top = bottom - (y1 - y0) * k;
        var dy = bottom > low ? low - bottom : 0;
        if (top + dy < 8) dy = 8 - top;
        scr.parts.forEach(function (p) {
          var c = p.crop || { x: 0, y: 0, w: p.obj.w, h: p.obj.h };
          if (!c.w || !c.h) return;
          picCtx.drawImage(partCanvas(p), c.x, c.y, c.w, c.h, cx + (p.x - mid) * k, bottom + dy - (y1 - p.y) * k, c.w * k, c.h * k);
        });
      });
    }
    // Drawn again when the stage, the picture or its zoom change, and as the control bar comes and goes.
    function repaintPic() { if (picOn.length) paintPic(); }
    if (window.ResizeObserver) new ResizeObserver(repaintPic).observe(stage);
    new MutationObserver(repaintPic).observe(stage, { attributes: true, attributeFilter: ['class'] });
    var picWatch = new MutationObserver(repaintPic);
    function refresh() {
      clearOut();
      update();
      schedule();
      ccBtn.classList.toggle('on', !!cur);
      ccBtn.setAttribute('data-tip', cur ? 'Subtitles: ' + cur.label + ' (C)' : 'Subtitles (C)');
    }

    // ---------- tracks ----------
    function addTrack(t) {
      for (var i = 0; i < tracks.length; i++) if (tracks[i].name === t.name && tracks[i].src === t.src) return tracks[i];
      t.enc = t.enc || '';
      tracks.push(t);
      return t;
    }
    function fileLabel(name) {
      var m = /[._ -]([a-z]{2,3}|[a-z]{4,12})\.(srt|vtt|ass|ssa)$/i.exec(name);
      var l = m ? langName(m[1].toLowerCase()) : '';
      return l && l.toLowerCase() !== m[1].toLowerCase() ? l + ' · ' + name : name;
    }
    function loadCues(t) {
      if (t.src === 'inner') return loadInner(t);
      if (t.cues) return Promise.resolve(t.cues);
      var p = t.text ? Promise.resolve(null) : t.bytes ? Promise.resolve(t.bytes) : t.file.arrayBuffer().then(function (b) { t.bytes = b; return b; });
      return p.then(function (bytes) {
        if (bytes) t.text = decode(bytes, t.enc);
        t.cues = parse(t.text, t.name);
        if (!t.cues.length) throw new Error('No subtitle lines found in “' + t.name + '”.');
        return t.cues;
      });
    }
    // Resolves true once the track shows.
    function select(t, quiet) {
      var my = token;
      return loadCues(t).then(function (c) {
        if (my !== token) return false;
        cur = last = t;
        cues = c;
        offset = parseFloat(load(delayKey())) || 0;
        refresh();
        if (side.dataset.kind === 'sync') { if (t.pgs) closeSide(); else openSync(); }
        // The file's own tracks are read from it again; others are kept with their text.
        remember(t.src === 'inner' ? { name: t.name, label: t.label, src: t.src } : { name: t.name, label: t.label, text: t.text, enc: t.enc, src: t.src });
        if (!quiet) ctx.flash(null, 'Subtitles: ' + t.label);
        return true;
      }).catch(function (e) { ctx.toast(e.message || 'Couldn’t read those subtitles.'); return false; });
    }
    function off(keep) {
      cur = null;
      cues = [];
      refresh();
      if (side.dataset.kind === 'sync') closeSide();
      if (keep) remember({ off: true });
    }

    // The subtitles picked for each video are kept (text included), so a movie
    // opened again comes back with them. The 40 most recent.
    function remember(rec) {
      var key = videoKey();
      if (!key || !chrome.storage) return;
      var k = 'qlp:sub:' + key;
      rec.at = Date.now();
      chrome.storage.local.get('qlp:subIndex', function (r) {
        void chrome.runtime.lastError;
        var index = ((r && r['qlp:subIndex']) || []).filter(function (x) { return x !== k; });
        index.push(k);
        var drop = index.length > 40 ? index.splice(0, index.length - 40) : [];
        var o = {};
        o[k] = rec;
        o['qlp:subIndex'] = index;
        chrome.storage.local.set(o, function () { void chrome.runtime.lastError; });
        if (drop.length) chrome.storage.local.remove(drop, function () { void chrome.runtime.lastError; });
      });
    }

    // A new video: its sidecar files and the subtitle tracks inside it (own: a
    // promise of { file, info } from qlockMkv, or null). Then what was picked for
    // it last time, else a sidecar file, else the file's forced or default track.
    function attach(sidecars, own) {
      token++;
      var my = token;
      tracks = [];
      cur = last = null;
      cues = [];
      closeSide();
      stopInner();
      offset = 0;
      var v = ctx.video();
      if (v) wire(v);
      (sidecars || []).forEach(function (f) { addTrack({ label: fileLabel(f.name), name: f.name, file: f, src: 'file' }); });
      refresh();
      var k = 'qlp:sub:' + videoKey();
      // Storage that doesn't answer (it happens with a damaged profile) mustn't keep the defaults away.
      var saved = new Promise(function (res) {
        chrome.storage.local.get(k, function (r) { void chrome.runtime.lastError; res(r && r[k]); });
        setTimeout(res, 1500);
      });
      own = Promise.resolve(own);
      own.then(function (src) { if (my === token && src) addInner(src); });
      Promise.all([saved, own]).then(function (a) {
        if (my !== token) return;
        var rec = a[0];
        if (rec && rec.off) return;
        if (rec && (rec.text || rec.src === 'inner')) {
          var same = tracks.filter(function (t) { return t.name === rec.name; })[0];
          if (same) { same.enc = rec.enc || ''; select(same, true); return; }
          if (rec.text) { select(addTrack({ label: rec.label || rec.name, name: rec.name, text: rec.text, src: 'saved' }), true); return; }
        }
        var files = tracks.filter(function (t) { return t.src === 'file'; });
        if (files.length) { select(preferred(files), true); return; }
        var inside = tracks.filter(function (t) { return t.src === 'inner' && !t.picture; });
        var pick = inside.filter(function (t) { return t.track.forced; })[0] || inside.filter(function (t) { return t.track.def; })[0];
        if (pick) select(pick, true);
      });
    }
    function preferred(list) {
      var code = userLang().slice(0, 2), lname = (langName(code) || '').toLowerCase();
      for (var i = 0; i < list.length; i++) {
        var n = list[i].name.toLowerCase();
        if (new RegExp('[._ -](' + code + '|' + lname + ')[._ -]').test(n)) return list[i];
      }
      return list[0];
    }

    // ---------- the video's own subtitle tracks (MKV) ----------
    // Text tracks, and Blu-ray picture tracks (PGS, local-pgs.js). DVD ones
    // (VobSub) are listed but can't be shown.
    var TEXT_CODEC = /^S_TEXT\/(UTF8|ASS|SSA|WEBVTT)$/, PGS_CODEC = /^S_HDMV\/PGS$/;
    var inner = null; // { file, info, tracks, job, ready, progress }
    function addInner(src) {
      var M = window.qlockMkv;
      inner = { file: src.file, info: src.info, tracks: [], job: null, ready: null, progress: 1 };
      src.info.tracks.filter(function (s) { return s.type === M.SUBTITLE; }).forEach(function (s, i) {
        var lang = langName(M.langCode(s)), name = s.name;
        var label = name && lang && name.toLowerCase().indexOf(lang.toLowerCase()) === -1 ? lang + ' · ' + name : name || lang || 'Track ' + (i + 1);
        if (s.forced && !/forced/i.test(label)) label += ' (forced)';
        var pgs = PGS_CODEC.test(s.codec) && !!window.qlockPgs;
        inner.tracks.push(addTrack({ label: label, name: 'track' + s.num, src: 'inner', track: s, pgs: pgs, picture: !pgs && !TEXT_CODEC.test(s.codec) }));
      });
      refresh();
    }
    function dvd(t) { return t.track && t.track.codec === 'S_VOBSUB'; }
    function stopInner() {
      if (inner && inner.job) inner.job.cancel();
      inner = null;
    }
    // All of the video's text tracks are read in one go, the first time one is
    // picked. Through the file's index that takes a moment; when it has to be
    // read through, the first lines show while the rest are still coming.
    function loadInner(t) {
      if (t.picture) return Promise.reject(new Error('“' + t.label + '” is a ' + (dvd(t) ? 'DVD ' : '') + 'picture subtitle track, which this player can’t show.'));
      var my = inner;
      if (!my || my.tracks.indexOf(t) === -1) return Promise.reject(new Error('That track belongs to another video.'));
      if (!my.job) readInner();
      return my.ready.then(function () {
        if (my.done && !t.cues.length) throw new Error('No subtitle lines found in “' + t.label + '”.');
        return t.cues;
      });
    }
    function readInner() {
      var M = window.qlockMkv, my = inner, chain = Promise.resolve(), byNum = {};
      var text = my.tracks.filter(function (t) { return !t.picture; });
      text.forEach(function (t) { t.cues = []; if (t.pgs) t.blocks = []; byNum[t.track.num] = t; });
      var release;
      my.ready = new Promise(function (res) { release = res; });
      my.job = M.subtitles(my.file, my.info, text.map(function (t) { return t.track.num; }), function (blocks) {
        chain = chain.then(function () {
          return Promise.all(blocks.map(function (b) { return M.unpack(byNum[b.track].track, b.data).catch(function () { return null; }); }));
        }).then(function (data) {
          if (inner !== my) return;
          var grew = {};
          blocks.forEach(function (b, i) {
            var t = byNum[b.track];
            if (!data[i]) return;
            if (t.pgs) { t.blocks.push({ start: b.start, data: data[i] }); grew[b.track] = true; } else addLine(t, b, data[i]);
          });
          text.forEach(function (t) {
            if (!t.pgs) { settle(t); return; }
            // Display sets build on the ones before, so a picture track is gone through again from the top.
            if (!grew[t.track.num]) return;
            t.blocks.sort(function (a, b) { return a.start - b.start; });
            t.cues.length = 0;
            Array.prototype.push.apply(t.cues, window.qlockPgs.screens(t.blocks));
          });
          if (cur && cur.src === 'inner') { clearOut(); update(); }
        });
      }, function (f) {
        my.progress = f;
        if (!my.scanning && f < 1) {
          my.scanning = true;
          release();
          ctx.toast('Reading the subtitles from the file. Lines show up as it goes.', null, null, 5000);
        }
      });
      my.job.promise.then(function () { return chain; }).catch(function () {}).then(function () {
        my.done = true;
        my.progress = 1;
        release();
      });
    }
    var utf8 = new TextDecoder('utf-8');
    function addLine(t, b, data) {
      var s = utf8.decode(data);
      if (/ASS|SSA/.test(t.track.codec)) {
        // ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        s = s.split(',').slice(8).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim();
        if (/^m\s+-?\d/.test(s)) return;
      } else s = s.replace(/\r\n?/g, '\n').trim();
      if (!s) return;
      var c = { start: b.start, end: b.end, text: s, open: b.end < 0 };
      if (c.open) c.end = c.start + 5;
      c.plain = plain(s);
      t.cues.push(c);
    }
    // In time order (they come almost so), and lines without an end last until the next.
    function settle(t) {
      var c = t.cues, i;
      for (i = 1; i < c.length; i++) if (c[i].start < c[i - 1].start) { c.sort(function (a, b) { return a.start - b.start; }); break; }
      for (i = 0; i < c.length - 1; i++) if (c[i].open) c[i].end = Math.min(c[i].start + 5, c[i + 1].start);
    }

    function addFiles(files, pick) {
      var added = [];
      Array.prototype.forEach.call(files, function (f) {
        if (SUB_EXT.test(f.name)) added.push(addTrack({ label: fileLabel(f.name), name: f.name, file: f, src: 'file' }));
      });
      if (pick && added.length) select(added[0]);
      return added.length;
    }
    input.addEventListener('change', function () {
      if (input.files && input.files.length && !addFiles(input.files, true)) ctx.toast('Those aren’t subtitle files (.srt, .vtt, .ass, .ssa).');
      input.value = '';
    });

    // ---------- delay ----------
    function setOffset(d, how) {
      offset = Math.round(clamp(d, -3600, 3600) * 1000) / 1000;
      save(delayKey(), offset ? offset : null);
      clearOut();
      update();
      document.querySelectorAll('[data-delay]').forEach(function (e) { e.textContent = fmtDelay(offset); });
      syncTimes();
      ctx.flash(null, how === 'synced' ? 'Subtitles synced: ' + fmtDelay(offset) : offset ? 'Subtitles ' + fmtDelay(offset) : 'Subtitles: original timing');
    }
    function nudge(d) { if (cur) setOffset(offset + d); }
    function delayRow() {
      var row = ctx.el('div', 'delay');
      function btn(text, tip, fn) {
        var b = ctx.el('button', 'db', text);
        b.type = 'button';
        b.title = tip;
        b.addEventListener('click', fn);
        return b;
      }
      row.appendChild(btn('−0.1', 'Show subtitles earlier (G)', function () { nudge(-0.1); }));
      var val = ctx.el('span', 'dv', fmtDelay(offset));
      val.setAttribute('data-delay', '');
      row.appendChild(val);
      row.appendChild(btn('+0.1', 'Show subtitles later (H)', function () { nudge(0.1); }));
      row.appendChild(btn('Reset', 'Back to the file’s own timing', function () { setOffset(0); }));
      return row;
    }

    // ---------- menu (the CC button) ----------
    function menu(m) {
      m.appendChild(ctx.el('h3', '', 'Subtitles'));
      m.appendChild(ctx.item('Off', !cur, function () { ctx.closeMenu(); off(true); }));
      tracks.forEach(function (t) {
        var tag = t.src === 'web' ? 'OpenSubtitles' : t.src === 'saved' ? 'saved' : t.src !== 'inner' ? '' : t.picture ? (dvd(t) ? 'DVD picture' : 'picture') + ', can’t show'
          : inner && inner.scanning && !inner.done ? 'reading ' + Math.floor(inner.progress * 100) + '%' : 'in the file';
        m.appendChild(ctx.item(t.label, t === cur, function () { ctx.closeMenu(); select(t); }, tag ? ctx.el('span', 'd', tag) : null));
      });
      m.appendChild(ctx.el('hr'));
      m.appendChild(ctx.item('Load a subtitle file…', false, function () { ctx.closeMenu(); input.click(); }));
      m.appendChild(ctx.item('Search OpenSubtitles…', false, function () { ctx.closeMenu(); openSearch(); }));
      if (!cur) return;
      m.appendChild(ctx.el('hr'));
      m.appendChild(ctx.el('h3', '', 'Timing'));
      m.appendChild(delayRow());
      // Pictures have no text to sync by or restyle.
      if (!cur.pgs) m.appendChild(ctx.item('Sync by clicking the line you hear…', false, function () { ctx.closeMenu(); openSync(); }));
      m.appendChild(ctx.el('h3', '', 'Size'));
      m.appendChild(ctx.chips([['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']], function (o) { return o[0] === size; },
        function (o) { size = o[0]; save('qlp:subSize', size); applyLook(); repaintPic(); }));
      if (cur.pgs) return;
      m.appendChild(ctx.el('h3', '', 'Style'));
      m.appendChild(ctx.chips([['outline', 'Outline'], ['box', 'Dark box']], function (o) { return o[0] === look; },
        function (o) { look = o[0]; save('qlp:subLook', look); applyLook(); }));
      if (cur.bytes || cur.file) {
        m.appendChild(ctx.el('h3', '', 'Text looks wrong? Encoding'));
        var sel = ctx.el('select', 'sel');
        ENCODINGS.forEach(function (e) { var o = ctx.el('option', '', e[1]); o.value = e[0]; sel.appendChild(o); });
        sel.value = cur.enc || '';
        sel.addEventListener('change', function () {
          var t = cur;
          t.enc = sel.value;
          t.text = null;
          t.cues = null;
          select(t, true);
        });
        var wrap = ctx.el('div', 'selrow');
        wrap.appendChild(sel);
        m.appendChild(wrap);
      }
    }

    function showable() { return tracks.filter(function (t) { return !t.picture; }); }
    function toggle() {
      if (cur) { off(true); ctx.flash(null, 'Subtitles off'); return; }
      var t = last || showable()[0];
      if (t) select(t);
      else ctx.toast('No subtitles yet: load a file or search OpenSubtitles from the CC button.', 'Search', openSearch);
    }
    function cycle() {
      var list = showable();
      if (!list.length) { toggle(); return; }
      var i = cur ? list.indexOf(cur) : -1;
      if (i === list.length - 1) { off(true); ctx.flash(null, 'Subtitles off'); } else select(list[i + 1]);
    }

    // ==================================================================
    // Side panel: the sync list and OpenSubtitles
    // ==================================================================
    function openSide(kind, title, build) {
      side.textContent = '';
      side.dataset.kind = kind;
      var head = ctx.el('div', 'sh');
      head.appendChild(ctx.el('strong', '', title));
      var x = ctx.el('button', 'b sx', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', closeSide);
      head.appendChild(x);
      side.appendChild(head);
      var body = ctx.el('div', 'sbody');
      side.appendChild(body);
      build(body);
      side.hidden = false;
      stage.classList.add('side-open');
      ctx.showUi();
    }
    function closeSide() {
      if (side.hidden) return;
      side.hidden = true;
      side.textContent = '';
      side.dataset.kind = '';
      stage.classList.remove('side-open');
      syncRows = null;
    }

    // ---------- sync list ----------
    // Every line with its time, like song lyrics; the current one follows the
    // video. Clicking the line being said right now moves all of them to match.
    var syncRows = null, syncList = null, scrolledAt = 0;
    function openSync() {
      if (!cur || cur.pgs) return;
      openSide('sync', 'Sync subtitles', function (body) {
        body.appendChild(ctx.el('p', 'hint', 'Play the video. When you hear a line start, click it: every line moves to match. ▶ jumps to a line.'));
        body.appendChild(delayRow());
        var find = ctx.el('input', 'find');
        find.type = 'search';
        find.placeholder = 'Find a line you hear…';
        body.appendChild(find);
        syncList = ctx.el('div', 'slist');
        var frag = document.createDocumentFragment();
        syncRows = cues.map(function (c, i) {
          var row = ctx.el('div', 'srow');
          row.dataset.i = String(i);
          row.appendChild(ctx.el('span', 'st', fmt(c.start + offset)));
          row.appendChild(ctx.el('span', 'stx', c.plain));
          var j = ctx.el('button', 'sj', '▶');
          j.type = 'button';
          j.title = 'Jump here';
          row.appendChild(j);
          frag.appendChild(row);
          return row;
        });
        syncList.appendChild(frag);
        body.appendChild(syncList);
        syncList.addEventListener('click', function (e) {
          var row = e.target.closest('.srow');
          var v = ctx.video();
          if (!row || !v) return;
          var c = cues[+row.dataset.i];
          if (e.target.closest('.sj')) { v.currentTime = Math.max(0, c.start + offset - 0.2); return; }
          setOffset(v.currentTime - REACT - c.start, 'synced');
          scrolledAt = 0;
        });
        ['wheel', 'pointerdown', 'keydown'].forEach(function (t) { syncList.addEventListener(t, function () { scrolledAt = Date.now(); }, { passive: true }); });
        find.addEventListener('input', function () {
          var q = find.value.trim().toLowerCase();
          syncRows.forEach(function (r, i) { r.hidden = !!q && cues[i].plain.toLowerCase().indexOf(q) === -1; });
          if (!q) { scrolledAt = 0; syncHighlight(lastK, true); }
        });
        find.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeSide(); } });
        lastK = -2;
        update();
      });
    }
    function syncTimes() {
      if (!syncRows) return;
      syncRows.forEach(function (r, i) { r.firstChild.textContent = fmt(cues[i].start + offset); });
    }
    function syncHighlight(k, force) {
      if (!syncRows) return;
      var prevOn = syncList.querySelector('.srow.on');
      if (prevOn) prevOn.classList.remove('on');
      var row = syncRows[Math.max(0, k)];
      if (!row) return;
      if (k >= 0) row.classList.add('on');
      // Follows the video, unless the list was scrolled by hand a moment ago.
      if ((force || Date.now() - scrolledAt > 5000) && !row.hidden) {
        syncList.scrollTop = row.offsetTop - syncList.clientHeight / 2 + row.offsetHeight / 2;
      }
    }

    // ---------- Online search ----------
    // OpenSubtitles.org's own search, which needs no account or key: by the
    // file's hash (exact matches for this very file) and by title. If it can't
    // be reached, Stremio's OpenSubtitles addon (a smaller share of the same
    // library, looked up by IMDb id through Stremio's catalogue) stands in.
    var ORG = 'https://rest.opensubtitles.org/search/';
    var ORG_HEADERS = { 'X-User-Agent': 'TemporaryUserAgent' };
    var STREMIO_SUBS = 'https://opensubtitles-v3.strem.io/subtitles/';
    var STREMIO_META = 'https://v3-cinemeta.strem.io/catalog/';
    // The picker's languages and their OpenSubtitles codes; the first is the one searched for.
    var LANGS = {
      en: 'eng', es: 'spa spl spn', fr: 'fre fra', de: 'ger deu', it: 'ita', 'pt-pt': 'por', 'pt-br': 'pob', nl: 'dut nld',
      ru: 'rus', uk: 'ukr', pl: 'pol', cs: 'cze ces', ro: 'rum ron', hu: 'hun', el: 'ell gre', tr: 'tur', ar: 'ara', he: 'heb',
      fa: 'per fas', hi: 'hin', bn: 'ben', ta: 'tam', te: 'tel', ml: 'mal', mr: 'mar', ur: 'urd', id: 'ind', ms: 'may msa',
      vi: 'vie', th: 'tha', 'zh-cn': 'chi zho zhe', 'zh-tw': 'zht', ja: 'jpn', ko: 'kor', sv: 'swe', da: 'dan', no: 'nor nob',
      fi: 'fin', hr: 'hrv', sr: 'scc srp', bg: 'bul'
    };
    var LANG_OF = {};
    Object.keys(LANGS).forEach(function (c) { LANGS[c].split(' ').forEach(function (k) { LANG_OF[k] = c; }); });
    function subLang(code) { return langName(LANG_OF[code] || code) || code; }
    var FORMATS = /^(srt|vtt|ass|ssa)$/i;
    // Releases recorded in a cinema: their subtitles are usually rough and timed for that copy only.
    var CINEMA = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr)\b/;

    var cache = {};
    function getJson(url, headers) {
      if (!cache[url]) {
        cache[url] = fetch(url, { headers: Object.assign({ Accept: 'application/json' }, headers) }).then(function (r) {
          if (!r.ok) throw new Error('The subtitle service answered ' + r.status + '. Try again in a moment.');
          return r.json();
        }, function () { throw new Error('Can’t reach the subtitle service. Check the connection.'); });
        cache[url].catch(function () { delete cache[url]; });
      }
      return cache[url];
    }
    function norm(s) {
      return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ').trim();
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    // OpenSubtitles' hash: the size plus the first and last 64 KiB as 64-bit sums.
    function movieHash(file) {
      var CH = 65536;
      if (!file || file.size < CH * 2 || typeof BigInt === 'undefined') return Promise.resolve('');
      return Promise.all([file.slice(0, CH).arrayBuffer(), file.slice(file.size - CH).arrayBuffer()]).then(function (parts) {
        var h = BigInt(file.size);
        parts.forEach(function (b) {
          var dv = new DataView(b);
          for (var i = 0; i < CH; i += 8) h = BigInt.asUintN(64, h + dv.getBigUint64(i, true));
        });
        return h.toString(16).padStart(16, '0');
      }).catch(function () { return ''; });
    }
    // "Show.Name.S01E02.1080p.WEB.x264" → title "Show Name", season 1, episode 2.
    function nameInfo(name) {
      var s = bareName(name).replace(/[._]+/g, ' ');
      var se = /\bS(\d{1,2})\s?E(\d{1,3})\b/i.exec(s) || /\b(\d{1,2})x(\d{2,3})\b/.exec(s);
      var yr = /\b(19[2-9]\d|20[0-4]\d)\b/.exec(s);
      var tag = /\b(2160p|1080p|720p|480p|4k|web[- ]?dl|webrip|web|bluray|blu ray|brrip|bdrip|hdrip|dvdrip|hdtv|x264|x265|h ?26[45]|hevc|10bit|aac|ddp?5 ?1|proper|repack|extended|uncut|remastered)\b/i.exec(s);
      var cut = s.length;
      [se, yr, tag].forEach(function (m) { if (m && m.index > 0 && m.index < cut) cut = m.index; });
      var title = s.slice(0, cut).replace(/[[({].*$/, '').replace(/\s+/g, ' ').trim() || s.trim();
      return { title: title, year: yr ? +yr[1] : 0, season: se ? +se[1] : 0, episode: se ? +se[2] : 0 };
    }
    // What the search box asks for: "Title 2010", "Show S01E02", or an IMDb id.
    function queryInfo(text) {
      var s = text.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      var tt = /\btt(\d{5,10})\b/.exec(s);
      var se = /\bS(\d{1,2})\s?E(\d{1,3})\b/i.exec(s) || /\b(\d{1,2})x(\d{2,3})\b/.exec(s);
      if (se) s = (s.slice(0, se.index) + ' ' + s.slice(se.index + se[0].length)).trim();
      var yr = /\s(19[2-9]\d|20[0-4]\d)$/.exec(s);
      var title = (yr ? s.slice(0, yr.index) : s).replace(/[\/\\?#&=]+/g, ' ').trim();
      return { id: tt ? tt[1] : '', full: s, title: title, year: yr ? +yr[1] : 0, ep: se ? { season: +se[1], episode: +se[2] } : null };
    }

    // Both sources give rows of one shape: the subtitle, and the film or episode it is for (its "work").
    function searchOrg(w, lang, file) {
      var code = lang ? LANGS[lang].split(' ')[0] : '';
      // The parameters go in alphabetical order.
      function get(parts) {
        if (code) parts.push('sublanguageid-' + code);
        return getJson(ORG + parts.sort().join('/'), ORG_HEADERS).then(function (j) { return Array.isArray(j) ? j : []; });
      }
      var byName = get(w.id ? ['imdbid-' + w.id]
        : ['query-' + encodeURIComponent(w.title.toLowerCase())].concat(w.ep ? ['season-' + w.ep.season, 'episode-' + w.ep.episode] : []));
      var byHash = movieHash(file).then(function (h) { return h ? get(['moviebytesize-' + file.size, 'moviehash-' + h]) : []; })
        .catch(function () { return []; });
      return Promise.all([byHash, byName]).then(function (a) {
        var seen = {};
        return a[0].concat(a[1]).filter(function (s) { return !seen[s.IDSubtitleFile] && (seen[s.IDSubtitleFile] = true); }).map(function (s) {
          var show = /^"([^"]+)"\s*(.*)$/.exec(s.MovieName || '');
          return {
            key: 'o' + s.IDSubtitleFile,
            work: s.IDMovieImdb,
            name: show ? show[1] : s.MovieName,
            label: show ? show[1] + ' S' + pad(s.SeriesSeason) + 'E' + pad(s.SeriesEpisode) + (show[2] ? ' · ' + show[2] : '')
              : s.MovieName + (+s.MovieYear ? ' (' + s.MovieYear + ')' : ''),
            year: +s.MovieYear || 0,
            release: (s.MovieReleaseName || '').trim() || bareName(s.SubFileName || ''),
            file: s.SubFileName || '',
            lang: s.SubLanguageID,
            langName: s.LanguageName || subLang(s.SubLanguageID),
            format: s.SubFormat,
            cds: +s.SubSumCD || 1,
            downloads: +s.SubDownloadsCnt || 0,
            rating: +s.SubRating || 0,
            trusted: s.SubFromTrusted === '1',
            hi: s.SubHearingImpaired === '1',
            machine: s.SubAutoTranslation === '1',
            bad: +s.SubBad > 0,
            exact: s.MatchedBy === 'moviehash',
            enc: s.SubEncoding,
            url: s.SubDownloadLink,
            gz: true
          };
        });
      });
    }
    function searchStremio(w, lang, file) {
      var find = w.id ? Promise.resolve({ id: 'tt' + w.id, name: 'tt' + w.id })
        : getJson(STREMIO_META + (w.ep ? 'series' : 'movie') + '/top/search=' + encodeURIComponent(w.title) + '.json').then(function (j) {
          var t = norm(w.title), f = norm(w.full);
          return (j.metas || []).filter(function (m) { return /^tt\d+$/.test(m.imdb_id || m.id); }).map(function (m, i) {
            var n = norm(m.name);
            return { m: m, s: (n === f ? 5 : n === t ? 3 : 0) + (w.year && parseInt(m.releaseInfo, 10) === w.year ? 2 : 0) - i / 100 };
          }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.m; })[0];
        });
      return Promise.all([find, movieHash(file)]).then(function (a) {
        var m = a[0], hash = a[1];
        if (!m) return [];
        var id = m.imdb_id || m.id;
        var path = w.ep ? 'series/' + id + ':' + w.ep.season + ':' + w.ep.episode : 'movie/' + id;
        var label = m.name + (w.ep ? ' S' + pad(w.ep.season) + 'E' + pad(w.ep.episode) : m.releaseInfo ? ' (' + m.releaseInfo + ')' : '');
        var codes = lang ? LANGS[lang].split(' ') : null;
        return getJson(STREMIO_SUBS + path + (hash ? '/videoHash=' + hash + '&videoSize=' + file.size : '') + '.json').then(function (j) {
          return (j.subtitles || []).filter(function (s) {
            return s.url && (!codes || codes.indexOf(s.lang) !== -1) && (!w.ep || !s.episode || (+s.season === w.ep.season && +s.episode === w.ep.episode));
          }).map(function (s) {
            return {
              key: 's' + s.id, work: id, name: m.name, label: label, year: parseInt(m.releaseInfo, 10) || 0,
              release: s.movieReleaseName || bareName(s.subtitleFileName || ''), file: s.subtitleFileName || '',
              lang: s.lang, langName: subLang(s.lang), format: 'srt', cds: 1, downloads: 0, rating: 0,
              exact: s.m === 'h', enc: 'UTF-8', url: s.url, gz: false
            };
          });
        });
      });
    }
    function search(w, lang, file) {
      return searchOrg(w, lang, file).then(function (rows) { return { rows: rows, via: 'From OpenSubtitles.org' }; }, function () {
        return searchStremio(w, lang, file).then(function (rows) { return { rows: rows, via: 'From OpenSubtitles, through Stremio' }; });
      });
    }

    // Rows grouped by film or episode, the one the search means first. Inside,
    // the closest to this file first: a hash match, the same release, the most
    // words in common with its name, then downloads, trust and rating. Cinema
    // recordings and machine translations go last; multi-CD sets and formats
    // this player can't read are left out.
    function rank(rows, w, file) {
      var mine = norm(bareName(file.name)), words = mine.split(' ');
      var fromCinema = CINEMA.test(mine), t = norm(w.title), f = norm(w.full);
      var byWork = {}, works = [];
      rows.forEach(function (r) {
        if (!FORMATS.test(r.format) || r.cds > 1 || !r.url) return;
        // Each word of this file's name that the release shares, once.
        var rel = norm(r.release), has = {}, common = 0;
        rel.split(' ').forEach(function (x) { has[x] = true; });
        words.forEach(function (x) { if (has[x]) { common++; has[x] = false; } });
        r.same = !!rel && rel === mine;
        r.low = !!(r.machine || r.bad || (!fromCinema && CINEMA.test(rel)));
        r.score = (r.exact ? 1000 : 0) + (r.same ? 500 : 0) + common * 8 + Math.log10(r.downloads + 1) * 6 +
          (r.trusted ? 6 : 0) + r.rating * 0.5 - (r.hi ? 3 : 0) - (r.low ? 300 : 0);
        var g = byWork[r.work];
        if (!g) {
          var n = norm(r.name);
          g = byWork[r.work] = { label: r.label, rows: [], downloads: 0,
            score: (w.id && r.work === w.id ? 6 : 0) + (n === f || n === t ? 4 : n.indexOf(t) === 0 ? 1 : 0) + (w.year && r.year === w.year ? 2 : 0) };
          works.push(g);
        }
        if (r.exact && !g.exact) { g.exact = true; g.score += 3; }
        g.downloads += r.downloads;
        g.rows.push(r);
      });
      works.forEach(function (g) {
        g.score += Math.log10(g.downloads + 1) * 0.3 + g.rows.length / 100;
        g.rows.sort(function (a, b) { return b.score - a.score; });
      });
      return works.sort(function (a, b) { return b.score - a.score; });
    }

    // "Inception.2010.1080p.BluRay.x264-CtrlHD" → "Inception 2010 1080p BluRay x264-CtrlHD".
    function pretty(s) { return s.replace(/\.(srt|sub|vtt|ass|ssa)$/i, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(); }
    function sourceOf(release) {
      var r = norm(release), res = /\b(2160p|1080p|720p|576p|480p)\b/.exec(r);
      var src = /\b(bluray|blu ray|bdrip|brrip|bdremux)\b/.test(r) ? 'BluRay' : /\b(web dl|webdl|webrip|web)\b/.test(r) ? 'WEB'
        : /\bhdtv\b/.test(r) ? 'TV' : /\b(dvdrip|dvd)\b/.test(r) ? 'DVD' : /\b(cam|camrip|hdcam)\b/.test(r) ? 'Cinema camera'
          : /\b(ts|hdts|telesync|tc|telecine)\b/.test(r) ? 'Cinema copy' : /\b(scr|screener|dvdscr)\b/.test(r) ? 'Screener' : '';
      return [res && res[1], src].filter(Boolean).join(' ');
    }
    function count(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); }
    // "CP1251" → "windows-1251", when the picker knows it; otherwise Auto.
    function encOf(e) {
      var m = /^CP(\d+)$/i.exec(e || ''), name = m ? 'windows-' + m[1] : '';
      return ENCODINGS.some(function (x) { return x[0] === name; }) ? name : '';
    }

    function openSearch() {
      if (!ctx.videoFile()) return;
      openSide('search', 'Subtitles online', function (body) {
        var info = nameInfo(ctx.videoFile().name);
        var form = ctx.el('form', 'osf');
        var top = ctx.el('div', 'osrow');
        var q = ctx.el('input', 'find');
        q.type = 'search';
        q.value = info.title + (info.season ? ' S' + pad(info.season) + 'E' + pad(info.episode) : info.year ? ' ' + info.year : '');
        q.placeholder = 'Movie or show, e.g. Dune 2021 or Dark S01E02';
        q.setAttribute('aria-label', 'Movie or show');
        var go = ctx.el('button', 'btn primary', 'Search');
        go.type = 'submit';
        top.appendChild(q);
        top.appendChild(go);
        form.appendChild(top);
        var opts = ctx.el('div', 'osrow');
        var lang = ctx.el('select', 'sel');
        lang.setAttribute('aria-label', 'Language');
        var any = ctx.el('option', '', 'Any language');
        any.value = '';
        lang.appendChild(any);
        Object.keys(LANGS).forEach(function (c) { var o = ctx.el('option', '', langName(c) || c); o.value = c; lang.appendChild(o); });
        lang.value = load('qlp:subLang') !== null ? load('qlp:subLang') : (LANGS[userLang()] ? userLang() : 'en');
        if (lang.selectedIndex < 0) lang.value = 'en';
        var pick = ctx.el('select', 'sel');
        pick.setAttribute('aria-label', 'Which title');
        pick.title = 'Other titles that match the search';
        pick.hidden = true;
        opts.appendChild(lang);
        opts.appendChild(pick);
        form.appendChild(opts);
        body.appendChild(form);
        var status = ctx.el('p', 'hint');
        body.appendChild(status);
        var results = ctx.el('div', 'oslist');
        body.appendChild(results);
        var foot = ctx.el('p', 'foot');
        body.appendChild(foot);

        q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeSide(); } });
        form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
        lang.addEventListener('change', function () { save('qlp:subLang', lang.value); run(); });
        pick.addEventListener('change', function () { list(works[+pick.value]); });

        var runId = 0, works = [];
        function say(text, warn) {
          status.className = warn ? 'hint warn' : 'hint';
          status.textContent = text;
        }
        function run() {
          var my = ++runId, w = queryInfo(q.value), file = ctx.videoFile();
          works = [];
          pick.hidden = true;
          results.textContent = '';
          if (!w.id && !w.title) { say('Type the name of the movie or show.'); return; }
          say('Searching…');
          search(w, lang.value, file).then(function (res) {
            if (my !== runId) return;
            foot.textContent = res.via;
            works = rank(res.rows, w, file);
            if (!works.length) {
              say('No subtitles found' + (lang.value ? ' in ' + langName(lang.value) : '') + '.' +
                (w.ep || w.id ? ' Check the name.' : ' For a TV episode, add its number, like S01E02.'));
              return;
            }
            pick.textContent = '';
            works.slice(0, 15).forEach(function (g, i) { var o = ctx.el('option', '', g.label); o.value = i; pick.appendChild(o); });
            pick.hidden = works.length < 2;
            list(works[0]);
          }, function (e) { if (my === runId) say(e.message, true); });
        }
        // The first 12, then the rest on request.
        function list(g) {
          results.textContent = '';
          var n = g.rows.length;
          say((n === 1 ? '1 subtitle' : n + ' subtitles') + (works.length < 2 ? ' for ' + g.label : '') + '. Best first.');
          function add(from, to) { g.rows.slice(from, to).forEach(function (r, i) { results.appendChild(resultRow(r, from + i === 0, !lang.value, say)); }); }
          add(0, 12);
          if (n > 12) {
            var more = ctx.el('button', 'btn more', 'Show ' + (n - 12) + ' more');
            more.type = 'button';
            more.addEventListener('click', function () { more.remove(); add(12, n); });
            results.appendChild(more);
          }
          results.scrollTop = 0;
        }
        run();
        setTimeout(function () { q.focus(); q.select(); }, 0);
      });
    }
    function resultRow(r, first, showLang, say) {
      var row = ctx.el('button', 'osr' + (r.low ? ' low' : ''));
      row.type = 'button';
      var badge = r.exact ? 'Exact match for this file' : r.same ? 'Same release as this file' : first && !r.low ? 'Best match' : '';
      if (badge) row.appendChild(ctx.el('span', 'ok', badge));
      var name = ctx.el('span', 'ot', pretty(r.release) || 'Subtitles');
      name.title = name.textContent;
      row.appendChild(name);
      var meta = [];
      if (showLang) meta.push(r.langName);
      if (sourceOf(r.release)) meta.push(sourceOf(r.release));
      if (r.downloads) meta.push(count(r.downloads) + ' downloads');
      if (r.hi) meta.push('hard of hearing');
      if (r.machine) meta.push('machine translated');
      if (r.bad) meta.push('reported as bad');
      if (meta.length) row.appendChild(ctx.el('span', 'om', meta.join(' · ')));
      row.addEventListener('click', function () {
        if (row.disabled) return;
        row.disabled = true;
        say('Downloading…');
        fetch(r.url).then(function (res) {
          if (!res.ok) throw new Error('The download failed (' + res.status + '). Try another one.');
          return res.arrayBuffer();
        }, function () { throw new Error('Can’t reach the subtitle service. Check the connection.'); }).then(function (buf) {
          if (!r.gz) return buf;
          var b = new Uint8Array(buf);
          if (b[0] !== 0x1f || b[1] !== 0x8b) throw new Error('OpenSubtitles didn’t send the file; its download limit for your connection may be used up. Try again later.');
          return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        }).then(function (buf) {
          // The key keeps two languages' files of the same name apart; the extension picks the parser.
          var file = r.file && SUB_EXT.test(r.file) ? r.file : pretty(r.release) + '.' + (FORMATS.test(r.format) ? r.format : 'srt');
          var t = addTrack({ label: r.langName + ' · ' + pretty(r.release), name: r.key + '.' + file, bytes: buf, src: 'web', enc: encOf(r.enc) });
          t.cues = null;
          return select(t).then(function (shown) {
            if (!shown) { say(''); return; }
            Array.prototype.forEach.call(row.parentNode.querySelectorAll('.osr.on'), function (x) { x.classList.remove('on'); });
            row.classList.add('on');
            say('Subtitles on. Out of sync? Try the next one, or Sync from the CC menu.');
          });
        }).catch(function (e) { say(e.message, true); }).then(function () { row.disabled = false; });
      });
      return row;
    }

    return {
      attach: attach,
      addFiles: addFiles,
      menu: menu,
      toggle: toggle,
      cycle: cycle,
      nudge: nudge,
      openSearch: openSearch,
      openSync: openSync,
      closeSide: closeSide,
      sideOpen: function () { return !side.hidden; },
      isSub: function (name) { return SUB_EXT.test(name); }
    };
  };
})();
