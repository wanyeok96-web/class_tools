/**
 * Class Tools — 문서변환 (한글 HWP/HWPX → PDF)
 * - 선택 직후 원본 바이트 고정
 * - Worker 격리 변환 + N개마다 엔진 재시작 (대량 변환 오염 방지)
 * - ZIP CRC 정식 테이블 / ZIP·PDF 저장 선택
 */
(function () {
  'use strict';

  const ACCEPT_EXT = ['.hwp', '.hwpx'];
  const STORAGE_MODE_KEY = 'ct-convert-download-mode';
  const HANGUL_API = 'http://127.0.0.1:19531';
  /** 이 횟수마다 워커(WASM)를 새로 띄워 상태 오염을 막습니다. */
  const RESTART_EVERY = 1;
  const FONT_CDN = {
    serifRegular:
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Serif/SubsetOTF/KR/NotoSerifKR-Regular.otf',
    serifBold:
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Serif/SubsetOTF/KR/NotoSerifKR-Bold.otf',
    sansRegular:
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf',
    sansBold:
      'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/SubsetOTF/KR/NotoSansKR-Bold.otf',
  };
  /** 문서에 자주 쓰이는 한글 폰트 — 시스템에서 우선 로드 (명조→고딕 순) */
  const SYSTEM_FONT_CANDIDATES = [
    '함초롬바탕',
    'HCR Batang',
    'HCI Batang',
    '바탕',
    'Batang',
    '바탕체',
    '궁서',
    'Gungsuh',
    '나눔명조',
    'NanumMyeongjo',
    '함초롬돋움',
    'HCR Dotum',
    'HCI Dotum',
    '맑은 고딕',
    'Malgun Gothic',
    '돋움',
    'Dotum',
    '돋움체',
    '굴림',
    'Gulim',
    '굴림체',
    '나눔고딕',
    'NanumGothic',
  ];

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /** @type {any[]} */
  let jobs = [];
  let converting = false;
  let bound = false;
  let assetsReady = false;
  let assetsPromise = null;
  /** @type {Uint8Array|null} */
  let wasmMaster = null;
  /** @type {Uint8Array[]} */
  let fontMasters = [];
  let batchSeq = 0;
  /** @type {number|null} */
  let activeBatchId = null;
  /** @type {{ name: string, sourceBytes: Uint8Array|null, error?: string }[]} */
  let queuedPrepared = [];
  /** @type {'zip'|'pdf'} */
  let downloadMode = loadDownloadMode();

  /** @type {Worker|null} */
  let worker = null;
  let workerReady = false;
  let workerJobs = 0;
  /** @type {Map<string, { resolve: Function, reject: Function }>} */
  const pendingWorker = new Map();
  let useWorker = true;
  /** 한글(한컴) 로컬 변환기 사용 가능 여부 — 원본 충실도 최우선 */
  let hangulReady = false;
  let hangulCheckedAt = 0;
  let engineMode = 'none'; // 'hangul' | 'wasm' | 'none'
  let healthTimer = null;

  function loadDownloadMode() {
    try {
      const v = localStorage.getItem(STORAGE_MODE_KEY);
      if (v === 'zip' || v === 'pdf') return v;
    } catch {
      /* ignore */
    }
    return 'zip';
  }

  function saveDownloadMode(mode) {
    downloadMode = mode === 'pdf' ? 'pdf' : 'zip';
    try {
      localStorage.setItem(STORAGE_MODE_KEY, downloadMode);
    } catch {
      /* ignore */
    }
    syncDownloadModeUi();
  }

  function syncDownloadModeUi() {
    $$('input[name="convertDownloadMode"]').forEach((el) => {
      el.checked = el.value === downloadMode;
    });
  }

  function assetUrl(relPath) {
    try {
      return new URL(relPath, document.baseURI || location.href).href;
    } catch {
      return relPath;
    }
  }

  function isHttpPage() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function bundledFontSpecs() {
    const local = (name) => assetUrl(`vendor/rhwptopdf/fonts/${name}`);
    return [
      { local: local('NotoSerifKR-Regular.otf'), cdn: FONT_CDN.serifRegular },
      { local: local('NotoSerifKR-Bold.otf'), cdn: FONT_CDN.serifBold },
      { local: local('NotoSansKR-Regular.otf'), cdn: FONT_CDN.sansRegular },
      { local: local('NotoSansKR-Bold.otf'), cdn: FONT_CDN.sansBold },
    ];
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-ct-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener(
          'error',
          () => reject(new Error(`스크립트 로드 실패: ${src}`)),
          { once: true }
        );
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.ctSrc = src;
      s.onload = () => {
        s.dataset.loaded = '1';
        resolve();
      };
      s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
      document.head.appendChild(s);
    });
  }

  async function loadInlineWasmBytes() {
    if (window.__RHWPTOPDF_WASM__ instanceof Uint8Array) {
      return window.__RHWPTOPDF_WASM__;
    }
    await loadScriptOnce(assetUrl('vendor/rhwptopdf/wasm-bytes.js'));
    if (!(window.__RHWPTOPDF_WASM__ instanceof Uint8Array)) {
      throw new Error('내장 WASM 데이터를 읽지 못했습니다.');
    }
    return window.__RHWPTOPDF_WASM__;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isAccepted(file) {
    const lower = file.name.toLowerCase();
    return ACCEPT_EXT.some((ext) => lower.endsWith(ext));
  }

  function pdfNameFrom(name) {
    return name.replace(/\.(hwp|hwpx)$/i, '') + '.pdf';
  }

  function uid() {
    return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(kind, title, detailHtml) {
    const el = $('#convertStatus');
    if (!el) return;
    el.className = `convert-status convert-status--${kind}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${detailHtml}</span>`;
  }

  function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n >>> 0, true);
    return b;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    return b;
  }

  function concatBytes(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function encodeUtf8(str) {
    return new TextEncoder().encode(str);
  }

  function buildZipStore(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encodeUtf8(file.name);
      const data = file.data;
      const crc = crc32(data);
      const flags = 0x0800;

      const local = concatBytes([
        u32(0x04034b50),
        u16(20),
        u16(flags),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
        data,
      ]);

      const central = concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]);

      localParts.push(local);
      centralParts.push(central);
      offset += local.length;
    }

    const centralDir = concatBytes(centralParts);
    const end = concatBytes([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0),
    ]);

    return new Blob([concatBytes([...localParts, centralDir, end])], {
      type: 'application/zip',
    });
  }

  const fontBytesCache = new Map();

  async function fetchFontBytes(url) {
    if (fontBytesCache.has(url)) return fontBytesCache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`폰트 로드 실패 (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    fontBytesCache.set(url, bytes);
    return bytes;
  }

  async function fetchFontWithFallback(localUrl, cdnUrl) {
    const urls = isHttpPage() ? [localUrl, cdnUrl] : [cdnUrl, localUrl];
    let lastErr = null;
    for (const url of urls) {
      try {
        return await fetchFontBytes(url);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('폰트 로드 실패');
  }

  function getFontQueryFn() {
    if (typeof window.queryLocalFonts === 'function') return () => window.queryLocalFonts();
    if (navigator.fonts && typeof navigator.fonts.query === 'function') {
      return () => navigator.fonts.query();
    }
    return null;
  }

  function fontKey(fd) {
    return `${fd.postscriptName || ''}|${fd.fullName || ''}|${fd.family || ''}`;
  }

  function matchesCandidate(fd, candidate) {
    const c = candidate.toLowerCase().replace(/\s+/g, '');
    const fields = [fd.family, fd.fullName, fd.postscriptName]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase().replace(/\s+/g, ''));
    return fields.some((f) => f === c || f.includes(c) || c.includes(f));
  }

  /** PC에 설치된 한글 관련 폰트를 최대한 수집 (Regular·Bold 포함) */
  async function loadSystemHangulFonts(maxFonts = 28) {
    const queryFn = getFontQueryFn();
    if (!queryFn) return [];

    let list = [];
    try {
      list = await queryFn();
    } catch (err) {
      console.warn('[CTConvert] queryLocalFonts failed:', err);
      return [];
    }

    const picked = [];
    const seen = new Set();

    for (const candidate of SYSTEM_FONT_CANDIDATES) {
      if (picked.length >= maxFonts) break;
      for (const fd of list) {
        if (picked.length >= maxFonts) break;
        if (!matchesCandidate(fd, candidate)) continue;
        const key = fontKey(fd);
        if (seen.has(key)) continue;
        try {
          const blob = await fd.blob();
          const buf = await blob.arrayBuffer();
          if (buf.byteLength < 1000) continue;
          const bytes = new Uint8Array(buf.byteLength);
          bytes.set(new Uint8Array(buf));
          picked.push(bytes);
          seen.add(key);
        } catch {
          /* skip */
        }
      }
    }
    return picked;
  }

  async function checkHangulEngine(force = false) {
    const now = Date.now();
    if (!force && now - hangulCheckedAt < 4000) return hangulReady;
    hangulCheckedAt = now;
    try {
      const res = await fetch(`${HANGUL_API}/health`, { cache: 'no-store' });
      if (!res.ok) {
        hangulReady = false;
        return false;
      }
      const data = await res.json();
      hangulReady = !!(data && data.ok && data.hangul);
      return hangulReady;
    } catch {
      hangulReady = false;
      return false;
    }
  }

  function updateEngineStatus() {
    if (!assetsReady) {
      engineMode = 'none';
      return;
    }
    if (hangulReady) {
      engineMode = 'hangul';
      setStatus(
        'ok',
        '변환 준비 완료',
        '브라우저 변환이 기본입니다. 한글 엔진이 연결되어 있으면 해당 파일은 더 정밀하게 처리됩니다.'
      );
      return;
    }
    engineMode = 'wasm';
    setStatus(
      'ok',
      '변환 준비 완료',
      '브라우저에서 바로 변환합니다. 파일은 이 기기 밖으로 나가지 않습니다.'
    );
  }

  async function ensureAssets() {
    if (assetsReady) {
      await checkHangulEngine();
      updateEngineStatus();
      return;
    }
    if (assetsPromise) return assetsPromise;

    assetsPromise = (async () => {
      setStatus('warn', '변환 엔진 준비 중…', '엔진·한글 폰트를 불러오는 중…');

      // 선택적: 로컬 한글 엔진 (있으면 보강용)
      await checkHangulEngine(true);

      const wasm = await loadInlineWasmBytes();
      wasmMaster = new Uint8Array(wasm.byteLength);
      wasmMaster.set(wasm);

      const fonts = [];

      // 1) 번들 Noto (명조·고딕 × Regular·Bold) — 공유/미설치 PC에서도 글자 깨짐 방지
      for (const spec of bundledFontSpecs()) {
        try {
          fonts.push(await fetchFontWithFallback(spec.local, spec.cdn));
        } catch (err) {
          console.warn('[CTConvert] bundled font load failed:', err);
        }
      }

      // 2) 시스템 한글 폰트 — 있으면 뒤에 등록해 serif/sans fallback을 더 자연스럽게
      try {
        const sysFonts = await loadSystemHangulFonts(28);
        fonts.push(...sysFonts);
      } catch (err) {
        console.warn('[CTConvert] system fonts:', err);
      }

      if (!fonts.length) {
        throw new Error('변환용 한글 폰트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
      }
      fontMasters = fonts.map((f) => {
        const copy = new Uint8Array(f.byteLength);
        copy.set(f);
        return copy;
      });

      try {
        await startWorker();
      } catch (err) {
        console.warn('[CTConvert] worker unavailable, fallback to main thread:', err);
        useWorker = false;
        await initMainThreadEngine();
      }

      assetsReady = true;
      updateEngineStatus();
    })().catch((err) => {
      assetsPromise = null;
      assetsReady = false;
      setStatus('err', '변환 엔진을 시작할 수 없습니다', escapeHtml(err?.message || String(err)));
      throw err;
    });

    return assetsPromise;
  }

  async function convertViaHangul(job) {
    const res = await fetch(`${HANGUL_API}/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(job.name || 'document.hwp'),
      },
      body: job.sourceBytes,
    });

    if (!res.ok) {
      let msg = `한글 변환 실패 (${res.status})`;
      try {
        const err = await res.json();
        if (err?.error) msg = err.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    const buf = await res.arrayBuffer();
    const pdfBytes = new Uint8Array(buf.byteLength);
    pdfBytes.set(new Uint8Array(buf));
    if (!isPdfBytes(pdfBytes) || pdfBytes.length < 64) {
      throw new Error('한글 엔진 PDF 결과가 올바르지 않습니다.');
    }
    return pdfBytes;
  }

  function killWorker() {
    if (worker) {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    }
    worker = null;
    workerReady = false;
    workerJobs = 0;
    for (const [, p] of pendingWorker) {
      p.reject(new Error('변환 워커가 종료되었습니다.'));
    }
    pendingWorker.clear();
  }

  function startWorker() {
    return new Promise((resolve, reject) => {
      killWorker();
      if (!wasmMaster || !fontMasters.length) {
        reject(new Error('엔진 자산이 없습니다.'));
        return;
      }

      let settled = false;
      try {
        worker = new Worker(assetUrl('convert-worker.js'));
      } catch (err) {
        reject(err);
        return;
      }

      worker.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === 'ready') {
          workerReady = true;
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        if (msg.type === 'error' && !msg.id) {
          if (!settled) {
            settled = true;
            reject(new Error(msg.message || '워커 초기화 실패'));
          }
          return;
        }
        if (msg.type === 'done' || (msg.type === 'error' && msg.id)) {
          const pending = pendingWorker.get(msg.id);
          if (!pending) return;
          pendingWorker.delete(msg.id);
          if (msg.type === 'done') {
            pending.resolve(new Uint8Array(msg.pdfBytes));
          } else {
            pending.reject(new Error(msg.message || '변환 실패'));
          }
        }
      };

      worker.onerror = (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(err?.message || '워커 오류'));
        }
      };

      const wasmCopy = wasmMaster.slice().buffer;
      const fontBuffers = fontMasters.map((f) => f.slice().buffer);
      worker.postMessage(
        { type: 'init', wasmBytes: wasmCopy, fonts: fontBuffers },
        [wasmCopy, ...fontBuffers]
      );

      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('워커 초기화 시간 초과'));
        }
      }, 60000);
    });
  }

  async function ensureWorkerForNextJob() {
    if (!useWorker) return;
    if (worker && workerReady && workerJobs < RESTART_EVERY) return;
    await startWorker();
  }

  async function convertViaWorker(job) {
    await ensureWorkerForNextJob();
    if (!worker || !workerReady) throw new Error('변환 워커가 없습니다.');

    const id = job.id;
    const sourceCopy = job.sourceBytes.slice().buffer;

    const pdfBytes = await new Promise((resolve, reject) => {
      pendingWorker.set(id, { resolve, reject });
      try {
        worker.postMessage(
          { type: 'convert', id, name: job.name, sourceBytes: sourceCopy },
          [sourceCopy]
        );
      } catch (err) {
        pendingWorker.delete(id);
        reject(err);
      }
    });

    workerJobs += 1;
    if (workerJobs >= RESTART_EVERY) {
      killWorker();
    }
    return pdfBytes;
  }

  async function initMainThreadEngine() {
    if (typeof window.RhwpToPdf !== 'function') {
      throw new Error('rhwptopdf UMD를 불러오지 못했습니다.');
    }
    await window.RhwpToPdf({ module_or_path: wasmMaster.slice() });
    window.RhwpToPdf.clearPdfFonts?.();
    for (const font of fontMasters) {
      window.RhwpToPdf.registerPdfFont(font);
    }
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

  async function convertViaMain(job) {
    // 메인 스레드 폴백: 파일마다 clear+폰트 재등록
    if (typeof window.RhwpToPdf?.hwpToPdf !== 'function') {
      await initMainThreadEngine();
    }
    const RhwpToPdf = window.RhwpToPdf;
    RhwpToPdf.clearPdfFonts?.();
    for (const font of fontMasters) {
      RhwpToPdf.registerPdfFont(font);
    }

    const input = job.sourceBytes.slice();
    let analysis = null;
    try {
      analysis = RhwpToPdf.analyzeHwp(input);
      if (!analysis?.pageCount || analysis.pageCount < 1) {
        throw new Error('페이지를 읽을 수 없는 문서입니다.');
      }
    } finally {
      try {
        analysis?.free?.();
      } catch {
        /* ignore */
      }
    }

    await yieldToUi();
    const pdfView = RhwpToPdf.hwpToPdf(input);
    const pdfBytes = new Uint8Array(pdfView.byteLength);
    pdfBytes.set(pdfView);
    if (!isPdfBytes(pdfBytes) || pdfBytes.length < 64) {
      throw new Error('PDF 생성 결과가 올바르지 않습니다.');
    }
    return pdfBytes;
  }

  async function convertJob(job) {
    // 1) 한글(한컴) 로컬 엔진 — 원본 충실도 최우선
    const hangul = await checkHangulEngine();
    if (hangul) {
      try {
        return await convertViaHangul(job);
      } catch (err) {
        console.warn('[CTConvert] hangul convert failed, fallback wasm:', err);
        hangulReady = false;
        hangulCheckedAt = 0;
        // 폴백으로 계속
      }
    }

    // 2) 브라우저 WASM (시스템 한글 폰트 최대한 사용)
    if (useWorker) {
      try {
        return await convertViaWorker(job);
      } catch (err) {
        console.warn('[CTConvert] worker convert failed, retry main:', err);
        try {
          killWorker();
          await startWorker();
          return await convertViaWorker(job);
        } catch (err2) {
          console.warn('[CTConvert] worker retry failed:', err2);
          useWorker = false;
          await initMainThreadEngine();
          return convertViaMain(job);
        }
      }
    }
    return convertViaMain(job);
  }

  async function prepareFiles(fileList) {
    const files = [...fileList].filter(isAccepted);
    const skipped = [...fileList].length - files.length;
    if (skipped > 0) {
      window.ctShowToast?.(`hwp/hwpx만 추가됩니다. (${skipped}개 제외)`);
    }
    if (!files.length) {
      window.ctShowToast?.('hwp 또는 hwpx 파일을 선택해주세요.');
      return [];
    }

    const prepared = [];
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const sourceBytes = new Uint8Array(buf.byteLength);
        sourceBytes.set(new Uint8Array(buf));
        if (!sourceBytes.length) {
          prepared.push({ name: file.name, sourceBytes: null, error: '빈 파일입니다.' });
          continue;
        }
        prepared.push({ name: file.name, sourceBytes });
      } catch (err) {
        prepared.push({
          name: file.name,
          sourceBytes: null,
          error: `파일을 읽지 못했습니다: ${err?.message || err}`,
        });
      }
    }
    return prepared;
  }

  function renderList() {
    const list = $('#convertFileList');
    if (!list) return;

    if (!jobs.length) {
      list.innerHTML = '';
      list.hidden = true;
      updateActions();
      return;
    }

    list.hidden = false;
    const statusLabel = {
      pending: '대기',
      converting: '변환 중…',
      success: '완료',
      failed: '실패',
    };

    list.innerHTML = `
      <ul class="convert-job-list">
        ${jobs
          .map(
            (j) => `
          <li class="convert-job convert-job--${j.status}">
            <span class="convert-job__name" title="${escapeHtml(j.name)}">${escapeHtml(j.name)}</span>
            <span class="convert-job__status">${statusLabel[j.status] || j.status}</span>
            ${j.error ? `<span class="convert-job__error">${escapeHtml(j.error)}</span>` : ''}
          </li>`
          )
          .join('')}
      </ul>`;
    updateActions();
  }

  function updateActions() {
    const btnSave = $('#btnConvertZip');
    const btnRetry = $('#btnConvertRetry');
    const btnClear = $('#btnConvertClear');
    const successCount = jobs.filter((j) => j.status === 'success' && j.pdfBytes).length;
    const failCount = jobs.filter((j) => j.status === 'failed').length;

    if (btnSave) {
      btnSave.hidden = successCount === 0;
      btnSave.disabled = converting;
      btnSave.classList.toggle('is-emphasis', successCount > 0 && !converting);
      btnSave.textContent = downloadMode === 'pdf' ? 'PDF 다시 받기' : 'ZIP 다시 받기';
    }
    if (btnRetry) {
      btnRetry.hidden = failCount === 0;
      btnRetry.disabled = converting;
    }
    if (btnClear) {
      btnClear.hidden = jobs.length === 0;
      btnClear.disabled = converting;
    }

    const summary = $('#convertSummary');
    if (summary) {
      if (!jobs.length) {
        summary.hidden = true;
      } else if (converting && activeBatchId != null) {
        summary.hidden = false;
        const batch = jobs.filter((j) => j.batchId === activeBatchId);
        const done = batch.filter((j) => j.status === 'success' || j.status === 'failed').length;
        const current = batch.find((j) => j.status === 'converting');
        summary.textContent = current
          ? `변환 중… (${done + 1}/${batch.length}) ${current.name}`
          : `변환 중… (${done}/${batch.length})`;
      } else {
        summary.hidden = false;
        summary.textContent = `성공 ${successCount} · 실패 ${failCount} · 전체 ${jobs.length}`;
      }
    }
  }

  async function addFiles(fileList) {
    // 사용자 제스처 안에서 시스템 폰트 권한/재수집 (품질↑)
    try {
      const more = await loadSystemHangulFonts(28);
      if (more.length) {
        const merged = [...fontMasters];
        for (const f of more) {
          if (!merged.some((m) => m.byteLength === f.byteLength)) merged.push(f);
        }
        if (merged.length !== fontMasters.length) {
          fontMasters = merged;
          killWorker();
        }
      }
    } catch {
      /* ignore */
    }

    const prepared = await prepareFiles(fileList);
    if (!prepared.length) return;

    if (converting) {
      queuedPrepared.push(...prepared);
      window.ctShowToast?.(`변환 진행 중 — ${prepared.length}개 파일을 대기열에 넣었습니다.`);
      return;
    }

    enqueueAndStart(prepared);
  }

  function enqueueAndStart(preparedList) {
    const batchId = ++batchSeq;
    for (const item of preparedList) {
      if (!item.sourceBytes) {
        jobs.push({
          id: uid(),
          name: item.name,
          sourceBytes: null,
          status: 'failed',
          error: item.error || '파일을 읽을 수 없습니다.',
          batchId,
        });
        continue;
      }
      jobs.push({
        id: uid(),
        name: item.name,
        sourceBytes: item.sourceBytes,
        status: 'pending',
        batchId,
      });
    }
    renderList();
    startBatch(batchId);
  }

  async function convertOne(job) {
    job.status = 'converting';
    job.error = undefined;
    renderList();
    await yieldToUi();

    try {
      const pdfBytes = await convertJob(job);
      job.pdfBytes = pdfBytes;
      job.pdfName = pdfNameFrom(job.name);
      job.status = 'success';
      // 원본 바이트 해제 (대량 변환 메모리 확보)
      job.sourceBytes = null;
    } catch (err) {
      job.status = 'failed';
      job.error = err?.message || String(err);
      job.pdfBytes = undefined;
    }
    renderList();
    await yieldToUi();
  }

  async function startBatch(batchId) {
    if (converting) return;
    const targets = jobs.filter((j) => j.batchId === batchId && j.status === 'pending');
    if (!targets.length) {
      await finishBatch(batchId);
      drainQueue();
      return;
    }

    converting = true;
    activeBatchId = batchId;
    updateActions();
    setStatus(
      'ok',
      '변환 중…',
      hangulReady
        ? `${targets.length}개 파일을 변환합니다.`
        : `${targets.length}개 파일을 브라우저에서 변환합니다.`
    );

    try {
      await ensureAssets();
    } catch {
      for (const job of targets) {
        job.status = 'failed';
        job.error = '변환 엔진이 준비되지 않았습니다.';
      }
      converting = false;
      activeBatchId = null;
      renderList();
      drainQueue();
      return;
    }

    for (const job of targets) {
      await convertOne(job);
    }

    converting = false;
    activeBatchId = null;
    killWorker();
    renderList();
    await finishBatch(batchId);
    drainQueue();
  }

  async function finishBatch(batchId) {
    const batchJobs = jobs.filter((j) => j.batchId === batchId);
    const successes = batchJobs.filter((j) => j.status === 'success' && j.pdfBytes);
    const fails = batchJobs.filter((j) => j.status === 'failed');

    if (successes.length) {
      try {
        await saveOutputs(successes);
        const modeLabel = downloadMode === 'pdf' ? 'PDF' : 'ZIP';
        setStatus(
          fails.length ? 'warn' : 'ok',
          fails.length
            ? `변환 완료 (성공 ${successes.length} · 실패 ${fails.length})`
            : `변환 완료 — ${successes.length}개`,
          fails.length
            ? `성공분은 ${modeLabel}로 저장했습니다. 실패 항목은 재시도할 수 있습니다.`
            : `${modeLabel}로 저장했습니다.`
        );
        window.ctShowToast?.(
          fails.length
            ? `성공 ${successes.length}개 저장 · 실패 ${fails.length}개`
            : `${successes.length}개 파일을 저장했습니다.`
        );
      } catch (err) {
        setStatus(
          'warn',
          `변환 완료 (성공 ${successes.length})`,
          '자동 다운로드가 차단되었을 수 있습니다. <strong>다시 받기</strong> 버튼을 눌러 주세요.'
        );
        window.ctShowToast?.('다시 받기 버튼을 눌러 저장하세요.');
        console.warn('[CTConvert] save failed:', err);
      }
    } else {
      setStatus('err', '변환 실패', '성공한 파일이 없습니다. 오류 메시지를 확인하세요.');
      window.ctShowToast?.('변환에 성공한 파일이 없습니다.');
    }
  }

  function drainQueue() {
    if (converting || !queuedPrepared.length) return;
    const next = queuedPrepared.splice(0, queuedPrepared.length);
    enqueueAndStart(next);
  }

  function uniquePdfNames(successJobs) {
    const used = new Map();
    return successJobs.map((j) => {
      let name = j.pdfName || pdfNameFrom(j.name);
      const base = name;
      let n = 1;
      while (used.has(name.toLowerCase())) {
        n += 1;
        name = base.replace(/\.pdf$/i, `_${n}.pdf`);
      }
      used.set(name.toLowerCase(), true);
      return { name, data: j.pdfBytes };
    });
  }

  async function saveOutputs(successJobs) {
    const files = uniquePdfNames(successJobs);
    if (!files.length) return;

    if (downloadMode === 'pdf' || files.length === 1) {
      for (let i = 0; i < files.length; i++) {
        downloadBlob(new Blob([files[i].data], { type: 'application/pdf' }), files[i].name);
        if (i < files.length - 1) await sleep(350);
      }
      return;
    }

    const zipBlob = buildZipStore(files);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(zipBlob, `문서변환_${stamp}.zip`);
  }

  function bind() {
    if (bound) return;
    bound = true;

    const zone = $('#convertDropzone');
    const input = $('#convertFileInput');
    const btnPick = $('#btnConvertPick');

    syncDownloadModeUi();
    $$('input[name="convertDownloadMode"]').forEach((el) => {
      el.addEventListener('change', () => {
        if (el.checked) saveDownloadMode(el.value);
        updateActions();
      });
    });

    btnPick?.addEventListener('click', () => input?.click());
    zone?.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      input?.click();
    });

    input?.addEventListener('change', () => {
      if (input.files?.length) addFiles(input.files);
      input.value = '';
    });

    ;['dragenter', 'dragover'].forEach((ev) => {
      zone?.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add('is-dragover');
      });
    });
    ;['dragleave', 'drop'].forEach((ev) => {
      zone?.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove('is-dragover');
      });
    });
    zone?.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files?.length) addFiles(files);
    });

    $('#btnConvertZip')?.addEventListener('click', async () => {
      const successes = jobs.filter((j) => j.status === 'success' && j.pdfBytes);
      if (!successes.length) return;
      try {
        await saveOutputs(successes);
        window.ctShowToast?.('파일을 다시 저장했습니다.');
      } catch (err) {
        window.ctShowToast?.('저장에 실패했습니다. 다시 시도해 주세요.');
        console.warn(err);
      }
    });

    $('#btnConvertRetry')?.addEventListener('click', async () => {
      if (converting) return;
      // 실패한 항목은 sourceBytes가 남아 있어야 함 (성공 후 해제한 것과 구분)
      const failed = jobs.filter((j) => j.status === 'failed' && j.sourceBytes?.length);
      if (!failed.length) {
        window.ctShowToast?.('다시 변환하려면 파일을 다시 올려 주세요. (원본이 해제된 항목)');
        return;
      }
      const batchId = ++batchSeq;
      for (const j of failed) {
        j.status = 'pending';
        j.error = undefined;
        j.pdfBytes = undefined;
        j.batchId = batchId;
      }
      renderList();
      startBatch(batchId);
    });

    $('#btnConvertClear')?.addEventListener('click', () => {
      if (converting) return;
      jobs = [];
      queuedPrepared = [];
      killWorker();
      renderList();
      setStatus(
        'ok',
        '준비 완료 — 바로 변환할 수 있습니다',
        'hwp / hwpx 파일을 올리거나 끌어다 놓으세요.'
      );
    });

    $('#btnConvertRecheck')?.addEventListener('click', async () => {
      assetsReady = false;
      assetsPromise = null;
      hangulCheckedAt = 0;
      killWorker();
      useWorker = true;
      // 사용자 제스처 안에서 시스템 폰트 재수집
      try {
        await loadSystemHangulFonts(28);
      } catch {
        /* ignore */
      }
      ensureAssets().catch(() => {});
    });
  }

  function init() {
    bind();
    ensureAssets().catch(() => {});
    clearInterval(healthTimer);
    healthTimer = setInterval(() => {
      checkHangulEngine(true).then(() => {
        if (!converting) updateEngineStatus();
      });
    }, 8000);
  }

  window.CTConvert = { init };
})();
