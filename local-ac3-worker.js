// QualityLock player: the Dolby Digital (AC-3) and Dolby Digital Plus (E-AC-3)
// decoder for local-decode.js. FFmpeg's decoder, compiled to WebAssembly
// (vendor/ac3/ac3.js), one frame at a time.
//
// { op: 'open', codec: 0 AC-3 | 1 E-AC-3 } · { op: 'reset' } (after a seek)
// { op: 'decode', frames: [ArrayBuffer] } → { out: [{ ch, rate, n, pcm: Float32Array, channel after channel } | null] }
'use strict';
importScripts('vendor/ac3/ac3.js');

var lib = null, dec = 0, loading = null;
var FLTP = 8; // FFmpeg's planar float, which its AC-3 decoders give

function decode(buf) {
  var b = new Uint8Array(buf), at = lib._configure_decode_packet(dec, b.length);
  if (!at) return null;
  lib.HEAPU8.set(b, at);
  if (lib._decode_packet(dec, BigInt(0)) < 0) return null;
  var ch = lib._get_decoded_channels(dec), n = lib._get_decoded_sample_count(dec);
  if (lib._get_decoded_format(dec) !== FLTP || !ch || !n) return null;
  var pcm = new Float32Array(ch * n);
  for (var c = 0; c < ch; c++) pcm.set(new Float32Array(lib.HEAPU8.buffer, lib._get_decoded_plane_ptr(dec, c), n), c * n);
  return { ch: ch, rate: lib._get_decoded_sample_rate(dec), n: n, pcm: pcm };
}

self.onmessage = function (e) {
  var m = e.data;
  Promise.resolve().then(function () {
    if (m.op === 'open') {
      loading = loading || self.qlockAc3Module();
      return loading.then(function (l) {
        lib = l;
        if (dec) lib._close_decoder(dec);
        dec = lib._init_decoder(m.codec);
        if (!dec) throw new Error('The Dolby decoder didn’t start.');
        return {};
      });
    }
    if (!dec) throw new Error('The Dolby decoder isn’t open.');
    if (m.op === 'reset') { lib._flush_decoder(dec); return {}; }
    return { out: m.frames.map(decode) };
  }).then(function (r) {
    r.id = m.id;
    self.postMessage(r, (r.out || []).filter(Boolean).map(function (o) { return o.pcm.buffer; }));
  }, function (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  });
};
