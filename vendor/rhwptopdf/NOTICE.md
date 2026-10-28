rhwptopdf / rhwp attribution
============================

This project vendors browser binaries from:

- rhwptopdf (MIT) — https://github.com/sanguneo/rhwptopdf
- Upstream HWP/HWPX parser/renderer modules originate from edwardkim/rhwp
  (Apache License 2.0) — https://github.com/edwardkim/rhwp

The WASM binary is stored gzip-compressed in `wasm-bytes.js`
(sha256 cfd6dece104d50e4ecec99ba14e798bef1c9d13e39111f24f36842c222f77dcd).
Restore the original `rhwptopdf.umd_bg.wasm` with
`python build_wasm_bytes.py --extract`.

Font fallbacks:

- Noto Sans KR / Noto Serif KR Regular & Bold (SIL Open Font License 1.1)
  https://github.com/googlefonts/noto-cjk
