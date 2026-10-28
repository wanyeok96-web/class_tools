/**
 * Class Tools — 타이머 · 스톱워치
 * script.js가 넘겨주는 app(공통 도구·상태)을 받아 동작합니다.
 */
function ctCreateTimerPanel(app) {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  let timerInterval = null;
  let timerRemaining = 300;
  let timerMode = 'countdown';
  let stopwatchElapsed = 0;
  let timerRunning = false;
  let timerPausedMidRun = false;

  function formatTime(sec) {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function getTimerDisplayValue() {
    return timerMode === 'stopwatch' ? stopwatchElapsed : timerRemaining;
  }

  function getTimerMode() {
    return timerMode;
  }

  function updateTimerDisplay() {
    const value = getTimerDisplayValue();
    const el = $('#timerDisplay');
    if (el) {
      el.textContent = formatTime(value);
      if (timerMode === 'countdown') {
        el.classList.toggle('is-warning', timerRemaining <= 60 && timerRemaining > 0);
        el.classList.toggle('is-done', timerRemaining <= 0);
      } else {
        el.classList.remove('is-warning', 'is-done');
      }
    }
    const fsEl = $('#fullscreenContent .timer-display');
    if (fsEl) {
      fsEl.textContent = formatTime(value);
      if (timerMode === 'countdown') {
        fsEl.classList.toggle('is-warning', timerRemaining <= 60 && timerRemaining > 0);
        fsEl.classList.toggle('is-done', timerRemaining <= 0);
      } else {
        fsEl.classList.remove('is-warning', 'is-done');
      }
    }
  }

  function pauseTimer() {
    if (timerInterval) timerPausedMidRun = true;
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
  }

  function switchTimerMode(mode) {
    if (mode === timerMode) return;
    pauseTimer();
    timerPausedMidRun = false;
    timerMode = mode;
    $$('.timer-mode-tab').forEach((btn) => {
      const active = btn.dataset.timerMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('#timerCountdownPanel').hidden = mode !== 'countdown';
    $('#timerStopwatchPanel').hidden = mode !== 'stopwatch';
    if (mode === 'stopwatch') {
      updateTimerDisplay();
    } else {
      const min = parseInt($('#timerMinutes')?.value, 10) || 0;
      const sec = parseInt($('#timerSeconds')?.value, 10) || 0;
      timerRemaining = min * 60 + sec;
      updateTimerDisplay();
    }
  }

  function startTimer() {
    if (timerInterval) return;
    if (timerMode === 'stopwatch') {
      timerRunning = true;
      timerInterval = setInterval(() => {
        stopwatchElapsed++;
        updateTimerDisplay();
      }, 1000);
      return;
    }
    if (!timerPausedMidRun) {
      const min = parseInt($('#timerMinutes').value, 10) || 0;
      const sec = parseInt($('#timerSeconds').value, 10) || 0;
      timerRemaining = min * 60 + sec;
    }
    timerPausedMidRun = false;
    timerRunning = true;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timerRemaining--;
      updateTimerDisplay();
      if (timerRemaining <= 0) {
        pauseTimer();
        try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onp6Wj4qEgHx4d3V0cnBwb29ubm1sa2ppaGhoZ2dmZmVlZGRkY2NiYmFhYGBfX15eXV1cXFtbWlpZWVhYV1dWVlZVVVRUVE9PT05OTk1NTEw=').play(); } catch {}
      }
    }, 1000);
  }

  function resetTimer() {
    pauseTimer();
    timerPausedMidRun = false;
    if (timerMode === 'stopwatch') {
      stopwatchElapsed = 0;
    } else {
      const min = parseInt($('#timerMinutes').value, 10) || 0;
      const sec = parseInt($('#timerSeconds').value, 10) || 0;
      timerRemaining = min * 60 + sec;
    }
    updateTimerDisplay();
  }

  return {
    formatTime,
    getTimerDisplayValue,
    getTimerMode,
    updateTimerDisplay,
    pauseTimer,
    switchTimerMode,
    startTimer,
    resetTimer,
  };
}
