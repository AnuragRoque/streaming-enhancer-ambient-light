// Shared defaults for the bridge (content script) and the popup.
// inject.js keeps its own copy because it runs in the page, not the extension.
var QLOCK_KEY = 'qlock';

var QLOCK_DEFAULTS = {
  enabled: true,
  overlay: false,     // keep the compact on-screen readout visible (always pops up briefly on resolution change)
  nerds: false,       // persistent Stats for Nerds HUD overlay (Alt+Shift+N)
  deepMode: false,    // also hook Web Workers (experimental)
  sites: {
    netflix: { enabled: true, mode: 'best', floor: 1080 },
    prime:   { enabled: true, mode: 'best', floor: 720 },
    hotstar: { enabled: true, mode: 'best', floor: 720 },
    other:   { enabled: true, mode: 'best', floor: 1080 }
  }
};

function qlockMerge(defaults, stored) {
  var out = JSON.parse(JSON.stringify(defaults));
  if (!stored || typeof stored !== 'object') return out;
  for (var k in stored) {
    if (k === 'sites') continue;
    if (k in out) out[k] = stored[k];
  }
  if (stored.sites && typeof stored.sites === 'object') {
    for (var s in out.sites) {
      var src = stored.sites[s];
      if (!src || typeof src !== 'object') continue;
      for (var f in out.sites[s]) if (f in src) out.sites[s][f] = src[f];
    }
  }
  return out;
}
