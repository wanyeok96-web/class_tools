# -*- coding: utf-8 -*-
"""
Class Tools — 로컬 한글→PDF 변환기
한글(한컴오피스) COM으로 HWP/HWPX를 PDF로 저장합니다.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

HOST = "127.0.0.1"
PORT = 19531
ALLOWED_EXT = {".hwp", ".hwpx"}
MAX_BYTES = 80 * 1024 * 1024  # 80MB

_lock = threading.Lock()
_hwp = None
_hwp_error: str | None = None
_convert_count = 0


def _log(msg: str) -> None:
    print(msg, flush=True)


def _quit_hwp() -> None:
    global _hwp
    if _hwp is None:
        return
    try:
        _close_doc(_hwp)
    except Exception:
        pass
    try:
        _hwp.Quit()
    except Exception:
        pass
    _hwp = None


def _init_hwp():
    global _hwp, _hwp_error
    if _hwp is not None:
        return _hwp
    try:
        import win32com.client  # type: ignore

        try:
            hwp = win32com.client.gencache.EnsureDispatch("HWPFrame.HwpObject")
        except Exception:
            hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        for module_name in ("FilePathCheckerModule", "FilePathCheckerModuleExample"):
            try:
                hwp.RegisterModule("FilePathCheckDLL", module_name)
                break
            except Exception:
                continue
        try:
            hwp.SetMessageBoxMode(0x0000FFFF)
        except Exception:
            pass
        try:
            hwp.XHwpWindows.Item(0).Visible = False
        except Exception:
            pass
        _hwp = hwp
        _hwp_error = None
        _log("[OK] 한글(한컴) COM 연결됨")
        return _hwp
    except Exception as exc:
        _hwp_error = f"한글(한컴오피스)에 연결할 수 없습니다: {exc}"
        _log(f"[ERR] {_hwp_error}")
        return None


def _close_doc(hwp) -> None:
    try:
        hwp.Clear(1)
    except Exception:
        try:
            hwp.HAction.Run("FileClose")
        except Exception:
            pass


def convert_bytes(filename: str, data: bytes) -> bytes:
    global _convert_count
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValueError("hwp, hwpx 파일만 지원합니다.")
    if not data:
        raise ValueError("빈 파일입니다.")
    if len(data) > MAX_BYTES:
        raise ValueError("파일이 너무 큽니다 (최대 80MB).")

    with _lock:
        # 대량 변환 시 한글 인스턴스 주기적 재시작 (상태 오염 방지)
        if _convert_count > 0 and _convert_count % 8 == 0:
            _log("[INFO] 한글 엔진 재시작 (안정화)")
            _quit_hwp()

        hwp = _init_hwp()
        if hwp is None:
            raise RuntimeError(_hwp_error or "한글을 사용할 수 없습니다.")

        tmp_dir = tempfile.mkdtemp(prefix="ct-convert-")
        src_path = os.path.join(tmp_dir, f"source{ext}")
        pdf_path = os.path.join(tmp_dir, "out.pdf")
        try:
            with open(src_path, "wb") as f:
                f.write(data)

            src_abs = os.path.abspath(src_path)
            pdf_abs = os.path.abspath(pdf_path)

            opened = hwp.Open(src_abs)
            if opened is False:
                # 옵션 문자열로 재시도 (암호 프롬프트 억제 등)
                try:
                    opened = hwp.Open(
                        src_abs,
                        "HWP" if ext == ".hwp" else "HWPX",
                        "forceopen:true;suspendpassword:true;versionwarning:false;",
                    )
                except Exception:
                    opened = False
            if opened is False:
                raise RuntimeError("파일을 열 수 없습니다. (암호·손상·미지원 형식 가능)")

            saved = hwp.SaveAs(pdf_abs, "PDF")
            if saved is False:
                raise RuntimeError("PDF 저장에 실패했습니다.")

            if not os.path.isfile(pdf_abs) or os.path.getsize(pdf_abs) <= 0:
                raise RuntimeError("PDF 파일이 생성되지 않았습니다.")

            with open(pdf_abs, "rb") as f:
                out = f.read()
            _convert_count += 1
            return out
        finally:
            _close_doc(hwp)
            for p in (src_path, pdf_path):
                try:
                    if os.path.isfile(p):
                        os.remove(p)
                except OSError:
                    pass
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass

def _cors(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Filename, X-Requested-With",
    )


def _json(handler: BaseHTTPRequestHandler, code: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    _cors(handler)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        _log("%s - %s" % (self.address_string(), fmt % args))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        _cors(self)
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            hwp = _init_hwp()
            _json(
                self,
                200,
                {
                    "ok": True,
                    "hangul": hwp is not None,
                    "error": _hwp_error,
                    "port": PORT,
                },
            )
            return
        _json(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/convert":
            _json(self, 404, {"ok": False, "error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            _json(self, 400, {"ok": False, "error": "요청 본문이 비어 있습니다."})
            return
        if length > MAX_BYTES:
            _json(self, 413, {"ok": False, "error": "파일이 너무 큽니다 (최대 80MB)."})
            return

        raw_name = self.headers.get("X-Filename") or "document.hwp"
        try:
            filename = unquote(raw_name)
        except Exception:
            filename = "document.hwp"
        filename = Path(filename).name or "document.hwp"

        data = self.rfile.read(length)
        try:
            pdf = convert_bytes(filename, data)
            out_name = Path(filename).stem + ".pdf"
            self.send_response(200)
            _cors(self)
            self.send_header("Content-Type", "application/pdf")
            self.send_header(
                "Content-Disposition",
                f"attachment; filename*=UTF-8''{Path(out_name).name}",
            )
            self.send_header("X-Pdf-Filename", Path(out_name).name)
            self.send_header("Content-Length", str(len(pdf)))
            self.end_headers()
            self.wfile.write(pdf)
            _log(f"[OK] {filename} → {out_name} ({len(pdf)} bytes)")
        except Exception as exc:
            _log(f"[ERR] {filename}: {exc}")
            traceback.print_exc()
            _json(self, 500, {"ok": False, "error": str(exc)})


def main() -> int:
    _log("=" * 48)
    _log(" Class Tools 문서변환기 (한글 → PDF)")
    _log(f" http://{HOST}:{PORT}")
    _log(" 이 창을 닫으면 변환이 중단됩니다.")
    _log("=" * 48)
    _init_hwp()
    if _hwp is None:
        _log("※ 한글(한컴오피스)이 설치되어 있는지 확인하세요.")
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        _log(f"포트 {PORT}을(를) 열 수 없습니다: {exc}")
        _log("이미 변환기가 실행 중인지 확인하세요.")
        return 1
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log("\n종료합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
