// QualityLock — service worker. Runs the keyboard commands listed at
// chrome://extensions/shortcuts and routes them, like the popup's controls, to the
// frame that holds the tab's main video (embedded players live in iframes, which
// never see key presses made while the top page has focus).
'use strict';

var COMMAND_ACTIONS = {
  'toggle-video-hud': 'toggleToolbar',
  'quick-ratio': 'cycle',
  'zoom-in': 'zoomIn',
  'zoom-out': 'zoomOut',
  'reset-video': 'reset',
  'speed-up': 'speedUp',
  'speed-down': 'speedDown',
  'speed-reset': 'speedReset',
  'seek-back': 'seekBack',
  'seek-forward': 'seekFwd',
  'toggle-fill': 'toggleFill',
  'cycle-backdrop': 'cycleBackdrop',
  'toggle-pip': 'pip',
  'toggle-fullscreen': 'fullscreen',
  'window-fullscreen': 'winfs',
  'toggle-lights': 'lights',
  'snapshot': 'snapshot'
};

// Picture-in-Picture and fullscreen need a user gesture inside the page. A
// script injected while handling a command (or a popup click) carries it; a
// runtime message does not.
var GESTURE_ACTIONS = { pip: true, fullscreen: true };

// Per-tab video scores reported by each frame: { 'frames:<tabId>': { <frameId>: score } }.
// Kept in storage.session so it survives the worker being shut down; all edits go
// through one in-memory copy so concurrent reports can't overwrite each other.
var framesCache = null;

function framesKey(tabId) { return 'frames:' + tabId; }

function loadFrames() {
  if (!framesCache) {
    framesCache = chrome.storage.session.get(null).then(function (all) { return all || {}; });
  }
  return framesCache;
}

function updateFrames(tabId, edit) {
  return loadFrames().then(function (all) {
    var key = framesKey(tabId);
    var frames = all[key] || {};
    edit(frames);
    if (Object.keys(frames).length) {
      all[key] = frames;
      var o = {};
      o[key] = frames;
      return chrome.storage.session.set(o);
    }
    delete all[key];
    return chrome.storage.session.remove(key);
  });
}

function videoFrame(tabId) {
  return loadFrames().then(function (all) {
    var frames = all[framesKey(tabId)] || {};
    var best = 0;
    var bestScore = 0;
    for (var id in frames) {
      if (frames[id] > bestScore) { best = +id; bestScore = frames[id]; }
    }
    return best;
  });
}

function sendToFrame(tabId, frameId, msg) {
  return new Promise(function (resolve) {
    chrome.tabs.sendMessage(tabId, msg, { frameId: frameId }, function (res) {
      resolve(chrome.runtime.lastError ? { failed: true } : { res: res });
    });
  });
}

// Sends to the video frame; if that frame is gone, forgets it and falls back to the top frame.
function sendToVideoFrame(tabId, msg) {
  return videoFrame(tabId).then(function (frameId) {
    return sendToFrame(tabId, frameId, msg).then(function (r) {
      if (!r.failed || frameId === 0) return r.res;
      return updateFrames(tabId, function (f) { delete f[frameId]; })
        .then(function () { return sendToFrame(tabId, 0, msg); })
        .then(function (r0) { return r0.res; });
    });
  });
}

function shortcutKeys() {
  if (!chrome.commands || !chrome.commands.getAll) return Promise.resolve({});
  return chrome.commands.getAll().then(function (cmds) {
    var keys = {};
    cmds.forEach(function (c) { if (c.shortcut) keys[c.name] = c.shortcut; });
    return keys;
  });
}

function runWithGesture(tabId, frameId, action) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: function (a) { window.postMessage({ __qlock: 'player', action: a }, '*'); },
    args: [action]
  }).catch(function () { /* page not scriptable (chrome://, store) */ });
}

if (chrome.commands && chrome.commands.onCommand) chrome.commands.onCommand.addListener(function (command, tab) {
  var action = COMMAND_ACTIONS[command];
  if (!action) return;
  var tabReady = tab && tab.id >= 0
    ? Promise.resolve(tab)
    : chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(function (t) { return t[0]; });
  if (GESTURE_ACTIONS[action]) {
    // Inject right away, while the key press still counts as a gesture.
    tabReady.then(function (t) {
      if (!t || t.id < 0) return;
      return videoFrame(t.id).then(function (frameId) { return runWithGesture(t.id, frameId, action); });
    });
    return;
  }
  Promise.all([tabReady, shortcutKeys()]).then(function (r) {
    var t = r[0];
    if (!t || t.id < 0) return;
    return sendToVideoFrame(t.id, { type: 'qlock:player', action: action, params: { keys: r[1] } });
  });
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'qlock:videoScore' && sender.tab && typeof sender.frameId === 'number') {
    var score = +msg.score;
    if (!isFinite(score)) return false;
    updateFrames(sender.tab.id, function (f) {
      if (score > 0) f[sender.frameId] = score;
      else delete f[sender.frameId];
    });
    return false;
  }

  // The top frame started a new document, so every old frame id is gone.
  if (msg.type === 'qlock:frameReset' && sender.tab && sender.frameId === 0) {
    updateFrames(sender.tab.id, function (f) { for (var k in f) delete f[k]; });
    return false;
  }

  if (msg.type === 'qlock:pickFrame' && typeof msg.tabId === 'number') {
    videoFrame(msg.tabId).then(sendResponse);
    return true; // async response
  }
  return false;
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  updateFrames(tabId, function (f) { for (var k in f) delete f[k]; });
});
