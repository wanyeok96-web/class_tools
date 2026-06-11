/**
 * Class Tools — 핀볼 물리 시뮬레이션 (캔버스)
 */
(function () {
  'use strict';

  const PINBALL_COLORS = [
    '#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF3B30',
    '#5856D6', '#00C7BE', '#FF2D55', '#5AC8FA', '#FFCC00',
    '#8E8E93', '#A2845E', '#30B0C7', '#FF6482', '#64D2FF',
  ];

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function buildPegs(boardW, boardH) {
    const pegs = [];
    const marginX = 22;
    const marginTop = 96;
    const marginBottom = 100;
    const usableW = boardW - marginX * 2;
    const usableH = boardH - marginTop - marginBottom;
    const pegR = Math.max(3.5, boardW * 0.007);

    const addRow = (y, cols, stagger) => {
      const colGap = usableW / (cols - 1);
      const offset = stagger ? colGap / 2 : 0;
      const count = stagger ? cols - 1 : cols;
      for (let c = 0; c < count; c++) {
        pegs.push({
          x: marginX + offset + c * colGap,
          y,
          r: pegR,
          finale: false,
        });
      }
    };

    const mainRows = 17;
    const mainCols = 13;
    const rowGap = usableH * 0.58 / (mainRows - 1);
    for (let r = 0; r < mainRows; r++) {
      addRow(marginTop + r * rowGap, mainCols, r % 2 === 1);
    }

    const finaleTop = marginTop + usableH * 0.58;
    const finaleRows = 6;
    const finaleCols = 15;
    const finaleGap = (usableH * 0.38) / (finaleRows - 1);
    for (let r = 0; r < finaleRows; r++) {
      const y = finaleTop + r * finaleGap;
      const cols = r % 2 === 0 ? finaleCols : finaleCols - 1;
      const colGap = usableW / (cols - 1);
      const offset = r % 2 === 1 ? colGap / 2 : 0;
      const count = r % 2 === 1 ? cols - 1 : cols;
      for (let c = 0; c < count; c++) {
        pegs.push({
          x: marginX + offset + c * colGap,
          y,
          r: pegR * 1.05,
          finale: true,
        });
      }
    }

    const bumperR = pegR * 1.8;
    const bumperY = boardH - marginBottom + 18;
    [-1, 1].forEach((side) => {
      pegs.push({
        x: marginX + (side < 0 ? 0 : usableW),
        y: bumperY,
        r: bumperR,
        finale: true,
        bumper: true,
      });
    });

    return pegs;
  }

  function getBallDisplayLabel(number, participantCount) {
    const s = String(number);
    if (participantCount > 12 || s.length > 4) return s.slice(-2);
    if (s.length > 3) return s.slice(-3);
    return s;
  }

  function createBalls(participants, boardW) {
    const n = participants.length;
    const ballR = clamp(boardW / (n * 2.4), 10, 18);
    const margin = ballR + 18;
    const span = boardW - margin * 2;
    const gap = n > 1 ? span / (n - 1) : 0;

    return participants.map((student, i) => ({
      id: student.id,
      name: student.name,
      number: student.number,
      displayLabel: getBallDisplayLabel(student.number, n),
      x: n === 1 ? boardW / 2 : margin + gap * i,
      y: 30 + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.8,
      vy: 0,
      r: ballR,
      color: PINBALL_COLORS[i % PINBALL_COLORS.length],
      finished: false,
      finishOrder: null,
      stuckFrames: 0,
      lastY: 20,
      releaseFrame: i * 8,
      frame: 0,
      nearFinish: false,
    }));
  }

  function PinballEngine(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.pegs = [];
    this.balls = [];
    this.bounds = { left: 0, right: 0, finishY: 0 };
    this.running = false;
    this.rafId = 0;
    this.finishCount = 0;
    this.winnerCount = 1;
    this.frame = 0;
    this.finalePulse = 0;
    this.onFinishOrder = null;
    this.onComplete = null;
    this.onFrame = null;
  }

  PinballEngine.prototype.resize = function resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect?.width || 640));
    const cssH = Math.max(500, Math.floor(cssW * 0.92));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.pegs = buildPegs(cssW, cssH);
    this.bounds = {
      left: 14,
      right: cssW - 14,
      finishY: cssH - 56,
      finaleZone: cssH * 0.68,
    };
  };

  PinballEngine.prototype.setup = function setup(participants, winnerCount) {
    this.resize();
    this.balls = createBalls(participants, this.width);
    this.finishCount = 0;
    this.winnerCount = Math.max(1, winnerCount || 1);
    this.frame = 0;
    this.finalePulse = 0;
    this.running = false;
    this.draw();
  };

  PinballEngine.prototype.reset = function reset() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.finishCount = 0;
    this.frame = 0;
    this.finalePulse = 0;
    this.balls.forEach((b) => {
      b.finished = false;
      b.finishOrder = null;
      b.stuckFrames = 0;
      b.nearFinish = false;
    });
    this.draw();
  };

  PinballEngine.prototype.start = function start(callbacks) {
    if (this.running || !this.balls.length) return;
    this.onFinishOrder = callbacks?.onFinishOrder;
    this.onComplete = callbacks?.onComplete;
    this.onFrame = callbacks?.onFrame;
    this.running = true;
    this.finishCount = 0;
    this.frame = 0;
    this.finalePulse = 0;
    this.balls.forEach((b, i) => {
      b.finished = false;
      b.finishOrder = null;
      b.stuckFrames = 0;
      b.nearFinish = false;
      b.releaseFrame = i * 8;
      b.frame = 0;
      b.vx = (Math.random() - 0.5) * 1.2;
      b.vy = 0;
    });
    this.loop();
  };

  PinballEngine.prototype.stop = function stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  };

  PinballEngine.prototype.loop = function loop() {
    if (!this.running) return;
    this.frame++;
    this.step();
    this.draw();
    this.onFrame?.(this.balls);
    const active = this.balls.filter((b) => !b.finished);
    if (!active.length) {
      this.running = false;
      this.onComplete?.(this.getFinishOrder());
      return;
    }
    this.rafId = requestAnimationFrame(() => this.loop());
  };

  PinballEngine.prototype.stepBall = function stepBall(ball, gravity, friction, bounce) {
    const { left, right, finishY, finaleZone } = this.bounds;

    if (ball.frame < ball.releaseFrame) {
      ball.frame++;
      return;
    }
    ball.frame++;

    const inFinale = ball.y > finaleZone;
    ball.nearFinish = inFinale && !ball.finished;
    const g = inFinale ? gravity * 0.72 : gravity;
    const f = inFinale ? 0.996 : friction;
    const b = inFinale ? 0.82 : bounce;

    ball.vy += g;
    ball.vx *= f;
    ball.vy *= f;
    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.x - ball.r < left) {
      ball.x = left + ball.r;
      ball.vx = Math.abs(ball.vx) * b;
    }
    if (ball.x + ball.r > right) {
      ball.x = right - ball.r;
      ball.vx = -Math.abs(ball.vx) * b;
    }

    for (let i = 0; i < this.pegs.length; i++) {
      const peg = this.pegs[i];
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const dist = Math.hypot(dx, dy);
      const minDist = ball.r + peg.r;
      if (dist >= minDist || dist < 0.001) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      ball.x += nx * overlap;
      ball.y += ny * overlap;
      const vDot = ball.vx * nx + ball.vy * ny;
      if (vDot < 0) {
        const pegBounce = peg.finale ? b + 0.06 : b;
        ball.vx -= (1 + pegBounce) * vDot * nx;
        ball.vy -= (1 + pegBounce) * vDot * ny;
      }
      const kick = peg.finale ? 1.5 : 1.15;
      ball.vx += (Math.random() - 0.5) * kick;
      ball.vy += (Math.random() - 0.5) * (peg.finale ? 0.55 : 0.35);
      if (peg.bumper) {
        ball.vx += (peg.x < this.width / 2 ? 1 : -1) * 2.2;
        ball.vy -= 1.5;
      }
    }

    if (Math.abs(ball.y - ball.lastY) < 0.12 && Math.hypot(ball.vx, ball.vy) < 0.3) {
      ball.stuckFrames++;
      if (ball.stuckFrames > 120) {
        ball.y += 6;
        ball.vy = inFinale ? 1.8 : 2.2;
        ball.vx += (Math.random() - 0.5) * 2.5;
        ball.stuckFrames = 0;
      }
    } else {
      ball.stuckFrames = 0;
      ball.lastY = ball.y;
    }

    if (!ball.finished && ball.y > finishY) {
      ball.finished = true;
      ball.finishOrder = ++this.finishCount;
      ball.y = finishY;
      ball.vx *= 0.3;
      ball.vy = 0;
      this.onFinishOrder?.(ball, this.getFinishOrder());
    }
  };

  PinballEngine.prototype.step = function step() {
    const gravity = 0.28;
    const friction = 0.993;
    const bounce = 0.76;
    const substeps = 2;

    let anyNearFinish = false;
    for (let s = 0; s < substeps; s++) {
      this.balls.forEach((ball) => {
        if (ball.finished) return;
        this.stepBall(ball, gravity / substeps, friction, bounce);
        if (ball.nearFinish) anyNearFinish = true;
      });
    }
    if (anyNearFinish) {
      this.finalePulse = Math.min(1, this.finalePulse + 0.06);
    } else {
      this.finalePulse = Math.max(0, this.finalePulse - 0.02);
    }
  };

  PinballEngine.prototype.getFinishOrder = function getFinishOrder() {
    return [...this.balls]
      .filter((b) => b.finishOrder != null)
      .sort((a, b) => a.finishOrder - b.finishOrder);
  };

  PinballEngine.prototype.draw = function draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1a2744');
    bg.addColorStop(0.5, '#243352');
    bg.addColorStop(0.82, '#2a2848');
    bg.addColorStop(1, '#1e2d4a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const finaleGlow = ctx.createLinearGradient(0, this.bounds.finaleZone, 0, h);
    finaleGlow.addColorStop(0, 'rgba(255, 214, 10, 0)');
    finaleGlow.addColorStop(0.4, `rgba(255, 214, 10, ${0.06 + this.finalePulse * 0.12})`);
    finaleGlow.addColorStop(1, `rgba(255, 59, 48, ${0.04 + this.finalePulse * 0.08})`);
    ctx.fillStyle = finaleGlow;
    ctx.fillRect(10, this.bounds.finaleZone, w - 20, h - this.bounds.finaleZone - 10);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    const slotCount = Math.min(8, Math.max(4, this.balls.length));
    const slotW = (w - 40) / slotCount;
    for (let i = 0; i <= slotCount; i++) {
      const x = 20 + i * slotW;
      ctx.beginPath();
      ctx.moveTo(x, h - 56);
      ctx.lineTo(x, h - 16);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.stroke();
    }

    const goalPulse = 0.6 + Math.sin(this.frame * 0.14) * 0.4 * this.finalePulse;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = `rgba(255, 214, 10, ${0.55 + this.finalePulse * 0.45})`;
    ctx.lineWidth = 2.5 + this.finalePulse * 2;
    ctx.beginPath();
    ctx.moveTo(16, this.bounds.finishY);
    ctx.lineTo(w - 16, this.bounds.finishY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '700 12px Pretendard, sans-serif';
    ctx.fillStyle = `rgba(255, 214, 10, ${0.5 + goalPulse * 0.5})`;
    ctx.textAlign = 'center';
    const goalLabel = this.finalePulse > 0.3 ? '🔥 GOAL!' : 'GOAL';
    ctx.fillText(goalLabel, w / 2, this.bounds.finishY - 10);

    this.pegs.forEach((peg) => {
      const g = ctx.createRadialGradient(peg.x - 1, peg.y - 1, 0, peg.x, peg.y, peg.r);
      if (peg.bumper) {
        g.addColorStop(0, '#ffe566');
        g.addColorStop(0.5, '#ff9500');
        g.addColorStop(1, '#cc5200');
      } else if (peg.finale) {
        g.addColorStop(0, '#fff8e0');
        g.addColorStop(0.45, '#e8d4a8');
        g.addColorStop(1, '#a89060');
      } else {
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.45, '#c8d4e8');
        g.addColorStop(1, '#7a8aa8');
      }
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });

    const sorted = [...this.balls].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? 1 : -1;
      return b.y - a.y;
    });

    sorted.forEach((ball) => {
      if (ball.nearFinish && !ball.finished) {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r + 6 + Math.sin(this.frame * 0.2) * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 214, 10, ${0.15 + this.finalePulse * 0.2})`;
        ctx.fill();
      }

      const g = ctx.createRadialGradient(
        ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, ball.r * 0.1,
        ball.x, ball.y, ball.r
      );
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, ball.color);
      g.addColorStop(1, shadeColor(ball.color, -30));
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = ball.nearFinish ? 'rgba(255,214,10,0.7)' : 'rgba(0,0,0,0.2)';
      ctx.lineWidth = ball.nearFinish ? 2.5 : 1.5;
      ctx.stroke();

      drawBallLabel(ctx, ball);

      if (ball.frame < ball.releaseFrame) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '600 8px Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('READY', ball.x, ball.y - ball.r - 4);
      }

      if (ball.finishOrder != null) {
        ctx.fillStyle = '#FFD60A';
        ctx.font = '700 10px Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${ball.finishOrder}위`, ball.x, ball.y - ball.r - 6);
      }
    });
  };

  function drawBallLabel(ctx, ball) {
    const label = ball.displayLabel || String(ball.number);
    let fontSize = Math.max(8, Math.min(ball.r * 0.92, 12));
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let fits = false;
    while (fontSize >= 7) {
      ctx.font = `700 ${fontSize}px Pretendard, sans-serif`;
      if (ctx.measureText(label).width <= ball.r * 1.65) {
        fits = true;
        break;
      }
      fontSize -= 0.5;
    }
    if (!fits) {
      ctx.font = '700 7px Pretendard, sans-serif';
    }
    ctx.fillText(label, ball.x, ball.y);
  }

  function shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = clamp((num >> 16) + percent, 0, 255);
    const g = clamp(((num >> 8) & 0xff) + percent, 0, 255);
    const b = clamp((num & 0xff) + percent, 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  window.CTPinball = {
    PinballEngine,
    PINBALL_COLORS,
  };
})();
