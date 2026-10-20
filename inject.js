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

    function mainVideo() {
      var vids = doc.getElementsByTagName('video');
      var best = null;
      var bestScore = -1;
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var score = (v.videoWidth * v.videoHeight) + (v.paused ? 0 : 1e9) + (v.readyState * 1e8);
        if (score > bestScore) { best = v; bestScore = score; }
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
        last: stats.last, playing: videoInfo(mainVideo())
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
      var fs = doc.fullscreenElement;
      var host = fs && fs.tagName !== 'VIDEO' ? fs : (doc.body || doc.documentElement);
      if (!host) return;
      if (overlayEl.parentNode !== host) host.appendChild(overlayEl);
      overlayEl.textContent = overlayLines().join('\n');
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
      var hostFs = doc.fullscreenElement;
      var host = hostFs && hostFs.tagName !== 'VIDEO' ? hostFs : (doc.body || doc.documentElement);
      if (!host) return;

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

      if (nerdsEl.parentNode !== host) host.appendChild(nerdsEl);

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

    setInterval(function () {
      renderOverlay();
      renderNerds();
    }, 1000);

    doc.addEventListener('fullscreenchange', function () {
      renderOverlay();
      renderNerds();
    });

    G.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && !e.ctrlKey) {
        if (e.code === 'KeyQ') {
          keyToggled = !keyToggled;
          flashUntil = 0;
          renderOverlay();
          e.preventDefault();
          e.stopPropagation();
        } else if (e.code === 'KeyN') {
          nerdsToggled = !nerdsToggled;
          renderNerds();
          e.preventDefault();
          e.stopPropagation();
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
      } else if (d.__qlock === 'getStatus') {
        G.postMessage({ __qlock: 'status', id: d.id, status: statusSnapshot() }, origin);
      } else if (d.__qlock === 'resetLevel') {
        setLevel(0);
        renderOverlay();
        renderNerds();
      } else if (d.__qlock === 'toggleNerds') {
        nerdsToggled = !nerdsToggled;
        renderNerds();
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
