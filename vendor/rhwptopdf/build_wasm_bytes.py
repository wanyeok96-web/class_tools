from pathlib import Path
import base64

root = Path(__file__).resolve().parent
wasm_path = root / "rhwptopdf.umd_bg.wasm"
out_path = root / "wasm-bytes.js"

wasm = wasm_path.read_bytes()
b64 = base64.b64encode(wasm).decode("ascii")

lines = [
    "(function () {",
    "  'use strict';",
    "  var chunks = [",
]
for i in range(0, len(b64), 120):
    piece = b64[i : i + 120]
    comma = "," if i + 120 < len(b64) else ""
    lines.append(f"    '{piece}'{comma}")
lines.extend(
    [
        "  ];",
        '  var b64 = chunks.join("");',
        "  var bin = atob(b64);",
        "  var bytes = new Uint8Array(bin.length);",
        "  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);",
        "  window.__RHWPTOPDF_WASM__ = bytes;",
        "})();",
        "",
    ]
)
out_path.write_text("\n".join(lines), encoding="ascii")
print(f"wrote {out_path} size={out_path.stat().st_size} wasm={len(wasm)}")
