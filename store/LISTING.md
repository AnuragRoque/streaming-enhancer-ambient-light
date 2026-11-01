# Chrome Web Store submission

Copy for each field in the developer dashboard. Keep it in step with the
extension when features or permissions change.

## Build and upload

1. Bump `version` in `manifest.json` and the `VERSION` constants in `inject.js` and `player.js` (the packager refuses a mismatch).
2. `python scripts/package.py` → upload `dist/qualitylock-<version>.zip`.

## Store listing tab

**Title** (from the manifest): QualityLock – Streaming Enhancer, Ambient & RGB Light

**Summary** (from the manifest, max 132): Keeps streams at top quality and upgrades any video: ambient & RGB light for black bars, zoom/fill, picture filters, speed and PiP.

**Category:** Entertainment (or the closest video/entertainment category offered)

**Description:**

```
QualityLock makes streaming video look its best, on any site.

KEEP STREAMS SHARP
When your connection dips, streaming players drop to 480p or 720p. QualityLock removes the low-quality options before the player reads them, so it waits a moment instead of going blurry. It works on Netflix, Prime Video, JioHotstar and sites that stream in DASH or HLS. It never unlocks a resolution your plan or browser doesn't get.

LIGHT UP THE BLACK BARS
• Ambient light: the bars glow with the colours at the picture's edges.
• Blur fill: the bars show a soft, blurred copy of the scene.
• RGB light: a virtual LED strip around the picture, with Wave, Cycle, Breathe and Static effects, your colours and your speed. Works on protected streams too.
• Image: your own picture behind the video.

A TOOLBAR FOR EVERY VIDEO
• Fill, stretch, zoom 25–300%, aspect presets from 4:3 to 32:9, custom ratios, rotate and mirror.
• Picture tuning: brightness, contrast, saturation, gamma, warmth, sharpness, with presets.
• Speed 0.25×–4× that sticks between videos, a timeline with hover previews, A-B loop, snapshots.
• Right-click + scroll for volume; any mouse button can skip back or forward.
• Picture-in-Picture, fill the browser window, lights off, stats for nerds.
• Keyboard shortcuts for everything.

PRIVATE BY DESIGN
No account, no analytics, no ads, and no data sent anywhere. Settings stay in your browser.

Something not working on a site? Switch off "On this site" in the popup and reload.

Notes: ambient light, blur fill and snapshots need to read the video's frames, which browsers don't allow on DRM-protected video (Netflix, Prime Video and most paid services). Everything else works there.

QualityLock is an independent project, not affiliated with or endorsed by Netflix, Amazon, JioHotstar, YouTube or Google.
```

**Graphics still to make:** at least one screenshot at 1280×800 (up to 5), and a small promo tile at 440×280. The 128×128 icon is `icons/icon128.png`.

**Homepage URL:** https://anuragroque.github.io/streaming-enhancer-ambient-light/
**Support URL:** https://github.com/AnuragRoque/streaming-enhancer-ambient-light/issues

## Privacy practices tab

**Single purpose:**

```
Improves video playback in the browser: it keeps streams at their best quality and adds display, lighting, picture, speed and mouse controls to the video on the page.
```

**Permission justifications:**

- **storage**
  ```
  Saves the user's settings (toolbar, display, picture, backdrop, mouse and quality choices, and sites where the user turned the extension off) and the optional backdrop picture the user chooses.
  ```
- **scripting**
  ```
  Picture-in-Picture and fullscreen require a user gesture in the page. When the user clicks those buttons in the popup, chrome.scripting.executeScript passes the action to the page during that click. No other code is injected this way.
  ```
- **Host permission (`<all_urls>`)**
  ```
  The extension works on the video of whatever page the user is watching, which can be any site, so its content scripts run on all sites. The quality lock must start at document_start, before the site's player requests its manifest, so it can't wait for a click (activeTab would be too late). It only inspects network responses to recognise DASH/HLS/Netflix manifests and only changes the video and its player. Nothing is stored or transmitted. Users can turn it off per site from the popup.
  ```

**Remote code:** No, I am not using remote code. (All code ships in the package. The optional Deep mode starts the site's own Web Workers with the extension's bundled `inject.js` code in front of them, so the quality lock also applies inside workers. It's off by default and loads nothing from outside the package.)

**Data usage:** check none of the data types. Nothing is collected or transmitted. Video frames and network responses are processed only in the page and never leave the device.

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://anuragroque.github.io/streaming-enhancer-ambient-light/privacy.html
(Live once GitHub Pages is on: repo Settings → Pages → Source: GitHub Actions, then push `web/` to `main`.)

## Test instructions (for the reviewer)

```
No account is needed for most features.
1. Open any YouTube video and move the mouse over it: the floating toolbar appears (Alt+Z toggles it).
2. Toolbar → backdrop button (sun icon): try Ambient, Blur, RGB and Image. Black bars are easiest to see on a widescreen trailer.
3. Popup → Display / Picture / Playback tabs change the video live.
4. Popup → Now → "On this site" switches the extension off for that site (takes full effect after a reload).
The quality lock acts on Netflix, Prime Video and JioHotstar, which need a subscription. It removes the lower renditions from the player's manifest, and Stats for nerds (Alt+Shift+N) shows what was kept.
```
