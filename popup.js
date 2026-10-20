(function () {
  'use strict';

  var MODES = [
    { v: 'best', label: 'Best only' },
    { v: 'floor1080', label: 'Never below 1080p' },
    { v: 'floor720', label: 'Never below 720p' },
    { v: 'off', label: 'Off' }
  ];

  // Stroke icons on a 24 grid (same set as the on-page toolbar).
  var ICONS = {
    now: '<circle cx="12" cy="12" r="9.5"/><path d="M10 8.5v7l6-3.5z" fill="currentColor"/>',
    display: '<path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>',
    picture: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    speed: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2.2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    toolbar: '<rect x="2" y="3" width="20" height="14" rx="2.2"/><rect x="6" y="11" width="12" height="3.2" rx="1.6" fill="currentColor" stroke="none"/><path d="M8 21h8M12 17v4"/>',
    fill: '<rect x="3" y="7.5" width="18" height="9" rx="1.6"/><path d="M12 1.8v3.4M10.2 3.5 12 1.7l1.8 1.8M12 22.2v-3.4M10.2 20.5 12 22.3l1.8-1.8"/>',
    backdrop: '<rect x="7" y="8" width="10" height="8" rx="1.5"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
    pip: '<rect x="2" y="4" width="20" height="16" rx="2.2"/><rect x="11.5" y="11" width="7.5" height="6" rx="1.2" fill="currentColor" stroke="none"/>',
    winfs: '<rect x="2" y="3.5" width="20" height="17" rx="2.2"/><path d="M2 8h20"/><polyline points="14 11.5 17 11.5 17 14.5"/><polyline points="10 17.5 7 17.5 7 14.5"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    lights: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-4 11.62c.68.55 1 1.38 1 2.25V17h6v-.63c0-.87.32-1.7 1-2.25A6.5 6.5 0 0 0 12 2.5z"/>',
    snapshot: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    stats: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    reload: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    rotate: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    rotateL: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    flip: '<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 7.5 4 17h5zM15 7.5l5 9.5h-5z"/>',
    grip: '<circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.3v13.4a1 1 0 0 0 1.5.86l10.8-6.7a1 1 0 0 0 0-1.72L9.5 4.44A1 1 0 0 0 8 5.3z" fill="currentColor" stroke="none"/>',
    back: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    fwd: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    volume: '<polygon points="11 5 6 9 2.5 9 2.5 15 6 15 11 19 11 5" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.9 5.1a9.8 9.8 0 0 1 0 13.8"/>',
    loop: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>'
  };
  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function fillIcons(root) {
    root.querySelectorAll('i[data-icon]').forEach(function (i) { if (!i.firstChild) i.innerHTML = svg(i.getAttribute('data-icon')); });
  }

  var PICTURE_ROWS = [
    ['brightness', 'Brightness', 40, 160, '%'],
    ['contrast', 'Contrast', 40, 160, '%'],
    ['saturation', 'Saturation', 0, 200, '%'],
    ['gamma', 'Gamma (shadows)', 40, 220, '%'],
    ['warmth', 'Warmth (night)', -100, 100, ''],
    ['sharpness', 'Sharpness', 0, 100, '%'],
    ['grayscale', 'Grayscale', 0, 100, '%']
  ];
  var PICTURE_PRESETS = [
    { id: 'original', name: 'Original', p: {} },
    { id: 'vivid', name: 'Vivid', p: { contrast: 110, saturation: 135, brightness: 102 } },
    { id: 'cinema', name: 'Cinema', p: { contrast: 110, saturation: 92, warmth: 12 } },
    { id: 'bright', name: 'Dark scenes', p: { brightness: 112, gamma: 130, contrast: 104 } },
    { id: 'night', name: 'Night', p: { brightness: 85, warmth: 65 } },
    { id: 'mono', name: 'Mono', p: { grayscale: 100, contrast: 112 } }
  ];
  var BUTTON_ICONS = {
    play: 'play', back: 'back', fwd: 'fwd', volume: 'volume', speed: 'speed', fill: 'fill', display: 'display',
    backdrop: 'backdrop', picture: 'picture', rotate: 'rotate', loop: 'loop', snapshot: 'snapshot', lights: 'lights',
    pip: 'pip', winfs: 'winfs', fullscreen: 'fullscreen', stats: 'stats'
  };

  var settings = null;
  var tabId = null;
  var frameId = 0;  // frame holding the tab's main video (see background.js)
  var keys = {};
  var currentSite = null;
  var player = null; // latest player snapshot from the page
  var $ = function (id) { return document.getElementById(id); };

  function modeOf(s) {
    if (!s.enabled) return 'off';
    if (s.mode === 'floor') return s.floor >= 1080 ? 'floor1080' : 'floor720';
    return 'best';
  }
  function applyMode(s, v) {
    if (v === 'off') { s.enabled = false; return; }
    s.enabled = true;
    if (v === 'best') { s.mode = 'best'; return; }
    s.mode = 'floor';
    s.floor = v === 'floor1080' ? 1080 : 720;
  }

  function save() {
    var o = {};
    o[QLOCK_KEY] = settings;
    chrome.storage.sync.set(o);
  }

  function needsReload() {
    if (tabId === null || !currentSite) return;
    $('applyHint').hidden = false;
    $('reload').classList.add('primary');
  }

  function sendToTab(msg, cb) {
    if (tabId === null) return;
    chrome.tabs.sendMessage(tabId, msg, { frameId: frameId }, function (res) {
      if (chrome.runtime.lastError) res = undefined;
      if (cb) cb(res);
    });
  }
  function act(action, params) {
    sendToTab({ type: 'qlock:player', action: action, params: params || null });
    setTimeout(poll, 120);
  }
  // PiP and fullscreen need a user gesture in the page; an injected script made
  // during this click carries it. Must be called straight from the click handler.
  function actWithGesture(action) {
    if (tabId === null) return;
    chrome.scripting.executeScript({
      target: { tabId: tabId, frameIds: [frameId] },
      world: 'MAIN',
      func: function (a) { window.postMessage({ __qlock: 'player', action: a }, '*'); },
      args: [action]
    }).catch(function () { act(action); });
    setTimeout(poll, 250);
  }

  // ---------------------------------------------------------------- tabs
  var TABS = ['now', 'display', 'picture', 'playback', 'quality', 'settings'];
  function selectTab(name, focus) {
    if (TABS.indexOf(name) === -1) name = 'now';
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    document.querySelector('main').scrollTop = 0;
    try { localStorage.setItem('qlock:tab', name); } catch (e) { /* ignore */ }
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
    t.addEventListener('keydown', function (e) {
      var i = TABS.indexOf(t.getAttribute('data-tab'));
      if (e.key === 'ArrowRight') { selectTab(TABS[(i + 1) % TABS.length], true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { selectTab(TABS[(i + TABS.length - 1) % TABS.length], true); e.preventDefault(); }
    });
  });

  // ---------------------------------------------------------------- tooltips
  var tipTimer = 0;
  document.addEventListener('pointerover', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    clearTimeout(tipTimer);
    if (!el) { $('tip').hidden = true; return; }
    tipTimer = setTimeout(function () {
      var tip = $('tip');
      tip.textContent = el.getAttribute('data-tip');
      tip.hidden = false;
      var r = el.getBoundingClientRect();
      var w = tip.offsetWidth, hh = tip.offsetHeight;
      var left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
      var top = r.top - hh - 6 < 4 ? r.bottom + 6 : r.top - hh - 6;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }, 450);
  });
  document.addEventListener('pointerdown', function () { clearTimeout(tipTimer); $('tip').hidden = true; });

  // ---------------------------------------------------------------- controls helpers
  function rangeFill(input) {
    var min = +input.min, max = +input.max;
    input.style.setProperty('--p', ((+input.value - min) / (max - min) * 100).toFixed(1) + '%');
  }
  function setRange(input, v) {
    if (document.activeElement === input) return;
    input.value = v;
    rangeFill(input);
  }
  function setSeg(id, v) {
    $(id).querySelectorAll('button').forEach(function (b) {
      var on = b.getAttribute('data-v') === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('role', 'radio');
    });
  }
  function onSeg(id, fn) {
    $(id).querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { fn(b.getAttribute('data-v')); });
    });
  }
  function bindToggle(id, get, set) {
    $(id).addEventListener('change', function (e) { set(e.target.checked); save(); renderSettings(); });
    return get;
  }
  function fmtRate(r) { return (Math.round(r * 100) / 100) + '×'; }

  // ---------------------------------------------------------------- render settings
  function renderSettings() {
    if (!settings) return;
    $('enabled').checked = !!settings.enabled;
    document.body.classList.toggle('disabled', !settings.enabled);
    document.body.classList.toggle('vc-off', !settings.videoController.enabled);
    $('overlay').checked = !!settings.overlay;
    $('nerds').checked = !!settings.nerds;
    $('deepMode').checked = !!settings.deepMode;
    $('vcEnabled').checked = settings.videoController.enabled !== false;
    $('vcShowOsd').checked = settings.videoController.showOsd !== false;
    $('smartCrop').checked = !!settings.display.smartCrop;
    $('rememberPerSite').checked = !!settings.display.rememberPerSite;

    // backdrop
    var b = settings.backdrop;
    setSeg('bdMode', b.mode);
    setRange($('bdIntensity'), b.intensity); $('bdIntensityVal').textContent = b.intensity + '%';
    setRange($('bdBlur'), b.blur); $('bdBlurVal').textContent = b.blur + '%';
    $('qaBackdropLabel').textContent = b.mode === 'blur' ? 'Blur fill' : b.mode === 'ambient' ? 'Ambient' : 'Backdrop';
    $('qaBackdrop').classList.toggle('on', b.mode !== 'off');

    // picture
    var p = settings.picture;
    PICTURE_ROWS.forEach(function (r) {
      var input = $('pic-' + r[0]);
      if (!input) return;
      setRange(input, p[r[0]]);
      $('pic-' + r[0] + '-val').textContent = fmtPic(r, p[r[0]]);
    });
    var preset = activePreset(p);
    document.querySelectorAll('#picPresets .chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-id') === preset); });

    // playback + mouse
    var pb = settings.playback;
    $('rememberSpeed').checked = !!pb.rememberSpeed;
    $('speedStep').value = String(pb.speedStep);
    $('seekStep').value = String(pb.seekStep);
    var m = settings.mouse;
    $('mouseWheel').value = m.wheel;
    $('rightWheel').checked = !!m.rightWheel;
    $('sideButtons').value = m.sideButtons;
    $('volumeStep').value = String(m.volumeStep);
    $('hideCursor').checked = !!m.hideCursor;

    // toolbar
    var tb = settings.toolbar;
    setSeg('tbShow', tb.show);
    setSeg('tbLayout', tb.layout);
    $('tbTheme').querySelectorAll('.theme').forEach(function (t) {
      var on = t.getAttribute('data-v') === tb.theme;
      t.classList.toggle('on', on);
      t.setAttribute('aria-checked', on ? 'true' : 'false');
      t.setAttribute('role', 'radio');
    });
    $('tbAutoHide').value = String(tb.autoHide);
    renderAccents();
    var sig = JSON.stringify(tb.buttons);
    if (dragItem === null && sig !== buttonsSig) renderButtonList();

    // per-site locks
    document.querySelectorAll('.site').forEach(function (row) {
      var site = row.getAttribute('data-site');
      var s = settings.sites[site] || { enabled: true, mode: 'best', floor: 1080 };
      var sel = row.querySelector('select');
      if (!sel.options.length) MODES.forEach(function (mo) { sel.add(new Option(mo.label, mo.v)); });
      sel.value = modeOf(s);
      row.querySelector('.tally').className = 'tally' + (settings.enabled && s.enabled ? ' on' : '');
      row.classList.toggle('current', site === currentSite || (!!currentSite && !settings.sites[currentSite] && site === 'other'));
    });
  }

  // ---------------------------------------------------------------- accent
  var darkScheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function mixHex(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return '#' + pa.map(function (v, i) { return ('0' + Math.round(v + (pb[i] - v) * t).toString(16)).slice(-2); }).join('');
  }
  function lumOf(hex) {
    var p = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16) / 255; });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  }
  function okHex(x) { return typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x); }
  function currentAccent() {
    var tb = settings.toolbar;
    if (tb.accent === 'custom' && okHex(tb.primary)) return [tb.primary, okHex(tb.secondary) ? tb.secondary : tb.primary];
    if (tb.accent === 'dynamic') return player && player.accent && okHex(player.accent[0]) ? player.accent : QLOCK_ACCENTS.rose;
    return QLOCK_ACCENTS[tb.accent] || QLOCK_ACCENTS.rose;
  }
  function applyPopupAccent() {
    if (!settings) return;
    var a = currentAccent();
    var dark = darkScheme ? darkScheme.matches : false;
    // Pastels need darkening to read on a light background.
    var p = dark ? a[0] : mixHex(a[0], '#000000', 0.38);
    var s = dark ? a[1] : mixHex(a[1], '#000000', 0.38);
    var root = document.documentElement.style;
    root.setProperty('--accent', p);
    root.setProperty('--accent2', s);
    root.setProperty('--accent-ink', lumOf(p) > 0.5 ? '#1d1a22' : '#ffffff');
    root.setProperty('--accent-soft', p + '26');
  }
  function renderAccents() {
    var box = $('tbAccent');
    if (!box.firstChild) {
      var items = Object.keys(QLOCK_ACCENTS).map(function (id) { return [id, QLOCK_ACCENT_NAMES[id], 'linear-gradient(135deg,' + QLOCK_ACCENTS[id][0] + ',' + QLOCK_ACCENTS[id][1] + ')']; });
      items.push(['dynamic', 'From site', 'conic-gradient(#f2a7b5,#f5c26b,#a8d5b5,#9ec9f2,#c3b1f0,#f2a7b5)']);
      items.push(['custom', 'Custom', '']);
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'accent'; b.setAttribute('data-v', it[0]); b.setAttribute('role', 'radio');
        if (it[0] === 'dynamic') b.setAttribute('data-tip', 'The site’s brand colour, or the picture’s colours when the site has none');
        var dot = document.createElement('span'); dot.className = 'dot';
        if (it[2]) dot.style.background = it[2];
        b.appendChild(dot);
        b.appendChild(document.createTextNode(it[1]));
        b.addEventListener('click', function () { settings.toolbar.accent = it[0]; save(); renderSettings(); });
        box.appendChild(b);
      });
    }
    box.querySelectorAll('.accent').forEach(function (b) {
      var on = b.getAttribute('data-v') === settings.toolbar.accent;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      if (b.getAttribute('data-v') === 'custom') {
        b.querySelector('.dot').style.background = 'linear-gradient(135deg,' + settings.toolbar.primary + ',' + settings.toolbar.secondary + ')';
      }
    });
    $('customColors').hidden = settings.toolbar.accent !== 'custom';
    if (document.activeElement !== $('accentP')) $('accentP').value = settings.toolbar.primary;
    if (document.activeElement !== $('accentS')) $('accentS').value = settings.toolbar.secondary;
    applyPopupAccent();
  }

  function fmtPic(r, v) { return r[0] === 'warmth' ? (v > 0 ? '+' : '') + v : v + r[4]; }
  function presetValues(pr) {
    var o = {};
    for (var k in QLOCK_DEFAULTS.picture) o[k] = k in pr.p ? pr.p[k] : QLOCK_DEFAULTS.picture[k];
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

  // ---------------------------------------------------------------- status
  function heightLabel(w, h) {
    // Name by width so letterboxed films (1920×800) still read as 1080p.
    if (w >= 3800) return '4K';
    if (w >= 2500) return '1440p';
    if (w >= 1900) return '1080p';
    if (w >= 1260) return '720p';
    if (w >= 840) return '480p';
    if (w > 0) return h + 'p';
    return '—';
  }

  function showEmpty() {
    currentSite = null;
    player = null;
    $('nowEmpty').hidden = false;
    $('nowLive').hidden = true;
    $('nowTelemetry').hidden = true;
    renderPlayer();
    renderSettings();
  }

  function renderStatus(st) {
    currentSite = st.site;
    player = st.player || null;
    $('nowEmpty').hidden = true;
    $('nowLive').hidden = false;

    var level = st.level | 0;
    $('nowSite').textContent = st.siteName + (st.cfg.enabled ? '' : ' · lock off');

    var p = st.playing;
    var res = $('nowRes');
    var telem = $('nowTelemetry');
    if (p && p.width) {
      res.textContent = heightLabel(p.width, p.height);
      var small = document.createElement('small');
      small.textContent = p.width + '×' + p.height + (p.aspect ? ' (' + p.aspect + ')' : '');
      res.appendChild(small);
      telem.hidden = false;
      $('telemetryDown').textContent = (p.downloadedStr || '0 B') + (p.estPerHour ? ' · ' + p.estPerHour : '');
      $('telemetrySpeed').textContent = (p.speedMbps > 0 ? p.speedMbps : '0.00') + ' Mbps';
      $('telemetryBuffer').textContent = (p.bufferAhead || 0) + ' s';
      var dropTxt = p.dropped !== null ? p.dropped + ' (' + p.dropPercent + '%)' : '0';
      $('telemetryFps').textContent = (p.fps > 0 ? p.fps + ' fps · ' : '') + dropTxt;
      var bits = [];
      if (p.paused) bits.push('Paused');
      if (p.playbackRate && p.playbackRate !== 1) bits.push(fmtRate(p.playbackRate));
      if (p.viewportWidth) bits.push('shown at ' + p.viewportWidth + '×' + p.viewportHeight);
      $('nowDetail').textContent = bits.join(' · ');
    } else {
      res.textContent = '—';
      telem.hidden = true;
      $('nowDetail').textContent = 'No video playing in this tab.';
    }

    var kept = $('nowKept');
    var last = st.last && st.last.sets && st.last.sets[0];
    if (last) {
      kept.textContent = 'Kept ' + last.kept.slice(0, 3).join(', ') + (last.kept.length > 3 ? ' and ' + (last.kept.length - 3) + ' more' : '') +
        '. ' + (last.dropped.length ? 'Dropped ' + last.dropped.length + ' lower.' : 'Nothing lower to drop.');
    } else if (st.cfg.enabled) {
      kept.textContent = st.manifestsSeen ? '' : 'No manifest caught yet. Start a video; if this stays empty while it plays, turn on Deep mode (Quality tab).';
    } else {
      kept.textContent = '';
    }

    var warn = $('nowWarn');
    if (level > 0) {
      warn.hidden = false;
      warn.textContent = 'The strict lock failed to play this title, so it is running at fallback level ' + level + ' of 3.';
    } else {
      warn.hidden = true;
    }
    $('resetLevel').hidden = level === 0;

    $('nowTally').className = 'tally' + (level > 0 ? ' bad' : st.manifestsFiltered && p && p.width ? ' ok' : st.cfg.enabled ? ' on' : '');
    $('toggleNerdsBtn').classList.toggle('on', !!st.nerdsOn);

    renderPlayer();
    renderSettings();
  }

  function renderPlayer() {
    var pl = player;
    var has = !!(pl && pl.hasVideo);
    ['toggleHudBtn', 'qaFill', 'qaBackdrop', 'qaPip', 'qaWinfs', 'qaFs', 'qaLights', 'qaSnap'].forEach(function (id) { $(id).disabled = !has; });
    if (!pl) {
      $('nowMode').hidden = true;
      $('ctrlModeTag').textContent = 'No video';
      return;
    }
    var d = pl.display;
    if (settings && settings.toolbar.accent === 'dynamic') applyPopupAccent();
    $('toggleHudBtn').classList.toggle('on', !!(pl.toolbar && pl.toolbar.enabled));
    $('qaFill').classList.toggle('on', d.mode === 'fill');
    $('qaPip').classList.toggle('on', !!pl.pip);
    $('qaWinfs').classList.toggle('on', !!pl.winfs);
    $('qaFs').classList.toggle('on', !!pl.fullscreen);
    $('qaLights').classList.toggle('on', !!pl.lights);

    var custom = d.mode !== 'original' || Math.abs(d.zoom - 1) > 0.004 || Math.abs(d.sx - 1) > 0.004 || Math.abs(d.sy - 1) > 0.004 || d.rot || d.flip;
    $('nowMode').hidden = !custom;
    $('nowMode').textContent = d.label;
    $('ctrlModeTag').textContent = d.label;

    // Display tab
    setSeg('dispMode', d.mode === 'aspect' ? '' : d.mode);
    document.querySelectorAll('#aspectChips .chip').forEach(function (c) {
      c.classList.toggle('on', d.mode === 'aspect' && Math.abs(+c.getAttribute('data-a') - d.aspect) < 0.01);
    });
    setRange($('popZoomRange'), Math.round(d.zoom * 100)); $('popZoomVal').textContent = Math.round(d.zoom * 100) + '%';
    setRange($('popSxRange'), Math.round(d.sx * 100)); $('popSxVal').textContent = Math.round(d.sx * 100) + '%';
    setRange($('popSyRange'), Math.round(d.sy * 100)); $('popSyVal').textContent = Math.round(d.sy * 100) + '%';
    $('flipBtn').classList.toggle('on', !!d.flip);
    var inner = typeof d.inner === 'number' ? d.inner : 0;
    document.querySelectorAll('#innerChips .chip').forEach(function (c) { c.classList.toggle('on', Math.abs(+c.getAttribute('data-i') - inner) < 0.001); });
    var innerNote = $('innerNote');
    innerNote.className = 'note' + (inner === 0 && d.cropBlocked ? ' warn' : '');
    $('barsManual').hidden = inner !== -2;
    var bt = Math.round((d.barT || 0) * 200) / 2, bl = Math.round((d.barL || 0) * 200) / 2;
    setRange($('barT'), bt); $('barTVal').textContent = bt + '%';
    setRange($('barL'), bl); $('barLVal').textContent = bl + '%';
    $('barLink').checked = !!d.barLink;
    innerNote.textContent = inner === -2 ? 'Fill zooms past these bars; ambient / blur fill paints over them.'
      : inner > 0 ? 'Treating everything outside a ' + inner + ':1 picture as bars (Fill zooms past them, the backdrop covers them).'
      : inner === -1 ? 'Nothing inside the video is treated as bars.'
      : d.cropBlocked ? 'This site doesn’t let extensions read its frames, so Auto can’t see these bars. Pick the film’s shape.'
      : d.cropDetected ? 'Detected and removed.' : 'Auto checks the picture while Fill or Stretch is on.';
    var note = 'Showing ' + Math.round(d.effX * 100) + '% × ' + Math.round(d.effY * 100) + '% of the player’s size.';
    if (d.cropDetected) note += ' Black bars inside the picture were detected and removed.';
    $('dispNote').textContent = note;

    // backdrop state
    var b = pl.backdrop || {};
    var bdNote = $('bdNote');
    var bdState = $('bdState');
    if (b.blocked === 'drm') {
      bdNote.hidden = false;
      bdNote.textContent = 'This video is DRM-protected (Netflix, Prime and similar). Browsers don’t let extensions read its frames, so the backdrop can’t be drawn here. It works on YouTube and most other sites.';
    } else if (b.blocked === 'bare-fullscreen') {
      bdNote.hidden = false;
      bdNote.textContent = 'The bare video is fullscreen, which hides everything behind it. Use the toolbar’s fullscreen button instead.';
    } else bdNote.hidden = true;
    if (b.mode && b.mode !== 'off') {
      bdState.hidden = false;
      bdState.className = 'pill' + (b.blocked ? ' bad' : ' accent');
      bdState.textContent = b.blocked ? 'Unavailable' : b.drawing && b.visible ? 'Filling bars' : b.drawing ? 'No bars now' : 'Waiting';
    } else bdState.hidden = true;

    // Playback tab
    var rate = pl.playback ? pl.playback.rate : 1;
    $('speedBig').textContent = fmtRate(rate);
    setRange($('speedRange'), Math.min(4, Math.max(0.25, rate)));
    document.querySelectorAll('#speedChips .chip').forEach(function (c) { c.classList.toggle('on', Math.abs(+c.getAttribute('data-r') - rate) < 0.001); });
  }

  function poll() {
    if (tabId === null) return;
    chrome.runtime.sendMessage({ type: 'qlock:pickFrame', tabId: tabId }, function (id) {
      frameId = !chrome.runtime.lastError && typeof id === 'number' ? id : 0;
      sendToTab({ type: 'qlock:status' }, function (status) {
        if (status) { renderStatus(status); return; }
        if (frameId === 0) { showEmpty(); return; }
        frameId = 0;
        sendToTab({ type: 'qlock:status' }, function (st) { if (st) renderStatus(st); else showEmpty(); });
      });
    });
  }

  // ---------------------------------------------------------------- NOW tab
  $('enabled').addEventListener('change', function (e) {
    settings.enabled = e.target.checked;
    save(); renderSettings(); needsReload();
  });
  $('reload').addEventListener('click', function () {
    if (tabId === null) return;
    chrome.tabs.reload(tabId);
    $('applyHint').hidden = true;
    $('reload').classList.remove('primary');
  });
  $('resetLevel').addEventListener('click', function () {
    if (tabId === null) return;
    sendToTab({ type: 'qlock:resetLevel' }, function () { chrome.tabs.reload(tabId); });
  });
  $('toggleNerdsBtn').addEventListener('click', function () { sendToTab({ type: 'qlock:toggleNerds' }); setTimeout(poll, 120); });
  $('toggleHudBtn').addEventListener('click', function () { act('toggleToolbar', { keys: keys }); });
  $('qaFill').addEventListener('click', function () { act('toggleFill'); });
  $('qaBackdrop').addEventListener('click', function () {
    var order = ['off', 'ambient', 'blur'];
    settings.backdrop.mode = order[(order.indexOf(settings.backdrop.mode) + 1) % order.length];
    save(); renderSettings();
  });
  $('qaPip').addEventListener('click', function () { actWithGesture('pip'); });
  $('qaFs').addEventListener('click', function () { actWithGesture('fullscreen'); });
  $('qaWinfs').addEventListener('click', function () { act('winfs'); });
  $('qaLights').addEventListener('click', function () { act('lights'); });
  $('qaSnap').addEventListener('click', function () { act('snapshot'); });

  // ---------------------------------------------------------------- DISPLAY tab
  onSeg('dispMode', function (m) { act('setMode', { mode: m }); });
  document.querySelectorAll('#aspectChips .chip').forEach(function (c) {
    c.addEventListener('click', function () { act('setAspect', { aspect: +c.getAttribute('data-a') }); });
  });
  function applyCustomAspect() {
    var raw = String($('customAspect').value).trim();
    var m = raw.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
    var a = m ? +m[1] / +m[2] : +raw;
    if (a > 0.2 && a < 6) act('setAspect', { aspect: a });
    else $('customAspect').focus();
  }
  $('customAspectApply').addEventListener('click', applyCustomAspect);
  $('customAspect').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyCustomAspect(); });
  $('btnResetTransform').addEventListener('click', function () { act('reset'); });
  ['barT', 'barL'].forEach(function (id) {
    var input = $(id);
    rangeFill(input);
    input.addEventListener('input', function () {
      rangeFill(input);
      $(id + 'Val').textContent = input.value + '%';
      var v = +input.value / 100;
      var link = $('barLink').checked;
      var t = id === 'barT' ? v : (link ? v : +$('barT').value / 100);
      var l = id === 'barL' ? v : (link ? v : +$('barL').value / 100);
      act('setBars', { t: t, l: l, quiet: true });
    });
  });
  $('barLink').addEventListener('change', function (e) { act('setBarLink', { on: e.target.checked }); });
  document.querySelectorAll('#innerChips .chip').forEach(function (c) {
    c.addEventListener('click', function () { act('setInner', { inner: +c.getAttribute('data-i') }); });
  });
  $('rotL').addEventListener('click', function () { act('rotateCcw'); });
  $('rotR').addEventListener('click', function () { act('rotateCw'); });
  $('flipBtn').addEventListener('click', function () { act('flip'); });

  function wireSlider(rangeId, valId, minusId, plusId, step, action, param) {
    var range = $(rangeId);
    rangeFill(range);
    function apply(n) {
      $(valId).textContent = n + '%';
      rangeFill(range);
      var params = {};
      params[param] = n / 100;
      act(action, params);
    }
    range.addEventListener('input', function () { apply(+range.value); });
    range.addEventListener('dblclick', function () { range.value = 100; apply(100); });
    $(minusId).addEventListener('click', function () { range.value = Math.max(+range.min, +range.value - step); apply(+range.value); });
    $(plusId).addEventListener('click', function () { range.value = Math.min(+range.max, +range.value + step); apply(+range.value); });
  }
  wireSlider('popZoomRange', 'popZoomVal', 'popZoomMinus', 'popZoomPlus', 5, 'setZoom', 'zoom');
  wireSlider('popSxRange', 'popSxVal', 'popSxMinus', 'popSxPlus', 5, 'setStretchX', 'scaleX');
  wireSlider('popSyRange', 'popSyVal', 'popSyMinus', 'popSyPlus', 5, 'setStretchY', 'scaleY');

  onSeg('bdMode', function (m) { settings.backdrop.mode = m; save(); renderSettings(); setTimeout(poll, 200); });
  [['bdIntensity', 'intensity', 'bdIntensityVal'], ['bdBlur', 'blur', 'bdBlurVal']].forEach(function (r) {
    var input = $(r[0]);
    input.addEventListener('input', function () {
      rangeFill(input);
      $(r[2]).textContent = input.value + '%';
      var b = JSON.parse(JSON.stringify(settings.backdrop));
      b[r[1]] = +input.value;
      act('backdropLive', { backdrop: b });
    });
    input.addEventListener('change', function () { settings.backdrop[r[1]] = +input.value; save(); });
  });
  bindToggle('smartCrop', null, function (v) { settings.display.smartCrop = v; });
  bindToggle('rememberPerSite', null, function (v) { settings.display.rememberPerSite = v; });

  // ---------------------------------------------------------------- PICTURE tab
  (function buildPicture() {
    var presets = $('picPresets');
    PICTURE_PRESETS.forEach(function (pr) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.textContent = pr.name;
      c.setAttribute('data-id', pr.id);
      c.addEventListener('click', function () { settings.picture = presetValues(pr); save(); renderSettings(); });
      presets.appendChild(c);
    });
    var box = $('picSliders');
    PICTURE_ROWS.forEach(function (r) {
      var wrap = document.createElement('div');
      wrap.className = 'sl';
      wrap.title = 'Double-click to reset';
      var label = document.createElement('label');
      label.setAttribute('for', 'pic-' + r[0]);
      label.textContent = r[1];
      var out = document.createElement('output');
      out.id = 'pic-' + r[0] + '-val';
      var input = document.createElement('input');
      input.type = 'range'; input.min = r[2]; input.max = r[3]; input.step = 1; input.id = 'pic-' + r[0];
      input.addEventListener('input', function () {
        rangeFill(input);
        out.textContent = fmtPic(r, +input.value);
        var p = JSON.parse(JSON.stringify(settings.picture));
        p[r[0]] = +input.value;
        act('pictureLive', { picture: p });
      });
      input.addEventListener('change', function () { settings.picture[r[0]] = +input.value; save(); renderSettings(); });
      input.addEventListener('dblclick', function () { settings.picture[r[0]] = QLOCK_DEFAULTS.picture[r[0]]; save(); input.blur(); renderSettings(); });
      wrap.appendChild(label); wrap.appendChild(out); wrap.appendChild(input);
      box.appendChild(wrap);
    });
    $('picReset').addEventListener('click', function () { settings.picture = presetValues(PICTURE_PRESETS[0]); save(); renderSettings(); });
    var cmp = $('picCompare');
    var end = function () { cmp.classList.remove('on'); act('pictureCompare', { on: false }); };
    cmp.addEventListener('pointerdown', function () { cmp.classList.add('on'); act('pictureCompare', { on: true }); });
    cmp.addEventListener('pointerup', end);
    cmp.addEventListener('pointerleave', function () { if (cmp.classList.contains('on')) end(); });
  })();

  // ---------------------------------------------------------------- PLAYBACK tab
  (function buildSpeed() {
    var chips = $('speedChips');
    [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].forEach(function (r) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip'; c.textContent = fmtRate(r); c.setAttribute('data-r', r);
      c.addEventListener('click', function () { act('setSpeed', { speed: r }); });
      chips.appendChild(c);
    });
    var range = $('speedRange');
    rangeFill(range);
    range.addEventListener('input', function () { rangeFill(range); $('speedBig').textContent = fmtRate(+range.value); act('setSpeed', { speed: +range.value, quiet: true }); });
    range.addEventListener('dblclick', function () { range.value = 1; act('setSpeed', { speed: 1 }); });
    $('speedMinus').addEventListener('click', function () { act('speedDown'); });
    $('speedPlus').addEventListener('click', function () { act('speedUp'); });
  })();
  bindToggle('rememberSpeed', null, function (v) { settings.playback.rememberSpeed = v; });
  $('speedStep').addEventListener('change', function (e) { settings.playback.speedStep = +e.target.value; save(); });
  $('seekStep').addEventListener('change', function (e) { settings.playback.seekStep = +e.target.value; save(); });
  $('mouseWheel').addEventListener('change', function (e) { settings.mouse.wheel = e.target.value; save(); });
  bindToggle('rightWheel', null, function (v) { settings.mouse.rightWheel = v; });
  $('sideButtons').addEventListener('change', function (e) { settings.mouse.sideButtons = e.target.value; save(); });
  $('volumeStep').addEventListener('change', function (e) { settings.mouse.volumeStep = +e.target.value; save(); });
  bindToggle('hideCursor', null, function (v) { settings.mouse.hideCursor = v; });

  // ---------------------------------------------------------------- QUALITY tab
  $('nerds').addEventListener('change', function (e) { settings.nerds = e.target.checked; save(); });
  $('overlay').addEventListener('change', function (e) { settings.overlay = e.target.checked; save(); });
  $('deepMode').addEventListener('change', function (e) { settings.deepMode = e.target.checked; save(); needsReload(); });
  document.querySelectorAll('.site select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var site = sel.closest('.site').getAttribute('data-site');
      if (!settings.sites[site]) settings.sites[site] = { enabled: true, mode: 'best', floor: 1080 };
      applyMode(settings.sites[site], sel.value);
      save(); renderSettings();
      if (site === currentSite || (currentSite && !settings.sites[currentSite] && site === 'other')) needsReload();
    });
  });

  // ---------------------------------------------------------------- SETTINGS tab
  bindToggle('vcEnabled', null, function (v) { settings.videoController.enabled = v; });
  bindToggle('vcShowOsd', null, function (v) { settings.videoController.showOsd = v; });
  onSeg('tbShow', function (v) { settings.toolbar.show = v; save(); renderSettings(); });
  onSeg('tbLayout', function (v) { settings.toolbar.layout = v; save(); renderSettings(); });
  $('tbTheme').querySelectorAll('.theme').forEach(function (t) {
    t.addEventListener('click', function () { settings.toolbar.theme = t.getAttribute('data-v'); save(); renderSettings(); });
  });
  $('tbAutoHide').addEventListener('change', function (e) { settings.toolbar.autoHide = +e.target.value; save(); });
  [['accentP', 'primary'], ['accentS', 'secondary']].forEach(function (c) {
    $(c[0]).addEventListener('change', function (e) { settings.toolbar[c[1]] = e.target.value; save(); renderSettings(); });
  });
  if (darkScheme && darkScheme.addEventListener) darkScheme.addEventListener('change', applyPopupAccent);

  // toolbar button arrangement
  var dragItem = null;
  var buttonsSig = '';
  function labelOf(id) {
    for (var i = 0; i < QLOCK_BUTTONS.length; i++) if (QLOCK_BUTTONS[i].id === id) return QLOCK_BUTTONS[i].label;
    return id;
  }
  function moveButton(from, to) {
    var list = settings.toolbar.buttons;
    if (to < 0 || to >= list.length || from === to) return;
    var item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
    save();
    renderButtonList();
  }
  function renderButtonList() {
    var ul = $('btnList');
    var focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.btn-item') ?
      document.activeElement.closest('.btn-item').getAttribute('data-id') + '|' + (document.activeElement.getAttribute('data-role') || '') : '';
    ul.textContent = '';
    buttonsSig = JSON.stringify(settings.toolbar.buttons);
    settings.toolbar.buttons.forEach(function (b, idx) {
      var li = document.createElement('li');
      li.className = 'btn-item' + (b.on ? '' : ' off');
      li.draggable = true;
      li.setAttribute('data-id', b.id);
      li.innerHTML = '<span class="grip">' + svg('grip') + '</span><span class="ic">' + svg(BUTTON_ICONS[b.id]) + '</span>' +
        '<span class="nm"></span>' +
        '<button type="button" class="mv" data-role="up" aria-label="Move up">' + svg('up') + '</button>' +
        '<button type="button" class="mv" data-role="down" aria-label="Move down">' + svg('down') + '</button>' +
        '<label class="toggle"><input type="checkbox" data-role="on"><span class="mini-switch"></span></label>';
      li.querySelector('.nm').textContent = labelOf(b.id);
      var cb = li.querySelector('input');
      cb.checked = b.on;
      cb.setAttribute('aria-label', 'Show ' + labelOf(b.id));
      cb.addEventListener('change', function () {
        // settings may have been replaced by a storage change since this row was drawn
        settings.toolbar.buttons.forEach(function (x) { if (x.id === b.id) x.on = cb.checked; });
        save(); renderButtonList();
      });
      li.querySelector('[data-role=up]').addEventListener('click', function () { moveButton(idx, idx - 1); });
      li.querySelector('[data-role=down]').addEventListener('click', function () { moveButton(idx, idx + 1); });
      li.addEventListener('dragstart', function (e) { dragItem = idx; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', b.id); } catch (x) { /* ignore */ } });
      li.addEventListener('dragend', function () { dragItem = null; renderButtonList(); });
      li.addEventListener('dragover', function (e) {
        if (dragItem === null) return;
        e.preventDefault();
        var r = li.getBoundingClientRect();
        var after = e.clientY > r.top + r.height / 2;
        li.classList.toggle('drop-after', after);
        li.classList.toggle('drop-before', !after);
      });
      li.addEventListener('dragleave', function () { li.classList.remove('drop-after', 'drop-before'); });
      li.addEventListener('drop', function (e) {
        e.preventDefault();
        if (dragItem === null) return;
        var r = li.getBoundingClientRect();
        var to = idx + (e.clientY > r.top + r.height / 2 ? 1 : 0);
        if (dragItem < to) to--;
        var from = dragItem;
        dragItem = null;
        moveButton(from, to);
      });
      ul.appendChild(li);
    });
    if (focusedId) {
      var parts = focusedId.split('|');
      var el = ul.querySelector('.btn-item[data-id="' + parts[0] + '"] [data-role="' + parts[1] + '"]');
      if (el) el.focus();
    }
  }
  $('btnOrderReset').addEventListener('click', function () { settings.toolbar.buttons = qlockButtons(null); save(); renderButtonList(); });

  // shortcuts (extension commands; Chrome owns the editor for them)
  // Some Chromium browsers don't expose chrome.commands to the popup; the popup
  // must still work without the shortcut list.
  function loadShortcuts() {
    if (!chrome.commands || typeof chrome.commands.getAll !== 'function') {
      $('keyList').textContent = 'This browser doesn’t report shortcuts here — see chrome://extensions/shortcuts.';
      return;
    }
    chrome.commands.getAll(function (cmds) {
      keys = {};
      var ul = $('keyList');
      ul.textContent = '';
      var order = Object.keys(chrome.runtime.getManifest().commands || {});
      (cmds || []).slice().sort(function (a, b) {
        if (!!a.shortcut !== !!b.shortcut) return a.shortcut ? -1 : 1;
        return order.indexOf(a.name) - order.indexOf(b.name);
      }).forEach(function (c) {
        if (c.name === '_execute_action') return;
        if (c.shortcut) keys[c.name] = c.shortcut;
        var li = document.createElement('li');
        var d = document.createElement('span');
        d.textContent = c.description || c.name;
        var k = document.createElement('span');
        k.className = 'k' + (c.shortcut ? '' : ' unset');
        k.textContent = c.shortcut || 'Not set';
        li.appendChild(d); li.appendChild(k);
        ul.appendChild(li);
      });
      $('qaHint').textContent = keys['toggle-video-hud'] ? keys['toggle-video-hud'] + ' toggles the toolbar' : '';
      $('toggleHudBtn').setAttribute('data-tip', 'Show or hide the floating toolbar' + (keys['toggle-video-hud'] ? ' (' + keys['toggle-video-hud'] + ')' : ''));
      act('setKeys', { keys: keys });
    });
  }
  $('editShortcuts').addEventListener('click', function () { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });

  var resetArmed = 0;
  $('resetAll').addEventListener('click', function () {
    var b = $('resetAll');
    if (!resetArmed) {
      resetArmed = setTimeout(function () { resetArmed = 0; b.classList.remove('armed'); b.textContent = 'Reset all settings'; }, 3000);
      b.classList.add('armed');
      b.textContent = 'Click again to reset everything';
      return;
    }
    clearTimeout(resetArmed); resetArmed = 0;
    b.classList.remove('armed'); b.textContent = 'Reset all settings';
    settings = qlockMerge(QLOCK_DEFAULTS, null);
    save(); renderSettings();
  });

  // ---------------------------------------------------------------- init
  fillIcons(document);
  var savedTab = 'now';
  try { savedTab = localStorage.getItem('qlock:tab') || 'now'; } catch (e) { /* ignore */ }
  selectTab(savedTab);
  $('versionNote').textContent = 'QualityLock ' + chrome.runtime.getManifest().version;

  // Toolbar and page changes (remembered speed, picture, backdrop) land in storage too.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync' || !changes[QLOCK_KEY] || !settings) return;
    settings = qlockMerge(QLOCK_DEFAULTS, changes[QLOCK_KEY].newValue);
    renderSettings();
  });

  chrome.storage.sync.get(QLOCK_KEY, function (r) {
    settings = qlockMerge(QLOCK_DEFAULTS, r && r[QLOCK_KEY]);
    renderSettings();
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      tabId = tabs && tabs[0] ? tabs[0].id : null;
      poll();
      try { loadShortcuts(); } catch (e) { /* shortcut list is optional */ }
      setInterval(poll, 1000);
    });
  });
})();
