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
    return false;
  });
})();
