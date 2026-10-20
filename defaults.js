// Shared defaults for the bridge (content script) and the popup.
// inject.js and player.js keep their own copies because they run in the page,
// not the extension. Keep the four in step.
var QLOCK_KEY = 'qlock';

// Floating toolbar buttons, in default order. `on` is the default visibility.
var QLOCK_BUTTONS = [
  { id: 'play',       on: true,  label: 'Play / pause' },
  { id: 'back',       on: true,  label: 'Seek back' },
  { id: 'fwd',        on: true,  label: 'Seek forward' },
  { id: 'speed',      on: true,  label: 'Speed' },
  { id: 'fill',       on: true,  label: 'Hide black bars' },
  { id: 'display',    on: true,  label: 'Zoom & aspect' },
  { id: 'backdrop',   on: true,  label: 'Ambient / blur fill' },
  { id: 'picture',    on: true,  label: 'Picture filters' },
  { id: 'rotate',     on: false, label: 'Rotate 90°' },
  { id: 'loop',       on: false, label: 'A-B loop' },
  { id: 'snapshot',   on: false, label: 'Snapshot' },
  { id: 'lights',     on: false, label: 'Lights off' },
  { id: 'pip',        on: true,  label: 'Picture-in-Picture' },
  { id: 'winfs',      on: true,  label: 'Fill browser window' },
  { id: 'fullscreen', on: true,  label: 'Fullscreen' },
  { id: 'stats',      on: false, label: 'Stats for nerds' }
];

// Accent palettes: [primary, secondary]. Kept in step with player.js.
var QLOCK_ACCENTS = {
    rose: ['#f2a7b5', '#c9a3e6'], peach: ['#f7b98b', '#f29e9e'], amber: ['#f5c26b', '#e89b5a'], sand: ['#e3c9a1', '#c7a27e'],
    sage: ['#a8d5b5', '#8cc7c2'], sky: ['#9ec9f2', '#b4a7ee'], lavender: ['#c3b1f0', '#f0b3d6'], mono: ['#e6e6e6', '#a8a8a8']
  };
var QLOCK_ACCENT_NAMES = { rose: 'Rose', peach: 'Peach', amber: 'Amber', sand: 'Sand', sage: 'Sage', sky: 'Sky', lavender: 'Lavender', mono: 'Mono' };

var QLOCK_DEFAULTS = {
  enabled: true,
  overlay: false,     // keep the compact on-screen readout visible (always pops up briefly on resolution change)
  nerds: false,       // persistent Stats for Nerds HUD overlay (Alt+Shift+N)
  deepMode: false,    // also hook Web Workers (experimental)
  videoController: {
    enabled: true,    // toolbar, display, picture, mouse and keyboard features
    showOsd: true     // on-screen badge when a zoom/ratio/speed/volume change is applied
    // Shortcuts are extension commands (manifest.json), set at chrome://extensions/shortcuts.
  },
  toolbar: {
    show: 'hover',      // 'hover' | 'always' | 'manual' (only via shortcut / popup)
    layout: 'compact',  // 'compact' | 'expanded' (adds the timeline row)
    theme: 'glass',     // 'dark' | 'light' | 'glass'
    autoHide: 3,        // seconds of no mouse movement before it fades; 0 = never
    accent: 'rose',     // a QLOCK_ACCENTS id, 'dynamic' (from the site / video) or 'custom'
    primary: '#f2a7b5', // custom accent colours
    secondary: '#c9a3e6',
    buttons: QLOCK_BUTTONS.map(function (b) { return { id: b.id, on: b.on }; })
  },
  display: {
    rememberPerSite: false, // restore zoom / ratio / rotation on the same site next time
    smartCrop: true         // Fill mode also removes black bars baked into the picture
  },
  picture: {
    brightness: 100, contrast: 100, saturation: 100, gamma: 100, // percent
    warmth: 0,       // -100 (cool) .. 100 (warm, night viewing)
    sharpness: 0,    // 0 .. 100
    grayscale: 0     // 0 .. 100
  },
  backdrop: {
    mode: 'off',     // 'off' | 'ambient' (glow from the edges) | 'blur' (blurred copy fills the bars)
    intensity: 80,   // 0 .. 100
    blur: 50         // 0 .. 100
  },
  playback: {
    speed: 1,
    rememberSpeed: true,
    speedStep: 0.25,
    seekStep: 10     // seconds, for toolbar buttons, side buttons and seek commands
  },
  mouse: {
    wheel: 'fullscreen', // wheel over the video changes volume: 'off' | 'fullscreen' | 'always'
    rightWheel: true,    // hold right button + wheel over the video = volume, anywhere
    sideButtons: 'video',// back/forward mouse buttons seek: 'off' | 'video' (pointer over it / fullscreen) | 'page'
    volumeStep: 5,       // percent
    hideCursor: true     // hide the cursor over the video in fullscreen when idle
  },
  sites: {
    netflix: { enabled: true, mode: 'best', floor: 1080 },
    prime:   { enabled: true, mode: 'best', floor: 720 },
    hotstar: { enabled: true, mode: 'best', floor: 720 },
    other:   { enabled: true, mode: 'best', floor: 1080 }
  }
};

// Puts every known button in exactly once, keeping the stored order and switches.
function qlockButtons(list) {
  var known = {};
  QLOCK_BUTTONS.forEach(function (b) { known[b.id] = b; });
  var out = [];
  var seen = {};
  if (Array.isArray(list)) {
    list.forEach(function (b) {
      if (!b || !known[b.id] || seen[b.id]) return;
      seen[b.id] = true;
      out.push({ id: b.id, on: b.on !== false });
    });
  }
  QLOCK_BUTTONS.forEach(function (b) {
    if (!seen[b.id]) out.push({ id: b.id, on: b.on });
  });
  return out;
}

// Deep merge onto the defaults: only known keys, only values of the same type.
function qlockMerge(defaults, stored) {
  function merge(d, s) {
    if (Array.isArray(d)) return Array.isArray(s) ? JSON.parse(JSON.stringify(s)) : JSON.parse(JSON.stringify(d));
    if (d && typeof d === 'object') {
      var o = {};
      for (var k in d) o[k] = merge(d[k], s && typeof s === 'object' && !Array.isArray(s) ? s[k] : undefined);
      return o;
    }
    return (s !== undefined && s !== null && typeof s === typeof d) ? s : d;
  }
  var out = merge(defaults, stored);
  if (out.toolbar) out.toolbar.buttons = qlockButtons(out.toolbar.buttons);
  return out;
}
