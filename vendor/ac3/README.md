# AC-3 / E-AC-3 decoder

`ac3.js` is FFmpeg's Dolby Digital (AC-3) and Dolby Digital Plus (E-AC-3) decoder, compiled to WebAssembly.
The WebAssembly is embedded in the file. It comes unchanged from the npm package
[@mediabunny/ac3](https://www.npmjs.com/package/@mediabunny/ac3) 1.65.0, file `dist/modules/build/ac3.js`.

Only the module wrapper was changed, so the file loads with `importScripts` in a worker:

- the CommonJS `exports` lines were removed;
- `import.meta.url` became `self.location.href`;
- the factory is set on `self.qlockAc3Module`.

`local-ac3-worker.js` loads it, and `local-decode.js` uses that worker.

## Licences

- The wrapper and the build are under the Mozilla Public License 2.0: see `LICENSE`.
  Source: https://github.com/Vanilagy/mediabunny/tree/main/packages/ac3
- FFmpeg (the decoder itself) is under the GNU LGPL 2.1 or later: see `ffmpeg/`.
  Source: https://ffmpeg.org/download.html, built as described in the package's source above.
