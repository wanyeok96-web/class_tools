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

  function wallXAtY(x1, y1, x2, y2, y) {
    if (Math.abs(y2 - y1) < 0.001) return x1;
    const t = clamp((y - y1) / (y2 - y1), 0, 1);
    return x1 + (x2 - x1) * t;
  }

  function buildFunnelConfig(boardW, boardH) {
    const funnelStartY = boardH * 0.8;
    const finishY = boardH - 56;
    const inset = 14;
    return {
      funnelStartY,
      finishY,
      wallLeftTop: inset,
      wallRightTop: boardW - inset,
      wallLeftBottom: boardW * 0.31,
      wallRightBottom: boardW * 0.69,
      leftWall: { x1: inset, y1: funnelStartY, x2: boardW * 0.31, y2: finishY },
      rightWall: { x1: boardW - inset, y1: funnelStartY, x2: boardW * 0.69, y2: finishY },
    };
  }

  function pegInsideFunnel(x, y, funnel, boardW) {
    if (y < funnel.funnelStartY) return true;
    const lw = wallXAtY(funnel.leftWall.x1, funnel.leftWall.y1, funnel.leftWall.x2, funnel.leftWall.y2, y);
    const rw = wallXAtY(funnel.rightWall.x1, funnel.rightWall.y1, funnel.rightWall.x2, funnel.rightWall.y2, y);
    const pad = 8;
    return x > lw + pad && x < rw - pad;
  }

  function buildPegs(boardW, boardH) {
    const pegs = [];
    const marginX = 22;
    const marginTop = 96;
    const marginBottom = 100;
    const usableW = boardW - marginX * 2;
    const usableH = boardH - marginTop - marginBottom;
    const pegR = Math.max(3.5, boardW * 0.007);
    const funnel = buildFunnelConfig(boardW, boardH);

    const addRow = (y, cols, stagger, finale) => {
      const colGap = usableW / (cols - 1);
      const offset = stagger ? colGap / 2 : 0;
      const count = stagger ? cols - 1 : cols;
      for (let c = 0; c < count; c++) {
        const x = marginX + offset + c * colGap;
        if (!pegInsideFunnel(x, y, funnel, boardW)) continue;
        pegs.push({
          x,
          y,
          r: pegR * (finale ? 1.05 : 1),
          finale: !!finale,
        });
      }
    };

    const mainRows = 17;
    const mainCols = 13;
    const rowGap = usableH * 0.52 / (mainRows - 1);
    for (let r = 0; r < mainRows; r++) {
      const y = marginTop + r * rowGap;
      if (y >= funnel.funnelStartY - pegR * 2) break;
      addRow(y, mainCols, r % 2 === 1, false);
    }

    const finaleTop = marginTop + usableH * 0.52;
    const finaleEnd = funnel.funnelStartY - rowGap * 0.6;
    const finaleRows = 5;
    const finaleCols = 15;
    const finaleSpan = Math.max(rowGap, finaleEnd - finaleTop);
    const finaleGap = finaleSpan / Math.max(1, finaleRows - 1);
    for (let r = 0; r < finaleRows; r++) {
      const y = finaleTop + r * finaleGap;
      if (y >= funnel.funnelStartY - pegR) break;
      addRow(y, finaleCols, r % 2 === 1, true);
    }

    // 깔때기 구간 — 좁아지는 통로 안쪽 핀 3줄
    const funnelRows = 3;
    const funnelGap = (funnel.finishY - funnel.funnelStartY) / (funnelRows + 1);
    for (let r = 1; r <= funnelRows; r++) {
      const y = funnel.funnelStartY + r * funnelGap;
      const lw = wallXAtY(funnel.leftWall.x1, funnel.leftWall.y1, funnel.leftWall.x2, funnel.leftWall.y2, y);
      const rw = wallXAtY(funnel.rightWall.x1, funnel.rightWall.y1, funnel.rightWall.x2, funnel.rightWall.y2, y);
      const span = rw - lw;
      const cols = 7;
      const fGap = span / (cols - 1);
      for (let c = 0; c < cols; c++) {
        pegs.push({
          x: lw + c * fGap,
          y,
          r: pegR * 1.08,
          finale: true,
        });
      }
    }

    const bumperR = pegR * 1.8;
    const bumperY = boardH - marginBottom + 18;
    const bLw = wallXAtY(funnel.leftWall.x1, funnel.leftWall.y1, funnel.leftWall.x2, funnel.leftWall.y2, bumperY);
    const bRw = wallXAtY(funnel.rightWall.x1, funnel.rightWall.y1, funnel.rightWall.x2, funnel.rightWall.y2, bumperY);
    [bLw, bRw].forEach((bx) => {
      pegs.push({
        x: bx,
        y: bumperY,
        r: bumperR,
        finale: true,
        bumper: true,
      });
    });

    return pegs;
  }

  function buildBars(boardW, boardH) {
    const marginX = 22;
    const marginTop = 96;
    const marginBottom = 100;
    const usableW = boardW - marginX * 2;
    const usableH = boardH - marginTop - marginBottom;

    const mk = (cxPct, cyPct, halfLenPct, speed, mode, extra = {}) => ({
      cx: marginX + usableW * cxPct,
      cy: marginTop + usableH * cyPct,
      halfLen: usableW * halfLenPct,
      angle: extra.angle || 0,
      speed,
      mode,
      dir: extra.dir ?? 1,
      swingMax: extra.swingMax ?? 0.7,
      swingPhase: extra.swingPhase ?? 0,
      thickness: extra.thickness ?? Math.max(6, boardW * 0.011),
      angularVel: 0,
      hitFlash: 0,
    });

    return [
      // ── 왼쪽 구역 ──
      mk(0.1, 0.17, 0.19, 0.034, 'spin', { dir: 1, angle: 0.45 }),
      mk(0.16, 0.36, 0.16, 0.026, 'swing', { swingMax: 0.95, swingPhase: 0.3 }),
      mk(0.11, 0.56, 0.18, 0.031, 'spin', { dir: -1, angle: -0.6 }),

      // ── 중앙 (짧게, 보조용) ──
      mk(0.5, 0.28, 0.1, 0.022, 'swing', { swingMax: 0.6, swingPhase: 2.2, thickness: 7 }),
      mk(0.48, 0.58, 0.11, 0.024, 'spin', { dir: 1, angle: 0.9 }),

      // ── 오른쪽 구역 ──
      mk(0.9, 0.2, 0.19, 0.036, 'spin', { dir: -1, angle: -0.35 }),
      mk(0.84, 0.39, 0.16, 0.027, 'swing', { swingMax: 0.92, swingPhase: 1.1 }),
      mk(0.89, 0.58, 0.18, 0.033, 'spin', { dir: 1, angle: 0.55 }),
    ];
  }

  function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) return { x: x1, y: y1 };
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
    return { x: x1 + t * dx, y: y1 + t * dy };
  }

  function spawnParticles(engine, x, y, color, count) {
    if (!engine.particles) engine.particles = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 3.5;
      engine.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 18 + Math.random() * 14,
        color: color || '#fff',
        r: 1.5 + Math.random() * 2,
      });
    }
    if (engine.particles.length > 80) {
      engine.particles.splice(0, engine.particles.length - 80);
    }
  }

  function getBallGivenName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '?';
    if (trimmed.length <= 1) return trimmed;
    return trimmed.slice(1);
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
      displayLabel: getBallGivenName(student.name),
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
      trail: [],
    }));
  }

  function PinballEngine(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.pegs = [];
    this.bars = [];
    this.particles = [];
    this.balls = [];
    this.bounds = { left: 0, right: 0, finishY: 0 };
    this.running = false;
    this.rafId = 0;
    this.finishCount = 0;
    this.winnerCount = 1;
    this.frame = 0;
    this.finalePulse = 0;
    this.shakeFramesLeft = 0;
    this.shakeIntensity = 0;
    this.shakeCooldownUntil = 0;
    this.onFinishOrder = null;
    this.onComplete = null;
    this.onFrame = null;
    this.onShake = null;
    this._idleRaf = 0;
    this.cameraFollowEnabled = false;
    this.tallBoard = false;
    this.cameraBlend = 0;
    this.cameraY = 0;
    this.cameraLeader = null;
  }

  PinballEngine.prototype.startIdlePreview = function startIdlePreview() {
    if (this._idleRaf) cancelAnimationFrame(this._idleRaf);
    const tick = () => {
      if (this.running) {
        this._idleRaf = 0;
        return;
      }
      this.updateBars();
      this.draw();
      this._idleRaf = requestAnimationFrame(tick);
    };
    this._idleRaf = requestAnimationFrame(tick);
  };

  PinballEngine.prototype.stopIdlePreview = function stopIdlePreview() {
    if (this._idleRaf) cancelAnimationFrame(this._idleRaf);
    this._idleRaf = 0;
  };

  PinballEngine.prototype.resize = function resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const cssW = Math.max(320, Math.floor(rect?.width || 640));
    const aspect = this.tallBoard ? 1.38 : 0.92;
    const minH = this.tallBoard ? 620 : 500;
    const cssH = Math.max(minH, Math.floor(cssW * aspect));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.pegs = buildPegs(cssW, cssH);
    this.bars = buildBars(cssW, cssH);
    this.funnel = buildFunnelConfig(cssW, cssH);
    this.bounds = {
      left: 14,
      right: cssW - 14,
      finishY: cssH - 56,
      finaleZone: cssH * 0.68,
      funnelStartY: cssH * 0.8,
    };
  };

  PinballEngine.prototype.applyWallCollisions = function applyWallCollisions(ball, bounce) {
    const fc = this.funnel;
    const inset = 14;

    if (ball.y < fc.funnelStartY) {
      if (ball.x - ball.r < inset) {
        ball.x = inset + ball.r;
        ball.vx = Math.abs(ball.vx) * bounce;
      }
      if (ball.x + ball.r > this.width - inset) {
        ball.x = this.width - inset - ball.r;
        ball.vx = -Math.abs(ball.vx) * bounce;
      }
      return;
    }

    const lw = wallXAtY(fc.leftWall.x1, fc.leftWall.y1, fc.leftWall.x2, fc.leftWall.y2, ball.y);
    const rw = wallXAtY(fc.rightWall.x1, fc.rightWall.y1, fc.rightWall.x2, fc.rightWall.y2, ball.y);
    const leftLimit = lw + ball.r;
    const rightLimit = rw - ball.r;

    if (ball.x < leftLimit) {
      ball.x = leftLimit;
      ball.vx = Math.abs(ball.vx) * bounce;
      ball.vy += 0.4;
    }
    if (ball.x > rightLimit) {
      ball.x = rightLimit;
      ball.vx = -Math.abs(ball.vx) * bounce;
      ball.vy += 0.4;
    }
  };

  PinballEngine.prototype.setup = function setup(participants, winnerCount) {
    this.resize();
    this.balls = createBalls(participants, this.width);
    this.finishCount = 0;
    this.winnerCount = Math.max(1, winnerCount || 1);
    this.frame = 0;
    this.finalePulse = 0;
    this.shakeFramesLeft = 0;
    this.shakeIntensity = 0;
    this.shakeCooldownUntil = 0;
    this.particles = [];
    this.cameraBlend = 0;
    this.cameraY = this.height * 0.42;
    this.cameraLeader = null;
    this.running = false;
    this.draw();
    this.startIdlePreview();
  };

  PinballEngine.prototype.reset = function reset() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.finishCount = 0;
    this.frame = 0;
    this.finalePulse = 0;
    this.shakeFramesLeft = 0;
    this.shakeIntensity = 0;
    this.shakeCooldownUntil = 0;
    this.particles = [];
    this.cameraBlend = 0;
    this.cameraY = this.height * 0.42;
    this.cameraLeader = null;
    this.balls.forEach((b) => {
      b.finished = false;
      b.finishOrder = null;
      b.stuckFrames = 0;
      b.nearFinish = false;
      b.trail = [];
    });
    this.draw();
    this.startIdlePreview();
  };

  PinballEngine.prototype.getRaceLeader = function getRaceLeader() {
    const active = this.balls.filter((b) => !b.finished && b.frame >= b.releaseFrame);
    if (active.length) {
      return active.reduce((best, b) => (b.y > best.y ? b : best), active[0]);
    }
    const finished = this.getFinishOrder();
    return finished.length ? finished[0] : null;
  };

  PinballEngine.prototype.updateCamera = function updateCamera() {
    if (!this.cameraFollowEnabled || !this.running) return;

    const leader = this.getRaceLeader();
    this.cameraLeader = leader;
    const threshold = this.height * 0.34;

    if (!leader || leader.y < threshold) {
      this.cameraBlend = Math.max(0, this.cameraBlend - 0.028);
      return;
    }

    this.cameraBlend = Math.min(1, this.cameraBlend + 0.02);
    const targetY = leader.y;
    this.cameraY += (targetY - this.cameraY) * 0.075;

    const zoom = 1 + this.cameraBlend * 0.8;
    const viewHalf = (this.height / zoom) / 2;
    this.cameraY = clamp(this.cameraY, viewHalf - 16, this.height - viewHalf + 16);
  };

  PinballEngine.prototype.updateBars = function updateBars() {
    this.bars.forEach((bar) => {
      if (bar.mode === 'spin') {
        bar.angle += bar.speed * bar.dir;
        bar.angularVel = bar.speed * bar.dir;
      } else if (bar.mode === 'swing') {
        bar.swingPhase += bar.speed;
        bar.angle = Math.sin(bar.swingPhase) * bar.swingMax;
        bar.angularVel = Math.cos(bar.swingPhase) * bar.speed * bar.swingMax;
      }
      if (bar.hitFlash > 0) bar.hitFlash--;
    });
  };

  PinballEngine.prototype.collideBallBar = function collideBallBar(ball, bar, bounce) {
    const cos = Math.cos(bar.angle);
    const sin = Math.sin(bar.angle);
    const x1 = bar.cx - cos * bar.halfLen;
    const y1 = bar.cy - sin * bar.halfLen;
    const x2 = bar.cx + cos * bar.halfLen;
    const y2 = bar.cy + sin * bar.halfLen;

    const cp = closestPointOnSegment(ball.x, ball.y, x1, y1, x2, y2);
    const dx = ball.x - cp.x;
    const dy = ball.y - cp.y;
    const dist = Math.hypot(dx, dy);
    const minDist = ball.r + bar.thickness / 2;
    if (dist >= minDist || dist < 0.001) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const vDot = ball.vx * nx + ball.vy * ny;
    if (vDot < 0) {
      const barBounce = bounce + 0.14;
      ball.vx -= (1 + barBounce) * vDot * nx;
      ball.vy -= (1 + barBounce) * vDot * ny;
    }

    const tangentX = -sin;
    const tangentY = cos;
    const barSurfaceVel = bar.angularVel * bar.halfLen;
    ball.vx += tangentX * barSurfaceVel * 0.35;
    ball.vy += tangentY * barSurfaceVel * 0.35;
    ball.vx += (Math.random() - 0.5) * 2.8;
    ball.vy += (Math.random() - 0.5) * 2;

    bar.hitFlash = 14;
    spawnParticles(this, cp.x, cp.y, bar.mode === 'swing' ? '#ff8ec8' : '#7ee8ff', 5);
    return true;
  };

  PinballEngine.prototype.shake = function shake() {
    if (!this.running) return false;
    if (this.frame < this.shakeCooldownUntil) return false;

    this.shakeCooldownUntil = this.frame + 72;
    this.shakeFramesLeft = 28;
    this.shakeIntensity = 1;

    this.balls.forEach((ball) => {
      if (ball.finished || ball.frame < ball.releaseFrame) return;
      const stuckMul = ball.stuckFrames > 20 ? 1.9 : 1;
      ball.vx += (Math.random() - 0.5) * 11 * stuckMul;
      ball.vy += (Math.random() - 0.5) * 9 * stuckMul - 2;
      ball.stuckFrames = 0;
      ball.lastY = ball.y - 8;
    });
    this.bars.forEach((bar) => {
      bar.hitFlash = 10;
      if (bar.mode === 'spin') bar.dir *= -1;
    });
    spawnParticles(this, this.width / 2, this.height * 0.45, '#ffd60a', 16);

    this.onShake?.();
    return true;
  };

  PinballEngine.prototype.start = function start(callbacks) {
    if (this.running || !this.balls.length) return;
    this.onFinishOrder = callbacks?.onFinishOrder;
    this.onComplete = callbacks?.onComplete;
    this.onFrame = callbacks?.onFrame;
    this.onShake = callbacks?.onShake;
    this.stopIdlePreview();
    this.running = true;
    this.finishCount = 0;
    this.frame = 0;
    this.finalePulse = 0;
    this.shakeFramesLeft = 0;
    this.shakeIntensity = 0;
    this.shakeCooldownUntil = 0;
    this.particles = [];
    this.cameraBlend = 0;
    this.cameraY = this.height * 0.42;
    this.cameraLeader = null;
    this.balls.forEach((b, i) => {
      b.finished = false;
      b.finishOrder = null;
      b.stuckFrames = 0;
      b.nearFinish = false;
      b.trail = [];
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
    this.startIdlePreview();
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
      this.startIdlePreview();
      return;
    }
    this.rafId = requestAnimationFrame(() => this.loop());
  };

  PinballEngine.prototype.stepBall = function stepBall(ball, gravity, friction, bounce) {
    const { finishY, finaleZone } = this.bounds;

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

    this.applyWallCollisions(ball, b);

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
        spawnParticles(this, peg.x, peg.y, '#ffcc00', 6);
      } else if (peg.finale && Math.random() < 0.12) {
        spawnParticles(this, ball.x, ball.y, '#e8d4a8', 2);
      }
    }

    for (let j = 0; j < this.bars.length; j++) {
      this.collideBallBar(ball, this.bars[j], b);
    }

    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 1.2 && ball.frame % 2 === 0) {
      if (!ball.trail) ball.trail = [];
      ball.trail.push({ x: ball.x, y: ball.y, alpha: 0.55, color: ball.color });
      if (ball.trail.length > 10) ball.trail.shift();
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

  PinballEngine.prototype.stepParticles = function stepParticles() {
    if (!this.particles.length) return;
    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.vx *= 0.96;
      p.life -= 1;
      return p.life > 0;
    });
  };

  PinballEngine.prototype.step = function step() {
    const gravity = 0.28;
    const friction = 0.993;
    const bounce = 0.76;
    const substeps = 2;

    this.updateBars();
    this.updateCamera();
    this.stepParticles();
    this.balls.forEach((ball) => {
      if (ball.trail?.length) {
        ball.trail.forEach((t) => { t.alpha *= 0.88; });
        ball.trail = ball.trail.filter((t) => t.alpha > 0.08);
      }
    });

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

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeFramesLeft > 0) {
      shakeX = (Math.random() - 0.5) * 16 * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * 14 * this.shakeIntensity;
      this.shakeFramesLeft--;
      this.shakeIntensity *= 0.86;
      if (this.shakeFramesLeft <= 0) this.shakeIntensity = 0;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    const camZoom = 1 + this.cameraBlend * 0.8;
    const camFocusY = this.cameraBlend > 0 ? this.cameraY : h * 0.42;

    ctx.save();
    if (this.cameraFollowEnabled && this.cameraBlend > 0.01) {
      ctx.translate(w / 2, h / 2);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-w / 2, -camFocusY);
    }

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

    drawFunnel(ctx, this.funnel, w, h, this.finalePulse, this.frame);

    const slotCount = Math.min(8, Math.max(4, this.balls.length));
    const slotLeft = this.funnel.wallLeftBottom;
    const slotRight = this.funnel.wallRightBottom;
    const slotW = (slotRight - slotLeft) / slotCount;
    for (let i = 0; i <= slotCount; i++) {
      const x = slotLeft + i * slotW;
      ctx.beginPath();
      ctx.moveTo(x, h - 56);
      ctx.lineTo(x, h - 16);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const goalPulse = 0.6 + Math.sin(this.frame * 0.14) * 0.4 * this.finalePulse;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = `rgba(255, 214, 10, ${0.55 + this.finalePulse * 0.45})`;
    ctx.lineWidth = 2.5 + this.finalePulse * 2;
    ctx.beginPath();
    ctx.moveTo(slotLeft + 4, this.bounds.finishY);
    ctx.lineTo(slotRight - 4, this.bounds.finishY);
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

    this.bars.forEach((bar) => drawBar(ctx, bar));

    this.particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (p.life / 24), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = clamp(p.life / 24, 0, 1);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

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

      (ball.trail || []).forEach((t) => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, ball.r * 0.72, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.globalAlpha = t.alpha * 0.35;
        ctx.fill();
      });
      ctx.globalAlpha = 1;

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

    const leader = this.cameraLeader;
    if (this.cameraFollowEnabled && this.cameraBlend > 0.35 && leader && !leader.finished) {
      ctx.beginPath();
      ctx.arc(
        leader.x, leader.y,
        leader.r + 11 + Math.sin(this.frame * 0.22) * 3,
        0, Math.PI * 2
      );
      ctx.strokeStyle = `rgba(255, 214, 10, ${0.45 + this.cameraBlend * 0.55})`;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(leader.x, leader.y - leader.r - 16, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 214, 10, ${0.7 + this.cameraBlend * 0.3})`;
      ctx.fill();
    }

    ctx.restore();

    if (this.cameraFollowEnabled && this.cameraBlend > 0.2) {
      drawCameraHud(ctx, this, w, h);
    }

    ctx.restore();
  };

  function drawCameraHud(ctx, engine, w, h) {
    const leader = engine.cameraLeader;
    const blend = engine.cameraBlend;
    if (!leader) return;

    ctx.save();
    ctx.globalAlpha = blend;

    const grad = ctx.createLinearGradient(0, 0, 0, 80);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, 80);

    ctx.fillStyle = 'rgba(255, 214, 10, 0.92)';
    ctx.font = '700 13px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎬 1위 추적', 18, 28);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 14px Pretendard, sans-serif';
    ctx.textAlign = 'right';
    const label = leader.displayLabel || getBallGivenName(leader.name);
    ctx.fillText(label, w - 18, 28);

    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, h * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, `rgba(0,0,0,${0.35 * blend})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  function drawFunnel(ctx, fc, w, h, finalePulse, frame) {
    const pulse = 0.45 + Math.sin(frame * 0.1) * 0.15 * finalePulse;

    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.moveTo(0, fc.funnelStartY);
    ctx.lineTo(fc.wallLeftTop, fc.funnelStartY);
    ctx.lineTo(fc.wallLeftBottom, fc.finishY);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w, fc.funnelStartY);
    ctx.lineTo(fc.wallRightTop, fc.funnelStartY);
    ctx.lineTo(fc.wallRightBottom, fc.finishY);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, fc.funnelStartY - 10);

    const wallGrad = ctx.createLinearGradient(0, fc.funnelStartY, 0, fc.finishY);
    wallGrad.addColorStop(0, `rgba(255, 214, 10, ${0.35 + pulse * 0.3})`);
    wallGrad.addColorStop(1, `rgba(255, 149, 0, ${0.55 + pulse * 0.4})`);

    ctx.strokeStyle = wallGrad;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fc.leftWall.x1, fc.leftWall.y1);
    ctx.lineTo(fc.leftWall.x2, fc.leftWall.y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fc.rightWall.x1, fc.rightWall.y1);
    ctx.lineTo(fc.rightWall.x2, fc.rightWall.y2);
    ctx.stroke();

    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = `rgba(255, 214, 10, ${0.25 + pulse * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fc.wallLeftTop, fc.funnelStartY);
    ctx.lineTo(fc.wallRightTop, fc.funnelStartY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '600 10px Pretendard, sans-serif';
    ctx.fillStyle = `rgba(255, 214, 10, ${0.35 + pulse * 0.35})`;
    ctx.textAlign = 'center';
    ctx.fillText('▼ FUNNEL', w / 2, fc.funnelStartY - 8);
  }

  function drawBar(ctx, bar) {
    const cos = Math.cos(bar.angle);
    const sin = Math.sin(bar.angle);
    const x1 = bar.cx - cos * bar.halfLen;
    const y1 = bar.cy - sin * bar.halfLen;
    const x2 = bar.cx + cos * bar.halfLen;
    const y2 = bar.cy + sin * bar.halfLen;
    const flash = bar.hitFlash > 0 ? bar.hitFlash / 14 : 0;
    const isSwing = bar.mode === 'swing';
    const hueA = isSwing ? '#ff5e9a' : '#38bdf8';
    const hueB = isSwing ? '#ff9ec7' : '#7dd3fc';

    ctx.save();
    ctx.lineCap = 'round';

    if (flash > 0) {
      ctx.shadowColor = isSwing ? '#ff6b9d' : '#5eead4';
      ctx.shadowBlur = 16 * flash;
    }

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, hueA);
    grad.addColorStop(0.5, flash > 0.3 ? '#ffffff' : hueB);
    grad.addColorStop(1, hueA);

    ctx.strokeStyle = grad;
    ctx.lineWidth = bar.thickness + flash * 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(bar.cx, bar.cy, 3.5 + flash, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.45 + flash * 0.55})`;
    ctx.fill();

    if (bar.mode === 'spin') {
      const tipX = bar.cx + cos * (bar.halfLen + 6);
      const tipY = bar.cy + sin * (bar.halfLen + 6);
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }

    ctx.restore();
  }

  function drawBallLabel(ctx, ball) {
    const label = ball.displayLabel || getBallGivenName(ball.name);
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
    getBallGivenName,
  };
})();
