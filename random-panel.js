/**
 * Class Tools — 랜덤 게임 화면 (룰렛 · 게임 모듈 연결)
 * script.js가 넘겨주는 app(공통 도구·상태)을 받아 동작합니다.
 */
function ctCreateRandomPanel(app) {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const closeModal = (...args) => app.closeModal(...args);
  const esc = (...args) => app.esc(...args);
  const getActiveStudents = (...args) => app.getActiveStudents(...args);
  const showModal = (...args) => app.showModal(...args);
  const showToast = (...args) => app.showToast(...args);

  let rouletteMode = 'students';
  let rouletteSpinning = false;
  const rouletteState = {
    students: { excluded: new Set(), history: [], rotation: 0 },
    custom: { excluded: new Set(), history: [], rotation: 0 },
  };

  function getRouletteModeState() {
    return rouletteState[rouletteMode] || rouletteState.students;
  }

  function setRouletteMode(mode) {
    const next = mode === 'custom' ? 'custom' : 'students';
    if (rouletteMode === next) return;
    rouletteMode = next;
    renderRoulettePanel();
    renderRouletteWinner(null);
    renderRouletteHistory();
  }

  function getRoulettePool() {
    const students = getActiveStudents();
    if (!students.length) return [];
    const classId = app.state.activeClassId;
    const poolIds = new Set(ctLoadRoulettePool(classId, students.map((s) => s.id)));
    let participants = students.filter((s) => poolIds.has(s.id));
    if (!participants.length && poolIds.size === 0 && students.length) {
      participants = students;
    }
    return participants.filter((s) => !rouletteState.students.excluded.has(s.id));
  }

  function getRouletteCustomPool() {
    const classId = app.state.activeClassId;
    const items = ctLoadRouletteCustomItems(classId);
    return items.filter((item) => !rouletteState.custom.excluded.has(item.id));
  }

  function getRouletteSegments() {
    if (rouletteMode === 'custom') {
      return ctBuildRouletteCustomSegments(getRouletteCustomPool());
    }
    return ctBuildRouletteSegments(getRoulettePool());
  }

  function getRouletteEmptyHtml() {
    if (rouletteMode === 'custom') {
      return '<div class="roulette-empty">룰렛 항목이 없습니다.<br>항목을 추가해주세요.</div>';
    }
    return '<div class="roulette-empty">학생 명단이 없습니다.<br>관리실에서 학생을 등록해주세요.</div>';
  }

  function formatRouletteWinner(segment) {
    if (!segment) return '';
    if (rouletteMode === 'custom') return esc(segment.label || segment.name);
    return `${esc(segment.number)}. ${esc(segment.name)}`;
  }

  function formatRouletteHistoryEntry(entry) {
    if (entry.mode === 'custom') return esc(entry.name);
    return `${esc(entry.number)}. ${esc(entry.name)}`;
  }

  function renderRoulettePanel() {
    renderRouletteWheel($('#rouletteWheel'));
    renderRouletteHistory();
  }

  function rouletteHexToRgb(hex) {
    const h = String(hex || '#cccccc').replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16) || 204,
      g: parseInt(h.slice(2, 4), 16) || 204,
      b: parseInt(h.slice(4, 6), 16) || 204,
    };
  }

  function rouletteMixHex(hex, targetHex, ratio) {
    const c = rouletteHexToRgb(hex);
    const t = rouletteHexToRgb(targetHex);
    const mix = (a, b) => Math.round(a + (b - a) * ratio);
    const r = mix(c.r, t.r);
    const g = mix(c.g, t.g);
    const b = mix(c.b, t.b);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  function getRouletteLabelLayout(n, label, lr) {
    const segmentAngle = (Math.PI * 2) / n;
    const maxTextWidth = Math.max(18, 2 * lr * Math.sin(segmentAngle / 2) * 0.88);
    const len = [...label].length;
    let fontSize = n > 32 ? 8 : n > 24 ? 9 : n > 16 ? 10 : n > 10 ? 11 : 13;
    if (len > 5) fontSize -= Math.min(4, Math.floor((len - 5) * 0.45));
    fontSize = Math.max(6, fontSize);
    return { fontSize, maxTextWidth };
  }

  function buildRouletteSvg(segments) {
    const n = segments.length;
    if (!n) {
      return getRouletteEmptyHtml();
    }
    const cx = 200;
    const cy = 200;
    const r = 188;
    let defs = `
      <defs>
        <radialGradient id="roulette-bg-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fff"/>
          <stop offset="72%" stop-color="#faf8fc"/>
          <stop offset="100%" stop-color="#f0ecf5"/>
        </radialGradient>
        <linearGradient id="roulette-rim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffe0ec"/>
          <stop offset="50%" stop-color="#fff"/>
          <stop offset="100%" stop-color="#dceeff"/>
        </linearGradient>
      </defs>`;
    let paths = '';
    let labels = '';

    segments.forEach((seg, i) => {
      const light = rouletteMixHex(seg.color, '#ffffff', 0.38);
      const deep = rouletteMixHex(seg.color, '#c8b8d0', 0.18);
      const mid = (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
      const gradDeg = (mid * 180) / Math.PI;
      defs += `<linearGradient id="roulette-seg-${i}" gradientTransform="rotate(${gradDeg} ${cx} ${cy})">
        <stop offset="0%" stop-color="${light}"/>
        <stop offset="55%" stop-color="${seg.color}"/>
        <stop offset="100%" stop-color="${deep}"/>
      </linearGradient>`;

      const start = (i / n) * Math.PI * 2 - Math.PI / 2;
      const end = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = end - start > Math.PI ? 1 : 0;
      paths += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z"
        fill="url(#roulette-seg-${i})" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>`;

      const labelMid = (start + end) / 2;
      const lr = r * 0.66;
      const lx = cx + lr * Math.cos(labelMid);
      const ly = cy + lr * Math.sin(labelMid);
      const deg = (labelMid * 180) / Math.PI + 90;
      const label = seg.label || seg.name;
      const { fontSize, maxTextWidth } = getRouletteLabelLayout(n, label, lr);
      labels += `<text x="${lx}" y="${ly}" class="roulette-wheel__label" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${deg} ${lx} ${ly})" textLength="${maxTextWidth.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>`;
    });

    const decor = `
      <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="url(#roulette-rim)" stroke-width="7" opacity="0.95"/>
      <circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="#fff" stroke-width="2" opacity="0.9"/>`;

    const ariaLabel = rouletteMode === 'custom' ? '항목 룰렛' : '학생 룰렛';
    return `<svg viewBox="0 0 400 400" role="img" aria-label="${ariaLabel}">${defs}${paths}${decor}${labels}</svg>`;
  }

  function renderRouletteWheel(wheelEl = $('#rouletteWheel')) {
    if (!wheelEl) return;
    const segments = getRouletteSegments();
    const modeState = getRouletteModeState();
    wheelEl.innerHTML = buildRouletteSvg(segments);
    wheelEl.style.transform = `rotate(${modeState.rotation}deg)`;
    wheelEl.classList.remove('is-spinning');
  }

  function renderRouletteWinner(segment, spinning = false) {
    const html = spinning
      ? '<p class="roulette-winner__placeholder">룰렛이 돌아가는 중…</p>'
      : !segment
        ? '<p class="roulette-winner__placeholder">버튼을 눌러 룰렛을 돌려보세요</p>'
        : `<div class="roulette-winner__card">
            <p class="roulette-winner__label">당첨</p>
            <p class="roulette-winner__name">${formatRouletteWinner(segment)}</p>
          </div>`;
    ['#rouletteWinner', '#fsRouletteWinner'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  function renderRouletteHistory() {
    const wrap = $('#rouletteHistory');
    const list = $('#rouletteHistoryList');
    if (!wrap || !list) return;
    const history = getRouletteModeState().history;
    if (!history.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    list.innerHTML = history.map((h, i) =>
      `<li>${i + 1}. ${formatRouletteHistoryEntry(h)}</li>`
    ).join('');
  }

  function showRouletteSpinError() {
    if (rouletteMode === 'custom') {
      const allItems = ctLoadRouletteCustomItems(app.state.activeClassId);
      if (!allItems.length) {
        showToast('룰렛 항목을 추가해주세요.');
      } else if (rouletteState.custom.excluded.size) {
        showToast('모든 항목이 당첨되었습니다. 다시 채우기를 눌러주세요.');
      } else {
        showToast('룰렛 항목이 없습니다.');
      }
      return;
    }
    const students = getActiveStudents();
    const classId = app.state.activeClassId;
    const poolIds = classId ? ctLoadRoulettePool(classId, students.map((s) => s.id)) : [];
    if (students.length && !poolIds.length) {
      showToast('룰렛 대상자를 1명 이상 선택해주세요.');
    } else if (rouletteState.students.excluded.size) {
      showToast('모든 학생이 당첨되었습니다. 다시 채우기를 눌러주세요.');
    } else {
      showToast('학생 명단이 없습니다.');
    }
  }

  function spinRoulette() {
    if (rouletteSpinning) return;
    const segments = getRouletteSegments();
    if (!segments.length) {
      showRouletteSpinError();
      return;
    }

    const wheels = [$('#rouletteWheel'), $('#fsRouletteWheel')].filter(Boolean);
    if (!wheels.length) return;

    const modeState = getRouletteModeState();
    const winnerIdx = ctPickRouletteWinnerIndex(segments.length);
    const winner = segments[winnerIdx];
    const targetRotation = ctCalcRouletteTargetRotation(winnerIdx, segments.length, modeState.rotation);

    rouletteSpinning = true;
    renderRouletteWinner(null, true);
    const spinBtn = $('#btnSpinRoulette');
    const fsSpinBtn = $('#btnFsSpin');
    if (spinBtn) spinBtn.disabled = true;
    if (fsSpinBtn) fsSpinBtn.disabled = true;

    try {
      window.CTGameSFX?.unlock?.();
      window.CTGameSFX?.whoosh?.();
      window.CTGameSFX?.loopTicks?.(4200, 160);
    } catch { /* ignore */ }

    wheels.forEach((wheel) => {
      wheel.classList.add('is-spinning');
      requestAnimationFrame(() => {
        wheel.style.transform = `rotate(${targetRotation}deg)`;
      });
    });

    const onEnd = () => {
      wheels[0].removeEventListener('transitionend', onEnd);
      modeState.rotation = targetRotation;
      rouletteSpinning = false;
      wheels.forEach((wheel) => wheel.classList.remove('is-spinning'));

      try { window.CTGameSFX?.win?.(); } catch { /* ignore */ }

      if ($('#rouletteNoDuplicate')?.checked) {
        modeState.excluded.add(winner.id);
        modeState.rotation = 0;
        wheels.forEach((wheel) => renderRouletteWheel(wheel));
      } else {
        wheels.forEach((wheel) => {
          wheel.style.transform = `rotate(${modeState.rotation}deg)`;
        });
      }

      const historyEntry = rouletteMode === 'custom'
        ? { id: winner.id, name: winner.name, mode: 'custom' }
        : { id: winner.id, number: winner.number, name: winner.name, mode: 'students' };
      modeState.history.unshift(historyEntry);
      renderRouletteWinner(winner);
      renderRouletteHistory();
      if (spinBtn) spinBtn.disabled = false;
      if (fsSpinBtn) fsSpinBtn.disabled = false;
    };

    wheels[0].addEventListener('transitionend', onEnd);
  }

  function resetRoulette() {
    const modeState = getRouletteModeState();
    modeState.excluded.clear();
    modeState.history = [];
    modeState.rotation = 0;
    rouletteSpinning = false;
    renderRouletteWheel($('#rouletteWheel'));
    renderRouletteWheel($('#fsRouletteWheel'));
    renderRouletteWinner(null);
    renderRouletteHistory();
    const spinBtn = $('#btnSpinRoulette');
    const fsSpinBtn = $('#btnFsSpin');
    if (spinBtn) spinBtn.disabled = false;
    if (fsSpinBtn) fsSpinBtn.disabled = false;
    showToast(rouletteMode === 'custom' ? '항목 룰렛을 다시 채웠습니다.' : '학생 룰렛을 다시 채웠습니다.');
  }

  function openRouletteFullscreen() {
    if (!getRouletteSegments().length) {
      showRouletteSpinError();
      return;
    }
    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    content.className = 'fullscreen-content fullscreen-roulette';
    content.innerHTML = `
      <div class="roulette-workspace">
        <div class="roulette-stage" id="fsRouletteStage">
          <div class="roulette-pointer" aria-hidden="true"></div>
          <div class="roulette-wheel-wrap">
            <div class="roulette-wheel" id="fsRouletteWheel"></div>
          </div>
          <div class="roulette-hub-cap" aria-hidden="true"></div>
        </div>
        <div class="roulette-winner" id="fsRouletteWinner">
          <p class="roulette-winner__placeholder">룰렛 돌리기 버튼을 눌러주세요</p>
        </div>
        <button type="button" class="btn btn-primary" id="btnFsSpin" style="margin-top:8px">룰렛 돌리기!</button>
      </div>`;

    const fsWheel = $('#fsRouletteWheel');
    renderRouletteWheel(fsWheel);
    fsWheel.style.transform = `rotate(${getRouletteModeState().rotation}deg)`;
    $('#btnFsSpin').onclick = () => spinRoulette();
  }

  function renderGamesPanel() {
    const classId = app.state.activeClassId;
    const students = getActiveStudents();
    if (classId && students.length) {
      if (!sessionStorage.getItem(ctLadderPoolKey(classId))) {
        ctSaveLadderPool(classId, students.map((s) => s.id));
      }
      if (!sessionStorage.getItem(ctRoulettePoolKey(classId))) {
        ctSaveRoulettePool(classId, students.map((s) => s.id));
      }
      if (!sessionStorage.getItem(ctPinballPoolKey(classId))) {
        ctSavePinballPool(classId, students.map((s) => s.id));
      }
    }
    CTGames?.showLobby();
  }

  function openGameWinnerFullscreen(title, winnersHtml) {
    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    content.className = 'fullscreen-content fullscreen-game';
    content.innerHTML = `
      <p class="fullscreen-game__title">${esc(title)}</p>
      <div class="fullscreen-game__winners">${winnersHtml}</div>`;
  }

  function buildWinnerFullscreenHtml(students) {
    return students.map((s) =>
      `<div class="random-winner">${esc(s.number)}. ${esc(s.name)}</div>`
    ).join('');
  }

  function initGamesModule() {
    if (!window.CTGames) return;
    CTGames.init({
      showToast,
      esc,
      showModal,
      closeModal,
      getStudents: getActiveStudents,
      getClassId: () => app.state.activeClassId,
      getTreasureRewards: () => app.state.treasureRewards || [],
      onRoulettePoolChange: () => {
        rouletteState.students.excluded.clear();
        rouletteState.students.rotation = 0;
        renderRoulettePanel();
        if (rouletteMode === 'students') renderRouletteWinner(null);
      },
      onRouletteModeChange: (mode) => {
        setRouletteMode(mode);
      },
      onRouletteCustomChange: () => {
        rouletteState.custom.excluded.clear();
        rouletteState.custom.rotation = 0;
        renderRoulettePanel();
        if (rouletteMode === 'custom') {
          renderRouletteWinner(null);
          renderRouletteHistory();
        }
      },
      renderRoulette: () => {
        const classId = app.state.activeClassId;
        if (classId) rouletteMode = ctLoadRouletteMode(classId);
        renderRoulettePanel();
        renderRouletteWinner(null);
        renderRouletteHistory();
      },
      openSlotFullscreen: () => {
        const students = getActiveStudents();
        const count = parseInt($('#gamePickCount')?.value, 10) || 1;
        const winners = ctPickRandom(students, count, !$('#gameNoDuplicate')?.checked);
        openGameWinnerFullscreen('🎰 슬롯머신', buildWinnerFullscreenHtml(winners));
      },
      openTreasureFullscreen: () => {
        const rewards = app.state.treasureRewards || [];
        const reward = ctPickTreasureReward(rewards);
        if (!reward) {
          showToast('관리실에서 보물상자 보상을 등록해주세요.');
          return;
        }
        openGameWinnerFullscreen('📦 보물상자', `<div class="treasure-prize-card treasure-prize-card--fs">${esc(reward)}</div>`);
      },
      openDiceFullscreen: () => {
        const dots = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        const count = window.CTGames?.getDiceCount?.() || 2;
        const values = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6));
        const sum = values.reduce((acc, v) => acc + v, 0);
        openGameWinnerFullscreen('🎲 주사위', `
          <p class="dice-fs-roll">${values.map((v) => dots[v - 1]).join(' + ')}</p>
          <p class="dice-fs-sum">${sum}</p>`);
      },
      openLadderFullscreen: () => {
        showToast('사다리는 화면에서 진행 후 결과를 확인하세요.');
      },
    });
    CTGames.bindEvents();
  }

  return {
    getRouletteModeState,
    setRouletteMode,
    getRoulettePool,
    getRouletteCustomPool,
    getRouletteSegments,
    getRouletteEmptyHtml,
    formatRouletteWinner,
    formatRouletteHistoryEntry,
    renderRoulettePanel,
    rouletteHexToRgb,
    rouletteMixHex,
    getRouletteLabelLayout,
    buildRouletteSvg,
    renderRouletteWheel,
    renderRouletteWinner,
    renderRouletteHistory,
    showRouletteSpinError,
    spinRoulette,
    resetRoulette,
    openRouletteFullscreen,
    renderGamesPanel,
    openGameWinnerFullscreen,
    buildWinnerFullscreenHtml,
    initGamesModule,
  };
}
