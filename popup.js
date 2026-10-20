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

  function renderSettings() {
    $('enabled').checked = !!settings.enabled;
    document.body.classList.toggle('disabled', !settings.enabled);
    $('overlay').checked = !!settings.overlay;
    if ($('nerds')) $('nerds').checked = !!settings.nerds;
    $('deepMode').checked = !!settings.deepMode;
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

    renderSettings();
  }

  function poll() {
    if (tabId === null) return;
    chrome.tabs.sendMessage(tabId, { type: 'qlock:status' }, { frameId: 0 }, function (status) {
      if (chrome.runtime.lastError || !status) { showEmpty(); return; }
      renderStatus(status);
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
    chrome.tabs.sendMessage(tabId, { type: 'qlock:resetLevel' }, { frameId: 0 }, function () {
      void chrome.runtime.lastError;
      chrome.tabs.reload(tabId);
    });
  });
  if ($('toggleNerdsBtn')) {
    $('toggleNerdsBtn').addEventListener('click', function () {
      if (tabId === null) return;
      chrome.tabs.sendMessage(tabId, { type: 'qlock:toggleNerds' }, { frameId: 0 }, function () {
        void chrome.runtime.lastError;
      });
    });
  }

  // --- init ---
  chrome.storage.sync.get(QLOCK_KEY, function (r) {
    settings = qlockMerge(QLOCK_DEFAULTS, r && r[QLOCK_KEY]);
    renderSettings();
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      tabId = tabs && tabs[0] ? tabs[0].id : null;
      poll();
      setInterval(poll, 1000);
    });
  });
})();
