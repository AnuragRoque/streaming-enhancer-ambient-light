// QualityLock — content script (isolated world). Passes settings from
// chrome.storage to the page script and relays status requests from the popup.
(function () {
  'use strict';

  var LS_KEY = '__qlock_settings';

  function push(settings) {
    // Cache in the site's localStorage so the page script has settings
    // synchronously at document_start on the next load.
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
    window.postMessage({ __qlock: 'settings', settings: settings }, location.origin);
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

  var lastScore = 0;
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.__qlock !== 'videoScore') return;
    var score = +e.data.score;
    if (!isFinite(score) || score < 0 || score === lastScore) return;
    lastScore = score;
    toBackground({ type: 'qlock:videoScore', score: score });
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
      window.postMessage({ __qlock: 'getStatus', id: id }, location.origin);
      setTimeout(function () { finish(null); }, 1000);
      return true; // async response
    }

    if (msg.type === 'qlock:resetLevel') {
      window.postMessage({ __qlock: 'resetLevel' }, location.origin);
      sendResponse(true);
      return false;
    }

    if (msg.type === 'qlock:toggleNerds') {
      window.postMessage({ __qlock: 'toggleNerds' }, location.origin);
      sendResponse(true);
      return false;
    }

    if (msg.type === 'qlock:toggleVideoController') {
      window.postMessage({ __qlock: 'toggleVideoController' }, location.origin);
      sendResponse(true);
      return false;
    }

    if (msg.type === 'qlock:videoTransform') {
      window.postMessage({ __qlock: 'videoTransform', action: msg.action, params: msg.params, keys: msg.keys }, location.origin);
      sendResponse(true);
      return false;
    }
    return false;
  });
})();
