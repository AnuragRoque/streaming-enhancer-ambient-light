// QualityLock player (local.html): plays video files from your computer.
//
// A file dropped into a browser tab plays from file://, where Chrome doesn't let
// an extension read the video's frames, so Auto black bars, ambient light, blur
// fill and snapshots can't work, and Chrome's own video page sizes the video to
// the picture, leaving no bars to fill. Here files play from blob: URLs this page
// owns, in a video box that fills the window.
//
// The controls are this page's own. QualityLock's display engine, backdrop,
// picture filters and toolbar come from player.js, loaded by local.html as on any
// site; the controls reach it with the same messages the popup sends.
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var stage = $('stage'), surface = $('surface'), ui = $('ui'), menu = $('menu');
  var pick = $('pick'), note = $('note'), drop = $('drop');
  var flashEl = $('flash'), toastEl = $('toast'), spinner = $('spinner');
  var seek = $('seek'), knob = $('knob'), played = $('played'), buf = $('buf'), hov = $('hov');
  var preview = $('preview'), thumb = $('thumb'), previewTime = $('previewTime');
  var volBox = $('vol'), volSlider = $('volSlider'), volRail = volSlider.querySelector('.vr');
  var volFill = $('volFill'), volKnob = $('volKnob'), volVal = $('volVal');
  var curEl = $('cur'), durEl = $('dur'), titleEl = $('title'), titleSub = $('titleSub'), speedBtn = $('speedBtn');
  var fileInput = $('fileInput'), dirInput = $('dirInput');
  var video = null;
  var noop = function () {};

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function save(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* storage blocked */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // QualityLock actions in player.js: the same messages the popup sends.
  function act(action, params) {
    window.postMessage({ __qlock: 'player', action: action, params: params || null }, location.origin);
  }
  // player.js's state (display mode, backdrop) for the settings menu.
  function qlStatus(cb) {
    var id = 'p' + Math.random().toString(36).slice(2);
    var done = false;
    function onMsg(e) {
      if (e.source !== window || !e.data || e.data.__qlock !== 'status' || e.data.id !== id) return;
      finish(e.data.status && e.data.status.player);
    }
    function finish(s) {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      cb(s || null);
    }
    window.addEventListener('message', onMsg);
    window.postMessage({ __qlock: 'getStatus', id: id }, location.origin);
    setTimeout(function () { finish(null); }, 500);
  }

  // The seek step is the extension's (popup → Playback).
  var seekStep = 10;
  function readSettings(s) {
    var st = s && s.playback ? +s.playback.seekStep : 0;
    seekStep = st > 0 ? st : 10;
    document.querySelectorAll('text.step').forEach(function (t) { t.textContent = String(seekStep); });
    $('cBack').setAttribute('aria-label', 'Back ' + seekStep + ' s (←)');
    $('cFwd').setAttribute('aria-label', 'Forward ' + seekStep + ' s (→)');
  }
  chrome.storage.sync.get(QLOCK_KEY, function (r) {
    void chrome.runtime.lastError;
    readSettings(qlockMerge(QLOCK_DEFAULTS, r && r[QLOCK_KEY]));
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' && changes[QLOCK_KEY]) readSettings(qlockMerge(QLOCK_DEFAULTS, changes[QLOCK_KEY].newValue));
  });

  // ==================================================================
  // Playlist
  // ==================================================================
  var MEDIA_EXT = /\.(mp4|m4v|mkv|webm|mov|ogv|ogg|avi|ts|m2ts|mp3|m4a|aac|flac|wav|opus)$/i;
  var SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
  function isMedia(f) { return !!f && (/^(video|audio)\//.test(f.type) || MEDIA_EXT.test(f.name)); }
  function wantedFile(name) { return MEDIA_EXT.test(name) || SUB_EXT.test(name); }
  function natural(a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }); }
  function bareName(name) { return name.replace(/\.[^.]+$/, ''); }

  var list = [];   // [{ file, path }], path relative to the folder picked
  var subFiles = []; // subtitle files that came with them
  var idx = -1;
  var folder = '';
  var url = '';

  // Opened from a file:// tab ("Open in QualityLock player"): its name is in the hash.
  var wanted = '';
  try { wanted = decodeURIComponent(location.hash.slice(1)); } catch (e) { wanted = ''; }
  if (wanted) {
    $('lead').textContent = 'Choose “' + wanted + '” again, or the folder it’s in to get next and previous. Chrome doesn’t let extensions read a video playing in its own tab, so it has to be opened here once.';
  }

  function openList(entries, dirName) {
    var media = entries.filter(function (e) { return isMedia(e.file); }).sort(natural);
    var subsIn = entries.filter(function (e) { return SUB_EXT.test(e.file.name); });
    if (!media.length) {
      // Subtitles alone, while something plays: for that video.
      if (subsIn.length && url) { subs.addFiles(subsIn.map(function (e) { return e.file; }), true); return; }
      if (url) toast('No video files there.');
      else showPicker(entries.length ? 'No video files there.' : '');
      return;
    }
    list = media;
    subFiles = subsIn;
    folder = dirName || '';
    var start = 0;
    if (wanted) for (var i = 0; i < list.length; i++) if (list[i].file.name === wanted) { start = i; break; }
    wanted = '';
    stage.classList.toggle('single', list.length < 2);
    playAt(start);
  }
  // Subtitle files for list[i]: the same name ("Movie.srt", "Movie.en.srt") in
  // its folder or a Subs folder next to it; any, when there's just one video.
  function dirOf(path) { return path.indexOf('/') !== -1 ? path.replace(/\/[^/]*$/, '') : ''; }
  function sidecarsFor(i) {
    var e = list[i], base = bareName(e.file.name).toLowerCase(), dir = dirOf(e.path);
    return subFiles.filter(function (sf) {
      if (list.length === 1) return true;
      if (sf.file.name.toLowerCase().indexOf(base) !== 0) return false;
      var sd = dirOf(sf.path);
      return sd === dir || sd.replace(/\/?(subs?|subtitles?)$/i, '') === dir;
    }).map(function (sf) { return sf.file; });
  }
  function fromFiles(files) {
    var out = [];
    for (var i = 0; i < files.length; i++) out.push({ file: files[i], path: files[i].webkitRelativePath || files[i].name });
    return out;
  }

  function playAt(i) {
    if (i < 0 || i >= list.length) return;
    savePos();
    idx = i;
    var f = list[i].file;
    var v = ensureVideo();
    var old = url;
    thumbsReset();
    url = URL.createObjectURL(f);
    swap = null;
    v.autoplay = true;
    v.src = url;
    if (old) URL.revokeObjectURL(old);
    audioChecked = false;
    // MKV: the audio and subtitle tracks inside it, which Chrome doesn't offer.
    mkv = null;
    audioNum = 0;
    decoder.stop();
    var own = window.qlockMkv ? window.qlockMkv.read(f).catch(function () { return null; }) : Promise.resolve(null);
    own.then(function (info) { if (list[idx] && list[idx].file === f) setupAudio(f, info); });
    subs.attach(sidecarsFor(i), own.then(function (info) { return info ? { file: f, info: info } : null; }));
    pick.hidden = true;
    note.textContent = '';
    stage.classList.add('has-video');
    titleEl.textContent = bareName(f.name);
    document.title = f.name;
    var dir = list[i].path.indexOf('/') !== -1 ? list[i].path.replace(/\/[^/]*$/, '') : folder;
    titleSub.textContent = list.length > 1 ? (i + 1) + ' of ' + list.length + (dir ? ' · ' + dir : '') : '';
    $('prev').disabled = $('cPrev').disabled = i === 0;
    $('next').disabled = $('cNext').disabled = i === list.length - 1;
    if (location.hash) history.replaceState(null, '', location.pathname);
    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: bareName(f.name), album: dir || '' });
    }
    closeMenu();
    showUi();
  }
  function next() { if (idx < list.length - 1) playAt(idx + 1); }
  function prev() {
    // Like a music player: a few seconds in, "previous" restarts this one.
    if (video && video.currentTime > 5) { video.currentTime = 0; return; }
    if (idx > 0) playAt(idx - 1);
  }

  // Remembered position per file, so a movie resumes where it was left.
  function posKey(f) { return 'qlp:pos:' + f.name + ':' + f.size; }
  function savePos() {
    if (!video || !list[idx] || !url) return;
    var t = video.currentTime, d = video.duration;
    var k = posKey(list[idx].file);
    if (!isFinite(d) || d < 180 || t < 30 || t > d - 60) save(k, null);
    else save(k, Math.floor(t));
  }

  // ==================================================================
  // Audio tracks (MKV)
  // ==================================================================
  // Chrome plays an MKV's first audio track it can decode. The others are in
  // the CC menu: picking one reloads the file with the rest hidden from Chrome
  // (qlockMkv.withAudio) and carries on from the same moment. Dolby tracks,
  // which Chrome can't decode, are decoded by local-decode.js while the video
  // plays with all its audio hidden from Chrome.
  var mkv = null, audioNum = 0, swap = null;
  // Until the video exists (and without local-decode.js): nothing decoded here.
  var decoder = { start: noop, stop: noop, active: function () { return false; }, volume: noop };
  var langNames = null;
  try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch (e) { langNames = null; }
  function audioKey(f) { return 'qlp:audio:' + f.name + ':' + f.size; }
  function audioTracks() { return mkv ? mkv.tracks.filter(function (t) { return t.type === window.qlockMkv.AUDIO; }) : []; }
  function audioLabel(t) {
    var code = window.qlockMkv.langCode(t), lang = code;
    try { if (code && langNames) lang = langNames.of(code); } catch (e) { lang = code; }
    if (t.name && lang && t.name.toLowerCase().indexOf(lang.toLowerCase()) === -1) return lang + ' · ' + t.name;
    return t.name || lang || 'Track ' + (audioTracks().indexOf(t) + 1);
  }
  function audioDetail(t) { return [window.qlockMkv.codecName(t), window.qlockMkv.channelsName(t.channels)].filter(Boolean).join(' '); }
  function decodedHere(t) { return !window.qlockMkv.canPlay(t) && !!window.qlockDecode && window.qlockDecode.can(t); }
  function playable(t) { return window.qlockMkv.canPlay(t) || decodedHere(t); }
  // The file's default track (its flag, else the first), if it can be played.
  function defaultAudio() {
    var ok = audioTracks().filter(playable), d = ok.filter(function (t) { return t.def; })[0] || ok[0];
    return d ? d.num : 0;
  }
  function setupAudio(f, info) {
    mkv = info;
    if (!info) return;
    audioNum = window.qlockMkv.current(info);
    // The track picked for this movie last time, else the file's default.
    var want = +load(audioKey(f)) || defaultAudio();
    if (want && want !== audioNum && audioTracks().some(function (t) { return t.num === want && playable(t); })) setAudio(want, true);
  }
  function setAudio(num, quiet) {
    var M = window.qlockMkv, f = list[idx] && list[idx].file;
    var t = audioTracks().filter(function (x) { return x.num === num; })[0];
    if (!video || !f || !t || num === audioNum || !playable(t)) return;
    var wasDecoded = decoder.active();
    audioNum = num;
    save(audioKey(f), num === defaultAudio() ? null : num);
    if (M.canPlay(t)) {
      decoder.stop();
      swapSource(M.withAudio(f, mkv, num));
    } else {
      // Every track Chrome could play hidden from it (when there's one), this one decoded here.
      if (!wasDecoded && M.current(mkv)) swapSource(M.withAudio(f, mkv, num));
      decoder.start(f, mkv, t);
    }
    if (!quiet) flash(null, 'Audio: ' + audioLabel(t));
  }
  // The decoder failed (it couldn't load, or the track is damaged): back to Chrome's own track.
  function decodeFailed(e) {
    var M = window.qlockMkv, f = list[idx] && list[idx].file, t = audioTracks().filter(function (x) { return x.num === audioNum; })[0];
    toast('Couldn’t play the ' + (t ? M.codecName(t) + ' ' : '') + 'audio: ' + (e && e.message || 'the decoder stopped'), null, null, 8000);
    var c = mkv ? M.current(mkv) : 0;
    audioNum = c;
    if (c && f) swapSource(M.withAudio(f, mkv, c));
  }
  function cycleAudio() {
    var ok = audioTracks().filter(playable);
    if (ok.length < 2) { flash(null, ok.length ? 'This video has one audio track' : 'No audio track this player can play'); return; }
    var i = ok.map(function (t) { return t.num; }).indexOf(audioNum);
    setAudio(ok[(i + 1) % ok.length].num);
  }
  // The same video from another source: it picks up at the same moment, playing or paused.
  function swapSource(blob) {
    var old = url;
    thumbsReset();
    url = URL.createObjectURL(blob);
    if (video.readyState >= 1) {
      swap = { t: video.currentTime, playing: !video.paused, rate: video.playbackRate };
      video.autoplay = swap.playing;
    }
    video.src = url;
    if (old) URL.revokeObjectURL(old);
  }
  function audioMenu(m) {
    var all = audioTracks(), M = window.qlockMkv;
    if (all.length < 2) return;
    m.appendChild(el('h3', '', 'Audio'));
    var cant = [];
    all.forEach(function (t) {
      var b = item(audioLabel(t), t.num === audioNum, function () { closeMenu(); setAudio(t.num); }, el('span', 'd', audioDetail(t)));
      if (!playable(t)) {
        b.disabled = true;
        b.title = 'This player can’t play ' + M.codecName(t) + ' audio';
        if (cant.indexOf(M.codecName(t)) === -1) cant.push(M.codecName(t));
      }
      m.appendChild(b);
    });
    if (cant.length) m.appendChild(el('p', 'mhint', 'Dimmed: this player can’t play ' + cant.join(' or ') + ' audio.'));
    m.appendChild(el('hr'));
  }

  function showPicker(msg) {
    note.textContent = msg || '';
    note.classList.toggle('warn', !!msg);
    pick.hidden = false;
  }

  // ==================================================================
  // The video element and its events
  // ==================================================================
  var audioChecked = false;
  var waitTimer = 0;
  var lastSave = 0;
  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    // A file's blob: URL can be opened twice, so player.js's timeline previews can use it too.
    video.setAttribute('data-qlock-file', '');
    stage.insertBefore(video, stage.firstChild);
    if (window.qlockDecode) { decoder = window.qlockDecode(video, decodeFailed); decoder.volume(level); }

    video.addEventListener('play', syncPlay);
    video.addEventListener('pause', function () { syncPlay(); savePos(); });
    video.addEventListener('ended', function () { savePos(); if (idx < list.length - 1) playAt(idx + 1); else showUi(); });
    video.addEventListener('loadedmetadata', function () {
      durEl.textContent = fmt(video.duration);
      var h = video.videoWidth && video.videoHeight ? Math.round(192 * video.videoHeight / video.videoWidth) : 108;
      thumb.height = clamp(h, 60, 192);
      thumb.style.height = thumb.height + 'px';
      if (swap) {
        // Another audio track: back to where it was.
        // (Autoplay stays as swapSource set it: Chrome looks at it again once enough has loaded.)
        video.currentTime = swap.t;
        video.playbackRate = swap.rate;
        if (swap.playing) video.play().catch(noop);
        swap = null;
        render();
        return;
      }
      var saved = +load(posKey(list[idx].file));
      if (saved >= 30 && saved < video.duration - 60) {
        video.currentTime = saved;
        toast('Resumed at ' + fmt(saved), 'Start over', function () { video.currentTime = 0; });
      }
      render();
    });
    video.addEventListener('durationchange', function () { durEl.textContent = fmt(video.duration); });
    video.addEventListener('timeupdate', function () {
      if (uiShown && !raf) render();
      var n = Date.now();
      if (n - lastSave > 5000) { lastSave = n; savePos(); }
    });
    video.addEventListener('progress', renderBuf);
    video.addEventListener('seeked', function () { render(); renderBuf(); });
    video.addEventListener('ratechange', function () { speedBtn.textContent = (Math.round(video.playbackRate * 100) / 100) + '×'; });
    video.addEventListener('volumechange', syncVolume);
    video.addEventListener('waiting', function () {
      clearTimeout(waitTimer);
      waitTimer = setTimeout(function () { spinner.hidden = false; stage.classList.add('waiting'); }, 300);
    });
    ['playing', 'canplay', 'seeked', 'pause'].forEach(function (t) {
      video.addEventListener(t, function () { clearTimeout(waitTimer); spinner.hidden = true; stage.classList.remove('waiting'); });
    });
    video.addEventListener('playing', function () {
      if (audioChecked) return;
      audioChecked = true;
      // Chrome can't decode some movie audio (AC-3, E-AC-3, DTS): the picture
      // then plays in silence with no error at all. Looks the same as a clip with
      // no sound, so only for movie-length files.
      setTimeout(function () {
        var all = audioTracks();
        if (all.length && !all.some(playable)) {
          var names = all.map(window.qlockMkv.codecName).filter(function (n, i, a) { return a.indexOf(n) === i; });
          toast('No sound: this video’s audio is ' + names.join(' and ') + ', which this player can’t play. Converting the audio to AAC fixes it.', null, null, 10000);
          return;
        }
        if (video && !video.paused && !video.muted && video.duration >= 600 && video.webkitAudioDecodedByteCount === 0 && !decoder.active()) {
          toast('No sound? Chrome can’t play this file’s audio format (AC-3, E-AC-3 and DTS are common in movies). Converting the audio to AAC fixes it.', null, null, 10000);
        }
      }, 4000);
    });
    video.addEventListener('error', function () {
      if (!video.getAttribute('src') || !list[idx]) return;
      var msg = 'Chrome can’t play “' + list[idx].file.name + '”: its format or codec isn’t supported. MP4 (H.264) and WebM play everywhere.';
      if (list.length > 1) toast(msg, idx < list.length - 1 ? 'Next' : null, next, 10000);
      else showPicker(msg);
    });
    applyVolume();
    return video;
  }

  function syncPlay() {
    stage.classList.toggle('paused', video.paused);
    var label = video.paused ? 'Play (Space)' : 'Pause (Space)';
    $('play').setAttribute('data-tip', label);
    $('play').setAttribute('aria-label', label);
    $('cPlay').setAttribute('aria-label', label);
    showUi();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
  }

  function togglePlay() {
    if (!video) return;
    if (video.paused) video.play().catch(noop); else video.pause();
  }
  function skip(dt) {
    if (!video || !isFinite(video.duration)) return;
    video.currentTime = clamp(video.currentTime + dt, 0, video.duration);
    flash($(dt < 0 ? 'cBack' : 'cFwd').querySelector('svg'), (dt > 0 ? '+' : '−') + Math.abs(dt) + ' s');
    render();
  }

  // ==================================================================
  // Showing and hiding the controls
  // ==================================================================
  // Shown while the mouse moves, while paused, and while it rests on a control
  // or a menu is open; gone (with the cursor) a moment after the mouse stops.
  var HIDE_MS = 2600;
  var uiShown = true, hideTimer = 0, overControls = false, menuOpen = false, dragging = false;
  function showUi() {
    if (!uiShown) { uiShown = true; stage.classList.remove('idle'); render(); renderBuf(); }
    kick();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(autoHide, HIDE_MS);
  }
  function autoHide() {
    hideTimer = 0;
    if (!video || video.paused || !pick.hidden) return;
    if (overControls || menuOpen || dragging) { hideTimer = setTimeout(autoHide, HIDE_MS); return; }
    uiShown = false;
    stage.classList.add('idle');
    preview.hidden = true;
  }

  var lastX = -1, lastY = -1;
  stage.addEventListener('pointermove', function (e) {
    // Only real movement: hover updates can send moves without the mouse moving.
    if (e.clientX === lastX && e.clientY === lastY) return;
    lastX = e.clientX; lastY = e.clientY;
    // The bars and menus hold the controls up; the centre buttons don't, since a
    // mouse often rests mid-screen while watching.
    overControls = !!(uiShown && e.target.closest && e.target.closest('.top, .bottom, .menu, .side'));
    showUi();
  }, { passive: true });
  stage.addEventListener('pointerleave', function () {
    overControls = false;
    lastX = lastY = -1;
    if (video && !video.paused && !menuOpen && !dragging) { clearTimeout(hideTimer); hideTimer = setTimeout(autoHide, 500); }
  });

  // Clicks on the picture play / pause, double-click toggles fullscreen.
  var swallowClick = false;
  stage.addEventListener('pointerdown', function (e) {
    showUi();
    if (!menuOpen || menu.contains(e.target) || (e.target.closest && e.target.closest('#speedBtn, #listBtn, #setBtn, #ccBtn'))) return;
    closeMenu();
    if (e.target === surface) swallowClick = true;
  }, true);
  surface.addEventListener('click', function () {
    if (swallowClick) { swallowClick = false; return; }
    togglePlay();
  });
  surface.addEventListener('dblclick', toggleFs);
  // Mouse clicks shouldn't leave focus on a button, where Space would press it again.
  ui.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });

  // ==================================================================
  // Time, seek bar and hover previews
  // ==================================================================
  var raf = 0, lastSec = -1, scrub = null;
  function loop() {
    raf = 0;
    render();
    if (uiShown && video && !video.paused) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && uiShown && video && !video.paused) raf = requestAnimationFrame(loop); }

  function render() {
    if (!video) return;
    var d = video.duration;
    var t = scrub ? scrub.t : video.currentTime;
    var p = d > 0 && isFinite(d) ? clamp(t / d, 0, 1) : 0;
    played.style.transform = 'scaleX(' + p + ')';
    knob.style.left = (p * 100) + '%';
    var s = Math.floor(t);
    if (s !== lastSec) {
      lastSec = s;
      curEl.textContent = fmt(t);
      seek.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d));
    }
  }
  function renderBuf() {
    if (!video || !(video.duration > 0)) return;
    var b = video.buffered, t = video.currentTime, end = 0;
    for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) { end = b.end(i); break; }
    buf.style.transform = 'scaleX(' + clamp(end / video.duration, 0, 1) + ')';
  }

  function seekAt(x) {
    var r = seek.getBoundingClientRect();
    var p = clamp((x - r.left) / r.width, 0, 1);
    return { p: p, t: p * (video.duration || 0), x: x - r.left, w: r.width };
  }
  seek.addEventListener('pointerdown', function (e) {
    if (!video || !isFinite(video.duration) || e.button !== 0) return;
    e.preventDefault();
    seek.setPointerCapture(e.pointerId);
    dragging = true;
    seek.classList.add('drag');
    scrub = { t: 0, at: 0 };
    scrubTo(seekAt(e.clientX));
  });
  seek.addEventListener('pointermove', function (e) {
    if (!video || !isFinite(video.duration)) return;
    var a = seekAt(e.clientX);
    showPreview(a);
    if (scrub) scrubTo(a);
  });
  function endScrub() {
    if (!scrub) return;
    video.currentTime = scrub.t;
    scrub = null;
    dragging = false;
    seek.classList.remove('drag');
    render();
    showUi();
  }
  seek.addEventListener('pointerup', endScrub);
  seek.addEventListener('pointercancel', endScrub);
  seek.addEventListener('pointerleave', function () { if (!scrub) preview.hidden = true; });
  // Live scrubbing, a seek every ~90 ms at most; the exact spot on release.
  function scrubTo(a) {
    scrub.t = a.t;
    render();
    var n = performance.now();
    if (n - scrub.at > 90) { scrub.at = n; video.currentTime = a.t; }
  }
  function showPreview(a) {
    preview.hidden = false;
    hov.style.transform = 'scaleX(' + a.p + ')';
    previewTime.textContent = fmt(a.t);
    preview.style.left = clamp(a.x, 100, Math.max(100, a.w - 100)) + 'px';
    wantThumb(a.t);
  }

  // Thumbnails from a hidden second copy of the file, seeked to where the mouse is.
  var pv = null, pvBusy = false, pvWant = -1;
  function thumbsReset() {
    if (pv) { pv.removeAttribute('src'); pv.load(); }
    pv = null; pvBusy = false; pvWant = -1;
    preview.classList.add('no-thumb');
  }
  function wantThumb(t) {
    if (!url) return;
    if (!pv) {
      pv = document.createElement('video');
      pv.muted = true;
      pv.preload = 'auto';
      pv.addEventListener('loadedmetadata', function () { if (pvWant >= 0) pvSeek(pvWant); });
      pv.addEventListener('seeked', function () {
        pvBusy = false;
        try {
          thumb.getContext('2d').drawImage(pv, 0, 0, thumb.width, thumb.height);
          preview.classList.remove('no-thumb');
        } catch (e) { /* not decodable */ }
        if (pvWant >= 0 && Math.abs(pvWant - pv.currentTime) > 0.5) pvSeek(pvWant);
      });
      pv.addEventListener('error', function () { pvBusy = false; });
      pv.src = url;
    }
    pvWant = t;
    if (!pvBusy) pvSeek(t);
  }
  function pvSeek(t) {
    if (!pv || pv.readyState < 1) return;
    pvBusy = true;
    pv.currentTime = t;
  }

  // ==================================================================
  // Volume, with a boost past 100% (Web Audio gain plus a limiter)
  // ==================================================================
  var level = 1;        // what the user picked, 0–2
  var audio = null;     // { ctx, gain }, made on the first boost
  var gestured = false; // an AudioContext started before any click stays silent
  function boost(g) {
    if (g <= 1 && !audio) return;
    if (!gestured || !video) return;
    if (!audio) {
      try {
        var ctx = new AudioContext();
        var src = ctx.createMediaElementSource(video);
        var gain = ctx.createGain();
        var lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
        src.connect(gain); gain.connect(lim); lim.connect(ctx.destination);
        audio = { ctx: ctx, gain: gain };
      } catch (e) { return; }
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(noop);
    audio.gain.gain.setTargetAtTime(g, audio.ctx.currentTime, 0.02);
  }
  function applyVolume() {
    if (!video) return;
    video.volume = Math.min(level, 1);
    boost(Math.max(level, 1));
    renderVol();
  }
  function setLevel(l, show) {
    l = clamp(Math.round(l * 100) / 100, 0, 2);
    if (Math.abs(l - 1) < 0.03) l = 1; // a soft stop at 100%
    level = l;
    if (video && l > 0 && video.muted) video.muted = false;
    applyVolume();
    save('qlp:vol', l);
    if (show) flash(null, l === 0 ? 'Muted' : 'Volume ' + Math.round(l * 100) + '%');
  }
  // Volume changed elsewhere (player.js's mouse wheel, the popup): follow it.
  function syncVolume() {
    if (video.volume < 0.999 && level > 1) { level = video.volume; boost(1); save('qlp:vol', level); }
    else if (video.volume < 0.999) level = video.volume;
    renderVol();
  }
  function renderVol() {
    var muted = !video || video.muted || level === 0;
    var eff = muted ? 0 : level;
    stage.classList.toggle('muted', muted);
    stage.classList.toggle('vol-low', !muted && level < 0.5);
    stage.classList.toggle('boost', !muted && level > 1);
    decoder.volume(eff);
    volFill.style.transform = 'scaleX(' + eff / 2 + ')';
    volKnob.style.left = (eff / 2 * 100) + '%';
    volVal.textContent = muted ? 'Muted' : Math.round(level * 100) + '%';
    volSlider.setAttribute('aria-valuenow', String(Math.round(eff * 100)));
    $('mute').setAttribute('data-tip', muted ? 'Unmute (M)' : 'Mute (M)');
  }
  function toggleMute() {
    if (!video) return;
    if (video.muted || level === 0) { video.muted = false; if (level === 0) setLevel(0.5); }
    else video.muted = true;
    flash(null, video.muted ? 'Muted' : 'Volume ' + Math.round(level * 100) + '%');
  }
  var savedLevel = parseFloat(load('qlp:vol'));
  if (isFinite(savedLevel)) level = clamp(savedLevel, 0, 2);
  function onGesture() {
    if (gestured) return;
    gestured = true;
    if (level > 1) applyVolume();
  }
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);

  function volAt(x) { var r = volRail.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * 2; }
  volSlider.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    volSlider.setPointerCapture(e.pointerId);
    volBox.classList.add('drag');
    dragging = true;
    onGesture();
    setLevel(volAt(e.clientX));
  });
  volSlider.addEventListener('pointermove', function (e) { if (volBox.classList.contains('drag')) setLevel(volAt(e.clientX)); });
  function endVol() { volBox.classList.remove('drag'); dragging = false; }
  volSlider.addEventListener('pointerup', endVol);
  volSlider.addEventListener('pointercancel', endVol);
  volBox.addEventListener('wheel', function (e) {
    e.preventDefault();
    setLevel((video && video.muted ? 0 : level) + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });

  // ==================================================================
  // Fullscreen, Picture-in-Picture
  // ==================================================================
  // The stage goes fullscreen, so the controls (and QualityLock's toolbar, which
  // player.js mounts inside it) stay clickable.
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(noop);
    else stage.requestFullscreen({ navigationUI: 'hide' }).catch(noop);
  }
  document.addEventListener('fullscreenchange', function () {
    var on = !!document.fullscreenElement;
    stage.classList.toggle('fs', on);
    $('fsBtn').setAttribute('data-tip', on ? 'Exit fullscreen (F)' : 'Fullscreen (F)');
    showUi();
  });
  function togglePip() {
    if (!video) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(noop);
    else video.requestPictureInPicture().catch(function () { toast('Picture-in-Picture isn’t available here.'); });
  }

  // ==================================================================
  // Menus: speed, playlist, settings
  // ==================================================================
  var menuFor = '';
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function item(label, on, onClick, extra) {
    var b = el('button', 'item' + (on ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.appendChild(el('span', 'ck', on ? '✓' : ''));
    b.appendChild(el('span', 'nm', label));
    if (extra) b.appendChild(extra);
    b.addEventListener('click', onClick);
    return b;
  }
  function chips(options, isOn, onPick) {
    var row = el('div', 'chips');
    options.forEach(function (o) {
      var c = el('button', 'chip' + (isOn(o) ? ' on' : ''), o[1]);
      c.type = 'button';
      c.addEventListener('click', function () {
        onPick(o);
        row.querySelectorAll('.chip').forEach(function (x) { x.classList.remove('on'); });
        c.classList.add('on');
      });
      row.appendChild(c);
    });
    return row;
  }
  function openMenu(kind, build) {
    if (menuFor === kind) { closeMenu(); return; }
    menu.textContent = '';
    build(menu);
    menu.hidden = false;
    menuFor = kind;
    menuOpen = true;
    stage.classList.add('menu-open');
    var on = menu.querySelector('.item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
    showUi();
  }
  function closeMenu() {
    if (!menuOpen) return;
    menu.hidden = true;
    menu.textContent = '';
    menuFor = '';
    menuOpen = false;
    stage.classList.remove('menu-open');
    showUi();
  }

  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  function speedMenu(m) {
    m.appendChild(el('h3', '', 'Speed'));
    var r = video ? video.playbackRate : 1;
    SPEEDS.forEach(function (s) {
      m.appendChild(item(s === 1 ? 'Normal' : s + '×', Math.abs(s - r) < 0.001, function () { act('setSpeed', { speed: s }); closeMenu(); }));
    });
  }

  function listMenu(m) {
    m.appendChild(el('h3', '', folder ? 'Playlist · ' + folder : 'Playlist'));
    list.forEach(function (e, i) {
      var dir = e.path.indexOf('/') !== -1 ? e.path.replace(/\/[^/]*$/, '') : '';
      var b = item(bareName(e.file.name), i === idx, function () { closeMenu(); if (i !== idx) playAt(i); }, dir ? el('span', 'd', dir) : null);
      b.querySelector('.ck').replaceWith(el('span', 'n', String(i + 1)));
      m.appendChild(b);
    });
    m.appendChild(el('hr'));
    m.appendChild(item('Open videos…', false, function () { closeMenu(); fileInput.click(); }));
    m.appendChild(item('Open a folder…', false, function () { closeMenu(); openFolder(); }));
  }

  var SIZES = [['original', 'Fit'], ['fill', 'Fill'], ['stretch', 'Stretch'], [16 / 9, '16:9'], [64 / 27, '21:9'], [4 / 3, '4:3']];
  var BACKDROPS = [['off', 'Off'], ['ambient', 'Ambient'], ['blur', 'Blur'], ['rgb', 'RGB light']];
  function settingsMenu(m, st) {
    var d = st && st.display, b = st && st.backdrop;
    m.appendChild(el('h3', '', 'Picture size'));
    m.appendChild(chips(SIZES, function (o) {
      if (!d) return o[0] === 'original';
      return typeof o[0] === 'number' ? d.mode === 'aspect' && Math.abs(d.aspect - o[0]) < 0.01 : d.mode === o[0];
    }, function (o) {
      if (typeof o[0] === 'number') act('setAspect', { aspect: o[0] });
      else act('setMode', { mode: o[0] });
    }));
    m.appendChild(el('h3', '', 'Black bars'));
    m.appendChild(chips(BACKDROPS, function (o) { return (b ? b.mode : 'off') === o[0]; }, function (o) {
      act('setBackdrop', { backdrop: { mode: o[0] } });
    }));
    m.appendChild(el('hr'));
    m.appendChild(item('Zoom, rotate, bars inside the film…', false, function () { closeMenu(); act('panel', { id: 'display' }); }));
    m.appendChild(item('Picture: brightness, colour, night…', false, function () { closeMenu(); act('panel', { id: 'picture' }); }));
    m.appendChild(item('Backdrop intensity and softness…', false, function () { closeMenu(); act('panel', { id: 'backdrop' }); }));
    m.appendChild(item('Save this frame (PNG)', false, function () { closeMenu(); act('snapshot'); }));
    m.appendChild(item('Stats for nerds', false, function () { closeMenu(); act('toggleStats'); }));
    m.appendChild(el('hr'));
    m.appendChild(item('Open videos…', false, function () { closeMenu(); fileInput.click(); }));
    m.appendChild(item('Open a folder…', false, function () { closeMenu(); openFolder(); }));
  }

  // ==================================================================
  // Feedback: centre flash, toast
  // ==================================================================
  var flashTimer = 0;
  function flash(icon, text) {
    flashEl.textContent = '';
    if (icon) { var svg = icon.cloneNode(true); svg.removeAttribute('class'); flashEl.appendChild(svg); }
    if (text) flashEl.appendChild(document.createTextNode(text));
    flashEl.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashEl.classList.remove('show'); }, 650);
  }
  var toastTimer = 0;
  function toast(text, actionLabel, action, ms) {
    toastEl.textContent = '';
    toastEl.appendChild(el('span', '', text));
    if (actionLabel) {
      var b = el('button', '', actionLabel);
      b.type = 'button';
      b.addEventListener('click', function () { hideToast(); action(); });
      toastEl.appendChild(b);
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 6000);
  }
  function hideToast() { toastEl.hidden = true; }

  // ==================================================================
  // Buttons
  // ==================================================================
  $('play').addEventListener('click', togglePlay);
  $('cPlay').addEventListener('click', togglePlay);
  $('cBack').addEventListener('click', function () { skip(-seekStep); });
  $('cFwd').addEventListener('click', function () { skip(seekStep); });
  $('prev').addEventListener('click', prev);
  $('cPrev').addEventListener('click', prev);
  $('next').addEventListener('click', next);
  $('cNext').addEventListener('click', next);
  $('mute').addEventListener('click', toggleMute);
  $('fsBtn').addEventListener('click', toggleFs);
  $('pipBtn').addEventListener('click', togglePip);
  $('qlBtn').addEventListener('click', function () { closeMenu(); act('toggleToolbar'); });
  speedBtn.addEventListener('click', function () { openMenu('speed', speedMenu); });
  $('ccBtn').addEventListener('click', function () { openMenu('subs', function (m) { audioMenu(m); subs.menu(m); }); });
  $('listBtn').addEventListener('click', function () { openMenu('list', listMenu); });
  $('setBtn').addEventListener('click', function () {
    if (menuFor === 'settings') { closeMenu(); return; }
    qlStatus(function (st) { openMenu('settings', function (m) { settingsMenu(m, st); }); });
  });

  // Media keys and Chrome's media controls.
  if ('mediaSession' in navigator) {
    var ms = navigator.mediaSession;
    var handlers = {
      play: function () { if (video) video.play().catch(noop); },
      pause: function () { if (video) video.pause(); },
      previoustrack: prev,
      nexttrack: next,
      seekbackward: function () { skip(-seekStep); },
      seekforward: function () { skip(seekStep); }
    };
    for (var h in handlers) { try { ms.setActionHandler(h, handlers[h]); } catch (e) { /* not supported */ } }
  }

  // ==================================================================
  // Keyboard
  // ==================================================================
  // As in most players. Shift + arrows / + / − / 0 (zoom, stretch) are player.js's.
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape' && menuOpen) { closeMenu(); e.preventDefault(); return; }
    if (k === 'Escape' && subs.sideOpen()) { subs.closeSide(); e.preventDefault(); return; }
    if ((k === ' ' || k === 'Enter') && t && t.tagName === 'BUTTON') return;
    if (k === 'o') { e.preventDefault(); fileInput.click(); return; }
    if (!video || !url) return;
    var done = true;
    if (k === ' ' || k === 'k') { togglePlay(); flash($('cPlay').querySelector(video.paused ? '.i-pause' : '.i-play'), video.paused ? 'Paused' : 'Playing'); }
    else if (k === 'ArrowLeft' || k === 'j') skip(-seekStep);
    else if (k === 'ArrowRight' || k === 'l') skip(seekStep);
    else if (k === 'ArrowUp') setLevel((video.muted ? 0 : level) + 0.05, true);
    else if (k === 'ArrowDown') setLevel((video.muted ? 0 : level) - 0.05, true);
    else if (k === 'm') toggleMute();
    else if (k === 'f') toggleFs();
    else if (k === 'c') subs.toggle();
    else if (k === 'a') cycleAudio();
    else if (k === 'v') subs.cycle();
    else if (k === 'g') subs.nudge(-0.1);
    else if (k === 'h') subs.nudge(0.1);
    else if (k === 'n') next();
    else if (k === 'p') prev();
    else if (k === '>') act('speedUp');
    else if (k === '<') act('speedDown');
    else if (k === 'Home') video.currentTime = 0;
    else if (k === 'End' && isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 1);
    else if (/^[0-9]$/.test(k) && isFinite(video.duration)) video.currentTime = video.duration * (+k / 10);
    else done = false;
    if (!done) return;
    e.preventDefault();
    showUi();
  });

  // ==================================================================
  // Opening files: picker, folder, drag and drop
  // ==================================================================
  $('pickFiles').addEventListener('click', function () { fileInput.click(); });
  $('pickFolder').addEventListener('click', openFolder);
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length) openList(fromFiles(fileInput.files), '');
    fileInput.value = '';
  });
  dirInput.addEventListener('change', function () {
    var files = dirInput.files;
    if (files && files.length) {
      var top = (files[0].webkitRelativePath || '').split('/')[0];
      // Paths inside the folder, without the folder's own name.
      openList(fromFiles(files).map(function (e) { return { file: e.file, path: e.path.slice(top.length + 1) || e.file.name }; }), top);
    }
    dirInput.value = '';
  });

  // A folder: its videos, sub-folders (seasons) too, in natural order.
  function openFolder() {
    if (!window.showDirectoryPicker) { dirInput.click(); return; }
    window.showDirectoryPicker({ id: 'qlock-videos', mode: 'read' }).then(function (dir) {
      return collect(dir, '', 0, []).then(function (out) { openList(out, dir.name); });
    }).catch(function (e) {
      if (e && e.name !== 'AbortError') dirInput.click();
    });
  }
  function collect(dir, prefix, depth, out) {
    var it = dir.values();
    function step() {
      return it.next().then(function (r) {
        if (r.done || out.length >= 2000) return out;
        var h = r.value;
        var p = h.kind === 'file'
          ? (wantedFile(h.name) ? h.getFile().then(function (f) { out.push({ file: f, path: prefix + f.name }); }) : Promise.resolve())
          : depth < 3 ? collect(h, prefix + h.name + '/', depth + 1, out) : Promise.resolve();
        return p.then(step);
      });
    }
    return step();
  }

  // Drop files or folders anywhere, also while something plays. Without
  // preventDefault the tab would navigate to the file itself.
  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    if (!hasFiles(e)) return;
    dragDepth++;
    drop.hidden = false;
  });
  window.addEventListener('dragleave', function (e) {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; }
  });
  window.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    drop.hidden = true;
    readDrop(e.dataTransfer, openList);
  });
  // Entries must be taken during the drop event; folders are read after.
  function readDrop(dt, cb) {
    var entries = Array.prototype.map.call(dt.items || [], function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
    if (!entries.some(function (en) { return en.isDirectory; })) { cb(fromFiles(dt.files), ''); return; }
    var out = [], pending = 0;
    var dirName = entries.length === 1 ? entries[0].name : '';
    function done() { if (--pending === 0) cb(out, dirName); }
    function walk(entry, path, depth) {
      if (entry.isFile) {
        if (!wantedFile(entry.name)) return;
        pending++;
        entry.file(function (f) { out.push({ file: f, path: path + f.name }); done(); }, done);
        return;
      }
      if (!entry.isDirectory || depth > 3) return;
      pending++;
      var reader = entry.createReader();
      var inner = entries.length === 1 && depth === 0 ? '' : path + entry.name + '/';
      (function more() {
        reader.readEntries(function (batch) {
          if (!batch.length) { done(); return; }
          batch.forEach(function (en) { walk(en, inner, depth + 1); });
          more();
        }, done);
      })();
    }
    entries.forEach(function (en) { walk(en, '', 0); });
    if (pending === 0) cb(out, dirName);
  }

  var subs = window.qlockSubs({
    video: function () { return video; },
    videoFile: function () { return list[idx] ? list[idx].file : null; },
    toast: toast, flash: flash, el: el, item: item, chips: chips, closeMenu: closeMenu, showUi: showUi
  });

  window.addEventListener('pagehide', savePos);
  renderVol();
})();
