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

  const STAMP_SIZES = [256, 512, 1024];

  function $(sel, ctx = document) {
    return ctx.querySelector(sel);
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
    ctx.font = `800 ${fontSize}px Pretendard, "Malgun Gothic", sans-serif`;

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
  }

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
    };
  };

  SignatureMaker.prototype.updateStampPreview = function updateStampPreview() {
    if (!this.stampCanvas) return;
    const opts = this.getStampOptions();
    renderStampPreview(this.stampCanvas, opts);
    const hint = $('#signatureStampHint');
    if (hint) {
      hint.textContent = opts.chars.length
        ? `${opts.chars.length}자 · ${opts.chars.join('')}`
        : '2~4자 한글을 입력하세요 (「인」 자동 추가 가능)';
    }
  };

  SignatureMaker.prototype.saveStampPng = async function saveStampPng() {
    const opts = this.getStampOptions();
    if (opts.chars.length < 2) {
      window.ctShowToast?.('도장 글자를 2자 이상 입력해주세요.');
      return;
    }
    try {
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
