// QualityLock — content script (isolated world). Passes settings from
// chrome.storage to the page script and relays status requests from the popup.
(function () {
  'use strict';

  var LS_KEY = '__qlock_settings';
  // file:// pages and sandboxed frames have an opaque origin ('null'), which
  // postMessage can't target by name; '*' is fine for posting to our own window.
  var ORIGIN = location.origin && location.origin !== 'null' && location.protocol !== 'file:' ? location.origin : '*';

  function push(settings) {
    // Cache in the site's localStorage so the page script has settings
    // synchronously at document_start on the next load.
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
    window.postMessage({ __qlock: 'settings', settings: settings }, ORIGIN);
  }

  chrome.storage.sync.get(QLOCK_KEY, function (r) {
    push(qlockMerge(QLOCK_DEFAULTS, r && r[QLOCK_KEY]));
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'sync' && changes[QLOCK_KEY]) push(qlockMerge(QLOCK_DEFAULTS, changes[QLOCK_KEY].newValue));
  });

  // Frame routing (background.js): the top frame clears the tab's record on each
  // new document, and every frame reports how good its video is.
  function toBackground(msg) {
    try { chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; }); } catch (e) { /* extension reloaded */ }
  }
  if (window === window.top) toBackground({ type: 'qlock:frameReset' });

  // After the extension is reloaded or updated, this script is cut off but the
  // page scripts keep running the old version; tell them to step aside.
  var aliveTimer = setInterval(function () {
    var alive = false;
    try { alive = !!(chrome.runtime && chrome.runtime.id); } catch (e) { alive = false; }
    if (alive) return;
    clearInterval(aliveTimer);
    window.postMessage({ __qlock: 'retire' }, ORIGIN);
  }, 2000);

  var lastScore = 0;
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__qlock !== 'videoScore') return;
    var score = +e.data.score;
    if (!isFinite(score) || score < 0 || score === lastScore) return;
    lastScore = score;
    toBackground({ type: 'qlock:videoScore', score: score });
  });

  // Settings changed from the on-page toolbar (picture, backdrop, layout,
  // remembered speed). The page can post anything, so only these fields are
  // taken, and qlockMerge drops values of the wrong type.
  var PATCHABLE = {
    picture: ['brightness', 'contrast', 'saturation', 'gamma', 'warmth', 'sharpness', 'grayscale'],
    backdrop: ['mode', 'intensity', 'blur'],
    playback: ['speed'],
    toolbar: ['layout']
  };
  var pending = null;
  var patchTimer = null;
  function flushPatch() {
    patchTimer = null;
    var patch = pending;
    pending = null;
    if (!patch) return;
    chrome.storage.sync.get(QLOCK_KEY, function (r) {
      var cur = qlockMerge(QLOCK_DEFAULTS, r && r[QLOCK_KEY]);
      for (var sec in patch) for (var f in patch[sec]) cur[sec][f] = patch[sec][f];
      var o = {};
      o[QLOCK_KEY] = qlockMerge(QLOCK_DEFAULTS, cur);
      chrome.storage.sync.set(o, function () { void chrome.runtime.lastError; });
    });
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__qlock !== 'patch') return;
    var p = e.data.patch;
    if (!p || typeof p !== 'object') return;
    for (var sec in PATCHABLE) {
      if (!p[sec] || typeof p[sec] !== 'object') continue;
      PATCHABLE[sec].forEach(function (f) {
        var v = p[sec][f];
        if (typeof v !== 'number' && typeof v !== 'string') return;
        if (typeof v === 'number' && !isFinite(v)) return;
        if (!pending) pending = {};
        if (!pending[sec]) pending[sec] = {};
        pending[sec][f] = v;
      });
    }
    // storage.sync allows ~120 writes a minute; coalesce slider drags.
    if (pending && !patchTimer) patchTimer = setTimeout(flushPatch, 700);
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return false;

    if (msg.type === 'qlock:status') {
      var id = 'q' + Math.random().toString(36).slice(2);
      var done = false;
      var onMsg = function (e) {
        if (e.source !== window || !e.data || e.data.__qlock !== 'status' || e.data.id !== id) return;
        finish(e.data.status);
      };
      var finish = function (status) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        sendResponse(status || null);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ __qlock: 'getStatus', id: id }, ORIGIN);
      setTimeout(function () { finish(null); }, 1000);
      return true; // async response
    }

    if (msg.type === 'qlock:resetLevel') {
      window.postMessage({ __qlock: 'resetLevel' }, ORIGIN);
      sendResponse(true);
      return false;
    }

    if (msg.type === 'qlock:toggleNerds') {
      window.postMessage({ __qlock: 'toggleNerds' }, ORIGIN);
      sendResponse(true);
      return false;
    }

    if (msg.type === 'qlock:toggleVideoController') {
      window.postMessage({ __qlock: 'toggleVideoController' }, ORIGIN);
      sendResponse(true);
      return false;
    }

    if (msg.type === 'qlock:videoTransform' || msg.type === 'qlock:player') {
      window.postMessage({ __qlock: 'player', action: msg.action, params: msg.params }, ORIGIN);
      sendResponse(true);
      return false;
    }
    return false;
  });
})();
