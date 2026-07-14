/**
 * Class Tools — 게임/연출용 Web Audio 사운드
 * 외부 파일 없이 짧은 효과음을 합성합니다.
 */
(function (global) {
  'use strict';

  let ctx = null;
  let unlocked = false;

  function getCtx() {
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    unlocked = true;
    return ctx;
  }

  function unlock() {
    getCtx();
  }

  function tone({
    type = 'sine',
    freq = 440,
    freqEnd = null,
    duration = 0.12,
    attack = 0.008,
    volume = 0.12,
    delay = 0,
  } = {}) {
    try {
      const ac = getCtx();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd != null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch {
      /* ignore */
    }
  }

  function noiseBurst({ duration = 0.08, volume = 0.06, delay = 0 } = {}) {
    try {
      const ac = getCtx();
      if (!ac) return;
      const len = Math.floor(ac.sampleRate * duration);
      const buffer = ac.createBuffer(1, len, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.7;
      src.buffer = buffer;
      const t0 = ac.currentTime + delay;
      gain.gain.setValueAtTime(volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ac.destination);
      src.start(t0);
      src.stop(t0 + duration + 0.02);
    } catch {
      /* ignore */
    }
  }

  const SFX = {
    unlock,
    isUnlocked: () => unlocked,

    click() {
      tone({ type: 'triangle', freq: 720, freqEnd: 540, duration: 0.06, volume: 0.07 });
    },

    tick(step = 0) {
      const base = 680 + (step % 4) * 35;
      tone({ type: 'square', freq: base, duration: 0.035, attack: 0.002, volume: 0.035 });
    },

    whoosh() {
      noiseBurst({ duration: 0.18, volume: 0.05 });
      tone({ type: 'sine', freq: 280, freqEnd: 520, duration: 0.2, volume: 0.06 });
    },

    pop() {
      tone({ type: 'sine', freq: 480, freqEnd: 760, duration: 0.1, volume: 0.1 });
    },

    flip() {
      noiseBurst({ duration: 0.05, volume: 0.04 });
      tone({ type: 'triangle', freq: 360, freqEnd: 640, duration: 0.1, volume: 0.08 });
    },

    dice() {
      noiseBurst({ duration: 0.12, volume: 0.05 });
      tone({ type: 'square', freq: 180, freqEnd: 90, duration: 0.14, volume: 0.05 });
      tone({ type: 'triangle', freq: 520, duration: 0.05, volume: 0.05, delay: 0.12 });
    },

    bounce(step = 0) {
      const f = 320 + (step % 5) * 40;
      tone({ type: 'sine', freq: f, freqEnd: f * 0.7, duration: 0.07, volume: 0.06 });
    },

    scoreUp() {
      tone({ type: 'sine', freq: 520, duration: 0.07, volume: 0.08 });
      tone({ type: 'sine', freq: 690, duration: 0.09, volume: 0.08, delay: 0.06 });
    },

    scoreDown() {
      tone({ type: 'sine', freq: 440, duration: 0.07, volume: 0.07 });
      tone({ type: 'sine', freq: 320, duration: 0.1, volume: 0.07, delay: 0.05 });
    },

    win() {
      tone({ type: 'triangle', freq: 523.25, duration: 0.12, volume: 0.1 });
      tone({ type: 'triangle', freq: 659.25, duration: 0.12, volume: 0.1, delay: 0.1 });
      tone({ type: 'triangle', freq: 783.99, duration: 0.18, volume: 0.11, delay: 0.2 });
      tone({ type: 'sine', freq: 1046.5, duration: 0.22, volume: 0.08, delay: 0.32 });
    },

    /** 사다리 이동 중 반복 틱 */
    loopTicks(ms, interval = 180) {
      const count = Math.max(1, Math.floor(ms / interval));
      for (let i = 0; i < count; i++) {
        setTimeout(() => SFX.tick(i), i * interval);
      }
    },
  };

  global.CTGameSFX = SFX;
})(window);
