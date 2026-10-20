/*
 * QualityLock — page script. Runs inside the page (MAIN world) at document_start,
 * before any of the site's own code.
 *
 * How it works
 * ------------
 * A streaming player picks its quality from a list of video renditions in a
 * manifest: a DASH .mpd, an HLS .m3u8 master playlist, or (Netflix) a JSON
 * manifest. When the network dips, adaptive bitrate (ABR) switches down the list.
 * QualityLock removes the lower renditions from that list before the player
 * reads it, so the player has nothing to switch down to and buffers instead.
 *
 * What it does not do: it never adds renditions the service didn't send and it
 * doesn't touch DRM or capability checks. The ceiling is still whatever your plan
 * and browser are given; this only stops the drops below that ceiling.
 *
 * Hooks: fetch, XMLHttpRequest (response getters), and on Netflix JSON.parse and
 * Response.json. Optional "deep mode" also hooks classic Web Workers.
 */
(function () {
  'use strict';

  function QL(G, BOOT) {
    'use strict';

    var VERSION = '1.0.0';
    var TAG = '[QualityLock]';
    var IS_WORKER = typeof G.document === 'undefined';
    var J = G.JSON || JSON;
    var nativeParse = J.parse;
    var nativeStringify = J.stringify;
    var MAX_LEVEL = 3;

    // ------------------------------------------------------------------
    // Site + settings
    // ------------------------------------------------------------------
    var DEFAULTS = {
      enabled: true,
      overlay: false,
      nerds: false,
      deepMode: false,
      videoController: {
        enabled: true,
        showOsd: true
      },
      sites: {
        netflix: { enabled: true, mode: 'best', floor: 1080 },
        prime: { enabled: true, mode: 'best', floor: 720 },
        hotstar: { enabled: true, mode: 'best', floor: 720 },
        other: { enabled: true, mode: 'best', floor: 1080 }
      }
    };
    var SITE_NAMES = {
      netflix: 'Netflix',
      prime: 'Prime Video',
      hotstar: 'JioHotstar',
      other: (G.location && G.location.hostname ? G.location.hostname.replace(/^www\./, '') : 'Web Video')
    };

    function detectSite(host) {
      host = String(host || '').toLowerCase();
      if (/(^|\.)netflix\.com$/.test(host)) return 'netflix';
      if (/(^|\.)primevideo\.com$/.test(host) || /(^|\.)amazon\.[a-z.]+$/.test(host)) return 'prime';
      if (/(^|\.)(jio)?hotstar\.com$/.test(host)) return 'hotstar';
      return 'other';
    }

    var SITE = BOOT && BOOT.site !== undefined ? BOOT.site : detectSite(G.location && G.location.hostname);

    function loadCachedSettings() {
      try {
        var raw = G.localStorage && G.localStorage.getItem('__qlock_settings');
        if (raw) return nativeParse.call(J, raw);
      } catch (e) { /* storage blocked */ }
      return nativeParse.call(J, nativeStringify.call(J, DEFAULTS));
    }

    var settings = BOOT && BOOT.settings ? BOOT.settings : loadCachedSettings();

    function siteCfg() {
      var d = DEFAULTS.sites[SITE] || DEFAULTS.sites.other || { enabled: true, mode: 'best', floor: 1080 };
      var s = (settings && settings.sites && (settings.sites[SITE] || settings.sites.other)) || d;
      return {
        enabled: !!SITE && settings.enabled !== false && s.enabled !== false,
        mode: s.mode === 'floor' ? 'floor' : 'best',
        floor: +s.floor || d.floor
      };
    }

    // Fallback level, per title (page path). 0 = strictest.
    //  best:  0 single best rendition · 1 every bitrate at the top height
    //         2 top two heights · 3 no filtering
    //  floor: 0 drop below the floor · 1+ no filtering
    var LEVEL_KEY = '__qlock_level';
    function getLevel() {
      if (BOOT && typeof BOOT.level === 'number') return BOOT.level;
      try {
        var r = nativeParse.call(J, G.sessionStorage.getItem(LEVEL_KEY) || 'null');
        if (r && r.site === SITE && r.path === G.location.pathname) return Math.min(r.level | 0, MAX_LEVEL);
      } catch (e) { /* ignore */ }
      return 0;
    }
    function setLevel(level) {
      try {
        G.sessionStorage.setItem(LEVEL_KEY, nativeStringify.call(J, { site: SITE, path: G.location.pathname, level: level }));
      } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Selection policy
    // ------------------------------------------------------------------
    var VIDEO_CODEC_RE = /^(avc[13]|hvc1|hev1|dvh[1e]|dva[1v]|vp0?9|vp08|av01)/i;

    function codecFamily(c) {
      c = String(c || '').toLowerCase();
      if (!c) return '';
      if (/dvh[1e]|dva[1v]|-dv\d|dolbyvision/.test(c)) return 'dv';
      if (/avc[13]|h264/.test(c)) return 'avc';
      if (/hvc1|hev1|hevc|h265/.test(c)) return 'hevc';
      if (/vp0?9/.test(c)) return 'vp9';
      if (/av01|av1/.test(c)) return 'av1';
      return 'other:' + c.split(/[.\-]/)[0];
    }

    // list: [{h, bw}] -> indexes to keep. Never empty.
    function pickIndexes(list, cfg, level) {
      var all = list.map(function (_, i) { return i; });
      if (list.length < 2 || level >= MAX_LEVEL) return all;

      var ranked = all.slice().sort(function (a, b) {
        return (list[b].h - list[a].h) || (list[b].bw - list[a].bw);
      });
      var heights = [];
      list.forEach(function (v) { if (v.h > 0 && heights.indexOf(v.h) === -1) heights.push(v.h); });
      heights.sort(function (a, b) { return b - a; });

      var keep;
      if (cfg.mode === 'floor') {
        if (level >= 1 || !heights.length) return all;
        keep = all.filter(function (i) { return !list[i].h || list[i].h >= cfg.floor; });
        var reaches = keep.some(function (i) { return list[i].h >= cfg.floor; });
        if (!reaches) keep = all.filter(function (i) { return list[i].h === heights[0]; });
      } else if (!heights.length) {
        var n = level === 0 ? 1 : level === 1 ? 2 : Math.ceil(list.length / 2);
        keep = ranked.slice(0, n);
      } else if (level === 0) {
        keep = [ranked[0]];
      } else if (level === 1) {
        keep = all.filter(function (i) { return list[i].h === heights[0]; });
      } else {
        var second = heights[1] || heights[0];
        keep = all.filter(function (i) { return list[i].h >= second; });
      }
      if (!keep.length) return all;
      return keep.sort(function (a, b) { return a - b; });
    }

    // Filter per group (codec family etc.) so each codec the player might choose
    // still has its own best rendition. Returns {index: true} for kept items.
    function chooseKeep(variants, cfg, level) {
      var groups = {};
      var order = [];
      variants.forEach(function (v, i) {
        var g = v.group || '';
        if (!Object.prototype.hasOwnProperty.call(groups, g)) { groups[g] = []; order.push(g); }
        groups[g].push(i);
      });
      var keep = {};
      order.forEach(function (g) {
        var idx = groups[g];
        var sub = idx.map(function (i) { return variants[i]; });
        pickIndexes(sub, cfg, level).forEach(function (j) { keep[idx[j]] = true; });
      });
      return keep;
    }

    function label(v) {
      var rate = v.kbps >= 1000 ? (v.kbps / 1000).toFixed(1) + ' Mbps' : Math.round(v.kbps) + ' kbps';
      var codec = v.group ? String(v.group).split('|')[0] : '';
      return (v.h ? v.h + 'p' : '?p') + ' ' + rate + (codec ? ' ' + codec : '');
    }

    function summary(variants, keep) {
      var kept = [];
      var dropped = [];
      variants.forEach(function (v, i) { (keep[i] ? kept : dropped).push(label(v)); });
      return { total: variants.length, kept: kept, dropped: dropped };
    }

    // ------------------------------------------------------------------
    // DASH (.mpd) — string based so it also runs inside workers (no DOMParser)
    // ------------------------------------------------------------------
    function getAttr(attrs, name) {
      var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
      var m = re.exec(attrs);
      return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
    }

    function stripAttrs(tag, names) {
      names.forEach(function (n) {
        tag = tag.replace(new RegExp('\\s' + n + '\\s*=\\s*(?:"[^"]*"|\'[^\']*\')'), '');
      });
      return tag;
    }

    function isVideoSet(asAttrs, reps) {
      var ct = (getAttr(asAttrs, 'contentType') || '').toLowerCase();
      if (ct) return ct === 'video';
      var mt = (getAttr(asAttrs, 'mimeType') || '').toLowerCase();
      if (mt) return mt.indexOf('video/') === 0;
      var codecs = getAttr(asAttrs, 'codecs');
      if (codecs) return VIDEO_CODEC_RE.test(codecs);
      return reps.some(function (r) {
        var rm = (getAttr(r.attrs, 'mimeType') || '').toLowerCase();
        if (rm) return rm.indexOf('video/') === 0;
        if (getAttr(r.attrs, 'height')) return true;
        return VIDEO_CODEC_RE.test(getAttr(r.attrs, 'codecs') || '');
      });
    }

    function filterMpd(text, cfg, level) {
      if (!/<(?:[\w.-]+:)?MPD[\s>]/.test(text.slice(0, 8192))) return null;
      var RE_AS = /<((?:[\w.-]+:)?AdaptationSet)\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>/g;
      var sets = [];
      var changed = false;

      var out = text.replace(RE_AS, function (whole, tag, asAttrs, body) {
        if (/\/\s*$/.test(asAttrs)) return whole;          // self-closing, nothing inside
        if (/trickmode/i.test(body)) return whole;          // thumbnail/trick-play track

        var RE_REP = /<((?:[\w.-]+:)?Representation)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>[\s\S]*?<\/\1\s*>)/g;
        var reps = [];
        var m;
        while ((m = RE_REP.exec(body))) reps.push({ attrs: m[2], start: m.index, end: m.index + m[0].length });
        if (reps.length < 2 || !isVideoSet(asAttrs, reps)) return whole;

        var setH = +getAttr(asAttrs, 'height') || 0;
        var setCodecs = getAttr(asAttrs, 'codecs') || '';
        var variants = reps.map(function (r) {
          var bw = +getAttr(r.attrs, 'bandwidth') || 0;
          return {
            h: +getAttr(r.attrs, 'height') || setH,
            bw: bw,
            kbps: bw / 1000,
            group: codecFamily(getAttr(r.attrs, 'codecs') || setCodecs)
          };
        });
        var keep = chooseKeep(variants, cfg, level);
        sets.push(summary(variants, keep));
        if (reps.every(function (_, i) { return keep[i]; })) return whole;

        changed = true;
        var openTag = whole.slice(0, tag.length + asAttrs.length + 2);
        var closeTag = whole.slice(openTag.length + body.length);
        var newBody = '';
        var pos = 0;
        reps.forEach(function (r, i) {
          if (keep[i]) return;
          newBody += body.slice(pos, r.start);
          pos = r.end;
        });
        newBody += body.slice(pos);
        return stripAttrs(openTag, ['minBandwidth', 'minWidth', 'minHeight']) + newBody + closeTag;
      });

      if (!sets.length) return null;
      return { text: out, changed: changed, report: { sets: sets } };
    }

    // ------------------------------------------------------------------
    // HLS (.m3u8 master playlist)
    // ------------------------------------------------------------------
    function parseHlsAttrs(s) {
      var out = {};
      var re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
      var m;
      while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
      return out;
    }

    function filterHls(text, cfg, level) {
      if (!/^\uFEFF?\s*#EXTM3U/.test(text) || text.indexOf('#EXT-X-STREAM-INF') === -1) return null;
      var lines = text.split(/\r?\n/);
      var entries = [];
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
        var j = i + 1;
        while (j < lines.length && (!lines[j].trim() || lines[j].charAt(0) === '#')) j++;
        if (j >= lines.length) break;
        var a = parseHlsAttrs(lines[i].slice(18));
        var res = /^(\d+)x(\d+)$/i.exec(a.RESOLUTION || '');
        var codecs = (a.CODECS || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean);
        var vcodec = codecs.filter(function (c) { return VIDEO_CODEC_RE.test(c); })[0] || '';
        var audioOnly = !res && codecs.length > 0 && !vcodec;
        var bw = +a.BANDWIDTH || +a['AVERAGE-BANDWIDTH'] || 0;
        entries.push({
          from: i, to: j, audioOnly: audioOnly,
          v: { h: res ? +res[2] : 0, bw: bw, kbps: bw / 1000,
               group: codecFamily(vcodec) + '|' + (a.AUDIO || '') + '|' + (a['VIDEO-RANGE'] || '') }
        });
        i = j;
      }
      var video = entries.filter(function (e) { return !e.audioOnly; });
      if (video.length < 2) return video.length ? { text: text, changed: false, report: { sets: [summary(video.map(function (e) { return e.v; }), { 0: true })] } } : null;

      var variants = video.map(function (e) { return e.v; });
      var keep = chooseKeep(variants, cfg, level);
      var drop = {};
      video.forEach(function (e, k) {
        if (keep[k]) return;
        for (var x = e.from; x <= e.to; x++) drop[x] = true;
      });
      var changed = Object.keys(drop).length > 0;
      var out = changed ? lines.filter(function (_, x) { return !drop[x]; }).join('\n') : text;
      return { text: out, changed: changed, report: { sets: [summary(variants, keep)] } };
    }

    // ------------------------------------------------------------------
    // Netflix JSON manifest: video_tracks[].streams[] {res_h, bitrate(kbps), content_profile, isDrm}
    // ------------------------------------------------------------------
    function filterNetflix(obj, cfg, level) {
      var sets = [];
      var changed = false;
      var found = 0;

      function doTracks(tracks) {
        tracks.forEach(function (t) {
          if (!t || !Array.isArray(t.streams) || t.streams.length < 2) return;
          var variants = t.streams.map(function (s) {
            var kbps = +(s && (s.bitrate || s.bitrateKbps)) || 0;
            return {
              h: +(s && (s.res_h || s.resH || s.height)) || 0,
              bw: kbps,
              kbps: kbps,
              group: codecFamily(s && (s.content_profile || s.contentProfile)) + '|' + (s && s.isDrm ? 'drm' : 'clear')
            };
          });
          var keep = chooseKeep(variants, cfg, level);
          sets.push(summary(variants, keep));
          var kept = t.streams.filter(function (_, i) { return keep[i]; });
          if (kept.length !== t.streams.length) {
            t.streams.splice.apply(t.streams, [0, t.streams.length].concat(kept));
            changed = true;
          }
        });
      }

      (function walk(o, depth) {
        if (!o || typeof o !== 'object' || depth > 4) return;
        if (Array.isArray(o)) {
          if (o.length <= 50) o.forEach(function (x) { walk(x, depth + 1); });
          return;
        }
        var vt = o.video_tracks || o.videoTracks;
        if (Array.isArray(vt)) { found++; doTracks(vt); return; }
        for (var k in o) {
          if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
          var v = o[k];
          if (v && typeof v === 'object') walk(v, depth + 1);
        }
      })(obj, 0);

      if (!found || !sets.length) return null;
      return { changed: changed, report: { sets: sets } };
    }

    // ------------------------------------------------------------------
    // Stats & Data Consumption Tracker (Stats for Nerds)
    // ------------------------------------------------------------------
    var stats = { manifestsSeen: 0, manifestsFiltered: 0, filteredAt: 0, last: null };
    var bc = null;
    try { if (G.BroadcastChannel && SITE) bc = new G.BroadcastChannel('__qlock_' + SITE); } catch (e) { bc = null; }
    var onRecord = null; // window side hook (watchdog)

    var dataTracker = {
      downloaded: 0,
      uploaded: 0,
      segments: 0,
      recent: [],
      recordDownload: function (bytes) {
        if (!bytes || bytes <= 0) return;
        this.downloaded += bytes;
        this.segments++;
        var now = Date.now();
        this.recent.push({ t: now, bytes: bytes });
        this.prune(now);
        if (IS_WORKER && bc) {
          try { bc.postMessage({ type: 'data', downloaded: bytes, uploaded: 0 }); } catch (e) {}
        }
      },
      recordUpload: function (bytes) {
        if (!bytes || bytes <= 0) return;
        this.uploaded += bytes;
        if (IS_WORKER && bc) {
          try { bc.postMessage({ type: 'data', downloaded: 0, uploaded: bytes }); } catch (e) {}
        }
      },
      prune: function (now) {
        now = now || Date.now();
        var cutoff = now - 3500;
        while (this.recent.length && this.recent[0].t < cutoff) this.recent.shift();
      },
      speedMbps: function () {
        var now = Date.now();
        this.prune(now);
        if (!this.recent.length) return 0;
        var sum = 0;
        for (var i = 0; i < this.recent.length; i++) sum += this.recent[i].bytes;
        var span = Math.max(0.8, (now - this.recent[0].t) / 1000);
        return (sum * 8) / (span * 1024 * 1024);
      },
      formatBytes: function (b) {
        if (!b || b <= 0) return '0 B';
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
        return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      }
    };

    function shortUrl(u) {
      u = String(u || '');
      var q = u.indexOf('?');
      if (q !== -1) u = u.slice(0, q);
      return u.length > 90 ? '…' + u.slice(-89) : u;
    }

    function applyRecord(entry) {
      stats.manifestsSeen++;
      if (entry.changed) { stats.manifestsFiltered++; stats.filteredAt = entry.at; }
      stats.last = entry;
      if (onRecord) onRecord(entry);
    }

    function record(kind, url, report, changed, source) {
      var entry = { kind: kind, url: shortUrl(url), changed: changed, source: source, sets: report.sets, level: getLevel(), at: Date.now() };
      applyRecord(entry);
      if (IS_WORKER && bc) { try { bc.postMessage({ type: 'record', entry: entry }); } catch (e) { /* ignore */ } }
      try {
        var s = report.sets[0];
        if (s && G.console) {
          G.console.info(TAG, (SITE_NAMES[SITE] || SITE) + ' ' + kind + ' manifest' + (IS_WORKER ? ' (worker)' : '') +
            ': kept [' + s.kept.join(', ') + ']' + (s.dropped.length ? ', dropped ' + s.dropped.length + ' lower' : ', nothing to drop'));
        }
      } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // Rewriters used by the hooks
    // ------------------------------------------------------------------
    function rewriteText(text, url, source) {
      if (typeof text !== 'string' || text.length < 20) return null;
      var cfg = siteCfg();
      if (!cfg.enabled) return null;
      var head = text.slice(0, 8192);
      var kind;
      var r;
      try {
        if (/<(?:[\w.-]+:)?MPD[\s>]/.test(head)) { kind = 'dash'; r = filterMpd(text, cfg, getLevel()); }
        else if (/^\uFEFF?\s*#EXTM3U/.test(head)) { kind = 'hls'; r = filterHls(text, cfg, getLevel()); }
        else return null;
      } catch (e) {
        if (G.console) G.console.warn(TAG, 'filter failed, leaving manifest untouched', e);
        return null;
      }
      if (!r) return null;
      record(kind, url, r.report, r.changed, source);
      return r.changed ? r : null;
    }

    var seenObjects = typeof WeakSet === 'function' ? new WeakSet() : null;
    function applyNetflix(obj, source) {
      if (SITE !== 'netflix' || !obj || typeof obj !== 'object') return;
      if (seenObjects) { if (seenObjects.has(obj)) return; seenObjects.add(obj); }
      var cfg = siteCfg();
      if (!cfg.enabled) return;
      try {
        var r = filterNetflix(obj, cfg, getLevel());
        if (r) record('netflix', '', r.report, r.changed, source);
      } catch (e) {
        if (G.console) G.console.warn(TAG, 'Netflix filter failed, leaving manifest untouched', e);
      }
    }

    var URL_HINT = /\.(mpd|m3u8)(?:[?#;/]|$)|(?:^|[\/_.-])(manifest|master|playlist)(?:[\/_.?#-]|$)|\/mpd\//i;
    function shouldInspect(url, ct) {
      ct = String(ct || '').toLowerCase();
      if (/^(video|audio|image|font)\/|event-stream|application\/(mp4|javascript|json|wasm)|text\/(css|html|javascript)/.test(ct)) return false;
      if (/dash\+xml|mpegurl/.test(ct)) return true;
      if (/xml/.test(ct)) return true;
      return URL_HINT.test(String(url || ''));
    }

    function looksTextual(buf) {
      var b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 64));
      var i = 0;
      if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) i = 3;
      while (i < b.length && (b[i] === 0x20 || b[i] === 0x0A || b[i] === 0x0D || b[i] === 0x09)) i++;
      return b[i] === 0x3C /* < */ || b[i] === 0x23 /* # */;
    }

    // Worker deep mode: relative URLs must resolve against the original script URL.
    var BASE = BOOT && BOOT.base;
    function resolveRel(u) {
      if (!BASE || typeof u !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
      try { return new URL(u, BASE).href; } catch (e) { return u; }
    }

    // ------------------------------------------------------------------
    // Hooks
    // ------------------------------------------------------------------
    function defineValue(obj, name, value) {
      try { Object.defineProperty(obj, name, { value: value, configurable: true }); } catch (e) { /* ignore */ }
    }

    function hookFetch() {
      var nativeFetch = G.fetch;
      var Resp = G.Response;
      var Hdrs = G.Headers;
      if (typeof nativeFetch !== 'function' || !Resp || !Hdrs) return;

      function rewriteResponse(resp, reqUrl) {
        if (!resp || resp.type === 'opaque' || resp.type === 'opaqueredirect') return Promise.resolve(resp);
        if (resp.status < 200 || resp.status >= 300 || resp.status === 204) return Promise.resolve(resp);
        var url = resp.url || reqUrl;
        var ct = resp.headers ? resp.headers.get('content-type') : '';
        if (!shouldInspect(url, ct)) return Promise.resolve(resp);
        var len = +(resp.headers.get('content-length') || 0);
        if (len > 10e6) return Promise.resolve(resp);

        // Never hold a response hostage: if the body takes more than 15 s, pass the original through.
        var timer;
        var timeout = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 15000); });
        var body = resp.clone().text();
        return Promise.race([body, timeout]).then(function (text) {
          clearTimeout(timer);
          if (text === null) return resp;
          var r = rewriteText(text, url, 'fetch');
          if (!r) return resp;
          var headers = new Hdrs(resp.headers);
          headers.delete('content-length');
          headers.delete('content-encoding');
          var out = new Resp(r.text, { status: resp.status, statusText: resp.statusText, headers: headers });
          defineValue(out, 'url', resp.url);
          defineValue(out, 'redirected', resp.redirected);
          defineValue(out, 'type', resp.type);
          return out;
        });
      }

      var wrapped = function fetch(input, init) {
        if (BASE && typeof input === 'string') input = resolveRel(input);
        if (init && init.body) {
          try {
            var up = 0;
            if (typeof init.body === 'string') up = init.body.length;
            else if (init.body.byteLength) up = init.body.byteLength;
            else if (init.body.size) up = init.body.size;
            if (up > 0) dataTracker.recordUpload(up);
          } catch (e) {}
        }
        var p = nativeFetch.call(G, input, init);
        if (!siteCfg().enabled) return p;
        var reqUrl = typeof input === 'string' ? input : (input && input.url) || String(input);
        return p.then(function (resp) {
          return rewriteResponse(resp, reqUrl).catch(function () { return resp; });
        });
      };
      G.fetch = wrapped;

      if (Resp.prototype) {
        if (Resp.prototype.arrayBuffer) {
          var nativeArrayBuffer = Resp.prototype.arrayBuffer;
          Resp.prototype.arrayBuffer = function () {
            return nativeArrayBuffer.apply(this, arguments).then(function (buf) {
              if (buf && buf.byteLength) dataTracker.recordDownload(buf.byteLength);
              return buf;
            });
          };
        }
        if (Resp.prototype.blob) {
          var nativeBlob = Resp.prototype.blob;
          Resp.prototype.blob = function () {
            return nativeBlob.apply(this, arguments).then(function (blob) {
              if (blob && blob.size) dataTracker.recordDownload(blob.size);
              return blob;
            });
          };
        }
      }

      if (SITE === 'netflix' && Resp.prototype && Resp.prototype.json) {
        var nativeJson = Resp.prototype.json;
        Resp.prototype.json = function () {
          return nativeJson.call(this).then(function (obj) { applyNetflix(obj, 'response.json'); return obj; });
        };
      }
    }

    function hookXhr() {
      var X = G.XMLHttpRequest;
      if (!X || !X.prototype) return;
      var P = X.prototype;
      var dText = Object.getOwnPropertyDescriptor(P, 'responseText');
      var dResp = Object.getOwnPropertyDescriptor(P, 'response');
      var dXml = Object.getOwnPropertyDescriptor(P, 'responseXML');
      if (!dText || !dText.get || !dResp || !dResp.get) return;

      var nativeSend = P.send;
      P.send = function (data) {
        if (data) {
          try {
            var up = 0;
            if (typeof data === 'string') up = data.length;
            else if (data.byteLength) up = data.byteLength;
            else if (data.size) up = data.size;
            if (up > 0) dataTracker.recordUpload(up);
          } catch (e) {}
        }
        return nativeSend.apply(this, arguments);
      };

      var meta = new WeakMap();
      var nativeOpen = P.open;
      P.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        if (BASE && args.length > 1) args[1] = resolveRel(String(args[1]));
        meta.set(this, { url: String(args[1]), done: false, result: null });
        this.addEventListener('load', function () {
          try {
            var len = 0;
            var cl = this.getResponseHeader('content-length');
            if (cl) len = parseInt(cl, 10) || 0;
            if (!len) {
              if (this.responseType === 'arraybuffer' && this.response) len = this.response.byteLength;
              else if (this.responseType === 'blob' && this.response) len = this.response.size;
              else if ((this.responseType === '' || this.responseType === 'text') && this.responseText) len = this.responseText.length;
            }
            if (len > 0) dataTracker.recordDownload(len);
          } catch (e) {}
        }, { once: true });
        return nativeOpen.apply(this, args);
      };

      function compute(xhr) {
        var m = meta.get(xhr);
        if (!m) return null;
        if (m.done) return m.result;
        if (xhr.readyState !== 4) return null;
        m.done = true;
        if (!siteCfg().enabled) return null;
        try {
          if (xhr.status < 200 || xhr.status >= 300) return null;
          var rt = xhr.responseType;
          if (rt === '' || rt === 'text') {
            var t = dText.get.call(xhr);
            var r = rewriteText(t, m.url, 'xhr');
            if (r) m.result = { text: r.text };
          } else if (rt === 'arraybuffer') {
            var buf = dResp.get.call(xhr);
            if (buf && buf.byteLength > 20 && buf.byteLength < 10e6 && looksTextual(buf)) {
              var r2 = rewriteText(new TextDecoder('utf-8').decode(buf), m.url, 'xhr');
              if (r2) m.result = { buffer: new TextEncoder().encode(r2.text).buffer };
            }
          } else if (rt === 'json') {
            applyNetflix(dResp.get.call(xhr), 'xhr.json');
          } else if (rt === 'document' && !IS_WORKER && G.XMLSerializer && G.DOMParser) {
            var doc = dResp.get.call(xhr);
            if (doc && doc.documentElement && /MPD$/.test(doc.documentElement.nodeName)) {
              var r3 = rewriteText(new G.XMLSerializer().serializeToString(doc), m.url, 'xhr');
              if (r3) m.result = { doc: new G.DOMParser().parseFromString(r3.text, 'application/xml') };
            }
          }
        } catch (e) {
          m.result = null;
        }
        return m.result;
      }

      Object.defineProperty(P, 'responseText', {
        configurable: true, enumerable: dText.enumerable,
        get: function () {
          var r = compute(this);
          return r && r.text !== undefined ? r.text : dText.get.call(this);
        }
      });
      Object.defineProperty(P, 'response', {
        configurable: true, enumerable: dResp.enumerable,
        get: function () {
          var r = compute(this);
          if (r) {
            if (r.text !== undefined) return r.text;
            if (r.buffer) return r.buffer;
            if (r.doc) return r.doc;
          }
          return dResp.get.call(this);
        }
      });
      if (dXml && dXml.get) {
        Object.defineProperty(P, 'responseXML', {
          configurable: true, enumerable: dXml.enumerable,
          get: function () {
            var r = compute(this);
            if (r && r.doc) return r.doc;
            if (r && r.text !== undefined && G.DOMParser) {
              if (!r.xml) r.xml = new G.DOMParser().parseFromString(r.text, 'application/xml');
              return r.xml;
            }
            return dXml.get.call(this);
          }
        });
      }
    }

    function hookJsonParse() {
      if (SITE !== 'netflix') return;
      J.parse = function parse(text, reviver) {
        var out = nativeParse.apply(J, arguments);
        if (typeof text === 'string' && text.length > 500 &&
            (text.indexOf('video_tracks') !== -1 || text.indexOf('videoTracks') !== -1)) {
          applyNetflix(out, 'JSON.parse');
        }
        return out;
      };
    }

    function hookWorkers() {
      if (IS_WORKER || !settings.deepMode || !G.Worker || !G.Blob || !G.URL) return;
      var NativeWorker = G.Worker;
      var src = QL.toString();
      var W = function Worker(url, opts) {
        try {
          if (!(opts && opts.type === 'module') && siteCfg().enabled) {
            var abs = new URL(String(url), G.location.href).href;
            var boot = { site: SITE, settings: settings, level: getLevel(), base: abs };
            var code = '(' + src + ')(self,' + nativeStringify.call(J, boot) + ');\nimportScripts(' + nativeStringify.call(J, abs) + ');';
            var blobUrl = G.URL.createObjectURL(new G.Blob([code], { type: 'text/javascript' }));
            var w = new NativeWorker(blobUrl, opts);
            setTimeout(function () { G.URL.revokeObjectURL(blobUrl); }, 60000);
            return w;
          }
        } catch (e) {
          if (G.console) G.console.warn(TAG, 'worker hook failed, using normal worker', e);
        }
        return new NativeWorker(url, opts);
      };
      W.prototype = NativeWorker.prototype;
      G.Worker = W;
    }

    function hookImportScripts() {
      if (!IS_WORKER || !BASE || typeof G.importScripts !== 'function') return;
      var nativeImport = G.importScripts;
      G.importScripts = function () {
        return nativeImport.apply(G, Array.prototype.slice.call(arguments).map(resolveRel));
      };
    }

    var api = {
      version: VERSION, site: SITE, stats: stats,
      filterMpd: filterMpd, filterHls: filterHls, filterNetflix: filterNetflix,
      pickIndexes: pickIndexes, codecFamily: codecFamily, rewriteText: rewriteText,
      setSettings: function (s) { settings = s; }
    };

    if (!SITE) return api;
    if (BOOT && BOOT.noHooks) return api;

    hookFetch();
    hookXhr();
    hookJsonParse();
    hookWorkers();
    hookImportScripts();

    if (IS_WORKER || !G.document) return api;

    // ------------------------------------------------------------------
    // Window only: settings, status, overlay, fallback watchdog, Nerds HUD
    // ------------------------------------------------------------------
    var doc = G.document;
    var origin = G.location.origin;

    if (bc) {
      bc.onmessage = function (e) {
        if (!e.data) return;
        if (e.data.type === 'record' && e.data.entry) applyRecord(e.data.entry);
        if (e.data.type === 'data') {
          if (e.data.downloaded) {
            dataTracker.downloaded += e.data.downloaded;
            dataTracker.segments++;
            dataTracker.recent.push({ t: Date.now(), bytes: e.data.downloaded });
            dataTracker.prune();
          }
          if (e.data.uploaded) dataTracker.uploaded += e.data.uploaded;
        }
      };
    }

    try {
      if (G.PerformanceObserver) {
        var po = new G.PerformanceObserver(function (list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var ent = entries[i];
            if (ent.initiatorType === 'video' || ent.initiatorType === 'audio') {
              var sz = ent.transferSize || ent.encodedBodySize || ent.decodedBodySize || 0;
              if (sz > 0) dataTracker.recordDownload(sz);
            }
          }
        });
        po.observe({ type: 'resource', buffered: true });
      }
    } catch (e) {}

    var fpsTracker = {
      fps: 0,
      lastTime: 0,
      lastPresented: 0,
      activeVid: null,
      loop: function (v) {
        if (!v || !v.requestVideoFrameCallback || this.activeVid === v) return;
        this.activeVid = v;
        var self = this;
        var onFrame = function (now, meta) {
          if (self.lastTime) {
            var dt = (now - self.lastTime) / 1000;
            var df = meta.presentedFrames - self.lastPresented;
            if (dt >= 0.5) {
              self.fps = Math.round(df / dt);
              self.lastTime = now;
              self.lastPresented = meta.presentedFrames;
            }
          } else {
            self.lastTime = now;
            self.lastPresented = meta.presentedFrames;
          }
          if (self.activeVid === v && !v.paused && !v.ended) {
            v.requestVideoFrameCallback(onFrame);
          } else {
            self.activeVid = null;
          }
        };
        v.requestVideoFrameCallback(onFrame);
      }
    };

    var shadowScanAt = 0;
    var shadowVideos = [];

    function collectShadowVideos(root, out) {
      var walker = doc.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
      for (var n = walker.currentNode; n; n = walker.nextNode()) {
        var sr = n.shadowRoot;
        if (!sr) continue;
        var vs = sr.querySelectorAll('video');
        for (var i = 0; i < vs.length; i++) out.push(vs[i]);
        collectShadowVideos(sr, out);
      }
      return out;
    }

    function videoScore(v) {
      return v ? (v.videoWidth * v.videoHeight) + (v.paused ? 0 : 1e9) + (v.readyState * 1e8) : 0;
    }

    function mainVideo() {
      var vids = doc.getElementsByTagName('video');
      if (!vids.length) {
        // Web-component players keep the <video> inside a shadow root, where
        // getElementsByTagName can't see it. Walking the tree is costly, so throttle it.
        var now = Date.now();
        if (now - shadowScanAt > 3000 && doc.documentElement) {
          shadowScanAt = now;
          shadowVideos = collectShadowVideos(doc.documentElement, []);
        }
        vids = shadowVideos.filter(function (sv) { return sv.isConnected; });
      }
      var best = null;
      var bestScore = -1;
      for (var i = 0; i < vids.length; i++) {
        var score = videoScore(vids[i]);
        if (score > bestScore) { best = vids[i]; bestScore = score; }
      }
      return best;
    }

    function videoInfo(v) {
      if (!v) return null;
      var ahead = 0;
      var totalBuffered = 0;
      try {
        for (var i = 0; i < v.buffered.length; i++) {
          totalBuffered += (v.buffered.end(i) - v.buffered.start(i));
          if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) > v.currentTime) {
            ahead = v.buffered.end(i) - v.currentTime;
          }
        }
      } catch (e) { /* ignore */ }

      var q = null;
      try { q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null; } catch (e) { q = null; }
      fpsTracker.loop(v);

      var curSpeed = dataTracker.speedMbps();
      var dlFormatted = dataTracker.formatBytes(dataTracker.downloaded);
      var upFormatted = dataTracker.formatBytes(dataTracker.uploaded);
      var estPerHour = '';
      if (v.currentTime > 5 && dataTracker.downloaded > 0) {
        var perSec = dataTracker.downloaded / v.currentTime;
        estPerHour = dataTracker.formatBytes(perSec * 3600) + '/hr';
      }

      var dropPercent = '0.00';
      if (q && q.totalVideoFrames > 0) {
        dropPercent = ((q.droppedVideoFrames / q.totalVideoFrames) * 100).toFixed(2);
      }

      var aspect = '';
      if (v.videoWidth && v.videoHeight) {
        var ratio = v.videoWidth / v.videoHeight;
        if (Math.abs(ratio - 16 / 9) < 0.05) aspect = '16:9';
        else if (Math.abs(ratio - 2.39) < 0.1) aspect = '2.39:1';
        else if (Math.abs(ratio - 4 / 3) < 0.05) aspect = '4:3';
        else aspect = ratio.toFixed(2) + ':1';
      }

      return {
        width: v.videoWidth, height: v.videoHeight,
        viewportWidth: v.clientWidth || 0, viewportHeight: v.clientHeight || 0,
        dpr: (G.devicePixelRatio || 1).toFixed(2),
        aspect: aspect,
        fps: fpsTracker.fps || 0,
        paused: v.paused, readyState: v.readyState,
        currentTime: Math.round(v.currentTime || 0),
        duration: Math.round(v.duration || 0),
        playbackRate: v.playbackRate || 1,
        bufferAhead: Math.round(ahead),
        totalBuffered: Math.round(totalBuffered),
        dropped: q ? q.droppedVideoFrames : null,
        frames: q ? q.totalVideoFrames : null,
        dropPercent: dropPercent,
        downloaded: dataTracker.downloaded,
        downloadedStr: dlFormatted,
        uploaded: dataTracker.uploaded,
        uploadedStr: upFormatted,
        speedMbps: curSpeed > 0 ? curSpeed.toFixed(2) : '0.00',
        segments: dataTracker.segments,
        estPerHour: estPerHour
      };
    }

    function statusSnapshot() {
      var cfg = siteCfg();
      return {
        version: VERSION, site: SITE, siteName: SITE_NAMES[SITE], cfg: cfg, level: getLevel(),
        deepMode: !!settings.deepMode,
        nerds: !!(settings && settings.nerds),
        manifestsSeen: stats.manifestsSeen, manifestsFiltered: stats.manifestsFiltered,
        last: stats.last, playing: videoInfo(mainVideo()),
        videoTransform: getVideoTransformSnapshot()
      };
    }

    // --- fallback watchdog ---
    var playedOk = false;
    var fallbackFired = false;
    var stuckSince = 0;

    onRecord = function (entry) {
      if (entry.changed) { playedOk = false; stuckSince = 0; }
    };

    function fallback(reason) {
      if (fallbackFired) return;
      var level = getLevel();
      var cfg = siteCfg();
      var maxUseful = cfg.mode === 'floor' ? 1 : MAX_LEVEL;
      if (level >= maxUseful) return;
      fallbackFired = true;
      var next = level + 1;
      setLevel(next);
      if (G.console) G.console.warn(TAG, 'playback failed with filtered manifest (' + reason + '), reloading at fallback level ' + next);
      toast('Playback failed (' + reason + '). Reloading with a looser lock (level ' + next + ')…', 8000);
      setTimeout(function () { G.location.reload(); }, 2500);
    }

    doc.addEventListener('error', function (e) {
      var t = e.target;
      if (!t || t.tagName !== 'VIDEO') return;
      if (!stats.filteredAt || playedOk || fallbackFired) return;
      var err = t.error;
      if (!err || err.code === 1) return;               // aborted by the player
      if (err.code === 4 && !t.currentSrc) return;      // src cleared on navigation
      fallback('media error ' + err.code);
    }, true);

    setInterval(function () {
      if (fallbackFired || playedOk || !stats.filteredAt) return;
      var v = mainVideo();
      if (!v) { stuckSince = 0; return; }
      if (v.readyState >= 3 && v.currentTime > 0.5) { playedOk = true; stuckSince = 0; return; }
      if (!v.paused && v.readyState < 3) {
        if (!stuckSince) stuckSince = Date.now();
        else if (Date.now() - stuckSince > 45000) fallback('video did not start within 45 s');
      } else {
        stuckSince = 0;
      }
    }, 3000);

    // --- compact overlay ---
    var overlayEl = null;
    var keyToggled = false;   // Alt+Shift+Q flips the popup setting for this tab
    var lastRes = '';
    var flashUntil = 0;       // readout pops up for a few seconds whenever the resolution changes
    var toastText = '';
    var toastUntil = 0;

    function toast(text, ms) {
      toastText = text;
      toastUntil = Date.now() + (ms || 5000);
      renderOverlay();
    }

    function overlayLines() {
      var cfg = siteCfg();
      var level = getLevel();
      var lines = [];
      var mode = !cfg.enabled ? 'off' : cfg.mode === 'floor' ? 'never below ' + cfg.floor + 'p' : 'best only';
      lines.push('QualityLock: ' + (SITE_NAMES[SITE] || SITE) + ', ' + mode + (level ? ', fallback level ' + level : ''));
      var info = videoInfo(mainVideo());
      if (info && info.height) {
        var speedTxt = info.speedMbps > 0 ? ' · ' + info.speedMbps + ' Mbps' : '';
        lines.push('Playing ' + info.width + '×' + info.height + ', buffer ' + info.bufferAhead + ' s' +
          (info.dropped !== null ? ', ' + info.dropped + ' dropped' : '') + speedTxt);
      }
      var last = stats.last;
      if (last && last.sets && last.sets.length) {
        var s = last.sets[0];
        lines.push('Kept ' + s.kept.slice(0, 2).join(', ') + (s.kept.length > 2 ? ' +' + (s.kept.length - 2) : '') +
          (s.dropped.length ? ', dropped ' + s.dropped.length + ' lower' : ', nothing lower to drop'));
      } else if (info && info.height && cfg.enabled) {
        lines.push('No manifest caught yet' + (settings.deepMode ? '' : ' — try Deep mode in the popup'));
      }
      if (toastText && Date.now() < toastUntil) lines.push(toastText);
      return lines;
    }

    function renderOverlay() {
      var showToast = toastText && Date.now() < toastUntil;
      var v = mainVideo();
      var res = v && v.videoHeight ? v.videoWidth + 'x' + v.videoHeight : '';
      if (res && res !== lastRes) flashUntil = Date.now() + 6000;
      lastRes = res;
      var always = !!settings.overlay !== keyToggled;
      var wanted = showToast || (res && (always || Date.now() < flashUntil));
      if (!wanted) {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        return;
      }
      if (!overlayEl) {
        overlayEl = doc.createElement('div');
        overlayEl.setAttribute('data-qualitylock', '');
        overlayEl.style.cssText = [
          'all:initial', 'position:fixed', 'top:12px', 'left:12px', 'z-index:2147483647',
          'pointer-events:none', 'white-space:pre', 'font:12px/1.45 ui-monospace,Consolas,monospace',
          'color:#f2f2f2', 'background:rgba(10,10,12,.78)', 'padding:7px 10px', 'border-radius:6px',
          'border-left:3px solid #e5a50a', 'box-shadow:0 2px 10px rgba(0,0,0,.4)'
        ].join(';');
      }
      if (!mountOnTop(overlayEl)) return;
      overlayEl.textContent = overlayLines().join('\n');
    }

    // ------------------------------------------------------------------
    // Top-layer mounting for every on-screen panel
    // ------------------------------------------------------------------
    // A fullscreen element sits in the browser's top layer, above any z-index, and
    // a fullscreen <video> can't hold children at all. Showing our panels as manual
    // popovers puts them in the top layer as well, after (so above) the fullscreen
    // element. Without popover support, fall back to appending inside it.
    var canPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
    var topLayerEls = [];

    function fallbackHost() {
      var fs = doc.fullscreenElement;
      if (fs) {
        if (fs.tagName !== 'VIDEO') return fs;
        if (fs.parentElement) return fs.parentElement;
      }
      return doc.body || doc.documentElement;
    }

    function mountOnTop(el) {
      if (canPopover) {
        var root = doc.body || doc.documentElement;
        if (!root) return false;
        if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
        if (el.parentNode !== root) root.appendChild(el);
        if (!el.matches(':popover-open')) { try { el.showPopover(); } catch (e) { /* not connected */ } }
      } else {
        var host = fallbackHost();
        if (!host) return false;
        if (el.parentNode !== host) host.appendChild(el);
      }
      if (topLayerEls.indexOf(el) === -1) topLayerEls.push(el);
      return true;
    }

    // Entering fullscreen pushes the fullscreen element above our open popovers;
    // re-showing them moves them back to the top of the stack.
    function raiseTopLayer() {
      topLayerEls.forEach(function (el) {
        if (!el.isConnected) return;
        if (!canPopover) { mountOnTop(el); return; }
        try {
          if (el.matches(':popover-open')) el.hidePopover();
          el.showPopover();
        } catch (e) { /* ignore */ }
      });
    }

    // ------------------------------------------------------------------
    // Stats for Nerds HUD (Alt+Shift+N)
    // ------------------------------------------------------------------
    var nerdsEl = null;
    var nerdsToggled = false; // local override via hotkey
    var nerdsPos = { x: 16, y: 16 };
    var isDragging = false;
    var dragStart = { x: 0, y: 0 };

    function makeBufferBar(ahead, maxAhead) {
      maxAhead = maxAhead || 60;
      var pct = Math.min(100, Math.max(0, Math.round((ahead / maxAhead) * 100)));
      var totalChars = 14;
      var filled = Math.min(totalChars, Math.round((pct / 100) * totalChars));
      var bar = '';
      for (var i = 0; i < totalChars; i++) bar += i < filled ? '█' : '░';
      return '[' + bar + '] ' + pct + '%';
    }

    function formatTime(s) {
      if (!s || s < 0) return '0:00';
      var m = Math.floor(s / 60);
      var sec = Math.floor(s % 60);
      if (m >= 60) {
        var h = Math.floor(m / 60);
        m = m % 60;
        return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
      }
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function renderNerds() {
      var active = (settings.nerds || false) !== nerdsToggled;
      var v = mainVideo();
      if (!active || !v) {
        if (nerdsEl && nerdsEl.parentNode) nerdsEl.parentNode.removeChild(nerdsEl);
        return;
      }

      var info = videoInfo(v);
      if (!info) return;

      var cfg = siteCfg();
      var level = getLevel();

      if (!nerdsEl) {
        nerdsEl = doc.createElement('div');
        nerdsEl.setAttribute('data-qualitylock-nerds', '');
        nerdsEl.style.cssText = [
          'all:initial', 'position:fixed', 'z-index:2147483647',
          'top:' + nerdsPos.y + 'px', 'left:' + nerdsPos.x + 'px',
          'width:370px', 'max-width:calc(100vw - 32px)',
          'background:rgba(12,17,26,0.92)', 'backdrop-filter:blur(16px)', '-webkit-backdrop-filter:blur(16px)',
          'border:1px solid rgba(255,255,255,0.12)', 'border-radius:9px',
          'box-shadow:0 12px 38px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)',
          'color:#e6edf3', 'font:11.5px/1.45 ui-monospace,"SF Mono",Consolas,monospace',
          'overflow:hidden', 'user-select:none', '-webkit-user-select:none'
        ].join(';');

        // Header (Draggable)
        var head = doc.createElement('div');
        head.style.cssText = [
          'display:flex', 'align-items:center', 'justify-content:space-between',
          'padding:7px 11px', 'background:rgba(255,255,255,0.04)',
          'border-bottom:1px solid rgba(255,255,255,0.09)', 'cursor:grab'
        ].join(';');

        var title = doc.createElement('div');
        title.style.cssText = 'display:flex;align-items:center;gap:7px;font-weight:700;font-size:11px;letter-spacing:0.04em;color:#f0a020;';
        title.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#5cc189;box-shadow:0 0 6px #5cc189;"></span> STATS FOR NERDS';
        head.appendChild(title);

        var closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Close (Alt+Shift+N)';
        closeBtn.style.cssText = [
          'background:transparent', 'border:none', 'color:#9aa5b0', 'font-size:13px',
          'cursor:pointer', 'padding:0 4px', 'line-height:1'
        ].join(';');
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          nerdsToggled = !nerdsToggled;
          renderNerds();
        });
        head.appendChild(closeBtn);

        head.addEventListener('pointerdown', function (e) {
          if (e.target === closeBtn) return;
          isDragging = true;
          dragStart.x = e.clientX - nerdsPos.x;
          dragStart.y = e.clientY - nerdsPos.y;
          head.style.cursor = 'grabbing';
          head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', function (e) {
          if (!isDragging) return;
          nerdsPos.x = Math.max(0, Math.min(window.innerWidth - 380, e.clientX - dragStart.x));
          nerdsPos.y = Math.max(0, Math.min(window.innerHeight - 340, e.clientY - dragStart.y));
          nerdsEl.style.left = nerdsPos.x + 'px';
          nerdsEl.style.top = nerdsPos.y + 'px';
        });
        head.addEventListener('pointerup', function (e) {
          isDragging = false;
          head.style.cursor = 'grab';
          try { head.releasePointerCapture(e.pointerId); } catch (err) {}
        });

        nerdsEl.appendChild(head);

        var content = doc.createElement('div');
        content.setAttribute('data-nerds-content', '');
        content.style.cssText = 'padding:9px 12px 11px;display:grid;grid-template-columns:120px 1fr;gap:4px 8px;';
        nerdsEl.appendChild(content);
      }

      if (!mountOnTop(nerdsEl)) return;

      var grid = nerdsEl.querySelector('[data-nerds-content]');
      if (!grid) return;

      var lastManifest = stats.last;
      var lastSet = lastManifest && lastManifest.sets && lastManifest.sets[0];
      var formatKind = lastManifest ? lastManifest.kind.toUpperCase() : 'DIRECT/HTML5';
      var lockMode = !cfg.enabled ? 'Off' : cfg.mode === 'floor' ? 'Floor ' + cfg.floor + 'p' : 'Best Only';
      var timeStr = formatTime(info.currentTime) + ' / ' + (info.duration > 0 ? formatTime(info.duration) : 'Live');
      var progressPct = info.duration > 0 ? ' (' + Math.round((info.currentTime / info.duration) * 100) + '%)' : '';
      var fpsStr = info.fps > 0 ? info.fps + ' fps' : '—';
      var resStr = (info.width ? info.width + '×' + info.height : '—') + (info.aspect ? ' (' + info.aspect + ')' : '');
      var viewStr = info.viewportWidth ? info.viewportWidth + '×' + info.viewportHeight + ' (DPR ' + info.dpr + ')' : '—';
      var bufBar = makeBufferBar(info.bufferAhead, 60);

      var rows = [
        ['Platform / Host', SITE_NAMES[SITE] || SITE],
        ['Video Resolution', resStr],
        ['Viewport / Scale', viewStr],
        ['Rendered FPS', fpsStr],
        ['Frames Dropped', (info.dropped !== null ? info.dropped + ' / ' + info.frames + ' (' + info.dropPercent + '%)' : '0 / 0')],
        ['Buffer Ahead', info.bufferAhead + ' s ' + bufBar],
        ['Current Time', timeStr + progressPct],
        ['Live Throughput', (info.speedMbps > 0 ? info.speedMbps + ' Mbps' : '0.00 Mbps') + ' (burst)'],
        ['Total Downloaded', info.downloadedStr + (info.estPerHour ? ' · ~' + info.estPerHour : '')],
        ['Total Uploaded', info.uploadedStr],
        ['Media Chunks', info.segments + ' segments'],
        ['Stream Protocol', formatKind],
        ['QualityLock Mode', lockMode + (level ? ' [L' + level + ']' : '')]
      ];

      if (lastSet) {
        rows.push(['Lock Filter', 'Kept ' + lastSet.kept.slice(0, 2).join(', ') + (lastSet.dropped.length ? ' (-' + lastSet.dropped.length + ' dropped)' : '')]);
      }

      var html = '';
      for (var r = 0; r < rows.length; r++) {
        var label = rows[r][0];
        var val = rows[r][1];
        var valColor = '#e6edf3';
        if (label === 'Live Throughput' && info.speedMbps > 0) valColor = '#5cc189';
        else if (label === 'Buffer Ahead' && info.bufferAhead < 8) valColor = '#ff8a80';
        else if (label === 'Frames Dropped' && parseFloat(info.dropPercent) > 1) valColor = '#ff8a80';
        else if (label === 'QualityLock Mode' && cfg.enabled) valColor = '#f0a020';
        html += '<span style="color:#8b949e;white-space:nowrap;">' + label + ':</span>' +
                '<span style="color:' + valColor + ';font-weight:600;word-break:break-all;">' + val + '</span>';
      }
      grid.innerHTML = html;
    }

    // ------------------------------------------------------------------
    // Video Controller & Aspect Ratio Engine
    // ------------------------------------------------------------------
    var vTransform = {
      zoom: 1.0,         // uniform zoom: 0.5 to 3.0
      scaleX: 1.0,       // horizontal stretch (left + right): 0.5 to 2.5
      scaleY: 1.0,       // vertical stretch (top + bottom): 0.5 to 2.5
      panX: 0,
      panY: 0,
      mode: 'original'   // 'original' | 'fill' | 'stretch-fill' | '16:9' | '21:9' | '4:3' | 'custom'
    };

    var vHudOpen = false;
    var vHudMinimized = false;
    var vHudEl = null;
    var vHudPos = { x: 24, y: 70 };
    var isDraggingHud = false;
    var hudDragStart = { x: 0, y: 0 };
    var vOsdEl = null;
    var vOsdTimer = null;
    // Shortcut labels from chrome://extensions/shortcuts, sent along with commands.
    var shortcutKeys = { hud: 'Alt+Z', ratio: 'Alt+X' };

    function vcCfg() {
      var vc = (settings && settings.videoController) || {};
      return {
        enabled: vc.enabled !== false,
        showOsd: vc.showOsd !== false
      };
    }

    function keyLabel(k) {
      return shortcutKeys[k] || 'no shortcut';
    }

    function targetVideo() {
      var fs = doc.fullscreenElement;
      if (fs) {
        if (fs.tagName === 'VIDEO') return fs;
        if (fs.querySelector) {
          var vInFs = fs.querySelector('video');
          if (vInFs) return vInFs;
        }
      }
      return mainVideo();
    }

    function getDisplayDimensions(v) {
      var fs = doc.fullscreenElement;
      if (fs) {
        return {
          width: G.innerWidth,
          height: G.innerHeight,
          ratio: G.innerWidth / G.innerHeight,
          isFullscreen: true
        };
      }
      var parent = v ? v.parentElement : null;
      var w = (parent && parent.clientWidth > 0) ? parent.clientWidth : (v && v.clientWidth > 0 ? v.clientWidth : G.innerWidth);
      var h = (parent && parent.clientHeight > 0) ? parent.clientHeight : (v && v.clientHeight > 0 ? v.clientHeight : G.innerHeight);
      return {
        width: w,
        height: h,
        ratio: w / h,
        isFullscreen: false
      };
    }

    var styledVideo = null;  // the <video> currently carrying our scale/translate
    var styleGuard = null;   // re-applies them when the player rewrites its style attribute
    var probeStyle = doc.createElement('div').style;

    // Writes only when the value actually differs (compared in the browser's own
    // serialization), so the style observer below can't feed itself.
    function setImportant(el, prop, val) {
      probeStyle.setProperty(prop, val);
      if (el.style.getPropertyValue(prop) === probeStyle.getPropertyValue(prop) &&
          el.style.getPropertyPriority(prop) === 'important') return;
      el.style.setProperty(prop, val, 'important');
    }

    function releaseStyledVideo() {
      if (styleGuard) styleGuard.disconnect();
      if (styledVideo) {
        styledVideo.style.removeProperty('scale');
        styledVideo.style.removeProperty('translate');
        styledVideo.style.removeProperty('transform-origin');
      }
      styledVideo = null;
    }

    function applyVideoTransform() {
      var v = targetVideo();
      if (styledVideo && styledVideo !== v) releaseStyledVideo();
      if (!v) return;

      var isDefault = Math.abs(vTransform.zoom - 1.0) < 0.002 &&
                     Math.abs(vTransform.scaleX - 1.0) < 0.002 &&
                     Math.abs(vTransform.scaleY - 1.0) < 0.002 &&
                     vTransform.panX === 0 && vTransform.panY === 0;

      if (isDefault) {
        if (styledVideo) releaseStyledVideo();
        return;
      }

      // The standalone scale/translate properties, not transform: the browser's
      // fullscreen stylesheet forces `transform: none !important` on the fullscreen
      // element, which beats any page style, so a transform-based zoom silently does
      // nothing once the <video> itself goes fullscreen. These also compose with a
      // transform the player sets for its own layout instead of overwriting it.
      var effX = (vTransform.scaleX * vTransform.zoom).toFixed(4);
      var effY = (vTransform.scaleY * vTransform.zoom).toFixed(4);
      setImportant(v, 'scale', effX + ' ' + effY);
      setImportant(v, 'translate', vTransform.panX + 'px ' + vTransform.panY + 'px');
      setImportant(v, 'transform-origin', '50% 50%');

      if (styledVideo !== v) {
        styledVideo = v;
        if (typeof MutationObserver === 'function') {
          if (!styleGuard) styleGuard = new MutationObserver(function () { applyVideoTransform(); });
          styleGuard.observe(v, { attributes: true, attributeFilter: ['style'] });
        }
      }
    }

    function showVideoOsd(title, desc) {
      if (!vcCfg().showOsd) return;

      if (!vOsdEl) {
        vOsdEl = doc.createElement('div');
        vOsdEl.setAttribute('data-qlock-video-osd', '');
        vOsdEl.style.cssText = [
          'all:initial', 'position:fixed', 'top:28px', 'left:50%', 'transform:translateX(-50%)',
          'z-index:2147483647', 'pointer-events:none',
          'background:rgba(12,17,26,0.92)', 'backdrop-filter:blur(16px)', '-webkit-backdrop-filter:blur(16px)',
          'border:1px solid rgba(240,160,32,0.4)', 'border-radius:10px',
          'padding:9px 18px', 'box-shadow:0 12px 32px rgba(0,0,0,0.65)',
          'display:flex', 'flex-direction:column', 'align-items:center', 'gap:2px',
          'opacity:0', 'transition:opacity 0.2s ease, transform 0.2s ease',
          'user-select:none', '-webkit-user-select:none'
        ].join(';');

        var tag = doc.createElement('div');
        tag.style.cssText = 'font:700 9.5px/1 ui-monospace,Consolas,monospace;letter-spacing:0.08em;color:#f0a020;text-transform:uppercase;margin-bottom:2px;';
        tag.textContent = 'QUALITYLOCK · VIDEO CONTROLLER';
        vOsdEl.appendChild(tag);

        var titleEl = doc.createElement('div');
        titleEl.setAttribute('data-osd-title', '');
        titleEl.style.cssText = 'font:700 14px/1.3 "Segoe UI",system-ui,sans-serif;color:#ffffff;letter-spacing:0.01em;';
        vOsdEl.appendChild(titleEl);

        var descEl = doc.createElement('div');
        descEl.setAttribute('data-osd-desc', '');
        descEl.style.cssText = 'font:500 11.5px/1.2 ui-monospace,Consolas,monospace;color:#9aa5b0;';
        vOsdEl.appendChild(descEl);
      }

      if (!mountOnTop(vOsdEl)) return;

      var tEl = vOsdEl.querySelector('[data-osd-title]');
      var dEl = vOsdEl.querySelector('[data-osd-desc]');
      if (tEl) tEl.textContent = title;
      if (dEl) dEl.textContent = desc || '';

      vOsdEl.style.opacity = '1';
      vOsdEl.style.transform = 'translateX(-50%) translateY(0)';

      if (vOsdTimer) clearTimeout(vOsdTimer);
      vOsdTimer = setTimeout(function () {
        if (vOsdEl) {
          vOsdEl.style.opacity = '0';
          vOsdEl.style.transform = 'translateX(-50%) translateY(-6px)';
        }
      }, 2200);
    }

    function setZoom(z, quiet) {
      vTransform.zoom = Math.max(0.5, Math.min(3.0, parseFloat(z.toFixed(2))));
      vTransform.mode = 'custom';
      applyVideoTransform();
      updateHudUI();
      if (!quiet) showVideoOsd('Zoom: ' + Math.round(vTransform.zoom * 100) + '%', 'Uniform scale (all edges)');
    }

    function setStretchX(sx, quiet) {
      vTransform.scaleX = Math.max(0.5, Math.min(2.5, parseFloat(sx.toFixed(2))));
      vTransform.mode = 'custom';
      applyVideoTransform();
      updateHudUI();
      if (!quiet) showVideoOsd('↔ Stretch Left + Right: ' + Math.round(vTransform.scaleX * 100) + '%', 'Stretches horizontally from center');
    }

    function setStretchY(sy, quiet) {
      vTransform.scaleY = Math.max(0.5, Math.min(2.5, parseFloat(sy.toFixed(2))));
      vTransform.mode = 'custom';
      applyVideoTransform();
      updateHudUI();
      if (!quiet) showVideoOsd('↕ Stretch Top + Bottom: ' + Math.round(vTransform.scaleY * 100) + '%', 'Stretches vertically from center');
    }

    function resetVideoTransform() {
      vTransform.zoom = 1.0;
      vTransform.scaleX = 1.0;
      vTransform.scaleY = 1.0;
      vTransform.panX = 0;
      vTransform.panY = 0;
      vTransform.mode = 'original';
      applyVideoTransform();
      updateHudUI();
      showVideoOsd('Ratio: Original (100%)', 'Video reset to normal proportions');
    }

    function applyFixRatio() {
      var v = targetVideo();
      if (!v) {
        showVideoOsd('Fix Ratio', 'No active video detected');
        return;
      }
      var rVid = (v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (16 / 9);
      var disp = getDisplayDimensions(v);
      var rDisp = disp.ratio;
      var zoom = 1.0;
      var note = '';

      if (rVid > rDisp + 0.02) {
        zoom = rVid / rDisp;
        note = 'Top & bottom letterbox bars eliminated (' + Math.round(zoom * 100) + '%)';
      } else if (rVid < rDisp - 0.02) {
        zoom = rDisp / rVid;
        note = 'Left & right pillarbox bars eliminated (' + Math.round(zoom * 100) + '%)';
      } else {
        zoom = 1.0;
        note = 'Aspect ratio matches display (' + Math.round(zoom * 100) + '%)';
      }

      vTransform.zoom = Math.max(1.0, Math.min(3.0, parseFloat(zoom.toFixed(3))));
      vTransform.scaleX = 1.0;
      vTransform.scaleY = 1.0;
      vTransform.panX = 0;
      vTransform.panY = 0;
      vTransform.mode = 'fill';
      applyVideoTransform();
      updateHudUI();
      showVideoOsd('✨ Fix Ratio (Fill / Crop)', note);
    }

    function applyStretchFill() {
      var v = targetVideo();
      if (!v) return;
      var rVid = (v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (16 / 9);
      var disp = getDisplayDimensions(v);
      var rDisp = disp.ratio;
      vTransform.zoom = 1.0;
      vTransform.panX = 0;
      vTransform.panY = 0;

      if (rVid > rDisp + 0.02) {
        vTransform.scaleX = 1.0;
        vTransform.scaleY = parseFloat((rVid / rDisp).toFixed(3));
        vTransform.mode = 'stretch-fill';
        showVideoOsd('↔ Stretch to Fill (Height: ' + Math.round(vTransform.scaleY * 100) + '%)', 'Top + bottom stretched to edge without cropping');
      } else if (rVid < rDisp - 0.02) {
        vTransform.scaleX = parseFloat((rDisp / rVid).toFixed(3));
        vTransform.scaleY = 1.0;
        vTransform.mode = 'stretch-fill';
        showVideoOsd('↔ Stretch to Fill (Width: ' + Math.round(vTransform.scaleX * 100) + '%)', 'Left + right stretched to edge without cropping');
      } else {
        vTransform.scaleX = 1.0;
        vTransform.scaleY = 1.0;
        vTransform.mode = 'original';
        showVideoOsd('Ratio: Original', 'Display matches video ratio');
      }
      applyVideoTransform();
      updateHudUI();
    }

    function applyPreset169() {
      var v = targetVideo();
      var rVid = (v && v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (4 / 3);
      vTransform.zoom = 1.0;
      vTransform.panX = 0;
      vTransform.panY = 0;
      vTransform.scaleX = parseFloat(((16 / 9) / rVid).toFixed(3));
      vTransform.scaleY = 1.0;
      vTransform.mode = '16:9';
      applyVideoTransform();
      updateHudUI();
      showVideoOsd('Preset: 16:9 Stretch (' + Math.round(vTransform.scaleX * 100) + '%)', 'Symmetric horizontal stretch to 16:9');
    }

    function applyPreset219() {
      var v = targetVideo();
      var rVid = (v && v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (16 / 9);
      vTransform.zoom = 1.0;
      vTransform.panX = 0;
      vTransform.panY = 0;
      vTransform.scaleX = parseFloat(((21 / 9) / rVid).toFixed(3));
      vTransform.scaleY = 1.0;
      vTransform.mode = '21:9';
      applyVideoTransform();
      updateHudUI();
      showVideoOsd('Preset: 21:9 Ultrawide (' + Math.round(vTransform.scaleX * 100) + '%)', 'Symmetric stretch for Cinemascope / Ultrawide');
    }

    var QUICK_CYCLE_STEPS = ['original', 'fill', 'stretch-fill', '16:9', '21:9', 'zoom125', 'zoom150'];
    var quickCycleIndex = 0;

    function cycleQuickRatioMode() {
      quickCycleIndex = (quickCycleIndex + 1) % QUICK_CYCLE_STEPS.length;
      var step = QUICK_CYCLE_STEPS[quickCycleIndex];
      if (step === 'original') resetVideoTransform();
      else if (step === 'fill') applyFixRatio();
      else if (step === 'stretch-fill') applyStretchFill();
      else if (step === '16:9') applyPreset169();
      else if (step === '21:9') applyPreset219();
      else if (step === 'zoom125') {
        vTransform.scaleX = 1.0; vTransform.scaleY = 1.0; setZoom(1.25);
      } else if (step === 'zoom150') {
        vTransform.scaleX = 1.0; vTransform.scaleY = 1.0; setZoom(1.50);
      }
    }

    function handleVideoAction(action, params) {
      if (action === 'setZoom') setZoom(params && params.zoom ? params.zoom : 1.0);
      else if (action === 'setStretchX') setStretchX(params && params.scaleX ? params.scaleX : 1.0);
      else if (action === 'setStretchY') setStretchY(params && params.scaleY ? params.scaleY : 1.0);
      else if (action === 'fixRatio') applyFixRatio();
      else if (action === 'stretchFill') applyStretchFill();
      else if (action === 'preset169') applyPreset169();
      else if (action === 'preset219') applyPreset219();
      else if (action === 'zoomIn') setZoom(vTransform.zoom + 0.05);
      else if (action === 'zoomOut') setZoom(vTransform.zoom - 0.05);
      else if (action === 'reset') resetVideoTransform();
      else if (action === 'cycle') cycleQuickRatioMode();
      else if (action === 'toggleHud') toggleVideoHud();
    }

    function getVideoTransformSnapshot() {
      return {
        zoom: vTransform.zoom,
        scaleX: vTransform.scaleX,
        scaleY: vTransform.scaleY,
        panX: vTransform.panX,
        panY: vTransform.panY,
        mode: vTransform.mode,
        hudOpen: vHudOpen,
        hudMinimized: vHudMinimized
      };
    }

    // ------------------------------------------------------------------
    // Video Controller Floating HUD UI
    // ------------------------------------------------------------------
    function toggleVideoHud() {
      vHudOpen = !vHudOpen;
      renderVideoHud();
      if (vHudOpen) {
        showVideoOsd('Video Controller HUD', 'Opened (' + keyLabel('hud') + ' to toggle)');
      }
    }

    function updateHudVideoInfo() {
      if (!vHudEl) return;
      var v = targetVideo();
      var infoEl = vHudEl.querySelector('[data-hud-info]');
      if (infoEl) {
        if (v && v.videoWidth) {
          var r = (v.videoWidth / v.videoHeight).toFixed(2);
          var isFs = !!doc.fullscreenElement;
          infoEl.textContent = v.videoWidth + '×' + v.videoHeight + ' (' + r + ':1)' + (isFs ? ' · Fullscreen' : '');
        } else {
          infoEl.textContent = 'No video detected';
        }
      }
    }

    function updateHudUI() {
      if (!vHudEl) return;
      var zoomVal = Math.round(vTransform.zoom * 100);
      var sxVal = Math.round(vTransform.scaleX * 100);
      var syVal = Math.round(vTransform.scaleY * 100);

      var zLabel = vHudEl.querySelector('[data-hud-zoom-val]');
      var zRange = vHudEl.querySelector('[data-hud-zoom-range]');
      if (zLabel) zLabel.textContent = zoomVal + '%';
      if (zRange) zRange.value = zoomVal;

      var sxLabel = vHudEl.querySelector('[data-hud-sx-val]');
      var sxRange = vHudEl.querySelector('[data-hud-sx-range]');
      if (sxLabel) sxLabel.textContent = sxVal + '%';
      if (sxRange) sxRange.value = sxVal;

      var syLabel = vHudEl.querySelector('[data-hud-sy-val]');
      var syRange = vHudEl.querySelector('[data-hud-sy-range]');
      if (syLabel) syLabel.textContent = syVal + '%';
      if (syRange) syRange.value = syVal;

      var modeBadge = vHudEl.querySelector('[data-hud-mode]');
      if (modeBadge) {
        var modeLabels = {
          original: 'Normal 100%',
          fill: '✨ Fix Ratio (Fill)',
          'stretch-fill': '↔ Stretch Fill',
          '16:9': '16:9 Stretch',
          '21:9': '21:9 Ultrawide',
          custom: 'Custom (' + zoomVal + '%)'
        };
        modeBadge.textContent = modeLabels[vTransform.mode] || vTransform.mode;
      }
      var hudKey = vHudEl.querySelector('[data-hud-key-hud]');
      var ratioKey = vHudEl.querySelector('[data-hud-key-ratio]');
      var closeEl = vHudEl.querySelector('[data-hud-close]');
      if (hudKey) hudKey.textContent = keyLabel('hud');
      if (ratioKey) ratioKey.textContent = keyLabel('ratio');
      if (closeEl) closeEl.title = 'Close (' + keyLabel('hud') + ')';
      updateHudVideoInfo();
    }

    function renderVideoHud() {
      if (!vHudOpen) {
        if (vHudEl && vHudEl.parentNode) vHudEl.parentNode.removeChild(vHudEl);
        return;
      }

      if (!vHudEl) {
        vHudEl = doc.createElement('div');
        vHudEl.setAttribute('data-qlock-videohud', '');
        vHudEl.style.cssText = [
          'all:initial', 'position:fixed', 'z-index:2147483647',
          'top:' + vHudPos.y + 'px', 'left:' + vHudPos.x + 'px',
          'width:340px', 'max-width:calc(100vw - 32px)',
          'background:rgba(12,17,26,0.94)', 'backdrop-filter:blur(18px)', '-webkit-backdrop-filter:blur(18px)',
          'border:1px solid rgba(255,255,255,0.14)', 'border-radius:10px',
          'box-shadow:0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(240,160,32,0.18)',
          'font:11.5px/1.4 ui-monospace,"SF Mono",Consolas,system-ui,sans-serif',
          'color:#e6edf3', 'user-select:none', '-webkit-user-select:none', 'overflow:hidden'
        ].join(';');

        // Header (Draggable)
        var head = doc.createElement('div');
        head.setAttribute('data-hud-head', '');
        head.style.cssText = [
          'display:flex', 'align-items:center', 'justify-content:space-between',
          'padding:7px 11px', 'background:rgba(255,255,255,0.04)',
          'border-bottom:1px solid rgba(255,255,255,0.09)', 'cursor:grab'
        ].join(';');

        var titleArea = doc.createElement('div');
        titleArea.style.cssText = 'display:flex;align-items:center;gap:7px;font-weight:700;font-size:11px;letter-spacing:0.04em;color:#f0a020;';
        titleArea.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f0a020;box-shadow:0 0 6px #f0a020;"></span> VIDEO CONTROLLER';
        head.appendChild(titleArea);

        var rightHead = doc.createElement('div');
        rightHead.style.cssText = 'display:flex;align-items:center;gap:6px;';

        var minBtn = doc.createElement('button');
        minBtn.type = 'button';
        minBtn.textContent = '—';
        minBtn.title = 'Minimize / Expand';
        minBtn.style.cssText = 'background:transparent;border:none;color:#9aa5b0;font-size:13px;cursor:pointer;padding:0 4px;line-height:1;';
        minBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          vHudMinimized = !vHudMinimized;
          renderVideoHud();
        });
        rightHead.appendChild(minBtn);

        var closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('data-hud-close', '');
        closeBtn.style.cssText = 'background:transparent;border:none;color:#9aa5b0;font-size:13px;cursor:pointer;padding:0 4px;line-height:1;';
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          vHudOpen = false;
          renderVideoHud();
        });
        rightHead.appendChild(closeBtn);
        head.appendChild(rightHead);

        // Dragging handlers
        head.addEventListener('pointerdown', function (e) {
          if (e.target === closeBtn || e.target === minBtn) return;
          isDraggingHud = true;
          hudDragStart.x = e.clientX - vHudPos.x;
          hudDragStart.y = e.clientY - vHudPos.y;
          head.style.cursor = 'grabbing';
          head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', function (e) {
          if (!isDraggingHud) return;
          vHudPos.x = Math.max(0, Math.min(window.innerWidth - 350, e.clientX - hudDragStart.x));
          vHudPos.y = Math.max(0, Math.min(window.innerHeight - 380, e.clientY - hudDragStart.y));
          vHudEl.style.left = vHudPos.x + 'px';
          vHudEl.style.top = vHudPos.y + 'px';
        });
        head.addEventListener('pointerup', function (e) {
          isDraggingHud = false;
          head.style.cursor = 'grab';
          try { head.releasePointerCapture(e.pointerId); } catch (err) {}
        });

        vHudEl.appendChild(head);

        // Body Container
        var body = doc.createElement('div');
        body.setAttribute('data-hud-body', '');
        body.style.cssText = 'padding:10px 12px;display:flex;flex-direction:column;gap:9px;';

        // Video Info & Mode Bar
        var infoRow = doc.createElement('div');
        infoRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#8b949e;padding-bottom:3px;border-bottom:1px solid rgba(255,255,255,0.06);';
        infoRow.innerHTML = '<span data-hud-info>Detecting video…</span><span data-hud-mode style="color:#5cc189;font-weight:700;">Normal</span>';
        body.appendChild(infoRow);

        // Quick Presets Row
        var presetsRow = doc.createElement('div');
        presetsRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';

        function makeHudBtn(txt, title, onClick, isPrimary) {
          var b = doc.createElement('button');
          b.type = 'button';
          b.textContent = txt;
          b.title = title;
          b.style.cssText = [
            'font:600 10.5px ui-monospace,Consolas,monospace',
            'background:' + (isPrimary ? '#f0a020' : 'rgba(255,255,255,0.07)'),
            'color:' + (isPrimary ? '#0f141c' : '#e6edf3'),
            'border:1px solid ' + (isPrimary ? '#f0a020' : 'rgba(255,255,255,0.12)'),
            'border-radius:4px', 'padding:4px 8px', 'cursor:pointer', 'transition:all .15s ease'
          ].join(';');
          b.addEventListener('mouseover', function () {
            if (!isPrimary) b.style.background = 'rgba(255,255,255,0.14)';
          });
          b.addEventListener('mouseout', function () {
            if (!isPrimary) b.style.background = 'rgba(255,255,255,0.07)';
          });
          b.addEventListener('click', onClick);
          return b;
        }

        presetsRow.appendChild(makeHudBtn('✨ Fix Ratio', 'Smart crop to eliminate top/bottom or side black bars', applyFixRatio, true));
        presetsRow.appendChild(makeHudBtn('↔ Stretch Fill', 'Stretch edges to touch screen without cropping', applyStretchFill));
        presetsRow.appendChild(makeHudBtn('16:9', 'Stretch horizontally to 16:9', applyPreset169));
        presetsRow.appendChild(makeHudBtn('21:9', 'Stretch to 21:9 ultrawide', applyPreset219));
        presetsRow.appendChild(makeHudBtn('↺ Reset', 'Reset zoom and stretch to 100%', resetVideoTransform));
        body.appendChild(presetsRow);

        // Helper for building slider rows
        function createSliderGroup(labelTxt, descTxt, min, max, step, valAttr, rangeAttr, onValChange, chips) {
          var group = doc.createElement('div');
          group.style.cssText = 'display:flex;flex-direction:column;gap:3px;background:rgba(255,255,255,0.03);padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.06);';

          var top = doc.createElement('div');
          top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
          top.innerHTML = '<span style="font-weight:700;font-size:10px;color:#9aa5b0;letter-spacing:0.04em;">' + labelTxt +
                          ' <small style="font-weight:400;color:#6b7684;">(' + descTxt + ')</small></span>' +
                          '<span ' + valAttr + ' style="font-weight:700;font-size:11px;color:#f0a020;">100%</span>';
          group.appendChild(top);

          var controls = doc.createElement('div');
          controls.style.cssText = 'display:flex;align-items:center;gap:6px;';

          var minusBtn = doc.createElement('button');
          minusBtn.type = 'button';
          minusBtn.textContent = '−';
          minusBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:3px;width:22px;height:22px;cursor:pointer;font-weight:700;line-height:1;';
          controls.appendChild(minusBtn);

          var range = doc.createElement('input');
          range.type = 'range';
          range.min = min;
          range.max = max;
          range.step = step;
          range.value = 100;
          range.setAttribute(rangeAttr, '');
          range.style.cssText = 'flex:1;accent-color:#f0a020;cursor:pointer;height:4px;';
          controls.appendChild(range);

          var plusBtn = doc.createElement('button');
          plusBtn.type = 'button';
          plusBtn.textContent = '+';
          plusBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:3px;width:22px;height:22px;cursor:pointer;font-weight:700;line-height:1;';
          controls.appendChild(plusBtn);

          minusBtn.addEventListener('click', function () {
            var n = Math.max(min, (+range.value) - step);
            range.value = n;
            onValChange(n / 100);
          });
          plusBtn.addEventListener('click', function () {
            var n = Math.min(max, (+range.value) + step);
            range.value = n;
            onValChange(n / 100);
          });
          range.addEventListener('input', function () {
            onValChange((+range.value) / 100);
          });

          group.appendChild(controls);

          if (chips && chips.length) {
            var chipRow = doc.createElement('div');
            chipRow.style.cssText = 'display:flex;gap:4px;margin-top:2px;';
            chips.forEach(function (c) {
              var chip = doc.createElement('button');
              chip.type = 'button';
              chip.textContent = c + '%';
              chip.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.09);color:#8b949e;border-radius:3px;font-size:9.5px;padding:1px 5px;cursor:pointer;';
              chip.addEventListener('click', function () {
                range.value = c;
                onValChange(c / 100);
              });
              chipRow.appendChild(chip);
            });
            group.appendChild(chipRow);
          }

          return group;
        }

        // 1. Zoom Slider
        body.appendChild(createSliderGroup(
          'ZOOM', 'all 4 sides equally', 50, 300, 5,
          'data-hud-zoom-val', 'data-hud-zoom-range',
          function (val) { setZoom(val, true); },
          [100, 125, 150, 200]
        ));

        // 2. Horizontal Stretch (Right + Left same time)
        body.appendChild(createSliderGroup(
          '↔ STRETCH LEFT + RIGHT', 'stretches width symmetrically', 50, 200, 5,
          'data-hud-sx-val', 'data-hud-sx-range',
          function (val) { setStretchX(val, true); },
          [80, 100, 120, 133]
        ));

        // 3. Vertical Stretch (Top + Bottom same time)
        body.appendChild(createSliderGroup(
          '↕ STRETCH TOP + BOTTOM', 'stretches height symmetrically', 50, 200, 5,
          'data-hud-sy-val', 'data-hud-sy-range',
          function (val) { setStretchY(val, true); },
          [80, 100, 120, 133]
        ));

        // Footer Cheatsheet
        var foot = doc.createElement('div');
        foot.style.cssText = 'font-size:9.5px;color:#8b949e;border-top:1px solid rgba(255,255,255,0.06);padding-top:5px;display:flex;justify-content:space-between;';
        foot.innerHTML = '<span><kbd data-hud-key-hud style="color:#e6edf3;"></kbd> HUD · <kbd data-hud-key-ratio style="color:#e6edf3;"></kbd> Fix Ratio</span><span>Shift+Arrows Nudge</span>';
        body.appendChild(foot);

        vHudEl.appendChild(body);
      }

      var hudBody = vHudEl.querySelector('[data-hud-body]');
      if (hudBody) hudBody.style.display = vHudMinimized ? 'none' : 'flex';

      if (!mountOnTop(vHudEl)) return;
      updateHudUI();
    }

    // ------------------------------------------------------------------
    // Event Matcher & Listeners
    // ------------------------------------------------------------------
    // Tell the extension how good this frame's video is, so keyboard commands and
    // the popup reach the frame that actually plays it (embedded players are iframes).
    var reportedScore = 0;
    function reportVideoScore() {
      var score = Math.round(videoScore(mainVideo()) / 1e6);
      if (score === reportedScore) return;
      reportedScore = score;
      try { G.postMessage({ __qlock: 'videoScore', score: score }, origin); } catch (e) { /* opaque origin */ }
    }

    setInterval(function () {
      renderOverlay();
      renderNerds();
      applyVideoTransform();
      reportVideoScore();
      if (vHudOpen) updateHudVideoInfo();
    }, 1000);

    doc.addEventListener('fullscreenchange', function () {
      renderOverlay();
      renderNerds();
      if (vHudOpen) renderVideoHud();
      if (vTransform.mode === 'fill') applyFixRatio();
      else if (vTransform.mode === 'stretch-fill') applyStretchFill();
      else applyVideoTransform();
      raiseTopLayer();
    });

    G.addEventListener('keydown', function (e) {
      // 1. Built-in QualityLock hotkeys (Alt+Shift+Q, Alt+Shift+N)
      if (e.altKey && e.shiftKey && !e.ctrlKey) {
        if (e.code === 'KeyQ') {
          keyToggled = !keyToggled;
          flashUntil = 0;
          renderOverlay();
          e.preventDefault();
          e.stopPropagation();
          return;
        } else if (e.code === 'KeyN') {
          nerdsToggled = !nerdsToggled;
          renderNerds();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // Avoid capturing when typing into forms
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

      if (!vcCfg().enabled) return;

      // The HUD and Fix Ratio shortcuts are extension commands (background.js), so
      // they show up and can be rebound at chrome://extensions/shortcuts.

      // 2. Shift + Keys for incremental adjustments
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          setZoom(vTransform.zoom + 0.05);
          e.preventDefault(); e.stopPropagation();
        } else if (e.key === '-' || e.key === '_') {
          setZoom(vTransform.zoom - 0.05);
          e.preventDefault(); e.stopPropagation();
        } else if (e.key === 'ArrowUp') {
          setStretchY(vTransform.scaleY + 0.05);
          e.preventDefault(); e.stopPropagation();
        } else if (e.key === 'ArrowDown') {
          setStretchY(vTransform.scaleY - 0.05);
          e.preventDefault(); e.stopPropagation();
        } else if (e.key === 'ArrowRight') {
          setStretchX(vTransform.scaleX + 0.05);
          e.preventDefault(); e.stopPropagation();
        } else if (e.key === 'ArrowLeft') {
          setStretchX(vTransform.scaleX - 0.05);
          e.preventDefault(); e.stopPropagation();
        } else if (e.key === ')' || e.code === 'Digit0') {
          resetVideoTransform();
          e.preventDefault(); e.stopPropagation();
        }
      }
    }, true);

    // --- messages from the extension bridge ---
    G.addEventListener('message', function (e) {
      if (e.source !== G || !e.data || typeof e.data !== 'object') return;
      var d = e.data;
      if (d.__qlock === 'settings' && d.settings && typeof d.settings === 'object') {
        settings = d.settings;
        renderOverlay();
        renderNerds();
        if (vHudOpen) updateHudUI();
      } else if (d.__qlock === 'getStatus') {
        G.postMessage({ __qlock: 'status', id: d.id, status: statusSnapshot() }, origin);
      } else if (d.__qlock === 'resetLevel') {
        setLevel(0);
        renderOverlay();
        renderNerds();
      } else if (d.__qlock === 'toggleNerds') {
        nerdsToggled = !nerdsToggled;
        renderNerds();
      } else if (d.__qlock === 'toggleVideoController') {
        toggleVideoHud();
      } else if (d.__qlock === 'videoTransform') {
        if (d.keys && typeof d.keys === 'object') {
          shortcutKeys = { hud: String(d.keys.hud || ''), ratio: String(d.keys.ratio || '') };
        }
        handleVideoAction(d.action, d.params);
      }
    });

    api.statusSnapshot = statusSnapshot;
    return api;
  }

  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = QL;
    return;
  }
  if (window.__qlockInstalled) return;
  try { Object.defineProperty(window, '__qlockInstalled', { value: true }); } catch (e) { return; }
  QL(window, null);
})();
