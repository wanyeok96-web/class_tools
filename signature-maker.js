/**
 * Class Tools — 서명·도장 만들기 (PNG보내기)
 */
(function () {
  'use strict';

  const STAMP_COLORS = [
    { id: 'vermillion', label: '인주', value: '#C41E3A' },
    { id: 'black', label: '검정', value: '#1a1a1a' },
    { id: 'blue', label: '청색', value: '#1e4d8c' },
    { id: 'gold', label: '금색', value: '#b8860b' },
  ];

  /**
   * 도장 서체. web: Google Fonts(OFL)에서 필요한 글자만 내려받음, system: PC에 설치된 글꼴.
   * 불러오지 못하면 family 목록의 다음 글꼴로 그려진다.
   * scale: 서체마다 글자 크기가 달라 고딕과 비슷한 크기로 보이도록 맞춘 배율
   */
  const STAMP_FONTS = [
    { id: 'gothic', label: '고딕', weight: 800, scale: 1, family: 'Pretendard, "Malgun Gothic", sans-serif' },
    { id: 'myeongjo', label: '명조', weight: 800, scale: 0.96, web: 'Nanum Myeongjo', family: '"Nanum Myeongjo", "함초롬바탕", "HCR Batang", Batang, serif' },
    { id: 'gungseo', label: '궁서', weight: 400, scale: 0.95, system: 'Gungsuh', family: 'Gungsuh, "궁서", GungSeo, "Nanum Myeongjo", serif' },
    { id: 'brush', label: '붓글씨', weight: 400, scale: 1.12, web: 'Nanum Brush Script', family: '"Nanum Brush Script", Gungsuh, "궁서", cursive' },
    { id: 'pen', label: '손글씨', weight: 400, scale: 1.24, web: 'Nanum Pen Script', family: '"Nanum Pen Script", cursive' },
    { id: 'heavy', label: '굵은 제목체', weight: 400, scale: 1.18, web: 'Black Han Sans', family: '"Black Han Sans", Pretendard, sans-serif' },
  ];
  const WEB_FONT_CSS = 'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@800&family=Nanum+Brush+Script&family=Nanum+Pen+Script&family=Black+Han+Sans&display=swap';
  const SAMPLE_TEXT = '홍길동';

  function $(sel, ctx = document) {
    return ctx.querySelector(sel);
  }

  function getStampFont(id) {
    return STAMP_FONTS.find((f) => f.id === id) || STAMP_FONTS[0];
  }

  function fontCss(font, px) {
    return `${font.weight} ${px * (font.scale || 1)}px ${font.family}`;
  }

  let webFontCssPromise = null;

  /** Google Fonts 스타일시트를 한 번만 붙이고, 읽기를 마치면(실패해도) 끝나는 Promise를 돌려준다 */
  function ensureWebFontCss() {
    if (webFontCssPromise) return webFontCssPromise;
    webFontCssPromise = new Promise((resolve) => {
      const link = document.createElement('link');
      link.id = 'ctStampFontCss';
      link.rel = 'stylesheet';
      link.href = WEB_FONT_CSS;
      link.onload = () => resolve(true);
      link.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 6000);
      document.head.appendChild(link);
    });
    return webFontCssPromise;
  }

  /** 시스템 글꼴 설치 여부 — 대체 글꼴과 글자 폭이 다르면 설치된 것으로 본다 */
  function isSystemFontAvailable(name) {
    const ctx = document.createElement('canvas').getContext('2d');
    const text = '홍길동인 도장';
    return ['monospace', 'serif'].some((fallback) => {
      ctx.font = `40px ${fallback}`;
      const base = ctx.measureText(text).width;
      ctx.font = `40px "${name}", ${fallback}`;
      return ctx.measureText(text).width !== base;
    });
  }

  /**
   * 캔버스에 그리기 전에 글꼴(해당 글자 부분)을 불러온다.
   * @returns {Promise<boolean>} 원하는 서체로 그릴 수 있으면 true
   */
  async function loadStampFont(font, text) {
    if (font.system) return isSystemFontAvailable(font.system);
    if (!font.web) return true;
    if (!(await ensureWebFontCss())) return false;
    try {
      const loaded = await Promise.race([
        document.fonts.load(fontCss(font, 64), text || SAMPLE_TEXT),
        new Promise((resolve) => setTimeout(() => resolve([]), 6000)),
      ]);
      return loaded.some((face) => face.family.replace(/["']/g, '') === font.web);
    } catch {
      return false;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (!canvas?.width || !canvas?.height) {
        reject(new Error('빈 캔버스'));
        return;
      }
      const fallback = () => {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const bin = atob(dataUrl.split(',')[1]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          resolve(new Blob([bytes], { type: 'image/png' }));
        } catch (err) {
          reject(err);
        }
      };
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else fallback();
        }, 'image/png');
      } else {
        fallback();
      }
    });
  }

  function trimTransparentCanvas(source, padding = 16) {
    const ctx = source.getContext('2d');
    const { width, height } = source;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3];
        if (a > 8) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!found) return null;

    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width - 1, maxX + padding);
    maxY = Math.min(height - 1, maxY + padding);

    const outW = maxX - minX + 1;
    const outH = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    out.getContext('2d').drawImage(source, minX, minY, outW, outH, 0, 0, outW, outH);
    return out;
  }

  function getStampChars(text, appendIn) {
    let chars = String(text || '').replace(/\s/g, '').split('');
    if (appendIn && chars.length >= 1 && chars.length <= 3 && chars[chars.length - 1] !== '인') {
      chars.push('인');
    }
    return chars.slice(0, 4);
  }

  function stampCellPositions(count, cx, cy, cellSize) {
    const half = cellSize / 2;
    if (count === 1) return [{ x: cx, y: cy, char: 0 }];
    if (count === 2) {
      return [
        { x: cx - half * 0.55, y: cy, char: 0 },
        { x: cx + half * 0.55, y: cy, char: 1 },
      ];
    }
    if (count === 3) {
      return [
        { x: cx - half * 0.5, y: cy - half * 0.35, char: 0 },
        { x: cx + half * 0.5, y: cy - half * 0.35, char: 1 },
        { x: cx, y: cy + half * 0.45, char: 2 },
      ];
    }
    return [
      { x: cx - half * 0.48, y: cy - half * 0.42, char: 0 },
      { x: cx + half * 0.48, y: cy - half * 0.42, char: 1 },
      { x: cx - half * 0.48, y: cy + half * 0.42, char: 2 },
      { x: cx + half * 0.48, y: cy + half * 0.42, char: 3 },
    ];
  }

  function drawStamp(ctx, options) {
    const {
      size,
      chars,
      color,
      border,
      font = STAMP_FONTS[0],
    } = options;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.44;

    ctx.clearRect(0, 0, size, size);

    if (border) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, size * 0.014);
      ctx.stroke();
    }

    const cellSize = radius * 1.35;
    const fontSize = chars.length === 4
      ? cellSize * 0.42
      : chars.length === 3
        ? cellSize * 0.48
        : cellSize * 0.55;

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontCss(font, fontSize);

    const positions = stampCellPositions(chars.length, cx, cy, cellSize);
    positions.forEach((pos) => {
      const ch = chars[pos.char];
      if (ch) ctx.fillText(ch, pos.x, pos.y);
    });
  }

  function renderStampPreview(canvas, options) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displaySize = canvas.clientWidth || 280;
    canvas.width = Math.floor(displaySize * dpr);
    canvas.height = Math.floor(displaySize * dpr);
    canvas.style.width = `${displaySize}px`;
    canvas.style.height = `${displaySize}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStamp(ctx, { ...options, size: displaySize });
  }

  function buildStampCanvas(options) {
    const canvas = document.createElement('canvas');
    canvas.width = options.size;
    canvas.height = options.size;
    drawStamp(canvas.getContext('2d'), options);
    return canvas;
  }

  function SignatureMaker() {
    this.bound = false;
    this.mode = 'draw';
    this.strokes = [];
    this.currentStroke = null;
    this.drawing = false;
    this.strokeColor = '#1a1a1a';
    this.strokeWidth = 3;
    this.previewBg = 'light';
    this.stampColor = STAMP_COLORS[0].value;
    this.stampSize = 512;
    this.stampBorder = true;
    this.stampAppendIn = true;
    this.stampFontId = STAMP_FONTS[0].id;
    this.fontRequest = 0;
    /** 서체별 불러오기 결과 — false면 대체 글꼴로 그려지므로 크기 보정을 하지 않는다 */
    this.fontReady = {};
  }

  /** 대체 글꼴(대개 궁서·명조 계열)로 그려질 때는 그 글꼴에 맞는 배율을 써서 도장 밖으로 넘치지 않게 한다 */
  SignatureMaker.prototype.effectiveFont = function effectiveFont(font) {
    return this.fontReady[font.id] === false ? { ...font, scale: 0.95 } : font;
  };

  SignatureMaker.prototype.renderFontChips = function renderFontChips() {
    const wrap = $('#signatureStampFonts');
    if (!wrap) return;
    ensureWebFontCss();
    const text = this.getStampOptions().chars.join('') || SAMPLE_TEXT;
    const chipSize = (font) => `${(1.3 * (this.effectiveFont(font).scale || 1)).toFixed(2)}rem`;
    wrap.innerHTML = STAMP_FONTS.map((font) => `
      <button type="button" class="signature-font-chip${font.id === this.stampFontId ? ' is-active' : ''}"
        data-font="${font.id}" aria-pressed="${font.id === this.stampFontId}" title="${font.label}">
        <span class="signature-font-chip__sample" style="font-family:${font.family.replace(/"/g, '&quot;')};font-weight:${font.weight};font-size:${chipSize(font)}"></span>
        <span class="signature-font-chip__label">${font.label}</span>
      </button>`).join('');
    wrap.querySelectorAll('.signature-font-chip__sample').forEach((el) => { el.textContent = text; });

    // 서체를 미리 불러와 두고, 못 불러온 서체는 칩 글자 크기 보정을 되돌린다
    STAMP_FONTS.forEach((font) => {
      loadStampFont(font, text).then((ok) => {
        this.fontReady[font.id] = ok;
        const sample = wrap.querySelector(`[data-font="${font.id}"] .signature-font-chip__sample`);
        if (sample) sample.style.fontSize = chipSize(font);
        if (font.id === this.stampFontId && this.stampCanvas) {
          renderStampPreview(this.stampCanvas, this.getStampOptions());
        }
      });
    });
  };

  SignatureMaker.prototype.syncFontChipSamples = function syncFontChipSamples() {
    const text = this.getStampOptions().chars.join('') || SAMPLE_TEXT;
    document.querySelectorAll('.signature-font-chip__sample').forEach((el) => { el.textContent = text; });
  };

  SignatureMaker.prototype.bind = function bind() {
    if (this.bound) return;
    this.bound = true;

    document.querySelectorAll('.signature-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.signatureTab));
    });

    this.drawCanvas = $('#signatureDrawCanvas');
    this.stampCanvas = $('#signatureStampCanvas');
    this.stampPreviewWrap = $('#signatureStampPreview');
    this.drawPreviewWrap = $('#signatureDrawPreview');

    $('#signatureStrokeWidth')?.addEventListener('input', (e) => {
      this.strokeWidth = parseInt(e.target.value, 10) || 3;
    });

    $('#signatureStrokeColor')?.addEventListener('input', (e) => {
      this.strokeColor = e.target.value;
    });

    $('#btnSignatureUndo')?.addEventListener('click', () => this.undoStroke());
    $('#btnSignatureClear')?.addEventListener('click', () => this.clearDraw());
    $('#btnSignatureDrawPng')?.addEventListener('click', () => this.exportDrawPng());

    const stampInput = $('#signatureStampText');
    if (stampInput) {
      let composing = false;
      stampInput.addEventListener('compositionstart', () => { composing = true; });
      stampInput.addEventListener('compositionend', () => {
        composing = false;
        this.updateStampPreview();
      });
      stampInput.addEventListener('input', () => {
        if (!composing) this.updateStampPreview();
      });
      stampInput.addEventListener('blur', () => {
        const cleaned = stampInput.value.replace(/[^\uAC00-\uD7A3]/g, '');
        if (cleaned !== stampInput.value) stampInput.value = cleaned;
        this.updateStampPreview();
      });
    }
    $('#signatureStampAppendIn')?.addEventListener('change', (e) => {
      this.stampAppendIn = e.target.checked;
      this.updateStampPreview();
    });
    $('#signatureStampSize')?.addEventListener('change', (e) => {
      this.stampSize = parseInt(e.target.value, 10) || 512;
    });
    $('#signatureStampBorder')?.addEventListener('change', (e) => {
      this.stampBorder = e.target.checked;
      this.updateStampPreview();
    });

    this.renderFontChips();
    $('#signatureStampFonts')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.signature-font-chip');
      if (!chip) return;
      this.stampFontId = chip.dataset.font;
      document.querySelectorAll('.signature-font-chip').forEach((c) => {
        const active = c === chip;
        c.classList.toggle('is-active', active);
        c.setAttribute('aria-pressed', String(active));
      });
      this.updateStampPreview();
    });

    document.querySelectorAll('.signature-color-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.stampColor = chip.dataset.color;
        document.querySelectorAll('.signature-color-chip').forEach((c) => {
          c.classList.toggle('is-active', c === chip);
        });
        this.updateStampPreview();
      });
    });

    document.querySelectorAll('.signature-preview-bg').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.previewBg = btn.dataset.previewBg;
        this.syncPreviewBgButtons();
        this.applyPreviewBg();
      });
    });

    $('#btnSignatureStampPng')?.addEventListener('click', () => this.saveStampPng());

    this.setupDrawCanvas();
    this.switchTab('draw');
    this.updateStampPreview();
  };

  SignatureMaker.prototype.switchTab = function switchTab(tabId) {
    this.mode = tabId;
    document.querySelectorAll('.signature-tab').forEach((btn) => {
      const active = btn.dataset.signatureTab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('#signatureTabDraw').hidden = tabId !== 'draw';
    $('#signatureTabStamp').hidden = tabId !== 'stamp';
    if (tabId === 'stamp') this.updateStampPreview();
    if (tabId === 'draw') this.resizeDrawCanvas();
  };

  SignatureMaker.prototype.syncPreviewBgButtons = function syncPreviewBgButtons() {
    document.querySelectorAll('.signature-preview-bg').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.previewBg === this.previewBg);
    });
  };

  SignatureMaker.prototype.applyPreviewBg = function applyPreviewBg() {
    const cls = `signature-preview-wrap--${this.previewBg}`;
    [this.drawPreviewWrap, this.stampPreviewWrap].forEach((el) => {
      if (!el) return;
      el.classList.remove('signature-preview-wrap--light', 'signature-preview-wrap--dark', 'signature-preview-wrap--checker');
      el.classList.add(cls);
    });
    this.syncPreviewBgButtons();
  };

  SignatureMaker.prototype.setupDrawCanvas = function setupDrawCanvas() {
    if (!this.drawCanvas) return;
    const canvas = this.drawCanvas;

    const onDown = (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      const pt = this.pointerPos(e);
      this.currentStroke = {
        color: this.strokeColor,
        width: this.strokeWidth,
        points: [pt],
      };
    };

    const onMove = (e) => {
      if (!this.drawing || !this.currentStroke) return;
      e.preventDefault();
      this.currentStroke.points.push(this.pointerPos(e));
      this.redrawDrawCanvas();
    };

    const onUp = (e) => {
      if (!this.drawing) return;
      this.drawing = false;
      if (this.currentStroke?.points.length) {
        this.strokes.push(this.currentStroke);
      }
      this.currentStroke = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.redrawDrawCanvas();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);
  };

  SignatureMaker.prototype.pointerPos = function pointerPos(e) {
    const rect = this.drawCanvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  SignatureMaker.prototype.resizeDrawCanvas = function resizeDrawCanvas() {
    const canvas = this.drawCanvas;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const cssW = Math.max(320, Math.floor(wrap?.clientWidth || 640));
    const cssH = Math.max(160, Math.floor(cssW * 0.32));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    this.drawDpr = dpr;
    this.drawLogicalW = cssW;
    this.drawLogicalH = cssH;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redrawDrawCanvas();
  };

  SignatureMaker.prototype.redrawDrawCanvas = function redrawDrawCanvas() {
    const canvas = this.drawCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = this.drawLogicalW || parseInt(canvas.style.width, 10) || 640;
    const h = this.drawLogicalH || parseInt(canvas.style.height, 10) || 200;
    ctx.clearRect(0, 0, w, h);

    const all = [...this.strokes];
    if (this.currentStroke) all.push(this.currentStroke);

    all.forEach((stroke) => {
      if (stroke.points.length < 2) {
        if (stroke.points.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
          ctx.fillStyle = stroke.color;
          ctx.fill();
        }
        return;
      }
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
  };

  SignatureMaker.prototype.undoStroke = function undoStroke() {
    this.strokes.pop();
    this.redrawDrawCanvas();
  };

  SignatureMaker.prototype.clearDraw = function clearDraw() {
    this.strokes = [];
    this.currentStroke = null;
    this.redrawDrawCanvas();
  };

  SignatureMaker.prototype.getDrawExportCanvas = function getDrawExportCanvas() {
    const cssW = parseInt(this.drawCanvas.style.width, 10) || 640;
    const cssH = parseInt(this.drawCanvas.style.height, 10) || 200;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = cssW;
    exportCanvas.height = cssH;
    const ctx = exportCanvas.getContext('2d');
    ctx.clearRect(0, 0, cssW, cssH);

    this.strokes.forEach((stroke) => {
      if (stroke.points.length < 2) {
        if (stroke.points.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
          ctx.fillStyle = stroke.color;
          ctx.fill();
        }
        return;
      }
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });

    return trimTransparentCanvas(exportCanvas, 20);
  };

  SignatureMaker.prototype.exportDrawPng = async function exportDrawPng() {
    if (!this.strokes.length) {
      window.ctShowToast?.('먼저 싸인을 그려주세요.');
      return;
    }
    const trimmed = this.getDrawExportCanvas();
    if (!trimmed) {
      window.ctShowToast?.('저장할 내용이 없습니다.');
      return;
    }
    try {
      const blob = await canvasToPngBlob(trimmed);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `싸인_${date}.png`);
      window.ctShowToast?.('PNG 파일이 저장되었습니다.');
    } catch {
      window.ctShowToast?.('PNG 저장에 실패했습니다.');
    }
  };

  SignatureMaker.prototype.getStampOptions = function getStampOptions() {
    const raw = $('#signatureStampText')?.value || '';
    const text = raw.replace(/[^\uAC00-\uD7A3]/g, '');
    const chars = getStampChars(text, this.stampAppendIn);
    return {
      size: this.stampSize,
      chars,
      color: this.stampColor,
      border: this.stampBorder,
      font: this.effectiveFont(getStampFont(this.stampFontId)),
    };
  };

  SignatureMaker.prototype.updateStampPreview = function updateStampPreview() {
    if (!this.stampCanvas) return;
    const opts = this.getStampOptions();
    renderStampPreview(this.stampCanvas, opts);
    this.syncFontChipSamples();
    const hint = $('#signatureStampHint');
    if (hint) {
      hint.textContent = opts.chars.length
        ? `${opts.chars.length}자 · ${opts.chars.join('')}`
        : '2~4자 한글을 입력하세요 (「인」 자동 추가 가능)';
    }

    // 글꼴이 늦게 도착하면 다시 그린다 (그 사이 다른 서체·글자로 바뀌었으면 무시)
    const request = ++this.fontRequest;
    const text = opts.chars.join('') || SAMPLE_TEXT;
    loadStampFont(opts.font, text).then((ok) => {
      this.fontReady[opts.font.id] = ok;
      if (request !== this.fontRequest) return;
      renderStampPreview(this.stampCanvas, this.getStampOptions());
      const fontHint = $('#signatureFontHint');
      if (!fontHint) return;
      fontHint.hidden = ok;
      fontHint.textContent = ok ? '' : (opts.font.system
        ? `이 PC에 ${opts.font.label} 글꼴이 없어 비슷한 글꼴로 표시됩니다.`
        : `인터넷에 연결되어 있지 않아 ${opts.font.label} 서체를 불러오지 못했습니다. 비슷한 글꼴로 표시됩니다.`);
    });
  };

  SignatureMaker.prototype.saveStampPng = async function saveStampPng() {
    const first = this.getStampOptions();
    if (first.chars.length < 2) {
      window.ctShowToast?.('도장 글자를 2자 이상 입력해주세요.');
      return;
    }
    try {
      this.fontReady[first.font.id] = await loadStampFont(first.font, first.chars.join(''));
      const opts = this.getStampOptions();
      const canvas = buildStampCanvas(opts);
      const blob = await canvasToPngBlob(canvas);
      downloadBlob(blob, `도장_${opts.chars.join('')}.png`);
      window.ctShowToast?.('PNG 파일이 저장되었습니다.');
    } catch {
      window.ctShowToast?.('PNG 저장에 실패했습니다.');
    }
  };

  SignatureMaker.prototype.init = function init() {
    this.bind();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.applyPreviewBg();
        this.resizeDrawCanvas();
        this.updateStampPreview();
      });
    });
  };

  const maker = new SignatureMaker();

  window.CTSignature = {
    init: () => maker.init(),
  };
})();
