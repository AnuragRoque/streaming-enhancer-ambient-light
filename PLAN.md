# QualityLock — Development Plan & Execution Log

This document outlines the architecture, completed implementations with timestamps, current operational state, and future roadmap for the **QualityLock** browser extension.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   BROWSER EXTENSION                    │
├────────────────────────────┬───────────────────────────┤
│        ISOLATED WORLD      │         MAIN WORLD        │
│      (Chrome Extensions)   │        (Page Context)     │
├────────────────────────────┼───────────────────────────┤
│  • defaults.js             │  • inject.js              │
│    - Default config        │    - DASH/HLS/JSON hooks  │
│    - Storage merge helpers │    - Video Controller HUD │
│                            │    - Aspect Ratio Engine  │
│  • bridge.js               │    - Stats for Nerds HUD  │
│    - chrome.storage sync   │    - Direct CSS transform │
│    - postMessage relay     │    - OSD Toast system     │
│                            │    - Global hotkey engine │
└─────────────▲──────────────┴─────────────▲─────────────┘
              │ postMessage                │
              ▼                            │
┌────────────────────────────┐             │
│        POPUP / UI          │             │
│  • popup.html / popup.css  │             │
│  • popup.js                │─────────────┘
│    - Status polling (1 Hz) │ Runtime messages
│    - Live Transform sliders│
│    - Shortcut display      │
└────────────────────────────┘
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

## 3. Current Implementation Status

| Feature / Subsystem | Status | Details |
| :--- | :---: | :--- |
| **Strict Quality Enforcer** | ✅ Complete | DASH, HLS, Netflix manifest filtering & fallback watchdog |
| **Stats for Nerds HUD** | ✅ Complete | Alt+Shift+N draggable overlay with throughput, FPS, buffer |
| **Video Controller: Zoom** | ✅ Complete | Stepless 50% to 300% zoom with live readout |
| **Video Controller: Stretch Y** | ✅ Complete | Top + Bottom simultaneous stretch (50% to 200%) |
| **Video Controller: Stretch X** | ✅ Complete | Left + Right simultaneous stretch (50% to 200%) |
| **Smart Fix Ratio (Auto Fill)** | ✅ Complete | Automatically removes black bars without distortion |
| **Stretch to Fill (No Crop)** | ✅ Complete | Stretches to frame edges without cutting content |
| **Aspect Ratio Presets** | ✅ Complete | 16:9, 21:9 Cinemascope, Stretch Fill, and Reset |
| **Fullscreen Controller HUD** | ✅ Complete | Top-layer popover above any fullscreen element, draggable & minimizable |
| **OSD Toast Feedback** | ✅ Complete | Top-center notification on shortcut triggers |
| **Shortcut 1 (Toggle HUD)** | ✅ Complete | Default `Alt+Z`, Chrome command (chrome://extensions/shortcuts) |
| **Shortcut 2 (Quick Fix Ratio)** | ✅ Complete | Default `Alt+X`, Chrome command, cycles modes with OSD feedback |
| **Nudge Hotkeys** | ✅ Complete | Shift+Arrows for stretch, Shift++/- for zoom, Shift+0 reset |

---

## 4. Future Roadmap & Enhancements

- [ ] **Pan & Drag While Zoomed**: Add optional mouse pan (`panX`, `panY`) while holding a modifier key (e.g. `Ctrl` + mouse drag) when zoomed > 100%.
- [ ] **Subtitle Position Compensation**: On players using absolute-positioned subtitles outside the `<video>` tag, detect and offset subtitle containers so they remain within the visible frame when zoomed in.
- [ ] **Per-Site Aspect Ratio Memory**: Allow users to remember a custom stretch/zoom preference for specific domains (e.g. always 21:9 fill on Netflix).
- [ ] **Custom Crop Presets**: Add custom user-defined aspect ratios (e.g. 18:9, 2:1 Univisium, 1.85:1 Academy Flat).
