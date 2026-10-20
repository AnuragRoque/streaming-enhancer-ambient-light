# QualityLock

> **Smart Streaming Quality Enforcer & Fullscreen Video Controller**  
> Manifest V3 Browser Extension for Chrome, Brave, and Edge.

QualityLock prevents adaptive video players (Netflix, Prime Video, JioHotstar, YouTube, HTML5/DASH/HLS) from stealthily downgrading video quality when network bandwidth fluctuates. It also features a **full-featured Video Controller** with fullscreen zoom, symmetric aspect-ratio stretching, one-click black-bar elimination, a draggable on-screen HUD, and customizable keyboard shortcuts.

---

## Features

### 1. 🔍 Video Controller & Aspect Ratio Engine
* **Smart "Fix Ratio" (Auto-Crop / Fill)**:
  * Detects letterbox black bars (top & bottom, e.g. 21:9 Cinemascope on a 16:9 monitor) and pillarbox black bars (left & right, e.g. 4:3 on a 16:9 display, or 16:9 on an Ultrawide monitor).
  * Automatically calculates the exact zoom factor required to completely eliminate black bars without distortion.
* **Symmetrical Horizontal Stretch (Left + Right Same Time)**:
  * Uses centered origin (`50% 50%`) to expand or compress width symmetrically from the center.
* **Symmetrical Vertical Stretch (Top + Bottom Same Time)**:
  * Uses centered origin (`50% 50%`) to expand or compress height symmetrically from the center.
* **Stretch to Fill (No Crop)**:
  * Stretches content to the full display boundary without cropping any video content.
* **Presets**: `16:9 Widescreen`, `21:9 Cinemascope`, `Stretch Fill`, and `↺ Reset (100%)`.
* **Granular Zoom**: Stepless zoom from **50% up to 300%**.

### 2. 🖥️ Fullscreen Floating HUD & OSD Toast
* **Draggable On-Screen Controller**:
  * Pinned inside `document.fullscreenElement` so it remains accessible and interactive during fullscreen playback.
  * Drag anywhere on screen by the header, or minimize into a compact pill badge.
  * Direct range sliders, +/- stepper buttons, and quick percentage chips.
* **OSD Notification Badge**:
  * Floating glassmorphism badge at the top-center providing instant visual feedback whenever zoom, stretch, or ratio modes change via keyboard shortcuts.

### 3. ⌨️ Customizable Keyboard Shortcuts
* **Shortcut 1 (Default: `Alt+Z`)**: Toggle on-screen Video Controller HUD in fullscreen or windowed mode.
* **Shortcut 2 (Default: `Alt+X`)**: Quick cycle aspect ratio / zoom presets:
  `Original (100%)` ➔ `✨ Fix Ratio (Eliminate Black Bars)` ➔ `↔ Stretch Fill` ➔ `16:9` ➔ `21:9` ➔ `Zoom 125%` ➔ `Zoom 150%`.
* **Rebind at `chrome://extensions/shortcuts`**: both are Chrome extension commands, so they work in fullscreen and inside embedded (iframe) players. The popup's **Change…** button opens that page, which also offers unbound *Zoom in*, *Zoom out* and *Reset video* commands.
* **Incremental Nudge Hotkeys**:
  * <kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd>: Stretch / compress Top + Bottom (+5% / -5%)
  * <kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd>: Stretch / compress Left + Right (+5% / -5%)
  * <kbd>Shift</kbd> + <kbd>+</kbd> / <kbd>-</kbd>: Zoom in / out (+5% / -5%)
  * <kbd>Shift</kbd> + <kbd>0</kbd>: Reset all transforms

### 4. 🔒 Strict Adaptive Bitrate (ABR) Lock
* Intercepts DASH (`.mpd`), HLS (`.m3u8`), and Netflix JSON manifests before the player reads them.
* Drops lower bitrates from the playlist so the player buffers instead of dropping to blurry 480p/720p.
* Modes per site: `Best only`, `Never below 1080p`, `Never below 720p`, or `Off`.

### 5. 📊 Stats for Nerds Telemetry HUD (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>)
* Draggable telemetry HUD showing:
  * Real-time network throughput (Mbps) & data downloaded / uploaded.
  * Estimated data usage per hour.
  * Rendered FPS and dropped frame count & percentage.
  * Buffer ahead in seconds with visual progress meter.
  * Stream protocol, resolution, and viewport dimensions.

---

## Keyboard Shortcuts Summary

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Alt+Z`** *(chrome://extensions/shortcuts)* | **Toggle Video Controller HUD** | Opens / minimizes the draggable controller bar over the video |
| **`Alt+X`** *(chrome://extensions/shortcuts)* | **Quick Fix Ratio / Zoom Cycle** | Cycles Fix Ratio (fills black bars), Stretch, and Zoom presets |
| **`Shift+Up / Down`** | **Nudge Stretch Y (Top + Bottom)** | Expands / compresses height symmetrically by 5% |
| **`Shift+Left / Right`**| **Nudge Stretch X (Left + Right)** | Expands / compresses width symmetrically by 5% |
| **`Shift++ / -`** | **Nudge Zoom** | Zooms in or out uniformly by 5% |
| **`Shift+0`** | **Reset Transform** | Resets zoom and stretch back to default 100% |
| **`Alt+Shift+N`** | **Toggle Stats for Nerds HUD** | Shows live bitrate, buffer, FPS, and data consumption |
| **`Alt+Shift+Q`** | **Toggle Compact Badge** | Shows small resolution badge overlay |

---

## File Architecture

```
extension/
├── manifest.json       # MV3 manifest: content scripts, keyboard commands, storage permission
├── background.js       # Service worker: runs keyboard commands, routes them to the frame holding the video
├── defaults.js         # Shared defaults and storage sync merger
├── bridge.js           # Isolated-world content script (relays messages between popup & page)
├── inject.js           # MAIN-world script: Manifest hooks, Video Controller engine, HUD, & Telemetry
├── popup.html          # Extension popup UI (Video Controller card, Site locks, & Settings)
├── popup.css           # Modern glassmorphism UI styles for popup
├── popup.js            # Live telemetry polling, video transform controls, & shortcut display
├── README.md           # Documentation and feature guide
├── PLAN.md             # Architecture, timeline of changes, and future roadmap
└── icons/              # Extension icons (16px, 48px, 128px)
```

---

## How to Install & Use

1. Clone or download this repository.
2. Open Google Chrome, Brave, or any Chromium browser and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `extension` folder.
5. Open any video streaming website (Netflix, YouTube, Prime Video, Hotstar, or any HTML5 video):
   * Press **`Alt+Z`** to toggle the on-screen controller bar.
   * Press **`Alt+X`** to instantly eliminate letterbox black bars.
   * Open the extension popup to fine-tune zoom and stretch; rebind shortcuts at `chrome://extensions/shortcuts`.
