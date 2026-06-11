/**
 * Class Tools — 랜덤 게임 UI
 */
(function () {
  'use strict';

  const CT_GAMES = [
    { id: 'ladder', icon: '🪜', title: '사다리 게임', desc: '사다리타기로 선정' },
    { id: 'slot', icon: '🎰', title: '슬롯머신', desc: '릴을 돌려 추첨' },
    { id: 'card', icon: '🃏', title: '카드뽑기', desc: '카드 한 장 뽑기' },
    { id: 'treasure', icon: '📦', title: '보물상자', desc: '보상이 쏟아지는 이벤트' },
    { id: 'dice', icon: '🎲', title: '주사위 게임', desc: '주사위를 굴려보세요' },
    { id: 'roulette', icon: '🎡', title: '룰렛', desc: '돌려서 당첨' },
    { id: 'pinball', icon: '🕹️', title: '핀볼', desc: '구슬 경주로 선정' },
    { id: 'scoreboard', icon: '🏆', title: '스코어보드', desc: '팀별 점수 관리' },
  ];

  let host = {};
  let currentGameId = null;
  let ladderState = { built: false, rungs: null, participants: [], winningBottoms: new Set(), paths: [], layout: null };
  let ladderAnimating = false;
  let slotSpinning = false;
  let cardDeck = [];
  let cardPickedOrder = [];
  let cardFlipped = new Set();
  let cardShuffling = false;
  let treasureOpening = false;
  let pinballEngine = null;
  let pinballRunning = false;
  let pinballExcluded = new Set();
  let pinballResizeBound = false;
  let scoreboardData = ctLoadScoreboard();

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function toast(msg) {
    host.showToast?.(msg);
  }

  function esc(str) {
    return host.esc?.(str) ?? String(str ?? '');
  }

  function getStudents() {
    return host.getStudents?.() || [];
  }

  function getClassId() {
    return host.getClassId?.() || null;
  }

  function getPickCount() {
    const n = parseInt($('#gamePickCount')?.value, 10) || 1;
    return Math.max(1, Math.min(5, n));
  }

  function noDuplicate() {
    return $('#gameNoDuplicate')?.checked !== false;
  }

  function formatStudent(s) {
    return `${s.number}. ${s.name}`;
  }

  function renderWinnerHtml(students) {
    if (!students.length) return '<p class="game-result__placeholder">결과가 없습니다</p>';
    return students.map((s) =>
      `<div class="game-winner">${esc(formatStudent(s))}</div>`
    ).join('');
  }

  function pickStudents(pool, count) {
    const items = [...pool];
    return ctPickRandom(items, count, !noDuplicate());
  }

  function showLobby() {
    currentGameId = null;
    const lobby = $('#gamesLobby');
    const view = $('#gamesView');
    if (lobby) lobby.hidden = false;
    if (view) view.hidden = true;
    $$('.game-screen').forEach((el) => { el.hidden = true; });
  }

  function openGame(gameId) {
    const students = getStudents();
    const needsStudents = ['ladder', 'slot', 'card', 'roulette', 'pinball'].includes(gameId);
    if (needsStudents && !students.length) {
      toast('학생 명단이 없습니다. 관리실에서 등록해주세요.');
      return;
    }
    if (gameId === 'treasure') {
      const rewards = host.getTreasureRewards?.() || [];
      if (!rewards.length) {
        toast('관리실에서 보물상자 보상을 등록해주세요.');
        return;
      }
    }
    const game = CT_GAMES.find((g) => g.id === gameId);
    if (!game) return;

    currentGameId = gameId;
    $('#gamesLobby').hidden = true;
    $('#gamesView').hidden = false;
    const title = $('#gamesViewTitle');
    if (title) title.textContent = `${game.icon} ${game.title}`;

    $$('.game-screen').forEach((el) => { el.hidden = true; });
    const common = $('#gameCommonOptions');
    if (common) common.hidden = ['ladder', 'roulette', 'treasure', 'dice', 'pinball', 'scoreboard'].includes(gameId);

    const screen = $(`#gameScreen${capitalize(gameId)}`);
    if (screen) screen.hidden = false;

    const inits = {
      ladder: initLadderGame,
      slot: initSlotGame,
      card: initCardGame,
      treasure: initTreasureGame,
      dice: initDiceGame,
      roulette: initRouletteGame,
      pinball: initPinballGame,
      scoreboard: initScoreboardGame,
    };
    inits[gameId]?.();
  }

  function capitalize(id) {
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function renderLobbyGrid() {
    const grid = $('#gamesGrid');
    if (!grid) return;
    grid.innerHTML = CT_GAMES.map((g) => `
      <button type="button" class="game-card card" data-game="${g.id}">
        <span class="game-card__icon">${g.icon}</span>
        <span class="game-card__title">${esc(g.title)}</span>
        <span class="game-card__desc">${esc(g.desc)}</span>
      </button>
    `).join('');
  }

  /* ── 사다리 ── */
  function getLadderParticipants() {
    const students = getStudents();
    const classId = getClassId();
    const ids = ctLoadLadderPool(classId, students.map((s) => s.id));
    return students.filter((s) => ids.includes(s.id));
  }

  function getLadderWinnerCount(participantCount) {
    const max = Math.max(1, Math.min(5, participantCount || 5));
    const input = $('#ladderWinnerCount');
    const n = parseInt(input?.value, 10) || 1;
    return Math.max(1, Math.min(max, n));
  }

  function resetLadderBoard() {
    ladderState.built = false;
    const board = $('#ladderBoard');
    if (board) board.innerHTML = '<p class="ladder-placeholder">사다리를 만든 후 시작하세요</p>';
    const btnStart = $('#btnLadderStart');
    const btnBuild = $('#btnLadderBuild');
    if (btnStart) btnStart.disabled = true;
    if (btnBuild) btnBuild.disabled = getLadderParticipants().length < 2;
  }

  function switchLadderTab(tabId) {
    $$('.ladder-tab').forEach((btn) => {
      const active = btn.dataset.ladderTab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('#ladderTabParticipants').hidden = tabId !== 'participants';
    $('#ladderTabWinners').hidden = tabId !== 'winners';
  }

  function updateLadderWinnerHint() {
    const hint = $('#ladderWinnerHint');
    if (!hint) return;
    const count = getLadderParticipants().length;
    const w = getLadderWinnerCount(count);
    hint.textContent = count
      ? `참가자 ${count}명 · 당첨 ${w}명 (도착 칸 ${w}개가 선정)`
      : '참가자를 먼저 선택해주세요.';
  }

  function renderLadderWinnerSettings({ resetValue = true } = {}) {
    const participants = getLadderParticipants();
    const classId = getClassId();
    const count = participants.length;
    const maxWin = Math.max(1, Math.min(5, count || 5));
    const input = $('#ladderWinnerCount');
    if (input) {
      input.max = String(maxWin);
      input.min = '1';
      input.disabled = count < 1;
      if (resetValue || document.activeElement !== input) {
        const saved = ctLoadLadderWinCount(classId, maxWin);
        input.value = String(Math.min(saved, maxWin));
      } else {
        const current = parseInt(input.value, 10);
        if (!current || current < 1) input.value = '1';
        else if (current > maxWin) input.value = String(maxWin);
      }
    }
    updateLadderWinnerHint();
  }

  function ladderPieceBadgeHtml(colIndex, student, className = 'ladder-pool-item__badge') {
    const piece = ctGetLadderPieceMeta(colIndex, student);
    return `<span class="${className}" style="--badge-color:${piece.color}" aria-hidden="true">${esc(piece.char)}</span>`;
  }

  function ladderPieceSvg(x, y, colIndex, student, isWinner) {
    const piece = ctGetLadderPieceMeta(colIndex, student);
    const r = isWinner ? 16 : 14;
    const cls = isWinner ? 'ladder-piece ladder-piece--winner' : 'ladder-piece';
    return `
      <g class="${cls}" transform="translate(${x}, ${y})">
        <circle class="ladder-piece__circle" r="${r}" fill="${piece.color}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>
        <text class="ladder-piece__char" text-anchor="middle" dominant-baseline="central">${esc(piece.char)}</text>
      </g>`;
  }

  function renderLadderPool() {
    const students = getStudents();
    const classId = getClassId();
    const poolIds = new Set(ctLoadLadderPool(classId, students.map((s) => s.id)));
    const grid = $('#ladderPoolGrid');
    const summary = $('#ladderPoolSummary');
    const btnBuild = $('#btnLadderBuild');

    if (!grid) return;

    if (!students.length) {
      grid.innerHTML = '<p class="field-hint">학생 명단이 없습니다.</p>';
      if (summary) summary.textContent = '';
      if (btnBuild) btnBuild.disabled = true;
      renderLadderWinnerSettings();
      return;
    }

    const selectedOrder = students.filter((s) => poolIds.has(s.id));
    grid.innerHTML = students.map((s) => {
      const col = selectedOrder.findIndex((p) => p.id === s.id);
      const badge = col >= 0
        ? ladderPieceBadgeHtml(col, s)
        : '<span class="ladder-pool-item__badge ladder-pool-item__badge--empty" aria-hidden="true">·</span>';
      return `
      <label class="ladder-pool-item">
        <input type="checkbox" class="ladder-pool-check" value="${esc(s.id)}" ${poolIds.has(s.id) ? 'checked' : ''} />
        ${badge}
        <span>${esc(formatStudent(s))}</span>
      </label>`;
    }).join('');

    const selected = grid.querySelectorAll('.ladder-pool-check:checked').length;
    if (summary) summary.textContent = `선택 ${selected}명 / 전체 ${students.length}명`;
    if (btnBuild) btnBuild.disabled = selected < 2;

    grid.querySelectorAll('.ladder-pool-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const ids = [...grid.querySelectorAll('.ladder-pool-check:checked')].map((c) => c.value);
        ctSaveLadderPool(classId, ids);
        resetLadderBoard();
        renderLadderPool();
      });
    });
    renderLadderWinnerSettings();
  }

  function initLadderGame() {
    ladderState = { built: false, rungs: null, participants: [], winningBottoms: new Set(), paths: [], layout: null };
    ladderAnimating = false;
    switchLadderTab('participants');
    renderLadderPool();
    resetLadderBoard();
  }

  function computeLadderLayout(n, levels) {
    const colW = Math.max(40, Math.min(58, 520 / n));
    const rowH = 24;
    const padX = 28;
    const padTop = 52;
    const padBot = 48;
    const w = padX * 2 + colW * Math.max(n - 1, 0);
    const h = padTop + rowH * levels + padBot;
    return { colW, rowH, padX, padTop, padBot, levels, n, w, h };
  }

  function buildLadder() {
    const participants = getLadderParticipants();
    if (participants.length < 2) {
      toast('사다리 게임은 최소 2명 이상 선택해주세요.');
      return;
    }
    const n = participants.length;
    const winnerCount = getLadderWinnerCount(n);
    const rungs = ctGenerateLadder(n);
    const levels = rungs.length;
    const layout = computeLadderLayout(n, levels);
    const winningBottoms = new Set(ctPickWinningBottomSlots(n, winnerCount));

    const paths = [];
    for (let c = 0; c < n; c++) {
      paths.push(ctBuildLadderPathPoints(
        rungs, c, layout.padX, layout.padTop, layout.colW, layout.rowH, levels
      ));
    }

    ladderState = { built: true, rungs, participants, winningBottoms, paths, layout };
    drawLadderSvg(null);
    const btnStart = $('#btnLadderStart');
    if (btnStart) btnStart.disabled = false;
    toast('사다리가 준비되었습니다. 시작! 버튼을 눌러주세요.');
  }

  function drawLadderSvg(progresses) {
    const board = $('#ladderBoard');
    if (!board || !ladderState.built) return;

    const { rungs, participants, winningBottoms, paths, layout } = ladderState;
    const { colW, rowH, padX, padTop, levels, n, w, h } = layout;

    let svg = `<svg class="ladder-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="사다리">`;

    for (let c = 0; c < n; c++) {
      const x = padX + c * colW;
      svg += `<line class="ladder-rail" x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop + rowH * levels}" />`;
    }

    for (let l = 0; l < levels; l++) {
      const y = padTop + rowH * (l + 0.5);
      rungs[l].forEach((c) => {
        const x1 = padX + c * colW;
        const x2 = padX + (c + 1) * colW;
        svg += `<line class="ladder-rung" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" />`;
      });
    }

    for (let c = 0; c < n; c++) {
      const x = padX + c * colW;
      const isWin = winningBottoms.has(c);
      const label = participants[c].name.length > 5
        ? participants[c].name.slice(0, 4) + '…'
        : participants[c].name;
      svg += `<text class="ladder-label ladder-label--top" x="${x}" y="18" text-anchor="middle">${esc(label)}</text>`;
      const bottom = isWin ? '🎉 선정' : '—';
      const cls = isWin ? 'ladder-label--win' : '';
      svg += `<text class="ladder-label ladder-label--bottom ${cls}" x="${x}" y="${padTop + rowH * levels + 30}" text-anchor="middle">${bottom}</text>`;
    }

    participants.forEach((s, c) => {
      const t = progresses ? (progresses[c] ?? 0) : 0;
      const pos = ctInterpolatePath(paths[c].points, t);
      const landed = t >= 1 && winningBottoms.has(paths[c].endCol);
      svg += ladderPieceSvg(pos.x, pos.y, c, s, landed);
    });

    svg += '</svg>';
    board.innerHTML = svg;
  }

  function animateLadderPieces() {
    const duration = Math.max(4500, Math.min(9500, ladderState.participants.length * 220));
    const start = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const raw = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - raw, 3.4);
        const progresses = ladderState.participants.map(() => ease);
        drawLadderSvg(progresses);
        if (raw < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function showLadderWinnerModal(winners) {
    if (!winners.length) {
      toast('당첨자가 없습니다.');
      return;
    }
    const body = `
      <p class="ladder-modal-intro">${winners.length}명이 선정되었습니다.</p>
      <ul class="ladder-winner-list">
        ${winners.map((w, i) => `
          <li class="ladder-winner-row">
            <span class="ladder-winner-row__rank">${i + 1}</span>
            <span class="ladder-winner-row__badge" style="--badge-color:${w.color}">${esc(w.char)}</span>
            <span class="ladder-winner-row__name">${esc(formatStudent(w.student))}</span>
          </li>
        `).join('')}
      </ul>`;
    const footer = '<button type="button" class="btn btn-primary" id="btnLadderModalClose">확인</button>';
    host.showModal?.('🎉 사다리 당첨 결과', body, footer);
    setTimeout(() => {
      $('#btnLadderModalClose')?.addEventListener('click', () => host.closeModal?.());
    }, 0);
  }

  async function runLadderAnimation() {
    if (ladderAnimating) return;
    if (!ladderState.built) {
      toast('먼저 사다리를 만들어주세요.');
      return;
    }

    ladderAnimating = true;
    const btnStart = $('#btnLadderStart');
    const btnBuild = $('#btnLadderBuild');
    if (btnStart) btnStart.disabled = true;
    if (btnBuild) btnBuild.disabled = true;

    drawLadderSvg(ladderState.participants.map(() => 0));
    await delay(200);
    await animateLadderPieces();

    const winners = ctGetLadderWinners(
      ladderState.rungs,
      ladderState.participants,
      ladderState.winningBottoms
    );
    drawLadderSvg(ladderState.participants.map(() => 1));
    await delay(350);
    showLadderWinnerModal(winners);

    const classId = getClassId();
    if ($('#ladderNoDuplicate')?.checked && classId && winners.length) {
      const winIds = new Set(winners.map((w) => w.student.id));
      const pool = getLadderParticipants();
      const remaining = pool.filter((s) => !winIds.has(s.id)).map((s) => s.id);
      ctSaveLadderPool(classId, remaining.length ? remaining : pool.map((s) => s.id));
      renderLadderPool();
    }

    ladderState.built = false;
    ladderAnimating = false;
    if (btnBuild) btnBuild.disabled = getLadderParticipants().length < 2;
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function ladderSelectAll(all) {
    const students = getStudents();
    const classId = getClassId();
    ctSaveLadderPool(classId, all ? students.map((s) => s.id) : []);
    resetLadderBoard();
    renderLadderPool();
  }

  function ladderResetPool() {
    const classId = getClassId();
    ctClearLadderPool(classId);
    const students = getStudents();
    ctSaveLadderPool(classId, students.map((s) => s.id));
    resetLadderBoard();
    renderLadderPool();
    toast('대상자가 초기화되었습니다.');
  }

  /* ── 슬롯 ── */
  const SLOT_ITEM_H = 96;
  const SLOT_REEL_SPIN_MS = 1300;
  const SLOT_DIGIT_GAP_MS = 420;

  function getStudentNumberDigits(student) {
    const n = String(student?.number ?? '').trim();
    return n ? [...n] : ['0'];
  }

  function buildSlotMachineShell() {
    return `
      <div class="slot-reels" id="slotReels"></div>
      <div class="slot-winner-reveal" id="slotWinnerReveal" hidden></div>
      <div class="slot-confetti" id="slotConfetti" aria-hidden="true"></div>`;
  }

  function initSlotGame() {
    const reel = $('#slotReel');
    const result = $('#slotResult');
    if (reel) reel.innerHTML = buildSlotMachineShell();
    if (result) result.innerHTML = '<p class="game-result__placeholder">돌리기 버튼을 눌러주세요</p>';
  }

  function buildSlotReels(digitCount) {
    const reels = $('#slotReels');
    if (!reels) return;
    reels.innerHTML = Array.from({ length: digitCount }, (_, i) => `
      <div class="slot-reel">
        <div class="slot-reel-viewport">
          <div class="slot-strip" data-reel-idx="${i}"></div>
        </div>
      </div>`).join('');
  }

  function resetSlotReveal() {
    const reveal = $('#slotWinnerReveal');
    const confetti = $('#slotConfetti');
    if (reveal) {
      reveal.hidden = true;
      reveal.classList.remove('is-show');
      reveal.innerHTML = '';
    }
    if (confetti) confetti.innerHTML = '';
  }

  async function spinDigitReel(stripEl, digit) {
    const items = [];
    for (let i = 0; i < 16; i++) items.push(String(Math.floor(Math.random() * 10)));
    items.push(digit);
    stripEl.innerHTML = items.map((d) => `<div class="slot-item">${d}</div>`).join('');
    stripEl.style.transition = 'none';
    stripEl.style.transform = 'translateY(0)';
    void stripEl.offsetWidth;
    const target = -(items.length - 1) * SLOT_ITEM_H;
    stripEl.style.transition = `transform ${SLOT_REEL_SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
    stripEl.style.transform = `translateY(${target}px)`;
    await delay(SLOT_REEL_SPIN_MS + 60);
  }

  async function revealSlotWinner(student) {
    const reveal = $('#slotWinnerReveal');
    const confetti = $('#slotConfetti');
    if (!reveal) return;
    reveal.hidden = false;
    reveal.innerHTML = `
      <p class="slot-winner-reveal__burst" aria-hidden="true">🎉</p>
      <p class="slot-winner-reveal__label">당첨!</p>
      <p class="slot-winner-reveal__number">${esc(String(student.number))}</p>
      <p class="slot-winner-reveal__name">${esc(student.name)}</p>`;
    requestAnimationFrame(() => reveal.classList.add('is-show'));
    launchConfetti(confetti);
    await delay(400);
  }

  async function spinSlot() {
    if (slotSpinning) return;
    const students = getStudents();
    if (!students.length) return;

    const count = getPickCount();
    const winners = pickStudents(students, count);
    if (!winners.length) return;

    slotSpinning = true;
    const btn = $('#btnSlotSpin');
    if (btn) btn.disabled = true;
    const result = $('#slotResult');
    const winner = winners[0];
    const digits = getStudentNumberDigits(winner);

    resetSlotReveal();
    buildSlotReels(digits.length);
    if (result) result.innerHTML = '<p class="game-result__placeholder">학번 추첨 중…</p>';

    for (let i = 0; i < digits.length; i++) {
      const strip = $(`#slotReels .slot-strip[data-reel-idx="${i}"]`);
      if (strip) await spinDigitReel(strip, digits[i]);
      if (i < digits.length - 1) await delay(SLOT_DIGIT_GAP_MS);
    }

    await delay(350);
    await revealSlotWinner(winner);
    if (result) result.innerHTML = renderWinnerHtml(winners);
    slotSpinning = false;
    if (btn) btn.disabled = false;
  }

  function openSlotFullscreen() {
    host.openSlotFullscreen?.(getStudents(), getPickCount(), noDuplicate());
  }

  /* ── 카드 ── */
  function getCardPickStatusHtml(picked, total, flipped = 0) {
    if (picked < total) {
      return `<p class="game-result__placeholder">${picked} / ${total}장 선택됨 — 부채꼴에서 카드를 고르세요</p>`;
    }
    if (flipped < picked) {
      return `<p class="game-result__placeholder">아래 카드를 눌러 이름을 확인하세요 (${flipped} / ${picked})</p>`;
    }
    return '';
  }

  function getCardFanLayout(index, total) {
    if (total <= 1) return { rotate: 0, yOffset: 0, xOffset: 0 };
    const spread = Math.min(58, 14 + total * 1.1);
    const half = spread / 2;
    const t = index / (total - 1);
    const rotate = -half + t * spread;
    const yOffset = Math.pow(Math.abs(rotate) / (half || 1), 1.25) * 22;
    const xSpread = Math.min(420, Math.max(160, (total - 1) * 22));
    const xOffset = (t - 0.5) * xSpread;
    return { rotate, yOffset, xOffset };
  }

  function getCardBackHtml() {
    return `<span class="card-back-face" aria-hidden="true">
      <span class="card-back-face__ornament card-back-face__ornament--tl"></span>
      <span class="card-back-face__ornament card-back-face__ornament--tr"></span>
      <span class="card-back-face__ornament card-back-face__ornament--bl"></span>
      <span class="card-back-face__ornament card-back-face__ornament--br"></span>
      <svg class="card-back-face__jester" viewBox="0 0 48 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 6 L5 30 L24 21 Z" fill="#c41e3a"/>
        <path d="M24 6 L43 30 L24 21 Z" fill="#e8b923"/>
        <ellipse cx="24" cy="23" rx="13" ry="4.5" fill="#2a1548"/>
        <circle cx="6" cy="32" r="3.2" fill="#e8b923" stroke="#f5e6a8" stroke-width="0.8"/>
        <circle cx="42" cy="32" r="3.2" fill="#c41e3a" stroke="#f5e6a8" stroke-width="0.8"/>
        <circle cx="6" cy="32" r="1" fill="#f5e6a8"/>
        <circle cx="42" cy="32" r="1" fill="#f5e6a8"/>
        <circle cx="24" cy="39" r="11" fill="#f5d6b8"/>
        <circle cx="20" cy="37" r="1.6" fill="#1a1030"/>
        <circle cx="28" cy="37" r="1.6" fill="#1a1030"/>
        <path d="M18 42.5 Q24 47 30 42.5" stroke="#1a1030" stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="24" cy="40.5" r="1.2" fill="#e8a0a0"/>
        <path d="M13 49 L24 56 L35 49 L32 46 L24 50 L16 46 Z" fill="#c41e3a"/>
        <path d="M16 46 L24 50 L32 46 L29 44 L24 47 L19 44 Z" fill="#e8b923"/>
      </svg>
    </span>`;
  }

  function updateCardFanSize() {
    const fan = $('#cardGameGrid');
    if (!fan) return;
    const maxW = Math.min(fan.clientWidth || 660, 660);
    const gap = 10;
    const cols = 6;
    const cardW = Math.max(72, (maxW - (cols - 1) * gap) / cols);
    const cardH = (cardW * 4) / 3;
    const sizeTargets = [fan, $('#cardPickedZone')].filter(Boolean);
    sizeTargets.forEach((el) => {
      el.style.setProperty('--card-w', `${cardW}px`);
      el.style.setProperty('--card-h', `${cardH}px`);
    });
  }

  function updateCardResultStatus() {
    const result = $('#cardResult');
    if (!result) return;
    const count = getPickCount();
    const picked = cardPickedOrder.length;
    const flipped = cardFlipped.size;
    if (flipped >= picked && picked >= count && picked > 0) {
      const students = cardPickedOrder
        .map((sid) => cardDeck.find((s) => s.id === sid))
        .filter(Boolean);
      result.innerHTML = renderWinnerHtml(students);
      return;
    }
    const status = getCardPickStatusHtml(picked, count, flipped);
    result.innerHTML = status || '<p class="game-result__placeholder">부채꼴에서 카드를 선택하세요</p>';
  }

  function initCardGame() {
    const students = getStudents();
    cardDeck = ctShuffleGroups([...students]);
    cardPickedOrder = [];
    cardFlipped = new Set();
    cardShuffling = false;
    renderCardGrid();
    renderPickedZone();
    const result = $('#cardResult');
    const count = getPickCount();
    if (result) {
      result.innerHTML = students.length
        ? getCardPickStatusHtml(0, count)
        : '<p class="game-result__placeholder">학생이 없습니다</p>';
    }
  }

  function renderCardGrid() {
    const grid = $('#cardGameGrid');
    if (!grid) return;
    if (!cardDeck.length) {
      grid.innerHTML = '<p class="field-hint card-fan__empty">학생이 없습니다.</p>';
      return;
    }

    const count = getPickCount();
    const fanLocked = cardShuffling || cardPickedOrder.length >= count;
    const remaining = cardDeck.filter((s) => !cardPickedOrder.includes(s.id));
    const total = remaining.length;

    if (!total) {
      grid.innerHTML = '<div class="card-fan__table is-empty"></div>';
      updateCardFanSize();
      return;
    }

    const tableLocked = fanLocked ? ' is-locked' : '';
    const cardsHtml = remaining.map((s, i) => {
      const { rotate, yOffset, xOffset } = getCardFanLayout(i, total);
      return `<button type="button" class="card-pick" data-id="${s.id}"
        style="--fan-r:${rotate}deg;--fan-y:${yOffset}px;--fan-x:${xOffset}px;--fan-z:${i}"
        aria-label="카드 선택" ${fanLocked ? 'disabled' : ''}>
        ${getCardBackHtml()}
      </button>`;
    }).join('');

    grid.innerHTML = `<div class="card-fan__table${tableLocked}">${cardsHtml}</div>`;
    updateCardFanSize();
    requestAnimationFrame(updateCardFanSize);
  }

  function renderPickedZone(enterId = null) {
    const zone = $('#cardPickedZone');
    if (!zone) return;

    if (!cardPickedOrder.length) {
      zone.innerHTML = '<p class="card-picked__hint">뽑은 카드가 여기에 모입니다</p>';
      return;
    }

    const slotsHtml = cardPickedOrder.map((id) => {
      const s = cardDeck.find((st) => st.id === id);
      if (!s) return '';
      const flipped = cardFlipped.has(id);
      const enterClass = id === enterId ? ' is-entering' : '';
      return `<button type="button" class="card-picked-slot${flipped ? ' is-flipped' : ''}${enterClass}"
        data-id="${s.id}" aria-label="${flipped ? esc(s.name) : '카드 뒤집기'}">
        <span class="card-picked-slot__inner">
          <span class="card-picked-slot__back">${getCardBackHtml()}</span>
          <span class="card-picked-slot__face">
            <span class="card-pick__num">${esc(String(s.number))}</span>
            <span class="card-pick__name">${esc(s.name)}</span>
          </span>
        </span>
      </button>`;
    }).join('');

    zone.innerHTML = `<div class="card-picked__row">${slotsHtml}</div>`;
    updateCardFanSize();
  }

  function selectCard(id) {
    if (cardShuffling) return;
    const student = cardDeck.find((s) => s.id === id);
    if (!student || cardPickedOrder.includes(id)) return;

    const count = getPickCount();
    if (cardPickedOrder.length >= count) return;

    cardPickedOrder.push(id);
    renderCardGrid();
    renderPickedZone(id);
    updateCardResultStatus();
  }

  function flipPickedCard(id) {
    if (cardShuffling || !cardPickedOrder.includes(id) || cardFlipped.has(id)) return;

    cardFlipped.add(id);
    const btn = $('#cardPickedZone')?.querySelector(`.card-picked-slot[data-id="${CSS.escape(id)}"]`);
    btn?.classList.add('is-flipped');
    btn?.setAttribute('aria-label', btn.querySelector('.card-pick__name')?.textContent || '카드');

    updateCardResultStatus();
  }

  async function shuffleCards() {
    if (cardShuffling) return;
    const students = getStudents();
    if (!students.length) return;

    cardShuffling = true;
    cardDeck = ctShuffleGroups([...students]);
    cardPickedOrder = [];
    cardFlipped = new Set();

    renderCardGrid();
    renderPickedZone();
    const grid = $('#cardGameGrid');
    const result = $('#cardResult');
    grid?.classList.add('is-shuffling');
    if (result) result.innerHTML = '<p class="game-result__placeholder">카드를 섞는 중…</p>';

    await delay(900);
    cardDeck = ctShuffleGroups([...students]);
    grid?.classList.remove('is-shuffling');
    cardShuffling = false;
    renderCardGrid();
    renderPickedZone();
    updateCardResultStatus();
    toast('카드를 다시 섞었습니다.');
  }

  function launchConfetti(container) {
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff85a2', '#c77dff', '#ffa94d'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('span');
      p.className = 'confetti-piece';
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = `${Math.random() * 0.6}s`;
      p.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
      p.style.setProperty('--cf-drift', `${(Math.random() - 0.5) * 180}px`);
      p.style.setProperty('--cf-rot', `${Math.random() * 720}deg`);
      container.appendChild(p);
    }
    setTimeout(() => { container.innerHTML = ''; }, 3500);
  }

  function resetTreasureBox() {
    const box = $('#treasureBox');
    if (!box) return;
    box.classList.remove('is-open', 'is-shaking', 'is-reveal');
    box.innerHTML = `
      <span class="treasure-box__lid" aria-hidden="true"></span>
      <span class="treasure-box__icon">📦</span>
      <span class="treasure-box__label">보물상자</span>`;
  }

  /* ── 보물상자 ── */
  function initTreasureGame() {
    resetTreasureBox();
    const result = $('#treasureResult');
    const confetti = $('#treasureConfetti');
    if (confetti) confetti.innerHTML = '';
    if (result) result.innerHTML = '<p class="game-result__placeholder">열기 버튼을 눌러주세요</p>';
    treasureOpening = false;
  }

  async function openTreasure() {
    if (treasureOpening) return;
    const rewards = host.getTreasureRewards?.() || [];
    if (!rewards.length) {
      toast('관리실에서 보물상자 보상을 등록해주세요.');
      return;
    }
    const reward = ctPickTreasureReward(rewards);
    if (!reward) return;

    treasureOpening = true;
    const btn = $('#btnTreasureOpen');
    const box = $('#treasureBox');
    const result = $('#treasureResult');
    const confetti = $('#treasureConfetti');
    if (btn) btn.disabled = true;
    if (result) result.innerHTML = '';

    resetTreasureBox();
    if (box) box.classList.add('is-shaking');
    await delay(850);
    if (box) {
      box.classList.remove('is-shaking');
      box.classList.add('is-open');
      await delay(350);
      box.classList.add('is-reveal');
      box.innerHTML = `
        <span class="treasure-box__glow" aria-hidden="true"></span>
        <span class="treasure-box__burst" aria-hidden="true">✨</span>
        <span class="treasure-box__prize-label">당첨!</span>
        <span class="treasure-box__prize-text">${esc(reward)}</span>`;
    }

    launchConfetti(confetti);
    if (result) {
      result.innerHTML = `<div class="treasure-prize-card">${esc(reward)}</div>`;
    }
    await delay(300);
    treasureOpening = false;
    if (btn) btn.disabled = false;
  }

  const DICE_DOTS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  function setDiceFace(el, value) {
    if (!el) return;
    el.dataset.value = String(value);
    const face = el.querySelector('.dice-roller__face') || el;
    face.textContent = DICE_DOTS[value - 1] || '?';
  }

  function getDiceCount() {
    const raw = parseInt($('#diceCount')?.value, 10);
    return Math.min(6, Math.max(1, Number.isFinite(raw) ? raw : 2));
  }

  function renderDiceStage() {
    const stage = $('#diceStage');
    if (!stage) return;
    const count = getDiceCount();
    const parts = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) parts.push('<span class="dice-plus">+</span>');
      parts.push(`<div class="dice-roller" data-dice-idx="${i}" data-value="1"><span class="dice-roller__face"></span></div>`);
    }
    stage.innerHTML = parts.join('');
    stage.classList.toggle('dice-stage--many', count >= 5);
    stage.classList.toggle('dice-stage--single', count === 1);
    $$('.dice-roller', stage).forEach((el) => {
      el.classList.remove('is-rolling', 'is-landed');
      setDiceFace(el, 1);
    });
  }

  /* ── 주사위 ── */
  function initDiceGame() {
    renderDiceStage();
    const total = $('#diceTotal');
    if (total) total.hidden = true;
  }

  async function rollDice() {
    const btn = $('#btnDiceRoll');
    if (btn) btn.disabled = true;
    const rollers = $$('.dice-roller', $('#diceStage'));
    const totalWrap = $('#diceTotal');
    const totalVal = $('#diceTotalValue');
    if (totalWrap) totalWrap.hidden = true;
    rollers.forEach((el) => el.classList.remove('is-landed'));

    const finals = rollers.map(() => 1 + Math.floor(Math.random() * 6));
    rollers.forEach((el) => el.classList.add('is-rolling'));

    let ticks = 0;
    while (ticks < 18) {
      rollers.forEach((el) => setDiceFace(el, 1 + Math.floor(Math.random() * 6)));
      await delay(60 + ticks * 10);
      ticks++;
    }

    rollers.forEach((el, i) => {
      el.classList.remove('is-rolling');
      setDiceFace(el, finals[i]);
      el.classList.add('is-landed');
    });

    await delay(200);
    const sum = finals.reduce((acc, v) => acc + v, 0);
    if (totalVal) totalVal.textContent = String(sum);
    if (totalWrap) {
      totalWrap.hidden = false;
      totalWrap.classList.remove('is-pop');
      void totalWrap.offsetWidth;
      totalWrap.classList.add('is-pop');
    }
    if (btn) btn.disabled = false;
    return { values: finals, sum };
  }

  /* ── 룰렛 ── */
  function switchRouletteTab(tabId) {
    $$('[data-roulette-tab]').forEach((btn) => {
      const active = btn.dataset.rouletteTab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const studentsPanel = $('#rouletteTabStudents');
    const customPanel = $('#rouletteTabCustom');
    if (studentsPanel) studentsPanel.hidden = tabId !== 'students';
    if (customPanel) customPanel.hidden = tabId !== 'custom';
    const classId = getClassId();
    if (classId) ctSaveRouletteMode(classId, tabId);
    host.onRouletteModeChange?.(tabId);
  }

  function renderRouletteCustomItems() {
    const list = $('#rouletteCustomList');
    const summary = $('#rouletteCustomSummary');
    const classId = getClassId();
    const items = ctLoadRouletteCustomItems(classId);

    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="field-hint">등록된 항목이 없습니다.</p>';
      if (summary) summary.textContent = '';
      return;
    }

    list.innerHTML = items.map((item, i) => `
      <li class="roulette-custom-item">
        <span class="roulette-custom-item__text">${esc(item.label)}</span>
        <button type="button" class="btn-icon-only btn-delete-roulette-custom" data-idx="${i}" title="삭제" aria-label="삭제">✕</button>
      </li>
    `).join('');
    if (summary) summary.textContent = `총 ${items.length}개 항목`;

    list.querySelectorAll('.btn-delete-roulette-custom').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const current = ctLoadRouletteCustomItems(classId);
        if (idx < 0 || idx >= current.length) return;
        current.splice(idx, 1);
        ctSaveRouletteCustomItems(classId, current);
        host.onRouletteCustomChange?.();
        renderRouletteCustomItems();
        toast('항목이 삭제되었습니다.');
      });
    });
  }

  function addRouletteCustomItem(label) {
    const text = String(label || '').trim();
    if (!text) {
      toast('항목을 입력해주세요.');
      return;
    }
    const classId = getClassId();
    const items = ctLoadRouletteCustomItems(classId);
    if (items.some((item) => item.label === text)) {
      toast('이미 등록된 항목입니다.');
      return;
    }
    if (items.length >= 40) {
      toast('항목은 최대 40개까지 등록할 수 있습니다.');
      return;
    }
    items.push({ id: ctGenerateId('roulette-item'), label: text });
    ctSaveRouletteCustomItems(classId, items);
    host.onRouletteCustomChange?.();
    renderRouletteCustomItems();
    const input = $('#rouletteCustomInput');
    if (input) input.value = '';
    toast('항목이 추가되었습니다.');
  }

  function resetRouletteCustomItems() {
    const classId = getClassId();
    ctSaveRouletteCustomItems(classId, [...CT_DEFAULT_ROULETTE_CUSTOM]);
    host.onRouletteCustomChange?.();
    renderRouletteCustomItems();
    toast('예시 목록으로 초기화했습니다.');
  }

  /* ── 룰렛 대상자 ── */
  function renderRoulettePool() {
    const students = getStudents();
    const classId = getClassId();
    const poolIds = new Set(ctLoadRoulettePool(classId, students.map((s) => s.id)));
    const grid = $('#roulettePoolGrid');
    const summary = $('#roulettePoolSummary');

    if (!grid) return;
    if (!students.length) {
      grid.innerHTML = '<p class="field-hint">학생 명단이 없습니다.</p>';
      if (summary) summary.textContent = '';
      return;
    }

    grid.innerHTML = students.map((s) => `
      <label class="ladder-pool-item">
        <input type="checkbox" class="roulette-pool-check" value="${esc(s.id)}" ${poolIds.has(s.id) ? 'checked' : ''} />
        <span>${esc(formatStudent(s))}</span>
      </label>
    `).join('');

    const colMin = students.length > 30 ? 132 : students.length > 20 ? 148 : students.length > 12 ? 160 : 172;
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${colMin}px, 1fr))`;

    const selected = grid.querySelectorAll('.roulette-pool-check:checked').length;
    if (summary) summary.textContent = `선택 ${selected}명 / 전체 ${students.length}명`;

    grid.querySelectorAll('.roulette-pool-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const ids = [...grid.querySelectorAll('.roulette-pool-check:checked')].map((c) => c.value);
        ctSaveRoulettePool(classId, ids);
        host.onRoulettePoolChange?.();
        renderRoulettePool();
      });
    });
  }

  function rouletteSelectAll(all) {
    const students = getStudents();
    const classId = getClassId();
    ctSaveRoulettePool(classId, all ? students.map((s) => s.id) : []);
    host.onRoulettePoolChange?.();
    renderRoulettePool();
  }

  function rouletteResetPool() {
    const classId = getClassId();
    ctClearRoulettePool(classId);
    const students = getStudents();
    ctSaveRoulettePool(classId, students.map((s) => s.id));
    host.onRoulettePoolChange?.();
    renderRoulettePool();
    toast('대상자가 초기화되었습니다.');
  }

  function initRouletteGame() {
    const classId = getClassId();
    const mode = classId ? ctLoadRouletteMode(classId) : 'students';
    switchRouletteTab(mode);
    renderRoulettePool();
    renderRouletteCustomItems();
    host.renderRoulette?.();
  }

  /* ── 핀볼 ── */
  function getPinballParticipants() {
    const students = getStudents();
    const classId = getClassId();
    const ids = ctLoadPinballPool(classId, students.map((s) => s.id));
    return students.filter((s) => ids.includes(s.id) && !pinballExcluded.has(s.id));
  }

  function getPinballWinnerCount(participantCount) {
    const max = Math.max(1, Math.min(5, participantCount || 5));
    const input = $('#pinballWinnerCount');
    const n = parseInt(input?.value, 10) || 1;
    return Math.max(1, Math.min(max, n));
  }

  function renderPinballPool() {
    const students = getStudents();
    const classId = getClassId();
    const poolIds = new Set(ctLoadPinballPool(classId, students.map((s) => s.id)));
    const grid = $('#pinballPoolGrid');
    const summary = $('#pinballPoolSummary');

    if (!grid) return;
    if (!students.length) {
      grid.innerHTML = '<p class="field-hint">학생 명단이 없습니다.</p>';
      if (summary) summary.textContent = '';
      return;
    }

    grid.innerHTML = students.map((s) => `
      <label class="ladder-pool-item">
        <input type="checkbox" class="pinball-pool-check" value="${esc(s.id)}" ${poolIds.has(s.id) ? 'checked' : ''} />
        <span>${esc(formatStudent(s))}</span>
      </label>
    `).join('');

    const selected = grid.querySelectorAll('.pinball-pool-check:checked').length;
    const active = getPinballParticipants().length;
    if (summary) summary.textContent = `선택 ${selected}명 / 참가 가능 ${active}명`;

    grid.querySelectorAll('.pinball-pool-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const ids = [...grid.querySelectorAll('.pinball-pool-check:checked')].map((c) => c.value);
        ctSavePinballPool(classId, ids);
        resetPinballBoard();
        renderPinballPool();
        renderPinballWinnerSettings();
      });
    });
  }

  function renderPinballWinnerSettings() {
    const participants = getPinballParticipants();
    const n = participants.length;
    const input = $('#pinballWinnerCount');
    const hint = $('#pinballWinnerHint');
    const max = Math.max(1, Math.min(5, n || 5));
    const classId = getClassId();
    const saved = ctLoadPinballWinCount(classId, max);
    const winCount = Math.max(1, Math.min(max, saved));

    if (input) {
      input.max = String(max);
      input.value = String(winCount);
      input.disabled = n < 2;
    }
    if (hint) {
      hint.textContent = n < 2
        ? '참가자 2명 이상 필요합니다'
        : `참가 ${n}명 · ${winCount}명 선정 (도착 순)`;
    }
    ctSavePinballWinCount(classId, winCount);
  }

  function resetPinballBoard() {
    pinballRunning = false;
    const canvas = $('#pinballCanvas');
    if (!canvas || !window.CTPinball) return;
    if (!pinballEngine) pinballEngine = new CTPinball.PinballEngine(canvas);
    const participants = getPinballParticipants();
    const winCount = getPinballWinnerCount(participants.length);
    pinballEngine.setup(participants, winCount);
    renderPinballLeaderboard([]);
    const status = $('#pinballStatus');
    if (status) {
      status.textContent = participants.length < 2
        ? '참가자를 2명 이상 선택해주세요.'
        : '시작 버튼을 누르면 구슬이 떨어집니다!';
    }
    $('#btnPinballStart')?.toggleAttribute('disabled', participants.length < 2);
    $('#btnPinballShake')?.toggleAttribute('disabled', true);
  }

  function setPinballShakeEnabled(enabled) {
    const btn = $('#btnPinballShake');
    if (!btn) return;
    btn.toggleAttribute('disabled', !enabled);
  }

  function pinballShakeBoard(engine, wrapEl) {
    if (!engine?.running) return;
    const ok = engine.shake();
    if (!ok) {
      toast('잠시 후 다시 튕길 수 있습니다.');
      return;
    }
    wrapEl?.classList.remove('is-shaking');
    void wrapEl?.offsetWidth;
    wrapEl?.classList.add('is-shaking');
  }

  function renderPinballLeaderboard(finished) {
    const list = $('#pinballLeaderboard');
    if (!list) return;
    if (!finished.length) {
      list.innerHTML = '<p class="pinball-leaderboard__empty">경주가 시작되면 도착 순서가 표시됩니다</p>';
      return;
    }
    list.innerHTML = finished.map((ball) => `
      <div class="pinball-rank-row" style="--ball-color:${ball.color}">
        <span class="pinball-rank-row__order">${ball.finishOrder}</span>
        <span class="pinball-rank-row__ball" aria-hidden="true"></span>
        <span class="pinball-rank-row__name">${esc(ball.displayLabel || ball.name)}</span>
      </div>
    `).join('');
  }

  function showPinballWinners(winners) {
    if (!winners.length) return;
    const body = `
      <p class="ladder-modal-intro">${winners.length}명이 선정되었습니다.</p>
      <ul class="ladder-winner-list">
        ${winners.map((w, i) => `
          <li class="ladder-winner-row">
            <span class="ladder-winner-row__rank">${i + 1}</span>
            <span class="ladder-winner-row__emoji" style="background:${w.color};border-radius:50%;width:28px;height:28px;display:inline-block"></span>
            <span class="ladder-winner-row__name">${esc(w.displayLabel || w.name)}</span>
          </li>
        `).join('')}
      </ul>`;
    const footer = '<button type="button" class="btn btn-primary" id="btnPinballModalClose">확인</button>';
    host.showModal?.('🏆 핀볼 당첨', body, footer);
    setTimeout(() => {
      $('#btnPinballModalClose')?.addEventListener('click', () => host.closeModal?.());
    }, 0);
  }

  function initPinballGame() {
    pinballRunning = false;
    renderPinballPool();
    renderPinballWinnerSettings();
    resetPinballBoard();
    if (!pinballResizeBound) {
      window.addEventListener('resize', onPinballResize);
      pinballResizeBound = true;
    }
  }

  function onPinballResize() {
    if (currentGameId !== 'pinball' || !pinballEngine || pinballRunning) return;
    const participants = getPinballParticipants();
    pinballEngine.setup(participants, getPinballWinnerCount(participants.length));
  }

  function pinballSelectAll(all) {
    const students = getStudents();
    const classId = getClassId();
    ctSavePinballPool(classId, all ? students.map((s) => s.id) : []);
    resetPinballBoard();
    renderPinballPool();
    renderPinballWinnerSettings();
  }

  function pinballResetPool() {
    const classId = getClassId();
    ctClearPinballPool(classId);
    const students = getStudents();
    ctSavePinballPool(classId, students.map((s) => s.id));
    pinballExcluded.clear();
    resetPinballBoard();
    renderPinballPool();
    renderPinballWinnerSettings();
    toast('대상자가 초기화되었습니다.');
  }

  async function startPinballRace() {
    if (pinballRunning || !pinballEngine) return;
    const participants = getPinballParticipants();
    if (participants.length < 2) {
      toast('참가자를 2명 이상 선택해주세요.');
      return;
    }

    const winCount = getPinballWinnerCount(participants.length);
    const classId = getClassId();
    ctSavePinballWinCount(classId, winCount);

    pinballRunning = true;
    const btn = $('#btnPinballStart');
    if (btn) btn.disabled = true;
    setPinballShakeEnabled(true);
    const status = $('#pinballStatus');
    const boardWrap = document.querySelector('.pinball-board-wrap');
    if (status) status.textContent = '⚡ 회전 장애물을 뚫고 골인까지!';

    pinballEngine.setup(participants, winCount);
    renderPinballLeaderboard([]);

    pinballEngine.start({
      onShake: () => {
        boardWrap?.classList.remove('is-shaking');
        void boardWrap?.offsetWidth;
        boardWrap?.classList.add('is-shaking');
      },
      onFrame: (balls) => {
        if (!status) return;
        const active = balls.filter((b) => !b.finished);
        const near = active.filter((b) => b.nearFinish);
        const finished = balls.filter((b) => b.finished).length;
        if (near.length >= 2) {
          status.textContent = `🔥 막판 승부! ${near.length}개 구슬이 골인 직전!`;
        } else if (finished > 0 && active.length > 0) {
          status.textContent = `${finished}명 도착 · 나머지 ${active.length}개 구슬 경주 중…`;
        } else if (balls.some((b) => b.frame < b.releaseFrame)) {
          status.textContent = '🚀 구슬이 하나씩 출발합니다…';
        } else if (active.length > 0) {
          status.textContent = `🌀 ${active.length}개 구슬이 장애물 속을 질주 중!`;
        }
      },
      onFinishOrder: (_ball, order) => {
        renderPinballLeaderboard(order);
        if (status && order.length === 1) {
          status.textContent = '🏁 1위 결정! 나머지 구슬도 골인할 때까지…';
        } else if (status) {
          status.textContent = `${order.length}명 도착 · 경주 계속 중!`;
        }
      },
      onComplete: (order) => {
        pinballRunning = false;
        if (btn) btn.disabled = false;
        setPinballShakeEnabled(false);
        boardWrap?.classList.remove('is-shaking');
        if (status) status.textContent = '경주 완료!';

        if ($('#pinballNoDuplicate')?.checked && classId) {
          order.slice(0, winCount).forEach((b) => pinballExcluded.add(b.id));
          const remaining = getPinballParticipants();
          if (!remaining.length) {
            pinballExcluded.clear();
            toast('모든 참가자가 당첨되었습니다. 다시 채웁니다.');
          }
        }

        showPinballWinners(order.slice(0, winCount));
        resetPinballBoard();
        renderPinballPool();
      },
    });
  }

  function openPinballFullscreen() {
    const participants = getPinballParticipants();
    if (participants.length < 2) {
      toast('참가자를 2명 이상 선택해주세요.');
      return;
    }
    if (pinballRunning) {
      toast('경주가 진행 중입니다.');
      return;
    }

    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    if (!overlay || !content || !window.CTPinball) return;

    const winCount = getPinballWinnerCount(participants.length);
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    content.className = 'fullscreen-content fullscreen-pinball';
    content.innerHTML = `
      <div class="pinball-fs-wrap">
        <div class="pinball-board-wrap pinball-board-wrap--fs" id="fsPinballBoardWrap">
          <canvas id="fsPinballCanvas" class="pinball-canvas" aria-label="핀볼 경주"></canvas>
        </div>
        <p class="pinball-status pinball-status--fs" id="fsPinballStatus">구슬이 떨어지는 중…</p>
        <div class="pinball-fs-leaderboard" id="fsPinballLeaderboard"></div>
        <div class="pinball-fs-actions">
          <button type="button" class="btn btn-secondary" id="btnFsPinballShake">📳 튕기기</button>
        </div>
      </div>`;

    const canvas = $('#fsPinballCanvas');
    const fsEngine = new CTPinball.PinballEngine(canvas);
    fsEngine.tallBoard = true;
    fsEngine.cameraFollowEnabled = true;
    fsEngine.setup(participants, winCount);

    const renderFsLeaderboard = (finished) => {
      const list = $('#fsPinballLeaderboard');
      if (!list) return;
      list.innerHTML = finished.map((ball) => `
        <span class="pinball-fs-chip" style="--ball-color:${ball.color}">${ball.finishOrder}. ${esc(ball.displayLabel || ball.name)}</span>
      `).join('');
    };

    const fsBoardWrap = $('#fsPinballBoardWrap');
    $('#btnFsPinballShake')?.addEventListener('click', () => pinballShakeBoard(fsEngine, fsBoardWrap));

    fsEngine.start({
      onShake: () => {
        fsBoardWrap?.classList.remove('is-shaking');
        void fsBoardWrap?.offsetWidth;
        fsBoardWrap?.classList.add('is-shaking');
      },
      onFrame: () => {
        const status = $('#fsPinballStatus');
        if (!status) return;
        const leader = fsEngine.getRaceLeader();
        if (fsEngine.cameraBlend > 0.4 && leader && !leader.finished) {
          status.textContent = `🎬 1위 ${leader.displayLabel || leader.name} 추적 중…`;
        } else if (fsEngine.cameraBlend > 0.15) {
          status.textContent = '🎥 카메라가 선두 구슬에 맞춰집니다…';
        }
      },
      onFinishOrder: (_ball, order) => renderFsLeaderboard(order),
      onComplete: (order) => {
        const status = $('#fsPinballStatus');
        if (status) status.textContent = '경주 완료!';
        const classId = getClassId();
        if ($('#pinballNoDuplicate')?.checked && classId) {
          order.slice(0, winCount).forEach((b) => pinballExcluded.add(b.id));
        }
        showPinballWinners(order.slice(0, winCount));
        resetPinballBoard();
        renderPinballPool();
      },
    });
  }

  /* ── 스코어보드 ── */
  function bumpScoreDisplay(teamIdx) {
    const el = $(`.scoreboard-score[data-team-idx="${teamIdx}"]`);
    if (!el) return;
    el.textContent = scoreboardData.teams[teamIdx]?.score ?? 0;
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }

  function renderScoreboard() {
    scoreboardData = ctNormalizeScoreboard(scoreboardData);
    const settings = $('#scoreboardSettings');
    const grid = $('#scoreboardGrid');
    if (!settings || !grid) return;

    const teamCounts = [2, 3, 4, 5, 6, 7, 8];
    const customStepActive = !CT_SCOREBOARD_STEP_PRESETS.includes(scoreboardData.step);

    settings.innerHTML = `
      <div class="scoreboard-settings__row">
        <span class="field-label">팀 수</span>
        <div class="scoreboard-pills">
          ${teamCounts.map((n) => `
            <button type="button" class="scoreboard-pill ${scoreboardData.teamCount === n ? 'is-active' : ''}" data-team-count="${n}">${n}팀</button>
          `).join('')}
        </div>
      </div>
      <div class="scoreboard-settings__row">
        <span class="field-label">한 번에 ±</span>
        <div class="scoreboard-pills">
          ${CT_SCOREBOARD_STEP_PRESETS.map((s) => `
            <button type="button" class="scoreboard-pill ${!customStepActive && scoreboardData.step === s ? 'is-active' : ''}" data-step="${s}">${s}점</button>
          `).join('')}
        </div>
        <div class="form-row scoreboard-custom-step">
          <label class="field">
            <span class="field-label">직접 입력</span>
            <input type="number" id="scoreboardCustomStep" class="input" min="1" max="999" value="${customStepActive ? scoreboardData.step : ''}" placeholder="점수" />
          </label>
          <button type="button" class="btn btn-secondary" id="btnScoreboardApplyStep">적용</button>
        </div>
      </div>
      <div class="form-row scoreboard-settings__actions">
        <button type="button" class="btn btn-secondary" id="btnScoreboardReset">점수 전체 리셋</button>
        <p class="field-hint">현재 <strong>${scoreboardData.step}점</strong>씩 올리거나 내립니다 · 수업 중 유지</p>
      </div>`;

    grid.innerHTML = scoreboardData.teams.map((team, i) => {
      const color = CT_TEAM_COLORS[i % CT_TEAM_COLORS.length];
      return `
        <div class="card scoreboard-team" style="--team-color: ${color}">
          <input type="text" class="input scoreboard-team-name" data-team-idx="${i}" value="${esc(team.name)}" maxlength="12" aria-label="팀 이름" />
          <div class="scoreboard-score" data-team-idx="${i}">${team.score}</div>
          <div class="scoreboard-controls">
            <button type="button" class="btn btn-secondary scoreboard-btn scoreboard-btn--minus" data-score-action="minus" data-team-idx="${i}" aria-label="${esc(team.name)} 점수 ${scoreboardData.step}점 감소">−</button>
            <button type="button" class="btn btn-primary scoreboard-btn scoreboard-btn--plus" data-score-action="plus" data-team-idx="${i}" aria-label="${esc(team.name)} 점수 ${scoreboardData.step}점 증가">+</button>
          </div>
        </div>`;
    }).join('');
  }

  function bindScoreboardEvents() {
    const workspace = $('#scoreboardWorkspace');
    if (!workspace || workspace.dataset.bound) return;
    workspace.dataset.bound = '1';

    workspace.addEventListener('click', (e) => {
      const scoreBtn = e.target.closest('[data-score-action]');
      if (scoreBtn) {
        const idx = parseInt(scoreBtn.dataset.teamIdx, 10);
        const delta = scoreBtn.dataset.scoreAction === 'plus' ? scoreboardData.step : -scoreboardData.step;
        scoreboardData = ctAdjustTeamScore(scoreboardData, idx, delta);
        ctSaveScoreboard(scoreboardData);
        bumpScoreDisplay(idx);
        return;
      }

      const countBtn = e.target.closest('[data-team-count]');
      if (countBtn) {
        scoreboardData = ctResizeScoreboardTeams(scoreboardData, parseInt(countBtn.dataset.teamCount, 10));
        ctSaveScoreboard(scoreboardData);
        renderScoreboard();
        return;
      }

      const stepBtn = e.target.closest('[data-step]');
      if (stepBtn) {
        scoreboardData = ctSetScoreboardStep(scoreboardData, parseInt(stepBtn.dataset.step, 10));
        ctSaveScoreboard(scoreboardData);
        renderScoreboard();
        return;
      }

      if (e.target.id === 'btnScoreboardApplyStep') {
        const custom = parseInt($('#scoreboardCustomStep')?.value, 10);
        if (!custom || custom < 1) {
          toast('1 이상의 점수를 입력해주세요.');
          return;
        }
        scoreboardData = ctSetScoreboardStep(scoreboardData, custom);
        ctSaveScoreboard(scoreboardData);
        renderScoreboard();
        return;
      }

      if (e.target.id === 'btnScoreboardReset') {
        scoreboardData = ctResetScoreboardScores(scoreboardData);
        ctSaveScoreboard(scoreboardData);
        renderScoreboard();
        toast('점수가 초기화되었습니다.');
      }
    });

    workspace.addEventListener('change', (e) => {
      if (!e.target.classList.contains('scoreboard-team-name')) return;
      const idx = parseInt(e.target.dataset.teamIdx, 10);
      scoreboardData = ctUpdateTeamName(scoreboardData, idx, e.target.value);
      ctSaveScoreboard(scoreboardData);
    });
  }

  function initScoreboardGame() {
    renderScoreboard();
  }

  /* ── 공개 API ── */
  function init(hostApi) {
    host = hostApi || {};
    renderLobbyGrid();
    showLobby();
  }

  function onClassChange() {
    if (currentGameId === 'ladder') {
      renderLadderPool();
      resetLadderBoard();
    }
    if (currentGameId === 'roulette') {
      const mode = ctLoadRouletteMode(getClassId());
      switchRouletteTab(mode);
      renderRoulettePool();
      renderRouletteCustomItems();
      host.renderRoulette?.();
    }
    if (currentGameId === 'pinball') {
      renderPinballPool();
      renderPinballWinnerSettings();
      resetPinballBoard();
    }
    if (currentGameId === 'scoreboard') {
      renderScoreboard();
    }
  }

  function bindEvents() {
    $('#gamesGrid')?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-game]');
      if (card?.dataset.game) openGame(card.dataset.game);
    });

    $('#btnGamesBack')?.addEventListener('click', showLobby);

    $$('.ladder-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchLadderTab(btn.dataset.ladderTab));
    });
    $('#ladderWinnerCount')?.addEventListener('change', () => {
      const classId = getClassId();
      const n = getLadderParticipants().length;
      ctSaveLadderWinCount(classId, getLadderWinnerCount(n));
      renderLadderWinnerSettings({ resetValue: false });
      resetLadderBoard();
    });
    $('#ladderWinnerCount')?.addEventListener('input', () => {
      const input = $('#ladderWinnerCount');
      const maxWin = Math.max(1, Math.min(5, getLadderParticipants().length || 5));
      if (input) {
        const current = parseInt(input.value, 10);
        if (current > maxWin) input.value = String(maxWin);
      }
      updateLadderWinnerHint();
    });

    $('#btnLadderSelectAll')?.addEventListener('click', () => ladderSelectAll(true));
    $('#btnLadderDeselectAll')?.addEventListener('click', () => {
      const classId = getClassId();
      ctSaveLadderPool(classId, []);
      resetLadderBoard();
      renderLadderPool();
    });
    $('#btnLadderPoolReset')?.addEventListener('click', ladderResetPool);
    $('#btnLadderBuild')?.addEventListener('click', buildLadder);
    $('#btnLadderStart')?.addEventListener('click', runLadderAnimation);
    $('#btnLadderFullscreen')?.addEventListener('click', () => host.openLadderFullscreen?.());

    $('#btnSlotSpin')?.addEventListener('click', spinSlot);
    $('#btnSlotFullscreen')?.addEventListener('click', openSlotFullscreen);

    $('#btnCardShuffle')?.addEventListener('click', shuffleCards);
    $('#cardGameGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.card-pick');
      if (!btn || btn.disabled || cardShuffling) return;
      selectCard(btn.dataset.id);
    });
    $('#cardPickedZone')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.card-picked-slot');
      if (!btn || btn.classList.contains('is-flipped') || cardShuffling) return;
      flipPickedCard(btn.dataset.id);
    });
    window.addEventListener('resize', () => {
      if (currentGameId === 'card') updateCardFanSize();
    });

    $('#btnTreasureOpen')?.addEventListener('click', openTreasure);
    $('#btnTreasureFullscreen')?.addEventListener('click', () => host.openTreasureFullscreen?.());

    $('#btnDiceRoll')?.addEventListener('click', rollDice);
    $('#diceCount')?.addEventListener('change', () => {
      renderDiceStage();
      const total = $('#diceTotal');
      if (total) total.hidden = true;
    });
    $('#btnDiceFullscreen')?.addEventListener('click', () => host.openDiceFullscreen?.());

    $$('[data-roulette-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchRouletteTab(btn.dataset.rouletteTab));
    });
    $('#rouletteCustomForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      addRouletteCustomItem($('#rouletteCustomInput')?.value);
    });
    $('#btnRouletteCustomReset')?.addEventListener('click', resetRouletteCustomItems);

    $('#btnRouletteSelectAll')?.addEventListener('click', () => rouletteSelectAll(true));
    $('#btnRouletteDeselectAll')?.addEventListener('click', () => rouletteSelectAll(false));
    $('#btnRoulettePoolReset')?.addEventListener('click', rouletteResetPool);

    $('#pinballWinnerCount')?.addEventListener('change', () => {
      const classId = getClassId();
      const n = getPinballParticipants().length;
      ctSavePinballWinCount(classId, getPinballWinnerCount(n));
      renderPinballWinnerSettings();
      resetPinballBoard();
    });
    $('#pinballWinnerCount')?.addEventListener('input', renderPinballWinnerSettings);

    $('#btnPinballSelectAll')?.addEventListener('click', () => pinballSelectAll(true));
    $('#btnPinballDeselectAll')?.addEventListener('click', () => pinballSelectAll(false));
    $('#btnPinballPoolReset')?.addEventListener('click', pinballResetPool);
    $('#btnPinballStart')?.addEventListener('click', startPinballRace);
    $('#btnPinballShake')?.addEventListener('click', () => {
      pinballShakeBoard(pinballEngine, document.querySelector('.pinball-board-wrap'));
    });
    $('#btnPinballReset')?.addEventListener('click', () => {
      pinballEngine?.stop();
      pinballRunning = false;
      document.querySelector('.pinball-board-wrap')?.classList.remove('is-shaking');
      resetPinballBoard();
    });
    $('#btnPinballFullscreen')?.addEventListener('click', openPinballFullscreen);

    bindScoreboardEvents();
  }

  window.CTGames = {
    init, bindEvents, showLobby, openGame, onClassChange,
    getCurrentGameId: () => currentGameId,
    getDiceCount, rollDice,
  };
})();
