"""rhwptopdf WASM을 gzip + base64로 묶어 wasm-bytes.js를 만든다.

파일로 직접 연 페이지(file://)에서는 fetch로 .wasm을 읽을 수 없어 스크립트에 넣어 둔다.
브라우저가 DecompressionStream으로 압축을 풀어 사용한다 (document-convert.js).

  python build_wasm_bytes.py [원본.wasm]      # wasm-bytes.js 생성
  python build_wasm_bytes.py --extract [출력.wasm]  # wasm-bytes.js에서 원본 .wasm 복원
"""
import base64
import gzip
import hashlib
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
out_path = root / "wasm-bytes.js"
LINE = 1000


def build(wasm_path: Path) -> None:
    wasm = wasm_path.read_bytes()
    if wasm[:4] != b"\0asm":
        sys.exit(f"WASM 파일이 아닙니다: {wasm_path}")
    packed = base64.b64encode(gzip.compress(wasm, 9, mtime=0)).decode("ascii")
    chunks = [packed[i : i + LINE] for i in range(0, len(packed), LINE)]
    lines = [
        "/* rhwptopdf WASM (gzip + base64) — build_wasm_bytes.py로 생성. 직접 수정하지 마세요. */",
        "(function () {",
        "  'use strict';",
        "  window.__RHWPTOPDF_WASM_GZ__ = {",
        f"    size: {len(wasm)},",
        f"    sha256: '{hashlib.sha256(wasm).hexdigest()}',",
        "    data: [",
        *[f"      '{c}'," for c in chunks],
        "    ].join(''),",
        "  };",
        "})();",
        "",
    ]
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out_path.name}: {out_path.stat().st_size:,} bytes (wasm {len(wasm):,})")


def extract(dest: Path) -> None:
    text = out_path.read_text(encoding="utf-8")
    data = "".join(re.findall(r"^\s+'([A-Za-z0-9+/=]+)',$", text, re.M))
    wasm = gzip.decompress(base64.b64decode(data))
    expected = re.search(r"sha256: '([0-9a-f]{64})'", text).group(1)
    if hashlib.sha256(wasm).hexdigest() != expected:
        sys.exit("sha256이 일치하지 않습니다.")
    dest.write_bytes(wasm)
    print(f"wrote {dest}: {len(wasm):,} bytes (sha256 ok)")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--extract"]:
        extract(Path(args[1]) if len(args) > 1 else root / "rhwptopdf.umd_bg.wasm")
    else:
        build(Path(args[0]) if args else root / "rhwptopdf.umd_bg.wasm")
