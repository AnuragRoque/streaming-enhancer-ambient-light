// QualityLock player: the tracks inside a Matroska file (.mkv, .webm), for
// local.js (audio) and local-subs.js (subtitles).
//
// Chrome plays MKV, but only the first audio track it can decode, and it
// ignores subtitle tracks. This reads the file's track list so the player can
// offer them all:
//   - audio: withAudio() is the same file with one letter changed in the codec
//     name of every other playable audio track, so Chrome skips those and plays
//     the chosen one. It is a Blob of slices of the file, so nothing is copied.
//   - subtitles: text and PGS tracks are read from the file's blocks, found
//     through its index (Cues) when the index lists them, or else by reading it through.
//   - audioReader(): one audio track's frames from any time on, for tracks
//     Chrome can't decode (local-decode.js decodes them).
//
// window.qlockMkv → { read, withAudio, current, subtitles, audioReader, unpack, canPlay, codecName, channelsName, langCode }
(function () {
  'use strict';

  var ID = {
    EBML: 0x1A45DFA3, SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB, SEEKPOS: 0x53AC,
    INFO: 0x1549A966, SCALE: 0x2AD7B1, TRACKS: 0x1654AE6B, ENTRY: 0xAE, NUMBER: 0xD7, TYPE: 0x83, DEFAULT: 0x88,
    FORCED: 0x55AA, HEARING: 0x55AB, NAME: 0x536E, LANG: 0x22B59C, BCP47: 0x22B59D, CODEC: 0x86, AUDIO: 0xE1, CHANNELS: 0x9F,
    ENCODINGS: 0x6D80, ENCODING: 0x6240, ENC_TYPE: 0x5033, COMPRESSION: 0x5034, COMP_ALGO: 0x4254, COMP_SETTINGS: 0x4255,
    CLUSTER: 0x1F43B675, TIMECODE: 0xE7, SIMPLEBLOCK: 0xA3, BLOCKGROUP: 0xA0, BLOCK: 0xA1, DURATION: 0x9B,
    CUES: 0x1C53BB6B, CUEPOINT: 0xBB, CUETIME: 0xB3, CUEPOS: 0xB7, CUETRACK: 0xF7, CUECLUSTER: 0xF1, CUEREL: 0xF0, CUEDUR: 0xB2
  };
  var VIDEO = 1, AUDIO = 2, SUBTITLE = 17;
  var utf8 = new TextDecoder('utf-8');

  function readAt(file, pos, len) {
    return file.slice(pos, Math.min(file.size, pos + len)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // The element header at p: its id (marker bits kept, as the spec writes them),
  // data size (-1 when unknown) and header length. null when cut off.
  function header(b, p, end) {
    if (p >= end) return null;
    var n = 1, mask = 0x80;
    while (n <= 4 && !(b[p] & mask)) { n++; mask >>= 1; }
    if (n > 4 || p + n >= end) return null;
    var id = 0, i;
    for (i = 0; i < n; i++) id = id * 256 + b[p + i];
    var q = p + n, m = 1;
    mask = 0x80;
    while (m <= 8 && !(b[q] & mask)) { m++; mask >>= 1; }
    if (m > 8 || q + m > end) return null;
    var v = b[q] & (mask - 1), ones = v === mask - 1;
    for (i = 1; i < m; i++) { v = v * 256 + b[q + i]; if (b[q + i] !== 0xFF) ones = false; }
    return { id: id, size: ones ? -1 : v, len: n + m };
  }
  // A variable-length number without its id-style marker (a block's track number).
  function vint(b, p) {
    var n = 1, mask = 0x80;
    while (n <= 8 && !(b[p] & mask)) { n++; mask >>= 1; }
    var v = b[p] & (mask - 1);
    for (var i = 1; i < n; i++) v = v * 256 + b[p + i];
    return { v: v, len: n };
  }
  function uint(b, p, n) { var v = 0; for (var i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }
  function str(b, p, n) { return utf8.decode(b.subarray(p, p + n)).replace(/\0+$/, ''); }
  // The children of an element: fn(id, dataStart, size).
  function each(b, p, end, fn) {
    while (p < end) {
      var h = header(b, p, end);
      if (!h || h.size < 0 || p + h.len + h.size > end) return;
      fn(h.id, p + h.len, h.size);
      p += h.len + h.size;
    }
  }

  // ---------- the file's head: segment, track list, where the index is ----------
  function read(file) {
    return readAt(file, 0, 65536).then(function (b) {
      var h = header(b, 0, b.length);
      if (!h || h.id !== ID.EBML || h.size < 0) return null;
      var p = h.len + h.size, s = header(b, p, b.length);
      if (!s || s.id !== ID.SEGMENT) return null;
      var info = {
        size: file.size, seg: p + s.len, end: s.size < 0 ? file.size : Math.min(file.size, p + s.len + s.size),
        scale: 1e6, tracks: [], tracksAt: -1, cuesAt: -1, clusterAt: -1
      };
      return walk(file, info, b).then(function () { return info.tracks.length ? info : null; });
    });
  }
  // Top-level elements, up to the first cluster. The SeekHead says where the
  // ones after the clusters (usually the index) are.
  function walk(file, info, head) {
    var seek = {}, pos = info.seg, steps = 0;
    function headerAt(p) {
      if (p + 12 <= head.length) return Promise.resolve(header(head, p, head.length));
      return readAt(file, p, 12).then(function (b) { return header(b, 0, b.length); });
    }
    function body(p, h) {
      var a = p + h.len;
      if (a + h.size <= head.length) return Promise.resolve({ b: head, p: a });
      return readAt(file, a, h.size).then(function (b) { return { b: b, p: 0 }; });
    }
    function next() {
      if (pos >= info.end || ++steps > 200) return done();
      return headerAt(pos).then(function (h) {
        if (!h) return done();
        var at = pos;
        if (h.id === ID.CLUSTER) { info.clusterAt = at; return done(); }
        if (h.size < 0) return done();
        pos = at + h.len + h.size;
        if (h.id === ID.CUES) info.cuesAt = at;
        if (h.id !== ID.SEEKHEAD && h.id !== ID.INFO && h.id !== ID.TRACKS) return next();
        return body(at, h).then(function (d) {
          if (h.id === ID.SEEKHEAD) seekHead(d.b, d.p, d.p + h.size, info.seg, seek);
          else if (h.id === ID.INFO) each(d.b, d.p, d.p + h.size, function (id, q, n) { if (id === ID.SCALE) info.scale = uint(d.b, q, n); });
          else { info.tracksAt = at; tracks(d.b, d.p, d.p + h.size, at + h.len - d.p, info); }
          return next();
        });
      });
    }
    function done() {
      if (info.cuesAt < 0 && seek[ID.CUES]) info.cuesAt = seek[ID.CUES];
      if (info.clusterAt < 0 && seek[ID.CLUSTER]) info.clusterAt = seek[ID.CLUSTER];
      if (info.tracksAt >= 0 || !seek[ID.TRACKS]) return Promise.resolve();
      // Track list after the clusters: rare, but allowed.
      pos = seek[ID.TRACKS];
      return headerAt(pos).then(function (h) {
        if (!h || h.id !== ID.TRACKS || h.size < 0) return;
        return body(pos, h).then(function (d) { info.tracksAt = pos; tracks(d.b, d.p, d.p + h.size, pos + h.len - d.p, info); });
      });
    }
    return next();
  }
  function seekHead(b, p, end, seg, out) {
    each(b, p, end, function (id, q, n) {
      if (id !== ID.SEEK) return;
      var sid = 0, spos = -1;
      each(b, q, q + n, function (id2, r, m) {
        if (id2 === ID.SEEKID) sid = uint(b, r, m);
        else if (id2 === ID.SEEKPOS) spos = uint(b, r, m);
      });
      if (sid && spos >= 0 && !out[sid]) out[sid] = seg + spos;
    });
  }
  // base: the file position of b[0], so the codec name's place in the file is known.
  function tracks(b, p, end, base, info) {
    each(b, p, end, function (id, q, n) {
      if (id !== ID.ENTRY) return;
      var t = { num: 0, type: 0, codec: '', codecAt: -1, name: '', lang: 'eng', def: true, forced: false, hi: false, channels: 0, comp: null };
      each(b, q, q + n, function (id2, r, m) {
        if (id2 === ID.NUMBER) t.num = uint(b, r, m);
        else if (id2 === ID.TYPE) t.type = uint(b, r, m);
        else if (id2 === ID.DEFAULT) t.def = !!uint(b, r, m);
        else if (id2 === ID.FORCED) t.forced = !!uint(b, r, m);
        else if (id2 === ID.HEARING) t.hi = !!uint(b, r, m);
        else if (id2 === ID.NAME) t.name = str(b, r, m).trim();
        else if (id2 === ID.LANG) t.lang = str(b, r, m);
        else if (id2 === ID.BCP47) t.bcp = str(b, r, m);
        else if (id2 === ID.CODEC) { t.codec = str(b, r, m); t.codecAt = base + r; }
        else if (id2 === ID.AUDIO) each(b, r, r + m, function (id3, s, k) { if (id3 === ID.CHANNELS) t.channels = uint(b, s, k); });
        else if (id2 === ID.ENCODINGS) t.comp = encoding(b, r, r + m);
      });
      if (t.bcp) t.lang = t.bcp;
      if (t.num && t.type) info.tracks.push(t);
    });
  }
  // Compressed blocks: zlib, or header stripping (bytes taken off every block's front).
  function encoding(b, p, end) {
    var out = { algo: -1, strip: null, encrypted: false };
    each(b, p, end, function (id, q, n) {
      if (id !== ID.ENCODING) return;
      each(b, q, q + n, function (id2, r, m) {
        if (id2 === ID.ENC_TYPE && uint(b, r, m) === 1) out.encrypted = true;
        if (id2 !== ID.COMPRESSION) return;
        out.algo = 0; // zlib, unless it says otherwise
        each(b, r, r + m, function (id3, s, k) {
          if (id3 === ID.COMP_ALGO) out.algo = uint(b, s, k);
          else if (id3 === ID.COMP_SETTINGS) out.strip = b.slice(s, s + k);
        });
      });
    });
    return out;
  }

  // ---------- audio ----------
  var MIME = [
    [/^A_AAC/, 'audio/mp4; codecs="mp4a.40.2"', 'AAC'], [/^A_OPUS/, 'audio/webm; codecs="opus"', 'Opus'],
    [/^A_VORBIS/, 'audio/webm; codecs="vorbis"', 'Vorbis'], [/^A_MPEG\/L3/, 'audio/mpeg', 'MP3'], [/^A_MPEG\/L2/, 'audio/mpeg; codecs="mp2"', 'MP2'],
    [/^A_FLAC/, 'audio/flac', 'FLAC'], [/^A_AC3/, 'audio/mp4; codecs="ac-3"', 'Dolby Digital'], [/^A_EAC3/, 'audio/mp4; codecs="ec-3"', 'Dolby Digital Plus'],
    [/^A_TRUEHD/, 'audio/mp4; codecs="mlpa"', 'Dolby TrueHD'], [/^A_DTS/, 'audio/mp4; codecs="dtsc"', 'DTS'], [/^A_PCM/, 'audio/wav', 'PCM']
  ];
  var probe = document.createElement('audio'), playable = {};
  function codecInfo(t) { for (var i = 0; i < MIME.length; i++) if (MIME[i][0].test(t.codec)) return MIME[i]; return null; }
  // Whether this Chrome can decode the track (AC-3, E-AC-3, DTS and TrueHD it can't, as a rule).
  function canPlay(t) {
    if (t.type !== AUDIO || (t.comp && (t.comp.encrypted || t.comp.algo === 0))) return false;
    if (!(t.codec in playable)) { var c = codecInfo(t); playable[t.codec] = !!c && probe.canPlayType(c[1]) !== ''; }
    return playable[t.codec];
  }
  function codecName(t) { var c = codecInfo(t); return c ? c[2] : t.codec.replace(/^A_/, ''); }
  function channelsName(n) { return n === 1 ? 'mono' : n === 2 ? 'stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : n ? n + ' ch' : ''; }
  // The track Chrome plays on its own: the first it can decode.
  function current(info) {
    for (var i = 0; i < info.tracks.length; i++) if (info.tracks[i].type === AUDIO && canPlay(info.tracks[i])) return info.tracks[i].num;
    return 0;
  }
  function withAudio(file, info, num) {
    if (num === current(info)) return file;
    var cut = info.tracks.filter(function (t) { return t.type === AUDIO && t.num !== num && t.codecAt >= 0 && canPlay(t); })
      .map(function (t) { return t.codecAt; }).sort(function (a, b) { return a - b; });
    var parts = [], at = 0;
    // "A_AAC" → "X_AAC": a codec Chrome doesn't know, so it passes the track by.
    cut.forEach(function (p) { parts.push(file.slice(at, p), 'X'); at = p + 1; });
    parts.push(file.slice(at));
    return new Blob(parts, { type: file.type });
  }
  // ISO 639-2 "bibliographic" codes, which Intl doesn't know, to the ones it does.
  var B2T = { fre: 'fra', ger: 'deu', dut: 'nld', chi: 'zho', cze: 'ces', gre: 'ell', per: 'fas', rum: 'ron', may: 'msa', alb: 'sqi',
    arm: 'hye', baq: 'eus', bur: 'mya', geo: 'kat', ice: 'isl', mac: 'mkd', mao: 'mri', slo: 'slk', tib: 'bod', wel: 'cym', scc: 'srp', scr: 'hrv' };
  function langCode(t) { var l = (t.lang || '').toLowerCase(); return l === 'und' || l === 'mis' || l === 'zxx' ? '' : B2T[l] || l; }

  // ---------- subtitle blocks ----------
  // A SimpleBlock or BlockGroup at p: { track, tc, data, dur } (dur -1 when not given).
  function block(b, p, end) {
    var h = header(b, p, end);
    if (!h || h.size < 0 || p + h.len + h.size > end) return null;
    var q = p + h.len, e = q + h.size;
    if (h.id === ID.SIMPLEBLOCK) return frame(b, q, e, -1);
    if (h.id !== ID.BLOCKGROUP) return null;
    var out = null, dur = -1;
    each(b, q, e, function (id, r, m) {
      if (id === ID.BLOCK) out = frame(b, r, r + m, -1);
      else if (id === ID.DURATION) dur = uint(b, r, m);
    });
    if (out) out.dur = dur;
    return out;
  }
  function frame(b, p, end, dur) {
    var t = vint(b, p), q = p + t.len;
    if (q + 3 > end || b[q + 2] & 0x06) return null; // laced: never used for subtitles
    var tc = (b[q] << 8 | b[q + 1]) << 16 >> 16;
    return { track: t.v, tc: tc, data: b.slice(q + 3, end), dur: dur };
  }
  // A block's data as stored, uncompressed.
  function unpack(t, data) {
    if (!t.comp || t.comp.algo < 0) return Promise.resolve(data);
    if (t.comp.algo === 3) {
      var out = new Uint8Array(t.comp.strip.length + data.length);
      out.set(t.comp.strip);
      out.set(data, t.comp.strip.length);
      return Promise.resolve(out);
    }
    if (t.comp.algo !== 0 || typeof DecompressionStream === 'undefined') return Promise.reject(new Error('unsupported compression'));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()
      .then(function (a) { return new Uint8Array(a); });
  }

  // Reads the blocks of the given subtitle tracks. onBlocks(list) gets them as
  // they are found: { track, start, end (-1 unknown), data } in seconds;
  // onProgress(0..1) while reading the file through. → { promise, cancel, indexed }
  function subtitles(file, info, nums, onBlocks, onProgress) {
    var job = { cancelled: false, indexed: false };
    var want = {};
    nums.forEach(function (n) { want[n] = true; });
    var sec = info.scale / 1e9;
    job.cancel = function () { job.cancelled = true; };
    job.promise = cueEntries(file, info, want).then(function (entries) {
      var listed = {};
      entries.forEach(function (e) { listed[e.track] = true; });
      var rest = nums.filter(function (n) { return !listed[n]; });
      job.indexed = !rest.length;
      return fromIndex(file, info, entries, sec, onBlocks, job).then(function () {
        if (rest.length && !job.cancelled) return scan(file, info, rest, sec, onBlocks, onProgress || function () {}, job);
      });
    });
    return job;
  }
  // The index (Cues): every entry, { time, track, cluster, rel, dur }; read once.
  function cues(file, info) {
    if (info.cueList) return info.cueList;
    info.cueList = info.cuesAt < 0 ? Promise.resolve([]) : readAt(file, info.cuesAt, 16).then(function (hb) {
      var h = header(hb, 0, hb.length);
      if (!h || h.id !== ID.CUES || h.size < 0 || h.size > 64 << 20) return [];
      return readAt(file, info.cuesAt + h.len, h.size).then(function (b) {
        var out = [];
        each(b, 0, b.length, function (id, p, n) {
          if (id !== ID.CUEPOINT) return;
          var time = 0, poss = [];
          each(b, p, p + n, function (id2, q, m) {
            if (id2 === ID.CUETIME) time = uint(b, q, m);
            else if (id2 === ID.CUEPOS) {
              var e = { track: 0, cluster: -1, rel: -1, dur: -1 };
              each(b, q, q + m, function (id3, r, k) {
                if (id3 === ID.CUETRACK) e.track = uint(b, r, k);
                else if (id3 === ID.CUECLUSTER) e.cluster = uint(b, r, k);
                else if (id3 === ID.CUEREL) e.rel = uint(b, r, k);
                else if (id3 === ID.CUEDUR) e.dur = uint(b, r, k);
              });
              poss.push(e);
            }
          });
          poss.forEach(function (e) { e.time = time; out.push(e); });
        });
        return out;
      });
    }).catch(function () { return []; });
    return info.cueList;
  }
  // The index's entries for these tracks that point right at their block.
  function cueEntries(file, info, want) {
    return cues(file, info).then(function (all) {
      return all.filter(function (e) { return want[e.track] && e.cluster >= 0 && e.rel >= 0; });
    });
  }
  // One small read per block, a few at a time.
  function fromIndex(file, info, entries, sec, onBlocks, job) {
    if (!entries.length) return Promise.resolve();
    var heads = {}, i = 0, found = [];
    function clusterHead(at) {
      if (!heads[at]) heads[at] = readAt(file, at, 16).then(function (b) { var h = header(b, 0, b.length); return h ? h.len : 12; });
      return heads[at];
    }
    function one(e) {
      var at = info.seg + e.cluster;
      return clusterHead(at).then(function (hl) {
        var p = at + hl + e.rel;
        return readAt(file, p, 4096).then(function (b) {
          var h = header(b, 0, b.length);
          if (h && h.size > 0 && h.len + h.size > b.length && h.size < 1 << 20) return readAt(file, p, h.len + h.size);
          return b;
        });
      }).then(function (b) {
        var k = block(b, 0, b.length);
        if (!k || k.track !== e.track) return;
        var d = k.dur >= 0 ? k.dur : e.dur;
        found.push({ track: k.track, start: e.time * sec, end: d >= 0 ? (e.time + d) * sec : -1, data: k.data });
      });
    }
    function worker() {
      if (job.cancelled || i >= entries.length) return Promise.resolve();
      return one(entries[i++]).catch(function () {}).then(worker);
    }
    var pool = [];
    for (var w = 0; w < 8; w++) pool.push(worker());
    return Promise.all(pool).then(function () {
      if (job.cancelled) return;
      found.sort(function (a, b) { return a.start - b.start; });
      onBlocks(found);
    });
  }
  // Reading the clusters through, 8 MB at a time; only the wanted tracks'
  // blocks are kept. Cluster sizes may be unknown (files recorded live), so
  // clusters are entered rather than measured.
  function scan(file, info, nums, sec, onBlocks, onProgress, job) {
    var CHUNK = 8 << 20, want = {}, pos = info.clusterAt, end = info.end, buf = null, at = 0, tc = 0, found = [];
    nums.forEach(function (n) { want[n] = true; });
    if (pos < 0) return Promise.resolve();
    var from = pos;
    function refill(p, n) {
      return readAt(file, p, Math.max(n, CHUNK)).then(function (b) { buf = b; at = p; });
    }
    function step() {
      for (;;) {
        if (job.cancelled) return Promise.resolve();
        if (pos >= end) break;
        var off = pos - at;
        var h = buf && off >= 0 ? header(buf, off, buf.length) : null;
        if (!h || (h.size >= 0 && (h.id === ID.SIMPLEBLOCK || h.id === ID.BLOCKGROUP) && off + h.len + 8 > buf.length)) {
          // Already read from here: the end of the file, or something that isn't Matroska.
          if (buf && at === pos) break;
          return refill(pos, 64).then(flush).then(step);
        }
        if (h.id === ID.CLUSTER) { tc = 0; pos += h.len; continue; }
        if (h.size < 0) break;
        if (h.id === ID.TIMECODE || h.id === ID.SIMPLEBLOCK || h.id === ID.BLOCKGROUP) {
          var q = off + h.len;
          // A block's track number is the first thing in it (a BlockGroup's Block, a little further in).
          var track = h.id === ID.SIMPLEBLOCK ? vint(buf, q).v : groupTrack(buf, q, buf.length);
          var need = h.id === ID.TIMECODE || want[track] || track < 0;
          if (need && off + h.len + h.size > buf.length) {
            if (at === pos) break; // cut short
            if (h.size > 16 << 20) { pos += h.len + h.size; continue; }
            return refill(pos, h.len + h.size).then(step);
          }
          if (h.id === ID.TIMECODE) tc = uint(buf, q, h.size);
          else if (need) {
            var k = block(buf, off, buf.length);
            if (k && want[k.track]) {
              var s = (tc + k.tc) * sec;
              found.push({ track: k.track, start: s, end: k.dur >= 0 ? s + k.dur * sec : -1, data: k.data });
            }
          }
        }
        pos += h.len + h.size;
      }
      return Promise.resolve(flush()).then(function () { onProgress(1); });
    }
    function flush() {
      if (found.length) { onBlocks(found); found = []; }
      onProgress(Math.min(1, (pos - from) / Math.max(1, end - from)));
    }
    return step();
  }
  // The track number of a BlockGroup's Block, -1 when not in this buffer.
  function groupTrack(b, p, end) {
    for (var i = 0; i < 4; i++) {
      var h = header(b, p, end);
      if (!h || h.size < 0) return -1;
      if (h.id === ID.BLOCK) return p + h.len < end ? vint(b, p + h.len).v : -1;
      p += h.len + h.size;
    }
    return -1;
  }

  // ---------- audio frames (tracks decoded by local-decode.js) ----------
  // Each cluster's place and start time, from the index; without one, by
  // hopping from cluster to cluster (each says how long it is). Read once.
  function clusters(file, info) {
    if (info.clusterList) return info.clusterList;
    var sec = info.scale / 1e9;
    info.clusterList = cues(file, info).then(function (all) {
      var seen = {}, out = [];
      all.forEach(function (e) {
        if (e.cluster < 0 || seen[e.cluster]) return;
        seen[e.cluster] = true;
        out.push({ t: e.time * sec, pos: info.seg + e.cluster });
      });
      return out.length ? out : hop(file, info);
    }).then(function (list) { return list.sort(function (a, b) { return a.t - b.t; }); });
    return info.clusterList;
  }
  function hop(file, info) {
    var out = [], pos = info.clusterAt, sec = info.scale / 1e9;
    function next() {
      if (pos < 0 || pos >= info.end) return out;
      return readAt(file, pos, 64).then(function (b) {
        var h = header(b, 0, b.length);
        if (!h || h.id !== ID.CLUSTER || h.size < 0) return out; // size unknown: the rest is read through
        var t = header(b, h.len, b.length);
        if (t && t.id === ID.TIMECODE) out.push({ t: uint(b, h.len + t.len, t.size) * sec, pos: pos });
        pos += h.len + h.size;
        return next();
      });
    }
    return Promise.resolve().then(next);
  }
  // One track's frames, in file order from wherever seek() put it.
  // next(seconds) → { frames: [{ t (seconds; -1: straight after the one before), data }], done }
  function audioReader(file, info, num) {
    var CHUNK = 1 << 20, sec = info.scale / 1e9, end = info.end, pos = -1, buf = null, at = 0, tc = 0;
    function refill(p, n) {
      return readAt(file, p, Math.max(n, CHUNK)).then(function (b) { buf = b; at = p; });
    }
    return {
      // To the last cluster starting a little before t.
      seek: function (t) {
        return clusters(file, info).then(function (list) {
          pos = info.clusterAt;
          for (var i = 0; i < list.length && list[i].t <= t - 0.1; i++) pos = list[i].pos;
          buf = null;
          tc = 0;
        });
      },
      next: function (want) {
        var frames = [], first = -1;
        function step() {
          for (;;) {
            if (pos < 0 || pos >= end) return { frames: frames, done: true };
            var off = pos - at;
            var h = buf && off >= 0 ? header(buf, off, buf.length) : null;
            if (!h || (h.size >= 0 && (h.id === ID.SIMPLEBLOCK || h.id === ID.BLOCKGROUP) && off + h.len + 8 > buf.length)) {
              if (buf && at === pos) return { frames: frames, done: true };
              return refill(pos, 64).then(step);
            }
            if (h.id === ID.CLUSTER) { tc = 0; pos += h.len; continue; }
            if (h.size < 0) return { frames: frames, done: true };
            if (h.id === ID.TIMECODE || h.id === ID.SIMPLEBLOCK || h.id === ID.BLOCKGROUP) {
              var q = off + h.len;
              var track = h.id === ID.SIMPLEBLOCK ? vint(buf, q).v : groupTrack(buf, q, buf.length);
              var need = h.id === ID.TIMECODE || track === num || track < 0;
              if (need && off + h.len + h.size > buf.length) {
                if (at === pos) return { frames: frames, done: true };
                return refill(pos, h.len + h.size).then(step);
              }
              if (h.id === ID.TIMECODE) tc = uint(buf, q, h.size);
              else if (need) {
                var k = laced(buf, off, buf.length);
                if (k && k.track === num) {
                  var t = (tc + k.tc) * sec;
                  k.frames.forEach(function (d, i) { frames.push({ t: i ? -1 : t, data: d }); });
                  if (first < 0) first = t;
                  if (t - first >= want) { pos += h.len + h.size; return { frames: frames, done: false }; }
                }
              }
            }
            pos += h.len + h.size;
          }
        }
        return Promise.resolve().then(step);
      }
    };
  }
  // A SimpleBlock or BlockGroup at p with its frames apart: audio is often
  // laced (several frames to a block, their sizes in Xiph, EBML or fixed form).
  function laced(b, p, end) {
    var h = header(b, p, end);
    if (!h || h.size < 0 || p + h.len + h.size > end) return null;
    var q = p + h.len, e = q + h.size;
    if (h.id === ID.BLOCKGROUP) {
      var inner = null;
      each(b, q, e, function (id, r, m) { if (id === ID.BLOCK) inner = { q: r, e: r + m }; });
      if (!inner) return null;
      q = inner.q;
      e = inner.e;
    } else if (h.id !== ID.SIMPLEBLOCK) return null;
    var t = vint(b, q), r = q + t.len;
    if (r + 3 > e) return null;
    var tc = (b[r] << 8 | b[r + 1]) << 16 >> 16, lace = b[r + 2] & 0x06, frames = [], sizes = [], i, s;
    r += 3;
    if (lace) {
      var n = b[r++] + 1;
      if (lace === 0x02) {
        for (i = 0; i < n - 1; i++) { s = 0; do { s += b[r]; } while (b[r++] === 255 && r < e); sizes.push(s); }
      } else if (lace === 0x06) {
        var v = vint(b, r);
        r += v.len;
        sizes.push(v.v);
        for (i = 1; i < n - 1; i++) {
          v = vint(b, r);
          r += v.len;
          sizes.push(sizes[i - 1] + v.v - (Math.pow(2, 7 * v.len - 1) - 1));
        }
      } else {
        s = Math.floor((e - r) / n);
        for (i = 0; i < n - 1; i++) sizes.push(s);
      }
      for (i = 0; i < sizes.length; i++) {
        if (sizes[i] < 0 || r + sizes[i] > e) return null;
        frames.push(b.slice(r, r + sizes[i]));
        r += sizes[i];
      }
    }
    frames.push(b.slice(r, e));
    return { track: t.v, tc: tc, frames: frames };
  }

  window.qlockMkv = {
    VIDEO: VIDEO, AUDIO: AUDIO, SUBTITLE: SUBTITLE,
    read: read,
    withAudio: withAudio,
    current: current,
    subtitles: subtitles,
    audioReader: audioReader,
    unpack: unpack,
    canPlay: canPlay,
    codecName: codecName,
    channelsName: channelsName,
    langCode: langCode
  };
})();
