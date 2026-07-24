/**
 * Class Tools — HWP/HWPX → PDF 변환 워커
 * 메인과 분리된 WASM 인스턴스에서 1파일씩 변환합니다.
 */
/* global RhwpToPdf */
'use strict';

importScripts('vendor/rhwptopdf/rhwptopdf.umd.js');

let fonts = [];
let ready = false;

function post(msg, transfer) {
  if (transfer && transfer.length) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

function isPdfBytes(bytes) {
  return (
    bytes &&
    bytes.length > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

async function init(data) {
  if (typeof RhwpToPdf !== 'function') {
    throw new Error('rhwptopdf UMD가 워커에 로드되지 않았습니다.');
  }
  const wasmBytes = new Uint8Array(data.wasmBytes);
  await RhwpToPdf({ module_or_path: wasmBytes });

  fonts = (data.fonts || []).map((buf) => new Uint8Array(buf));
  if (!fonts.length) {
    throw new Error('변환용 폰트가 없습니다.');
  }
  registerFonts();
  ready = true;
}

function registerFonts() {
  if (typeof RhwpToPdf.clearPdfFonts === 'function') {
    RhwpToPdf.clearPdfFonts();
  }
  for (const font of fonts) {
    RhwpToPdf.registerPdfFont(font);
  }
}

function convertOne(sourceBytes) {
  if (!ready) throw new Error('워커 엔진이 준비되지 않았습니다.');

  // 매 변환마다 폰트 레지스트리 초기화 (누적/오염 방지)
  registerFonts();

  const input = new Uint8Array(sourceBytes);
  if (!input.length) throw new Error('빈 파일입니다.');

  let analysis = null;
  let pageCount = 0;
  try {
    analysis = RhwpToPdf.analyzeHwp(input);
    pageCount = analysis?.pageCount || 0;
    if (pageCount < 1) throw new Error('페이지를 읽을 수 없는 문서입니다.');
  } finally {
    try {
      analysis?.free?.();
    } catch (_) {
      /* ignore */
    }
  }

  const pdfView = RhwpToPdf.hwpToPdf(input);
  const pdfBytes = new Uint8Array(pdfView.byteLength);
  pdfBytes.set(pdfView);

  if (!isPdfBytes(pdfBytes)) {
    throw new Error('PDF 생성 결과가 올바르지 않습니다.');
  }
  if (pdfBytes.length < 64) {
    throw new Error('생성된 PDF가 너무 작습니다.');
  }

  return { pdfBytes, pageCount };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'init') {
      await init(msg);
      post({ type: 'ready', version: RhwpToPdf.version?.() || '' });
      return;
    }

    if (msg.type === 'convert') {
      const result = convertOne(msg.sourceBytes);
      post(
        {
          type: 'done',
          id: msg.id,
          pageCount: result.pageCount,
          pdfBytes: result.pdfBytes.buffer,
        },
        [result.pdfBytes.buffer]
      );
      return;
    }

    post({ type: 'error', id: msg.id, message: '알 수 없는 워커 명령입니다.' });
  } catch (err) {
    post({
      type: 'error',
      id: msg.id,
      message: err?.message || String(err),
    });
  }
};
