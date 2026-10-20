(function () {
  'use strict';

  var MODES = [
    { v: 'best', label: 'Best only' },
    { v: 'floor1080', label: 'Never below 1080p' },
    { v: 'floor720', label: 'Never below 720p' },
    { v: 'off', label: 'Off' }
  ];

  var settings = null;
  var tabId = null;
  var frameId = 0;  // frame holding the tab's main video (see background.js)
  var keys = { hud: '', ratio: '' };
  var currentSite = null;
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

  var isUserAdjustingSlider = false;

  function sendToTab(msg, cb) {
    if (tabId === null) return;
    chrome.tabs.sendMessage(tabId, msg, { frameId: frameId }, function (res) {
      if (chrome.runtime.lastError) res = undefined;
      if (cb) cb(res);
    });
  }

  function sendVideoAction(action, params) {
    sendToTab({ type: 'qlock:videoTransform', action: action, params: params, keys: keys });
  }

  function toggleVideoHud() {
    sendVideoAction('toggleHud');
  }

  function loadShortcuts() {
    chrome.commands.getAll(function (cmds) {
      (cmds || []).forEach(function (c) {
        if (c.name === 'toggle-video-hud') keys.hud = c.shortcut || '';
        if (c.name === 'quick-ratio') keys.ratio = c.shortcut || '';
      });
      [['keyHud', keys.hud], ['keyRatio', keys.ratio]].forEach(function (p) {
        var el = $(p[0]);
        if (!el) return;
        el.textContent = p[1] || 'Not set';
        el.classList.toggle('unset', !p[1]);
      });
      if ($('toggleHudBtn')) $('toggleHudBtn').title = 'Toggle Video Controller HUD' + (keys.hud ? ' (' + keys.hud + ')' : '');
    });
  }

  function renderSettings() {
    $('enabled').checked = !!settings.enabled;
    document.body.classList.toggle('disabled', !settings.enabled);
    $('overlay').checked = !!settings.overlay;
    if ($('nerds')) $('nerds').checked = !!settings.nerds;
    $('deepMode').checked = !!settings.deepMode;

    // Video Controller settings
    var vc = settings.videoController || {};
    if ($('vcShowOsd')) $('vcShowOsd').checked = vc.showOsd !== false;

    document.querySelectorAll('.site').forEach(function (row) {
      var site = row.getAttribute('data-site');
      var s = settings.sites[site] || { enabled: true, mode: 'best', floor: 1080 };
      var sel = row.querySelector('select');
      if (!sel.options.length) MODES.forEach(function (m) { sel.add(new Option(m.label, m.v)); });
      sel.value = modeOf(s);
      row.querySelector('.tally').className = 'tally' + (settings.enabled && s.enabled ? ' on' : '');
      row.classList.toggle('current', site === currentSite || (currentSite && !settings.sites[currentSite] && site === 'other'));
    });
  }

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
    $('nowEmpty').hidden = false;
    $('nowLive').hidden = true;
    var telem = $('nowTelemetry');
    if (telem) telem.hidden = true;
    renderSettings();
  }

  function renderStatus(st) {
    currentSite = st.site;
    $('nowEmpty').hidden = true;
    $('nowLive').hidden = false;

    var level = st.level | 0;
    $('nowSite').textContent = st.siteName + (st.cfg.enabled ? '' : ', lock off');

    var p = st.playing;
    var res = $('nowRes');
    var telem = $('nowTelemetry');

    if (p && p.width) {
      res.textContent = heightLabel(p.width, p.height);
      var small = document.createElement('small');
      small.textContent = p.width + '×' + p.height + (p.aspect ? ' (' + p.aspect + ')' : '');
      res.appendChild(small);

      if (telem) {
        telem.hidden = false;
        $('telemetryDown').textContent = p.downloadedStr || '0 B';
        $('telemetrySpeed').textContent = (p.speedMbps > 0 ? p.speedMbps : '0.00') + ' Mbps';
        $('telemetryBuffer').textContent = (p.bufferAhead || 0) + ' s';
        var dropTxt = p.dropped !== null ? p.dropped + ' (' + p.dropPercent + '%)' : '0';
        $('telemetryFps').textContent = (p.fps > 0 ? p.fps + ' fps · ' : '') + dropTxt;
      }

      var bits = ['Buffer ' + p.bufferAhead + ' s'];
      if (p.dropped !== null && p.dropped !== undefined) bits.push(p.dropped + ' dropped');
      if (p.fps) bits.push(p.fps + ' fps');
      if (p.paused) bits.push('paused');
      $('nowDetail').textContent = bits.join(', ');
    } else {
      res.textContent = '—';
      if (telem) telem.hidden = true;
      $('nowDetail').textContent = 'No video playing in this tab.';
    }

    var kept = $('nowKept');
    var last = st.last && st.last.sets && st.last.sets[0];
    if (last) {
      kept.textContent = 'Kept ' + last.kept.slice(0, 3).join(', ') + (last.kept.length > 3 ? ' and ' + (last.kept.length - 3) + ' more' : '') +
        '. ' + (last.dropped.length ? 'Dropped ' + last.dropped.length + ' lower.' : 'Nothing lower to drop.');
    } else if (st.cfg.enabled) {
      kept.textContent = st.manifestsSeen ? '' : 'No manifest caught yet. Start a video; if this stays empty while it plays, turn on Deep mode.';
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

    var tally = $('nowTally');
    tally.className = 'tally' + (level > 0 ? ' bad' : st.manifestsFiltered && p && p.width ? ' ok' : st.cfg.enabled ? ' on' : '');

    if (st.videoTransform) {
      var vt = st.videoTransform;
      var zPct = Math.round((vt.zoom || 1) * 100);
      var sxPct = Math.round((vt.scaleX || 1) * 100);
      var syPct = Math.round((vt.scaleY || 1) * 100);

      if ($('popZoomVal')) $('popZoomVal').textContent = zPct + '%';
      if ($('popSxVal')) $('popSxVal').textContent = sxPct + '%';
      if ($('popSyVal')) $('popSyVal').textContent = syPct + '%';

      if (!isUserAdjustingSlider) {
        if ($('popZoomRange')) $('popZoomRange').value = zPct;
        if ($('popSxRange')) $('popSxRange').value = sxPct;
        if ($('popSyRange')) $('popSyRange').value = syPct;
      }

      if ($('ctrlModeTag')) {
        var modeLabels = {
          original: '100% Original',
          fill: '✨ Fix Ratio (' + zPct + '%)',
          'stretch-fill': '↔ Stretch Fill',
          '16:9': '16:9 Stretch',
          '21:9': '21:9 Ultrawide',
          custom: 'Custom (' + zPct + '%)'
        };
        $('ctrlModeTag').textContent = modeLabels[vt.mode] || ('Zoom ' + zPct + '%');
      }
    }

    renderSettings();
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

  // --- events ---
  $('enabled').addEventListener('change', function (e) {
    settings.enabled = e.target.checked;
    save(); renderSettings(); needsReload();
  });
  if ($('nerds')) {
    $('nerds').addEventListener('change', function (e) {
      settings.nerds = e.target.checked;
      save();
    });
  }
  $('overlay').addEventListener('change', function (e) {
    settings.overlay = e.target.checked;
    save();
  });
  $('deepMode').addEventListener('change', function (e) {
    settings.deepMode = e.target.checked;
    save(); needsReload();
  });
  document.querySelectorAll('.site select').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var site = sel.closest('.site').getAttribute('data-site');
      if (!settings.sites[site]) settings.sites[site] = { enabled: true, mode: 'best', floor: 1080 };
      applyMode(settings.sites[site], sel.value);
      save(); renderSettings();
      if (site === currentSite || (currentSite && !settings.sites[currentSite] && site === 'other')) needsReload();
    });
  });
  $('reload').addEventListener('click', function () {
    if (tabId === null) return;
    chrome.tabs.reload(tabId);
    $('applyHint').hidden = true;
    $('reload').classList.remove('primary');
  });
  $('resetLevel').addEventListener('click', function () {
    if (tabId === null) return;
    sendToTab({ type: 'qlock:resetLevel' }, function () {
      chrome.tabs.reload(tabId);
    });
  });
  if ($('toggleNerdsBtn')) {
    $('toggleNerdsBtn').addEventListener('click', function () {
      sendToTab({ type: 'qlock:toggleNerds' });
    });
  }

  // Video Controller buttons
  if ($('toggleHudBtn')) {
    $('toggleHudBtn').addEventListener('click', function () {
      toggleVideoHud();
    });
  }
  if ($('btnFixRatio')) {
    $('btnFixRatio').addEventListener('click', function () {
      sendVideoAction('fixRatio');
    });
  }
  if ($('btnStretchFill')) {
    $('btnStretchFill').addEventListener('click', function () {
      sendVideoAction('stretchFill');
    });
  }
  if ($('btnPreset169')) {
    $('btnPreset169').addEventListener('click', function () {
      sendVideoAction('preset169');
    });
  }
  if ($('btnPreset219')) {
    $('btnPreset219').addEventListener('click', function () {
      sendVideoAction('preset219');
    });
  }
  if ($('btnResetTransform')) {
    $('btnResetTransform').addEventListener('click', function () {
      sendVideoAction('reset');
    });
  }

  // Sliders
  function wireSlider(rangeId, valId, minusId, plusId, min, max, step, actionName, paramName) {
    var range = $(rangeId);
    var valEl = $(valId);
    var minus = $(minusId);
    var plus = $(plusId);
    if (!range) return;

    function applyVal(n) {
      if (valEl) valEl.textContent = n + '%';
      var params = {};
      params[paramName] = n / 100;
      sendVideoAction(actionName, params);
    }

    range.addEventListener('input', function (e) {
      isUserAdjustingSlider = true;
      applyVal(+e.target.value);
    });
    range.addEventListener('change', function () {
      setTimeout(function () { isUserAdjustingSlider = false; }, 400);
    });
    if (minus) {
      minus.addEventListener('click', function () {
        var n = Math.max(min, (+range.value) - step);
        range.value = n;
        applyVal(n);
      });
    }
    if (plus) {
      plus.addEventListener('click', function () {
        var n = Math.min(max, (+range.value) + step);
        range.value = n;
        applyVal(n);
      });
    }
  }

  wireSlider('popZoomRange', 'popZoomVal', 'popZoomMinus', 'popZoomPlus', 50, 300, 5, 'setZoom', 'zoom');
  wireSlider('popSxRange', 'popSxVal', 'popSxMinus', 'popSxPlus', 50, 200, 5, 'setStretchX', 'scaleX');
  wireSlider('popSyRange', 'popSyVal', 'popSyMinus', 'popSyPlus', 50, 200, 5, 'setStretchY', 'scaleY');

  // Shortcuts are extension commands; Chrome owns the editor for them.
  if ($('editShortcuts')) {
    $('editShortcuts').addEventListener('click', function () {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }
  if ($('vcShowOsd')) {
    $('vcShowOsd').addEventListener('change', function (e) {
      if (!settings.videoController) settings.videoController = {};
      settings.videoController.showOsd = e.target.checked;
      save();
    });
  }

  // --- init ---
  chrome.storage.sync.get(QLOCK_KEY, function (r) {
    settings = qlockMerge(QLOCK_DEFAULTS, r && r[QLOCK_KEY]);
    renderSettings();
    loadShortcuts();
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      tabId = tabs && tabs[0] ? tabs[0].id : null;
      poll();
      setInterval(poll, 1000);
    });
  });
})();
