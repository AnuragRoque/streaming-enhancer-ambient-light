// QualityLock player: audio tracks Chrome can't decode (Dolby Digital and
// Dolby Digital Plus, common in movie MKVs), decoded here and played through
// Web Audio in step with the video, which then plays with its own audio off.
//
// The track's frames are read from the file a few seconds ahead of the video
// (qlockMkv.audioReader), decoded in a worker (local-ac3-worker.js: FFmpeg's
// decoder compiled to WebAssembly, in vendor/ac3) and scheduled against the
// video's clock. Playing, a stall, a speed change or a drift of more than
// 60 ms lines the schedule up with the video's time again; seeking reads from
// the new place.
//
// window.qlockDecode(video, onError) → { start(file, info, track), stop(), active(), volume(v) }
// window.qlockDecode.can(track): whether a track can be decoded here.
// window.qlockDecode.codecs: [{ test: RegExp on the codec id, open(track) → Promise<decoder> }],
//   a decoder being { decode([Uint8Array]) → Promise<[{ ch, rate, n, pcm } | null]>, reset(), close() },
//   pcm holding the n samples of each channel one after another.
(function () {
  'use strict';

  var AHEAD = 3;     // seconds decoded ahead of the video
  var BATCH = 0.75;  // seconds read and decoded at a time
  var DRIFT = 0.06;  // seconds apart before lining up again
  var LEAD = 0.03;   // seconds from now for the first sound to start
  function noop() {}

  // ---------- the AC-3 / E-AC-3 decoder, in a worker ----------
  function ac3(track) {
    var w = new Worker('local-ac3-worker.js'), seq = 0, waiting = {}, failed = null;
    w.onmessage = function (e) {
      var m = e.data, p = waiting[m.id];
      if (!p) return;
      delete waiting[m.id];
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
    };
    w.onerror = function (e) {
      failed = new Error(e.message || 'The Dolby decoder didn’t start.');
      Object.keys(waiting).forEach(function (k) { waiting[k].reject(failed); });
      waiting = {};
      w.terminate();
    };
    function call(msg, transfer) {
      if (failed) return Promise.reject(failed);
      msg.id = ++seq;
      return new Promise(function (res, rej) {
        waiting[msg.id] = { resolve: res, reject: rej };
        w.postMessage(msg, transfer || []);
      });
    }
    return call({ op: 'open', codec: /^A_EAC3/.test(track.codec) ? 1 : 0 }).then(function () {
      return {
        decode: function (frames) {
          var bufs = frames.map(function (f) { return f.byteOffset === 0 && f.byteLength === f.buffer.byteLength ? f.buffer : f.slice().buffer; });
          return call({ op: 'decode', frames: bufs }, bufs).then(function (m) { return m.out; });
        },
        reset: function () { call({ op: 'reset' }).catch(noop); },
        close: function () { w.terminate(); }
      };
    }, function (e) { w.terminate(); throw e; });
  }

  // ---------- channels ----------
  // What a Dolby frame carries (its acmod and LFE bits), in FFmpeg's output
  // order, then where each goes in Web Audio's 5.1 (L R C LFE SL SR), which
  // Chrome mixes down for stereo. Back channels fold into the surrounds.
  var ACMOD = [['FL', 'FR'], ['FC'], ['FL', 'FR'], ['FL', 'FR', 'FC'], ['FL', 'FR', 'BC'], ['FL', 'FR', 'FC', 'BC'], ['FL', 'FR', 'SL', 'SR'], ['FL', 'FR', 'FC', 'SL', 'SR']];
  var ORDER = ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'BC', 'SL', 'SR'];
  var SEVEN_ONE = ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'];
  var FIVE_ONE = ['FL', 'FR', 'FC', 'LFE', 'SL', 'SR'];
  var WEB = { FL: [[0, 1]], FR: [[1, 1]], FC: [[2, 1]], LFE: [[3, 1]], SL: [[4, 1]], SR: [[5, 1]], BL: [[4, 0.7071]], BR: [[5, 0.7071]], BC: [[4, 0.7071], [5, 0.7071]] };
  function layout(b, ch) {
    var names = null;
    if (ch === 8) return SEVEN_ONE;
    if (b && b.length > 7 && b[0] === 0x0B && b[1] === 0x77) {
      var acmod, lfe;
      if (b[5] >> 3 <= 10) {
        // AC-3: after acmod, 2 bits each for the centre and surround levels and Dolby Surround, when present.
        var bits = b[6] << 8 | b[7], skip = 3;
        acmod = bits >> 13;
        if (acmod & 1 && acmod !== 1) skip += 2;
        if (acmod & 4) skip += 2;
        if (acmod === 2) skip += 2;
        lfe = bits >> (15 - skip) & 1;
      } else {
        acmod = b[4] >> 1 & 7; // E-AC-3
        lfe = b[4] & 1;
      }
      names = ACMOD[acmod].concat(lfe ? ['LFE'] : []).sort(function (x, y) { return ORDER.indexOf(x) - ORDER.indexOf(y); });
    }
    if (names && names.length === ch) return names;
    return ch === 1 ? ['FC'] : ch === 2 ? ['FL', 'FR'] : FIVE_ONE.slice(0, ch);
  }

  var codecs = [{ test: /^A_E?AC3/, open: ac3 }];
  function codecFor(t) {
    if (!t || typeof WebAssembly !== 'object' || typeof Worker !== 'function' || (t.comp && t.comp.encrypted)) return null;
    for (var i = 0; i < codecs.length; i++) if (codecs[i].test.test(t.codec)) return codecs[i];
    return null;
  }

  window.qlockDecode = function (video, onError) {
    var M = window.qlockMkv;
    var actx = null, out = null, vol = 1, timer = 0;
    var job = null;    // { file, info, track, reader, dec, gen, held: [{ m0, m1, buf, node }], clock, end, busy, done }
    var anchor = null; // { c (when to schedule media time m), c0 (when it's heard), m, rate }

    function context() {
      if (!actx) {
        actx = new AudioContext();
        out = actx.createGain();
        out.gain.value = vol;
        // As with the volume boost: a limiter, as a 5.1 mix folded to stereo can go past full scale.
        var lim = actx.createDynamicsCompressor();
        lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
        out.connect(lim);
        lim.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume().catch(noop);
      return actx;
    }
    // An audio context made before any click stays silent until one.
    function wake() { if (job && actx && actx.state === 'suspended') actx.resume().then(sync, noop); }
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);

    function start(file, info, track) {
      stop();
      var c = codecFor(track);
      if (!c) return;
      var my = job = { file: file, info: info, track: track, reader: null, dec: null, gen: 0, held: [], clock: -1, end: -1, busy: false, done: false };
      context();
      c.open(track).then(function (d) {
        if (job !== my) { d.close(); return; }
        my.dec = d;
        restart();
        sync();
      }, function (e) { if (job === my) fail(e); });
      if (!timer) timer = setInterval(tick, 250);
    }
    function stop() {
      if (!job) return;
      silence();
      if (job.dec) job.dec.close();
      job = null;
      anchor = null;
      clearInterval(timer);
      timer = 0;
      if (actx && actx.state === 'running') actx.suspend().catch(noop);
    }
    function fail(e) {
      stop();
      if (onError) onError(e);
    }

    // ---------- reading and decoding ahead ----------
    // From the video's time again (a seek): what's decoded is dropped, and a
    // new reader starts, as the last one may still be busy.
    function restart() {
      var my = job;
      if (!my || !my.dec) return;
      my.gen++;
      silence();
      my.held = [];
      my.reader = M.audioReader(my.file, my.info, my.track.num);
      my.clock = my.end = -1;
      my.done = my.busy = false;
      my.dec.reset();
      pump();
    }
    function pump() {
      var my = job;
      if (!my || !my.dec || my.busy || my.done || my.end >= video.currentTime + AHEAD) return;
      my.busy = true;
      var g = my.gen, rd = my.reader, frames;
      // A new reader first goes to the video's time.
      (rd.ready = rd.ready || rd.seek(video.currentTime))
        .then(function () { return rd.next(BATCH); })
        .then(function (r) {
          if (g !== my.gen) return;
          my.done = r.done;
          frames = r.frames;
          return Promise.all(frames.map(function (f) { return M.unpack(my.track, f.data); }));
        })
        .then(function (datas) {
          if (!datas || g !== my.gen) return;
          return my.dec.decode(datas).then(function (outs) { if (g === my.gen && job === my) add(my, frames, datas, outs); });
        })
        .then(function () {
          if (g !== my.gen) return;
          my.busy = false;
          pump();
        }, function (e) { if (job === my) fail(e); });
    }
    // Decoded frames → AudioBuffers, a run of frames alike (rate, channels) in each.
    function add(my, frames, datas, outs) {
      var runs = [], run = null;
      frames.forEach(function (f, i) {
        var o = outs[i];
        if (f.t >= 0 && (my.clock < 0 || Math.abs(f.t - my.clock) > 0.1)) my.clock = f.t;
        if (!o || !o.n) { if (my.dur) my.clock += my.dur; run = null; return; } // a damaged frame: its time passes in silence
        var names = layout(datas[i], o.ch), key = o.rate + ':' + names.join();
        if (!run || run.key !== key || Math.abs(run.m1 - my.clock) > 1e-4) runs.push(run = { key: key, rate: o.rate, names: names, m0: my.clock, m1: my.clock, list: [] });
        run.list.push(o);
        my.dur = o.n / o.rate;
        my.clock += my.dur;
        run.m1 = my.clock;
      });
      runs.forEach(function (r) {
        var h = { m0: r.m0, m1: r.m1, buf: mix(r), node: null };
        my.held.push(h);
        if (r.m1 > my.end) my.end = r.m1;
        if (anchor) play(h);
      });
    }
    function mix(r) {
      var n = 0, at = 0, names = r.names.join(), simple = names === 'FL,FR' ? 2 : names === 'FC' ? 1 : 0;
      r.list.forEach(function (o) { n += o.n; });
      var buf = actx.createBuffer(simple || 6, n, r.rate), dst = [];
      for (var c = 0; c < buf.numberOfChannels; c++) dst.push(buf.getChannelData(c));
      r.list.forEach(function (o) {
        for (var c = 0; c < o.ch; c++) {
          var src = o.pcm.subarray(c * o.n, (c + 1) * o.n);
          if (simple) { dst[c].set(src, at); continue; }
          (WEB[r.names[c]] || []).forEach(function (w) {
            var d = dst[w[0]], k = w[1];
            for (var i = 0; i < o.n; i++) d[at + i] += src[i] * k;
          });
        }
        at += o.n;
      });
      return buf;
    }

    // ---------- in step with the video ----------
    function play(h) {
      if (h.node || !anchor) return;
      var t0 = anchor.c + (h.m0 - anchor.m) / anchor.rate, now = actx.currentTime + LEAD, off = 0;
      if (t0 < now) { off = (now - t0) * anchor.rate; t0 = now; }
      if (off >= h.buf.duration) return;
      var s = actx.createBufferSource();
      s.buffer = h.buf;
      s.playbackRate.value = anchor.rate;
      s.connect(out);
      s.start(t0, off);
      h.node = s;
    }
    function silence() {
      if (!job) return;
      job.held.forEach(function (h) {
        if (!h.node) return;
        try { h.node.stop(); } catch (e) { /* not started */ }
        h.node.disconnect();
        h.node = null;
      });
    }
    // Line the schedule up with the video's time now (or stop it, when the video isn't moving).
    function sync() {
      if (!job || !job.dec) return;
      silence();
      anchor = null;
      if (video.paused || video.seeking || video.readyState < 3 || !actx || actx.state !== 'running') return;
      var lat = actx.outputLatency || actx.baseLatency || 0, now = actx.currentTime;
      anchor = { c: now - lat, c0: now, m: video.currentTime, rate: video.playbackRate || 1 };
      job.held.forEach(play);
    }
    function tick() {
      var my = job;
      if (!my || !my.dec) return;
      if (actx.state === 'suspended' && !video.paused) actx.resume().then(sync, noop);
      var now = video.currentTime;
      if (anchor) {
        var heard = anchor.m + (actx.currentTime - anchor.c0) * anchor.rate;
        if (Math.abs(heard - now) > DRIFT) sync();
      } else if (!video.paused && !video.seeking && video.readyState >= 3) sync();
      // Fell behind (a hidden tab, a slow disk): from here again.
      if (!my.busy && my.end >= 0 && my.end < now - 0.5) { restart(); return; }
      my.held = my.held.filter(function (h) { return h.m1 > now - 1; });
      pump();
    }
    ['playing', 'pause', 'waiting', 'ratechange', 'seeked'].forEach(function (t) { video.addEventListener(t, sync); });
    video.addEventListener('seeking', function () { anchor = null; restart(); });

    return {
      start: start,
      stop: stop,
      active: function () { return !!job; },
      volume: function (v) {
        vol = v;
        if (out) out.gain.setTargetAtTime(v, actx.currentTime, 0.02);
      }
    };
  };
  window.qlockDecode.can = function (t) { return !!codecFor(t); };
  window.qlockDecode.codecs = codecs;
})();
