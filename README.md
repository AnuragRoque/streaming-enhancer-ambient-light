# QualityLock

> **Streaming quality lock + a floating video toolbar for every site**
> Manifest V3 extension for Chrome, Edge, Brave and other Chromium browsers.

QualityLock does two jobs:

1. **Keeps streams sharp.** Netflix, Prime Video, JioHotstar and other DASH/HLS players drop to 480p/720p when the network dips. QualityLock removes the lower renditions from the stream's manifest before the player reads it, so the player buffers instead of downgrading.
2. **Gives every video the same controls.** A floating toolbar (and a tabbed popup) adds fill/zoom/aspect ratio, ambient light for black bars, picture filters, speed, a timeline with previews, Picture-in-Picture, window fill, lights off and mouse controls to any HTML5 video.

---

## Features

### 🎛️ Floating toolbar (on the video)

* **Auto-hide** (default): shows when the mouse moves over a video and hides once the mouse stops (1–8 s, set in the popup). It also hides when the mouse rests on the toolbar, after a few extra seconds so you can still read tooltips. You can also pick **Always visible**, or **Shortcut only** (<kbd>Alt</kbd>+<kbd>Z</kbd>).
* **Compact** layout (one row of icons) or **Expanded** layout (adds a timeline).
* **Drag** it anywhere by the grip. It remembers its spot per site and stays in place relative to the player.
* **Glass**, **Dark** and **Light** themes. Every button has a tooltip that shows its shortcut.
* **Choose and reorder the buttons** in the popup (Settings → Toolbar buttons).
* **Clickable in fullscreen.** While something is fullscreen, Chrome ignores clicks outside it, so the toolbar moves inside the fullscreen player (and back out after). A bare `<video>` can't hold anything, so QualityLock's own fullscreen fills the window with the video and puts the whole page in fullscreen instead; on Chrome's own video page, double-click does the same. Also works inside embedded iframe players.

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
* **RGB light**: makes the bars glow like an LED strip behind a TV, brightest next to the picture and fading outwards. Effects: **Wave** (a rainbow chasing around the picture), **Cycle** (the whole strip changes colour), **Breathe** and **Static** (your colour, pulsing or steady), with colour presets, a colour picker and a speed slider. It doesn't read the video, so it **works on Netflix, Prime and other DRM sites too**.
* **Image**: your own picture behind the video, so the bars show its edges. Choose it in the popup (Display tab). It's shrunk to 1920 px and kept in the extension's local storage. Softness blurs it. The picture is drawn inside the web page, so that site's scripts can see it. Don't use a private photo.
* Intensity and softness sliders. It draws only while there are bars to fill.

### 🎨 Picture

* Brightness, contrast, saturation, **gamma** (lifts dark scenes), **warmth** (warm night viewing or cooler), **sharpness** and grayscale.
* Presets: Original, Vivid, Cinema, Dark scenes, Night, Mono. **Hold to compare** with the original.
* Saved and applied to every video.

### ⏩ Playback

* **Speed** 0.25×–4× from the toolbar, popup or shortcuts. It's remembered for the next video and follows changes you make in the site's own menu.
* **Timeline** (Expanded layout): buffered ranges, click or drag to seek, **hover previews** and a time readout that toggles between elapsed and remaining. The tooltip says when the video will end at the current speed.
* **A-B loop**, **snapshot** (saves the frame as PNG, with your picture filters), seek back/forward with a configurable step.
* On **Netflix** and **YouTube**, seeking and play/pause go through the site's own player API. Setting `currentTime` directly crashes Netflix's player.
* **Volume goes through the site's own player** so its slider and saved level stay in step. It uses the player API on YouTube, Netflix, JW Player and Video.js, or the volume slider in the player's controls (Plyr, Shaka, Twitch and many custom players). If the site ignores it, QualityLock sets the video's volume directly.

### 🖥️ Viewing

* **Picture-in-Picture**. It also works on players that try to disable it.
* **Fullscreen**. On YouTube, Netflix and Prime it presses the site's own fullscreen button, so its controls stay right.
* **Fill browser window**: the player takes over the tab with the page hidden. <kbd>Esc</kbd> returns.
* **Lights off**: dims everything around the video.
* **Hides the cursor** over the video in fullscreen when the mouse rests.

### 🖱️ Mouse

* **Hold right button + wheel = volume** anywhere over the video, and no context menu pops up afterwards.
* **Wheel alone = volume** is opt-in: off (default), only in fullscreen, or always. When it's off, the wheel scrolls the page as usual.
* **Mouse buttons seek** −/+ the seek step inside the video instead of leaving the page. By default, the back/forward side buttons do this. To change which buttons, click *Seek back* or *Seek forward* in the popup and press any mouse button (a side button, the wheel click or an extra button). Choose *over the video* (default) or *anywhere on the page*.
* Scrolling up on a muted video unmutes it at its previous level.

### 📂 Videos from your computer

A movie dragged into the browser plays from `file://`, where Chrome doesn't let extensions read its frames, and Chrome's own video page has no room around the picture. So Auto black bars, ambient light, blur fill and snapshots can't work there. **The QualityLock player** (`local.html`) is a full player for your own files: they play from your disk (nothing is uploaded) with every QualityLock feature working.

* **Open it** from the popup (**Now → Play a file from your computer**), or from a `file://` tab: **Open in QualityLock player** in the toolbar's Display / Backdrop panel or the popup. It opens next to the tab, pauses the original and asks for that file by name. Chrome never gives extensions the file itself, so you pick it (or its folder) once more.
* **Playlists**: choose several videos, or open / drop a folder (sub-folders such as seasons too), sorted the natural way (E2 before E10). **Next / previous** buttons, a playlist menu, and the next video starts when one ends.
* **Its own controls**: big centre play / pause with ±10 s and next / previous, a seek bar with thumbnail previews and live scrubbing, volume up to **200% (boost)**, speed menu, Picture-in-Picture and fullscreen. They show when the mouse moves and stay while you're on them or paused; a few seconds after the mouse stops they hide along with the cursor. Click the picture to play / pause, double-click for fullscreen; everything stays clickable in fullscreen.
* **Settings menu**: picture size (Fit, Fill, Stretch, 16:9, 21:9, 4:3), black bars (ambient, blur, RGB light), and QualityLock's zoom, picture and backdrop panels. The QualityLock button top right brings up the full toolbar.
* **Audio tracks in MKV files** (CC button, <kbd>A</kbd>): every audio track is listed with its language, name, format and channels, e.g. *Hindi BD 5.1 · Dolby Digital 5.1* or *English · AAC 7.1*. Picking one switches to it at the same moment, playing or paused, and each movie remembers its choice. Chrome on its own only ever plays the first audio track it can decode. To switch, the player reloads the file with the other tracks' codec names changed by one letter, so Chrome skips them. This happens in memory, without copying the file. Without a saved choice, the track the file marks as default plays, as in other players.
  * **Dolby Digital (AC-3) and Dolby Digital Plus (E-AC-3)**, which Chrome can't decode, are decoded by the player. It uses FFmpeg's decoder compiled to WebAssembly (`vendor/ac3`), in a worker. The track is read from the file a few seconds ahead and played through Web Audio in step with the picture: lined up again on play, seek, stalls and speed changes, or if they drift 60 ms apart. 5.1 and 7.1 are mixed down to your speakers. The volume, boost and mute apply as usual. If the decoder fails, the player says so and plays a track Chrome can play. DTS and TrueHD are still dimmed, with the reason.
* **Subtitles** (CC button, <kbd>C</kbd>):
  * **Inside MKV files**: text subtitle tracks (SRT, ASS/SSA, WebVTT) are listed with their language and name. The file's forced or default track comes on by itself. They are read through the file's index in a moment. A file without an index is read through, with lines showing as it goes, at roughly a minute for a 20 GB file on an SSD. Blu-ray picture subtitles (PGS) are drawn as on the disc. The disc's 16:9 frame is laid over the picture, so in a movie cropped to 2.40:1 they sit in the black bar below it. They move above the control bar while it shows, and Size scales them. DVD picture subtitles (VobSub) are listed but can't be shown.
  * `.srt`, `.vtt`, `.ass` and `.ssa`. Files next to a video with the same name (`Movie.srt`, `Movie.en.srt`, or in a `Subs` folder) load by themselves; others load from the CC menu or by dropping them on the player. Old files in other encodings (Cyrillic, Arabic, Greek…) can be switched to the right one when the text looks wrong.
  * **Online search** with OpenSubtitles.org's own search: no account and no API key. If that site can't be reached, Stremio's OpenSubtitles addon stands in. It searches by the file's hash (*exact match* for that very file) and by the title, year, season and episode from the file name; other titles with the same name are a pick away. The best are listed first:
    * the exact match, then the *same release*, then the closest name, the most downloads and trusted uploaders;
    * cinema recordings and machine translations go last;
    * multi-CD sets and picture formats are left out.

    One click downloads the subtitles and turns them on, in the right encoding. The ad lines OpenSubtitles puts in its files are removed. Only the title, and the file's hash and size, are sent.
  * **Timing**: <kbd>G</kbd> / <kbd>H</kbd> show them 0.1 s earlier / later. Or **sync by line**: a list of every line with its time, like song lyrics, following the video. Click the line you hear being said and all of them move to match; type a few words to find a line, ▶ jumps to it.
  * Size S–XL, outline or dark box. Each movie remembers its subtitles (downloads too) and each subtitle file its timing. <kbd>V</kbd> cycles the loaded tracks.
* **Resumes** each movie where you left it, with *Start over*. Warns when a movie plays without sound because its audio can't be decoded (DTS, or AC-3 in a file that isn't MKV).
* Keys: <kbd>Space</kbd>/<kbd>K</kbd> play, <kbd>←</kbd><kbd>→</kbd> (<kbd>J</kbd>/<kbd>L</kbd>) seek, <kbd>↑</kbd><kbd>↓</kbd> volume, <kbd>M</kbd> mute, <kbd>F</kbd> fullscreen, <kbd>N</kbd>/<kbd>P</kbd> next / previous, <kbd>C</kbd> subtitles, <kbd>A</kbd> audio track, <kbd>G</kbd>/<kbd>H</kbd> subtitle timing, <kbd>&lt;</kbd>/<kbd>&gt;</kbd> speed, <kbd>0</kbd>–<kbd>9</kbd> jump, <kbd>O</kbd> open. Media keys and all the extension shortcuts work too.

### 🔒 Quality lock (the original feature)

* Intercepts DASH (`.mpd`), HLS (`.m3u8`) and Netflix JSON manifests (fetch, XHR, `JSON.parse`, `Response.json`; optional *Deep mode* for players that fetch in a Web Worker).
* Per site: **Best only**, **Never below 1080p**, **Never below 720p** or **Off**.
* **Automatic fallback**: if the strict lock stops a title from playing, it reloads with a looser lock (levels 1–3). *Reset fallback* in the popup clears it.

### 📊 Stats for nerds (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>)

Live throughput, data used (and per hour), FPS and dropped frames, buffer ahead, resolution and viewport, protocol, and what the lock kept.

---

## What it can't do

* **Ambient light, blur fill, snapshots, timeline previews and baked-bar detection need to read video frames.** Browsers never let extensions read DRM-protected video (Netflix, Prime Video, Disney+, most paid streams). On those sites, these features show a short notice instead. RGB light, the Image backdrop, fill/zoom/aspect, picture filters, speed, PiP, mouse and everything else still work. YouTube and most free sites are not DRM-protected.
* The same goes for **videos opened from your computer in their own tab** (`file://`): Chrome blocks reading their frames. Use the QualityLock player instead (see *Videos from your computer*). Shortcuts for PiP and fullscreen may be refused there, because Chrome doesn't let extensions inject into their own pages to pass on the key press; use <kbd>F</kbd> or the toolbar.
* When a site's own button puts the **bare `<video>`** in fullscreen, nothing can sit over it: the backdrop is hidden and the toolbar can't be clicked. Use the toolbar's fullscreen button instead.
* The quality lock only works within what the service already sends. It never adds a rendition and doesn't touch DRM. If a site's own quality setting is low (Prime's Good/Better/Best, Hotstar Data Saver, Netflix playback settings), the higher renditions are never sent.
* Some mouse software (Logitech Options, etc.) sends side buttons as keystrokes. Then the browser handles them before the page sees them.
* In the QualityLock player, **DTS and TrueHD audio** can't be played, and neither can **Dolby Digital in an MP4**: the player decodes Dolby audio only in MKV files. Decoded Dolby audio changes pitch at speeds other than 1× (Chrome keeps the pitch for audio it plays itself). Audio and subtitle tracks are read from **MKV** files only, not from MP4. DVD picture subtitles (VobSub) aren't shown.

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
| Right button + wheel                                      | Volume                                                                                                                                   |
| Wheel over video                                          | Volume, if turned on (off by default)                                                                                                    |
| Mouse back / forward (or the buttons you pick)            | Seek −/+ seek step                                                                                                                      |

---

## The popup

Six tabs, so nothing is buried:

| Tab                | What's there                                                                                                                                                                   |
| :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now**      | **On this site** switch (turns QualityLock completely off for the tab's site), what's playing (resolution, throughput, buffer, FPS, what the lock kept) and quick actions: toolbar, hide bars, backdrop, PiP, window, fullscreen, lights off, snapshot, stats |
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

**If it breaks a site:** popup → Now → switch off **On this site**, then reload the tab. Nothing of QualityLock is installed on that site's pages after that (no network hooks, no toolbar).

---

## Publishing

```bash
python scripts/package.py     # -> dist/qualitylock-<version>.zip, the Chrome Web Store upload
```

The packager puts in only what `manifest.json`, `popup.html` and the extension's own pages (`EXTRA_PAGES`: `local.html`) reference (plus `_locales/` if present), so docs, tests, `web/` and tooling never ship. It refuses to build if the name, short name or description is over the store's limits, or if the `VERSION` constants in `inject.js` / `player.js` don't match the manifest. Before each release, bump all three.

- `store/LISTING.md`: the store listing text, single-purpose statement, permission justifications, privacy answers and reviewer test steps, ready to paste into the dashboard.
- `web/`: the product page and the privacy policy (static HTML, no scripts or external requests). `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main` that touches `web/`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

**Privacy.** Nothing is collected or sent anywhere. The page script needs a few settings before `chrome.storage` can answer, so `bridge.js` caches only those in each site's localStorage: on/off, Deep mode and the quality-lock choices, or just "off here". The full settings reach the page by message. The list of turned-off sites is never given to pages.

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
├── local.html/css/js  QualityLock player for files from your computer: its own controls, playlists from
│                      files / folders, volume boost, resume; files play from blob: URLs. Loads defaults,
│                      bridge, inject and player.js like a site gets them (player.js keeps its toolbar out of the way there)
├── local-mkv.js       The player's MKV reader: track list, audio track switching, subtitle blocks and audio frames from inside the file
├── local-subs.js      The player's subtitles: SRT / VTT / ASS parsing and drawing, delay, sync list, online search
├── local-pgs.js       Blu-ray picture subtitles (PGS): display sets to timed screens, run-length pictures to canvases
├── local-decode.js    Dolby audio the player decodes itself: reads ahead, decodes in a worker, plays in step with the video
├── local-ac3-worker.js  The worker: FFmpeg's AC-3 / E-AC-3 decoder (vendor/ac3, WebAssembly; MPL-2.0 and LGPL-2.1, licences there)
├── icons/
├── scripts/package.py  Builds the store zip (not shipped)
├── store/LISTING.md    Store dashboard copy (not shipped)
├── web/                Product page + privacy policy for GitHub Pages (not shipped)
└── README.md / PLAN.md (not shipped)
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
