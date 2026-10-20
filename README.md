# QualityLock

> **Streaming quality lock + a floating video toolbar for every site**
> Manifest V3 extension for Chrome, Edge, Brave and other Chromium browsers.

QualityLock does two jobs:

1. **Keeps streams sharp.** Netflix, Prime Video, JioHotstar and other DASH/HLS players drop to 480p/720p when the network dips. QualityLock removes the lower renditions from the stream's manifest before the player reads it, so the player buffers instead of downgrading.
2. **Gives every video the same controls.** A floating toolbar (and a tabbed popup) adds fill/zoom/aspect ratio, ambient light for black bars, picture filters, speed, a timeline with previews, Picture-in-Picture, window fill, lights off and mouse controls to any HTML5 video.

---

## Features

### 🎛️ Floating toolbar (on the video)

* Shows when the mouse moves over a video and fades when idle. It can also stay visible, or appear only via <kbd>Alt</kbd>+<kbd>Z</kbd>.
* **Compact** layout (one row of icons) or **Expanded** layout (adds a timeline).
* **Drag** it anywhere by the grip. It remembers its spot per site and stays in place relative to the player.
* **Glass**, **Dark** and **Light** themes. Every button has a tooltip that shows its shortcut.
* **Choose and reorder the buttons** in the popup (Settings → Toolbar buttons).
* Works in fullscreen, including when the bare `<video>` is the fullscreen element, and inside embedded iframe players.

### 🖼️ Display: fit, fill, aspect ratio, zoom, rotate

* **Original · Fit · Fill · Stretch.** *Fill* zooms until the black bars are gone. *Stretch* fills the screen without cropping.
* **Removes black bars inside the picture.** Many videos have the bars encoded into the frame (a 2.39:1 film inside a 16:9 file). In Fill mode, QualityLock detects those bars and zooms past them too.
* **Aspect presets** 4:3, 16:9, 1.85, 21:9, 2.39 and 32:9, plus any custom ratio (`18:9`, `2.2`).
* **Zoom** 25–300%, and **stretch** left + right / top + bottom 50–200%, always from the centre.
* **Rotate** 90° steps (scaled to fit) and **mirror**.
* Recalculated live on resize and on entering or leaving fullscreen. Optionally **remembered per site**.

### 🌈 Black-bar backdrop (no zoom, no crop)

* **Ambient light**: the bars glow with the colours at the picture's edges, so the video blends into them, like YouTube's ambient mode.
* **Blur fill**: the bars show a soft, blurred copy of the picture, like the background behind a vertical clip on Instagram.
* Intensity and softness sliders. It draws only while there are bars to fill.

### 🎨 Picture

* Brightness, contrast, saturation, **gamma** (lifts dark scenes), **warmth** (warm night viewing or cooler), **sharpness** and grayscale.
* Presets: Original, Vivid, Cinema, Dark scenes, Night, Mono. **Hold to compare** with the original.
* Saved and applied to every video.

### ⏩ Playback

* **Speed** 0.25×–4× from the toolbar, popup or shortcuts. It's remembered for the next video and follows changes you make in the site's own menu.
* **Timeline** (Expanded layout): buffered ranges, click or drag to seek, **hover previews** and a time readout that toggles between elapsed and remaining. The tooltip says when the video will end at the current speed.
* **A-B loop**, **snapshot** (saves the frame as PNG, with your picture filters), seek back/forward with a configurable step.
* On **Netflix** and **YouTube**, seeking, play/pause and volume go through the site's own player API. Setting `currentTime` directly crashes Netflix's player.

### 🖥️ Viewing

* **Picture-in-Picture**. It also works on players that try to disable it.
* **Fullscreen**. On YouTube, Netflix and Prime it presses the site's own fullscreen button, so its controls stay right.
* **Fill browser window**: the player takes over the tab with the page hidden. <kbd>Esc</kbd> returns.
* **Lights off**: dims everything around the video.
* **Hides the cursor** over the video in fullscreen when the mouse rests.

### 🖱️ Mouse

* **Wheel = volume** over the video: off, only in fullscreen (default), or always.
* **Hold right button + wheel = volume** anywhere over the video, and no context menu pops up afterwards.
* **Mouse back/forward side buttons seek** −/+ the seek step inside the video instead of leaving the page. Choose *over the video* (default) or *anywhere on the page*.
* Scrolling up on a muted video unmutes it at its previous level.

### 🔒 Quality lock (the original feature)

* Intercepts DASH (`.mpd`), HLS (`.m3u8`) and Netflix JSON manifests (fetch, XHR, `JSON.parse`, `Response.json`; optional *Deep mode* for players that fetch in a Web Worker).
* Per site: **Best only**, **Never below 1080p**, **Never below 720p** or **Off**.
* **Automatic fallback**: if the strict lock stops a title from playing, it reloads with a looser lock (levels 1–3). *Reset fallback* in the popup clears it.

### 📊 Stats for nerds (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>)

Live throughput, data used (and per hour), FPS and dropped frames, buffer ahead, resolution and viewport, protocol, and what the lock kept.

---

## What it can't do

* **Ambient light, blur fill, snapshots, timeline previews and baked-bar detection need to read video frames.** Browsers never let extensions read DRM-protected video (Netflix, Prime Video, Disney+, most paid streams). On those sites, these features show a short notice instead. Fill/zoom/aspect, picture filters, speed, PiP, mouse and everything else still work. YouTube and most free sites are not DRM-protected.
* The backdrop sits behind the video, so it's hidden when the **bare `<video>`** element is fullscreen (the browser's built-in video controls). Use the toolbar's fullscreen button instead.
* The quality lock only works within what the service already sends. It never adds a rendition and doesn't touch DRM. If a site's own quality setting is low (Prime's Good/Better/Best, Hotstar Data Saver, Netflix playback settings), the higher renditions are never sent.
* Some mouse software (Logitech Options, etc.) sends side buttons as keystrokes. Then the browser handles them before the page sees them.

---

## Keyboard & mouse

Chrome lets an extension suggest four keys; the rest can be bound at `chrome://extensions/shortcuts` (Popup → Settings → **Change…**).

| Shortcut                                                  | Action                                                                                                                                   |
| :-------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| <kbd>Alt</kbd>+<kbd>Z</kbd>                               | Show / hide the floating toolbar                                                                                                         |
| <kbd>Alt</kbd>+<kbd>X</kbd>                               | Cycle Fill → Stretch → 16:9 → 21:9 → Zoom 125% → Zoom 150% → Original                                                              |
| <kbd>Alt</kbd>+<kbd>.</kbd> / <kbd>Alt</kbd>+<kbd>,</kbd> | Speed up / slow down (step set in the popup)                                                                                             |
| *bind yourself*                                         | Normal speed, seek back/forward, hide black bars, cycle backdrop, PiP, fullscreen, fill window, lights off, snapshot, zoom in/out, reset |
| <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>              | Stretch top + bottom ±5%                                                                                                                |
| <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd>              | Stretch left + right ±5%                                                                                                                |
| <kbd>Shift</kbd>+<kbd>+</kbd>/<kbd>−</kbd>               | Zoom ±5%                                                                                                                                |
| <kbd>Shift</kbd>+<kbd>0</kbd>                             | Reset zoom, ratio and rotation                                                                                                           |
| <kbd>Esc</kbd>                                            | Leave window fill / lights off                                                                                                           |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>              | Stats for nerds                                                                                                                          |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd>              | Resolution badge                                                                                                                         |
| Wheel over video                                          | Volume (in fullscreen by default)                                                                                                        |
| Right button + wheel                                      | Volume                                                                                                                                   |
| Mouse back / forward                                      | Seek −/+ seek step                                                                                                                      |

---

## The popup

Six tabs, so nothing is buried:

| Tab                | What's there                                                                                                                                                                   |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now**      | What's playing (resolution, throughput, buffer, FPS, what the lock kept) and quick actions: toolbar, hide bars, backdrop, PiP, window, fullscreen, lights off, snapshot, stats |
| **Display**  | Fit/Fill/Stretch, aspect presets and custom ratio, zoom and stretch sliders, rotate and mirror, ambient/blur backdrop, baked-bar removal, remember per site                    |
| **Picture**  | Presets, seven sliders (double-click resets one), hold to compare                                                                                                              |
| **Playback** | Speed, remember speed, speed and seek steps, all mouse options, hide cursor                                                                                                    |
| **Quality**  | Lock per site, stats overlay, resolution badge, Deep mode                                                                                                                      |
| **Settings** | Video controls on/off, notifications, toolbar show mode / layout / theme / auto-hide, button order and visibility, all shortcuts, reset everything                             |

It follows the system light or dark theme.

---

## Install

1. Clone or download this repository and keep the folder somewhere permanent.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin QualityLock from the puzzle-piece menu.
5. **Reload any video tabs that were already open**: content scripts only load into pages opened after install.

Updating: replace the files and press the reload icon on the extension's card. New shortcut suggestions apply only if those keys aren't taken.

---

## File architecture

```
extension/
├── manifest.json   MV3 manifest: content scripts, commands, storage + scripting permissions
├── background.js   Service worker: runs keyboard commands in the frame that holds the video;
│                   PiP / fullscreen go through an injected script so they keep the key press's user gesture
├── defaults.js     Settings schema, deep merge, toolbar button list (shared by bridge + popup)
├── bridge.js       Isolated-world content script: settings → page, popup/commands → page,
│                   whitelisted setting changes from the toolbar → chrome.storage
├── inject.js       Page script (MAIN world): manifest hooks, quality filters, fallback watchdog,
│                   stats for nerds, resolution badge, top-layer mounting; hands a small core API to player.js
├── player.js       Page script (MAIN world): floating toolbar, display engine, backdrop, picture filters,
│                   speed, timeline previews, A-B loop, snapshot, PiP, window fill, lights off, mouse, OSD
├── popup.html/css/js  Tabbed popup
├── README.md / PLAN.md
└── icons/
```

`player.js` is separate from `inject.js` on purpose. Deep mode copies `inject.js` into every web worker, and the UI code has no business there.

**Robustness rules in the page scripts.** All UI is in shadow roots inside top-layer popovers, so it sits above fullscreen and page CSS can't reach it. Nothing uses `innerHTML`, because YouTube enforces Trusted Types. Styles go in through `adoptedStyleSheets`, which survives strict CSP. The video is moved with the `scale`/`rotate`/`translate` properties, because the fullscreen stylesheet forces `transform: none`. Every inline style written to a page element is put back exactly when the feature turns off.

---

## Tests

From the repository's `tests/` folder (next to `extension/`):

```bash
npm install                   # once: jsdom + xmldom
node run.js                   # unit tests: manifest filters, hooks, bridge relay, manifest/file checks
python browser_test.py        # real Chromium: quality lock on fake Hotstar/Netflix pages + popup
python player_test.py         # real Chromium: toolbar, fill/stretch/aspect/rotate, baked-bar detection,
                              # ambient/blur, filters, speed, side buttons, right-wheel volume, window fill,
                              # fullscreen, PiP (popup + toolbar), lights, snapshot, A-B loop, timeline previews,
                              # a YouTube-style layout, a Trusted Types + CSP page, and every popup tab
```

The browser tests need `pip install playwright` and `python -m playwright install chromium`. `player_test.py` also needs `ffmpeg` on PATH the first time, to generate its test clips. Screenshots go to `tests/.shots/`.
