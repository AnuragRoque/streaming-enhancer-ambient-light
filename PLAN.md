# QualityLock — Development Plan & Execution Log

This document outlines the architecture, completed implementations with timestamps, current operational state, and future roadmap for the **QualityLock** browser extension.

---

## 1. System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              BROWSER EXTENSION                           │
├───────────────────────────────┬──────────────────────────────────────────┤
│   ISOLATED WORLD (per frame)  │          MAIN WORLD (page, per frame)    │
├───────────────────────────────┼──────────────────────────────────────────┤
│ • defaults.js                 │ • inject.js  (also copied into workers   │
│   - settings schema           │   in Deep mode)                          │
│   - deep merge, button list   │   - DASH / HLS / Netflix JSON hooks      │
│ • bridge.js                   │   - fallback watchdog, stats, badge      │
│   - chrome.storage → page     │   - top-layer mounting (popovers)        │
│   - popup/commands → page     │   - core API ──► window.__qlockCore      │
│   - whitelisted page patches  │ • player.js  (takes the core API)        │
│     → chrome.storage          │   - floating toolbar + panels + OSD      │
│   - frame video scores        │   - display engine, baked-bar detection  │
│                               │   - ambient / blur backdrop canvas       │
│                               │   - picture filters (CSS + SVG)          │
│                               │   - speed, timeline previews, A-B loop   │
│                               │   - PiP, fullscreen, window fill, lights │
│                               │   - wheel / right-wheel / side buttons   │
└───────────────▲───────────────┴────────────────────▲─────────────────────┘
                │ runtime messages                   │ scripting.executeScript
┌───────────────┴──────────────┐   ┌─────────────────┴───────────────────────┐
│ POPUP (6 tabs)               │   │ background.js (service worker)          │
│ Now · Display · Picture ·    │   │ - keyboard commands → video frame       │
│ Playback · Quality · Settings│   │ - PiP / fullscreen keep the gesture     │
│ - status poll (1 Hz)         │   │ - per-tab frame scores (storage.session)│
└──────────────────────────────┘   └─────────────────────────────────────────┘
```

---

## 2. Chronological Change Log & Completed Milestones

### 📍 [2026-10-21 01:20:28 +05:30] — Initial Baseline
* **Manifest & Content Script Pipeline**:
  * Set up Manifest V3 (`manifest.json`) targeting `<all_urls>` with `document_start`.
  * Configured dual-world injection (`inject.js` in `MAIN`, `bridge.js` in isolated world).
* **Adaptive Bitrate Filtering**:
  * Intercepted `fetch`, `XMLHttpRequest`, and `JSON.parse` to prune low-bitrate streams from DASH MPD, HLS M3U8, and Netflix JSON manifests.
  * Added fallback watchdog to loosen lock levels if video playback fails.
* **Telemetry HUD & Badge**:
  * Built "Stats for Nerds" draggable HUD (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>) tracking throughput, FPS, dropped frames, buffer, and data usage.

---

### 📍 [2026-10-21 01:25:00 - 01:28:45 +05:30] — Video Controller Engine & Transform Core
* **Storage Schema Update (`defaults.js`)**:
  * Added `videoController` settings schema:
    ```javascript
    videoController: {
      enabled: true,
      showOsd: true,
      shortcutHud: 'Alt+Z',          // Shortcut 1: Toggle HUD
      shortcutQuickZoom: 'Alt+X'     // Shortcut 2: Quick Fix Ratio / Zoom Cycle
    }
    ```
  * Updated `qlockMerge` to persist and merge controller configurations across updates.
* **Message Relay Bridge (`bridge.js`)**:
  * Added listeners for `qlock:toggleVideoController` and `qlock:videoTransform` messages, forwarding them via `window.postMessage`.
* **Transform Engine & Mathematics (`inject.js`)**:
  * **Symmetric Stretch**: Set `transform-origin: 50% 50%` so scaling horizontally (`scaleX`) stretches left + right simultaneously, and scaling vertically (`scaleY`) stretches top + bottom simultaneously.
  * **Smart Fix Ratio (Auto-Crop / Fill)**:
    * Compares $R_{\text{video}} = W_{\text{vid}} / H_{\text{vid}}$ with display area $R_{\text{disp}} = W_{\text{disp}} / H_{\text{disp}}$.
    * If $R_{\text{video}} > R_{\text{disp}}$ (e.g. 21:9 movie on 16:9 screen): calculates $\text{zoom} = R_{\text{video}} / R_{\text{disp}}$ to eliminate top/bottom letterbox bars.
    * If $R_{\text{video}} < R_{\text{disp}}$ (e.g. 4:3 on 16:9, or 16:9 on 21:9 Ultrawide): calculates $\text{zoom} = R_{\text{disp}} / R_{\text{video}}$ to eliminate pillarbox side bars.
  * **Stretch to Fill (No Crop)**: Scales $X$ or $Y$ to the display boundary without cropping content.
  * **Presets**: Added instant modes for `16:9`, `21:9`, `Stretch Fill`, and `↺ Reset (100%)`.

---

### 📍 [2026-10-21 01:28:45 - 01:31:00 +05:30] — Fullscreen HUD, OSD, Shortcuts, & Popup UI
* **Fullscreen-Compatible Floating HUD (`inject.js`)**:
  * Dynamically attaches to `document.fullscreenElement` (or parent) to guarantee visibility during fullscreen playback.
  * Draggable by header bar with pointer capture; minimizable into a compact corner pill.
  * Live range sliders for Zoom (50%–300%), Horizontal Stretch (50%–200%), and Vertical Stretch (50%–200%).
* **OSD Notification Badge (`inject.js`)**:
  * Floating glassmorphism indicator showing active zoom/stretch percentage and mode when shortcuts are pressed, fading out after 2.2 seconds.
* **Global Shortcut & Event Matcher (`inject.js`)**:
  * Implemented flexible keyboard parser matching modifier combos (`Alt+Z`, `Alt+X`, `Ctrl+Shift+Z`, etc.).
  * Added incremental nudge hotkeys (<kbd>Shift</kbd>+<kbd>Arrows</kbd>, <kbd>Shift</kbd>+<kbd>+/-</kbd>, <kbd>Shift</kbd>+<kbd>0</kbd>).
  * Suppressed execution when user focuses `<input>`, `<textarea>`, or contentEditable elements.
* **Popup UI & Key Recorder (`popup.html`, `popup.css`, `popup.js`)**:
  * Created `.video-ctrl` card in popup with live status tag, preset buttons, and steppers.
  * Added interactive key-recorder in Settings: click the input field, press any combination, and it automatically saves to `chrome.storage.sync`.
  * Included reset `↺` buttons to easily revert shortcuts to defaults (`Alt+Z` and `Alt+X`).

---

### 📍 [2026-10-21 01:38:15 +05:30] — Formatting, Validation, & Documentation
* Validated syntax across all extension JavaScript files using Node.js syntax compiler (`node -c`).
* Created `README.md` and `PLAN.md` for project handoff, state tracking, and documentation.

---

### 📍 [2026-10-21] — Zoom in fullscreen, top-layer HUD, Chrome shortcuts
* **Zoom/scale fix (`inject.js`)**: the transform engine now writes the standalone `scale` / `translate` properties instead of `transform`. Chrome's fullscreen stylesheet forces `transform: none !important` on the fullscreen element, so zoom did nothing once the `<video>` itself went fullscreen. A MutationObserver re-applies the values when the player rewrites the video's `style` attribute; videos inside open shadow roots are found too.
* **Top-layer panels**: HUD, OSD, overlay and Stats for Nerds are shown as manual popovers so they render above any fullscreen element (including a fullscreen `<video>`), and are re-raised on `fullscreenchange`.
* **Chrome commands (`manifest.json`, `background.js`)**: `Alt+Z` / `Alt+X` are extension commands, listed and rebindable at `chrome://extensions/shortcuts`, plus unbound zoom in/out/reset commands. The in-page Alt+Z/Alt+X matcher and the popup key-recorder were removed.
* **Frame routing**: each frame reports its video score; commands and the popup go to the frame holding the main video, so embedded iframe players work.

---

### 📍 [2026-10-21] — Player layer, floating toolbar, tabbed popup
* **Split**: the video features moved out of `inject.js` into a new `player.js` (MAIN world, runs right after it). Deep mode copies `inject.js` into every web worker, so the UI no longer goes there. `inject.js` hands over a small core API (`mainVideo`, `mountOnTop`, settings, hooks) through a self-deleting `window.__qlockCore`.
* **Floating toolbar** (replaces the HUD): shadow DOM in a top-layer popover; hover / always / shortcut-only; compact or expanded (timeline); glass / dark / light themes; tooltips with shortcut keys; drag to move (stored as fractions of the player box, per site); auto-hide when idle; button order and visibility set in the popup.
* **Display engine rewrite**: modes Original / Fit / Fill / Stretch / Aspect(R), recomputed live from the real player box (handles YouTube's picture-sized `<video>`), plus zoom, symmetric stretch, 90° rotation (scaled to fit) and mirror. **Baked-in bar detection** samples the frame in Fill mode (symmetric dark rows/columns, three agreeing samples, needs bright content inside).
* **Black-bar backdrop**: ambient light (whole frame stretched over the area, temporal smoothing, heavy blur) and blur fill (cover-scaled blurred copy), on a canvas inserted just before the video and clipped to the player box. It's skipped when there are no bars, and explains itself on DRM video.
* **Picture filters**: brightness / contrast / saturation / grayscale in CSS; gamma, warmth and sharpness in one generated SVG filter; presets, hold-to-compare; snapshots keep the CSS part.
* **Playback**: speed with remember-across-videos (re-applied when a player resets it on load, adopted when changed in the site's menu); timeline with buffered ranges and hover previews (second `<video>` for direct files, remembered frames for MSE streams); A-B loop; snapshot; Netflix and YouTube player-API adapters for seek / play / volume.
* **Viewing**: PiP (removes `disablepictureinpicture`), fullscreen via the site's own button where known, browser-window fill (pinned inline styles, all restored), lights off (one box-shadow, nothing restacked), idle cursor hiding in fullscreen.
* **Mouse**: wheel volume (off / fullscreen / always), right button + wheel volume with the context menu suppressed, back/forward side buttons seek instead of navigating.
* **Commands**: 17 commands (Alt+Z, Alt+X, Alt+. and Alt+, suggested). PiP and fullscreen run through `chrome.scripting.executeScript` from the command or popup click, so the page gets the user gesture those APIs need (`scripting` permission + `<all_urls>` host access).
* **Popup**: rebuilt as six tabs (Now, Display, Picture, Playback, Quality, Settings), light and dark themes, live state from the page, drag-and-drop toolbar button list, full shortcut list.
* **Settings schema**: new `toolbar`, `display`, `picture`, `backdrop`, `playback`, `mouse` sections. `qlockMerge` is now a typed deep merge. The bridge accepts only whitelisted fields from the page (picture, backdrop, speed, layout) and coalesces writes for storage.sync quotas.
* **Fixes on the way**: Stats for nerds no longer uses `innerHTML` (it threw on Trusted Types sites like YouTube); the XHR hook no longer assumes `addEventListener` exists on the request object.
* **Tests**: `tests/player_test.py` drives the toolbar, every display mode, baked-bar detection, ambient/blur, filters, speed, real CDP side-button presses, right-wheel volume, window fill, fullscreen, PiP (popup and toolbar), lights, snapshot, A-B loop, timeline previews, a YouTube-style layout, a Trusted Types + CSP page and all popup tabs. `browser_test.py` and `run.js` updated for the tabbed popup and `player.js`.

---

## 3. Current Implementation Status

| Feature / Subsystem | Status | Details |
| :--- | :---: | :--- |
| **Strict Quality Enforcer** | ✅ Complete | DASH, HLS, Netflix manifest filtering & fallback watchdog |
| **Stats for Nerds HUD** | ✅ Complete | Alt+Shift+N draggable overlay; Trusted Types safe |
| **Floating toolbar** | ✅ Complete | Hover/always/shortcut, compact/expanded, 3 themes, drag, tooltips, custom buttons |
| **Display modes** | ✅ Complete | Original, Fit, Fill, Stretch, aspect presets + custom ratio |
| **Baked-in bar detection** | ✅ Complete | Fill mode, non-DRM video |
| **Zoom / stretch / rotate / mirror** | ✅ Complete | 25–300% zoom, 50–200% stretch, 90° steps |
| **Ambient light / blur fill** | ✅ Complete | Non-DRM video; hidden when no bars |
| **Picture filters** | ✅ Complete | 7 controls, presets, compare, saved globally |
| **Speed** | ✅ Complete | 0.25–4× in the UI, remembered, shortcuts |
| **Timeline + hover previews** | ✅ Complete | Direct files: exact frames; streams: remembered frames |
| **A-B loop / snapshot** | ✅ Complete | Snapshot non-DRM only |
| **PiP / fullscreen / window fill / lights off** | ✅ Complete | Gesture-safe from popup and commands |
| **Mouse controls** | ✅ Complete | Wheel / right+wheel volume, side buttons seek |
| **Per-site memory** | ✅ Complete | Zoom, ratio, rotation (opt-in) |
| **Tabbed popup** | ✅ Complete | 6 tabs, light/dark |

---

## 4. Future Roadmap & Enhancements

- [ ] **Pan while zoomed**: drag with a modifier key to move a zoomed picture (`panX`/`panY`).
- [ ] **Subtitle compensation**: keep absolute-positioned subtitle layers inside the visible area when zoomed.
- [ ] **Volume boost above 100%** (Web Audio). Needs care: routing a cross-origin video without CORS through Web Audio silences it.
- [ ] **Per-site picture profiles** (e.g. warmer on one site only).
- [ ] **Chapter markers** on the timeline where the site exposes them (YouTube).
