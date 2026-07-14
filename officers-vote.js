/**
 * 임원투표 — 찬반 / 경합, 반장·부반장(단독·동시)
 */
(function (global) {
  'use strict';

  const ROLE_LABEL = { president: '반장', vice: '부반장' };

  let deps = {
    esc: (s) => String(s ?? ''),
    showToast: () => {},
    showModal: () => {},
    closeModal: () => {},
    getStudents: () => [],
    confirmRole: () => {},
    openFullscreen: null,
    closeFullscreen: null,
    isFullscreenOpen: () => false,
  };

  /** @type {null | object} */
  let election = null;
  /** setup draft before voting starts */
  let draft = createDraft();
  let lastFlash = '';
  /** 한 학생 투표 종료 후 확인 모달이 열린 동안 추가 입력 차단 */
  let voteGateOpen = false;

  function createDraft() {
    return {
      mode: 'president',
      voterCount: null, // null → 학급 인원으로 채움
      president: { method: 'contest', candidateIds: [] },
      vice: { method: 'contest', candidateIds: [] },
    };
  }

  function defaultVoterCount() {
    return Math.max(1, deps.getStudents().length || 1);
  }

  function resolveVoterCount() {
    const max = defaultVoterCount();
    let n = Number(draft.voterCount);
    if (!Number.isFinite(n) || n < 1) n = max;
    draft.voterCount = Math.min(max, Math.max(1, Math.floor(n)));
    return draft.voterCount;
  }

  function init(options) {
    deps = { ...deps, ...options };
  }

  function onClassChange() {
    election = null;
    draft = createDraft();
    lastFlash = '';
    releaseVoteGate(true);
  }

  function activeRoles() {
    if (!election) {
      if (draft.mode === 'both') return ['president', 'vice'];
      return [draft.mode];
    }
    if (election.mode === 'both') return ['president', 'vice'];
    return [election.mode];
  }

  function studentById(id) {
    return deps.getStudents().find((s) => s.id === id) || null;
  }

  function studentLabel(id) {
    const s = studentById(id);
    if (!s) return '알 수 없음';
    return `${s.number}. ${s.name}`;
  }

  function blockedIdsForRole(role, fromDraft) {
    const blocked = new Set();
    const src = fromDraft || draft;
    // 현재 임원(재출마)은 허용. 이번 선거에서만 역할 간 중복·당선 겸임만 막음.
    if (role === 'president') {
      (src.vice?.candidateIds || []).forEach((id) => blocked.add(id));
      if (election?.races?.vice?.winnerId) blocked.add(election.races.vice.winnerId);
    } else {
      (src.president?.candidateIds || []).forEach((id) => blocked.add(id));
      if (election?.races?.president?.winnerId) blocked.add(election.races.president.winnerId);
    }
    return blocked;
  }

  function buildRace(roleCfg) {
    const candidates = roleCfg.candidateIds.map((id, i) => ({
      studentId: id,
      symbol: i + 1,
    }));
    const tallies = {};
    candidates.forEach((c) => {
      tallies[c.studentId] = roleCfg.method === 'approval'
        ? { yes: 0, no: 0 }
        : { votes: 0 };
    });
    return {
      method: roleCfg.method,
      candidates,
      tallies,
      phase: 'voting',
      currentCandidateIndex: 0,
      ballotsCast: 0,
      winnerId: null,
      tied: false,
    };
  }

  function startElection() {
    const roles = activeRoles();
    for (const role of roles) {
      const cfg = draft[role];
      if (!cfg.candidateIds.length) {
        deps.showToast(`${ROLE_LABEL[role]} 후보를 1명 이상 선택해주세요.`);
        return;
      }
      if (cfg.method === 'contest' && cfg.candidateIds.length < 2) {
        deps.showToast(`${ROLE_LABEL[role]} 경합투표는 후보 2명 이상이 필요합니다.`);
        return;
      }
      if (cfg.method === 'approval' && cfg.candidateIds.length < 1) {
        deps.showToast(`${ROLE_LABEL[role]} 후보를 선택해주세요.`);
        return;
      }
    }

    const cross = new Set();
    if (draft.mode === 'both') {
      for (const id of draft.president.candidateIds) {
        if (draft.vice.candidateIds.includes(id)) {
          deps.showToast('같은 학생을 반장·부반장 후보에 넣을 수 없습니다.');
          return;
        }
        cross.add(id);
      }
    }

    const races = {};
    roles.forEach((role) => {
      races[role] = buildRace(draft[role]);
    });

    election = {
      mode: draft.mode,
      expectedVoters: resolveVoterCount(),
      completedVisits: 0,
      races,
      visitStep: roles[0],
      approvalSubStep: 0,
      status: 'voting',
      flash: '',
    };
    lastFlash = '';
    render();
    deps.showToast('투표를 시작합니다. 학생이 교탁에서 입력하세요.');
  }

  function totalBallots(race) {
    if (!race) return 0;
    if (race.method === 'contest') {
      return Object.values(race.tallies).reduce((n, t) => n + (t.votes || 0), 0);
    }
    return Object.values(race.tallies).reduce((n, t) => n + (t.yes || 0) + (t.no || 0), 0);
  }

  function castApproval(race, yes) {
    const cand = race.candidates[race.currentCandidateIndex];
    if (!cand) return false;
    const t = race.tallies[cand.studentId];
    if (yes) t.yes += 1;
    else t.no += 1;
    race.ballotsCast += 1;
    return true;
  }

  function castContest(race, symbol) {
    const cand = race.candidates.find((c) => c.symbol === symbol);
    if (!cand) {
      deps.showToast('없는 기호입니다.');
      return false;
    }
    race.tallies[cand.studentId].votes += 1;
    race.ballotsCast += 1;
    return true;
  }

  function nextOpenRole(fromRole) {
    const roles = activeRoles().filter((r) => election.races[r]?.phase === 'voting');
    if (!roles.length) return null;
    const idx = roles.indexOf(fromRole);
    if (idx >= 0 && idx < roles.length - 1) return roles[idx + 1];
    return roles[0];
  }

  function advanceVisitAfterCast() {
    if (!election || election.mode !== 'both') return { visitComplete: true };
    const rolesOpen = activeRoles().filter((r) => election.races[r]?.phase === 'voting');
    if (!rolesOpen.length) return { visitComplete: true };
    const idx = rolesOpen.indexOf(election.visitStep);
    if (idx >= 0 && idx < rolesOpen.length - 1) {
      election.visitStep = rolesOpen[idx + 1];
      return { visitComplete: false };
    }
    election.visitStep = rolesOpen[0];
    return { visitComplete: true };
  }

  function releaseVoteGate(silent) {
    const wasOpen = voteGateOpen;
    voteGateOpen = false;
    document.getElementById('modalBackdrop')?.classList.remove('officers-vote-gate');
    if (wasOpen) deps.closeModal?.();
    if (!silent && wasOpen) {
      lastFlash = '';
      render();
      if (deps.isFullscreenOpen?.()) syncFullscreenVote();
    }
  }

  function showVoteReceivedModal() {
    voteGateOpen = true;
    lastFlash = '';
    election.completedVisits = (election.completedVisits || 0) + 1;
    const done = election.completedVisits;
    const total = election.expectedVoters || 0;
    const remaining = Math.max(0, total - done);
    const roles = activeRoles().filter((r) => election.races[r]?.phase === 'voting');
    const nextRoleHint = election.mode === 'both' && roles.length
      ? `<p class="officers-gate-detail">다음 학생은 <strong>${deps.esc(ROLE_LABEL[election.visitStep])}</strong>부터 투표합니다.</p>`
      : '';
    const progressHint = remaining > 0
      ? `<p class="officers-gate-detail">투표 진행: <strong>${done} / ${total}</strong>명 (남은 ${remaining}명)</p>`
      : `<p class="officers-gate-detail officers-gate-complete">예정 인원 <strong>${total}명</strong> 투표가 모두 끝났습니다. 결과 공개를 진행하거나 추가 투표를 받을 수 있습니다.</p>`;

    deps.showModal?.(
      '투표 접수 완료',
      `<div class="officers-gate-modal">
        <p class="officers-gate-lead">표가 접수되었습니다.</p>
        <p class="officers-gate-detail">투표하신 분은 <strong>자리로 돌아가</strong> 주세요.</p>
        <p class="officers-gate-detail">준비가 되면 <strong>다음 학생</strong>만 교탁으로 나와 투표해 주세요.</p>
        ${progressHint}
        ${nextRoleHint}
        <p class="hint officers-gate-note">확인 버튼을 누르기 전까지 추가 투표는 입력되지 않습니다.</p>
      </div>`,
      `<button type="button" class="btn btn-primary" id="officersVoteGateOk">다음 학생 투표 시작</button>`
    );

    const backdrop = document.getElementById('modalBackdrop');
    backdrop?.classList.add('officers-vote-gate');

    const onDismiss = () => {
      if (!voteGateOpen) return;
      voteGateOpen = false;
      backdrop?.classList.remove('officers-vote-gate');
      lastFlash = '';
      render();
      if (deps.isFullscreenOpen?.()) syncFullscreenVote();
    };

    document.getElementById('officersVoteGateOk')?.addEventListener('click', () => {
      releaseVoteGate(false);
    }, { once: true });
    document.getElementById('modalClose')?.addEventListener('click', onDismiss, { once: true });
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) onDismiss();
    }, { once: true });

    render();
    if (deps.isFullscreenOpen?.()) syncFullscreenVote();
  }

  function handleVoteInput(value) {
    if (!election || election.status !== 'voting') return;
    if (voteGateOpen) {
      deps.showToast('이전 투표 확인 모달을 닫은 뒤 다음 학생이 투표하세요.');
      return;
    }
    const role = election.mode === 'both' ? election.visitStep : election.mode;
    const race = election.races[role];
    if (!race || race.phase !== 'voting') {
      const next = nextOpenRole(role);
      if (next) election.visitStep = next;
      deps.showToast('이 역할 투표는 종료되었습니다.');
      render();
      return;
    }

    let ok = false;
    if (race.method === 'approval') {
      if (value !== 0 && value !== 1) {
        deps.showToast('0(반대) 또는 1(찬성)만 입력할 수 있습니다.');
        return;
      }
      ok = castApproval(race, value === 1);
    } else {
      ok = castContest(race, value);
    }
    if (!ok) return;

    if (election.mode === 'both') {
      const { visitComplete } = advanceVisitAfterCast();
      if (visitComplete) {
        showVoteReceivedModal();
        return;
      }
      // 동시 모드: 같은 학생의 다음 역할 투표로 이어짐 (모달 없음)
      lastFlash = '';
      render();
      if (deps.isFullscreenOpen?.()) syncFullscreenVote();
      return;
    }

    showVoteReceivedModal();
  }

  function nextApprovalCandidate(role) {
    const race = election?.races?.[role];
    if (!race || race.method !== 'approval') return;
    if (race.currentCandidateIndex < race.candidates.length - 1) {
      race.currentCandidateIndex += 1;
      election.completedVisits = 0;
      lastFlash = `다음 후보: ${studentLabel(race.candidates[race.currentCandidateIndex].studentId)}`;
      if (election.mode === 'both') election.visitStep = role;
      render();
      if (deps.isFullscreenOpen?.()) syncFullscreenVote();
      return;
    }
    race.phase = 'closed';
    lastFlash = `${ROLE_LABEL[role]} 후보 투표가 모두 끝났습니다`;
    maybeAllClosed();
    render();
  }

  function closeRace(role) {
    const race = election?.races?.[role];
    if (!race) return;
    race.phase = 'closed';
    if (election.mode === 'both' && election.visitStep === role) {
      const next = nextOpenRole(role);
      if (next) election.visitStep = next;
    }
    maybeAllClosed();
    render();
  }

  function maybeAllClosed() {
    const roles = activeRoles();
    if (roles.every((r) => election.races[r].phase === 'closed' || election.races[r].phase === 'revealed' || election.races[r].phase === 'confirmed')) {
      election.status = 'closed';
    }
  }

  function resolveWinner(race) {
    if (race.method === 'contest') {
      let best = -1;
      let winners = [];
      race.candidates.forEach((c) => {
        const v = race.tallies[c.studentId].votes || 0;
        if (v > best) {
          best = v;
          winners = [c.studentId];
        } else if (v === best) {
          winners.push(c.studentId);
        }
      });
      if (best <= 0 || winners.length !== 1) {
        race.winnerId = null;
        race.tied = winners.length > 1 && best > 0;
        return;
      }
      race.winnerId = winners[0];
      race.tied = false;
      return;
    }
    let best = -1;
    let winners = [];
    race.candidates.forEach((c) => {
      const v = race.tallies[c.studentId].yes || 0;
      if (v > best) {
        best = v;
        winners = [c.studentId];
      } else if (v === best) {
        winners.push(c.studentId);
      }
    });
    if (best < 0 || winners.length !== 1) {
      race.winnerId = null;
      race.tied = winners.length > 1;
      return;
    }
    race.winnerId = winners[0];
    race.tied = false;
  }

  function revealResults() {
    if (!election) return;
    releaseVoteGate(true);
    activeRoles().forEach((role) => {
      const race = election.races[role];
      if (race.phase === 'voting') race.phase = 'closed';
      resolveWinner(race);
      race.phase = 'revealed';
    });
    election.status = 'revealed';
    lastFlash = '';
    render();
    if (deps.isFullscreenOpen?.()) {
      deps.closeFullscreen?.();
    }
  }

  function confirmWinners() {
    if (!election) return;
    let any = false;
    activeRoles().forEach((role) => {
      const race = election.races[role];
      if (race.phase !== 'revealed' && race.phase !== 'confirmed') return;
      if (!race.winnerId) {
        deps.showToast(`${ROLE_LABEL[role]} 당선자가 없어 확정할 수 없습니다. 재투표하세요.`);
        return;
      }
      deps.confirmRole(role, race.winnerId);
      race.phase = 'confirmed';
      any = true;
    });
    if (any) {
      election.status = 'confirmed';
      deps.showToast('임원이 확정되어 자리배치에 반영되었습니다.');
      render();
    }
  }

  function confirmOne(role) {
    const race = election?.races?.[role];
    if (!race?.winnerId) {
      deps.showToast('당선자가 없습니다.');
      return;
    }
    deps.confirmRole(role, race.winnerId);
    race.phase = 'confirmed';
    if (activeRoles().every((r) => election.races[r].phase === 'confirmed')) {
      election.status = 'confirmed';
    }
    deps.showToast(`${ROLE_LABEL[role]}이(가) 확정되었습니다.`);
    render();
  }

  function resetElection(keepDraft) {
    releaseVoteGate(true);
    election = null;
    if (!keepDraft) draft = createDraft();
    lastFlash = '';
    deps.closeFullscreen?.();
    render();
  }

  function retakeRace(role) {
    if (!election) return;
    const cfg = {
      method: election.races[role].method,
      candidateIds: election.races[role].candidates.map((c) => c.studentId),
    };
    election.races[role] = buildRace(cfg);
    election.status = 'voting';
    election.visitStep = role;
    election.completedVisits = 0;
    lastFlash = `${ROLE_LABEL[role]} 재투표를 시작합니다`;
    render();
  }

  /* ── UI ── */

  function toggleCandidate(role, studentId) {
    const cfg = draft[role];
    const blocked = blockedIdsForRole(role);
    if (blocked.has(studentId) && !cfg.candidateIds.includes(studentId)) {
      deps.showToast('이번 선거에서 다른 역할 후보·당선자와는 겹칠 수 없습니다.');
      return;
    }
    const idx = cfg.candidateIds.indexOf(studentId);
    if (idx >= 0) cfg.candidateIds.splice(idx, 1);
    else cfg.candidateIds.push(studentId);
    render();
  }

  function moveCandidate(role, studentId, dir) {
    const list = draft[role].candidateIds;
    const i = list.indexOf(studentId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    render();
  }

  function renderSetup(root) {
    const students = deps.getStudents().slice().sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    const roles = activeRoles();
    const voterCount = resolveVoterCount();
    const classSize = defaultVoterCount();

    const modeToggle = `
      <div class="card officers-card">
        <p class="officers-section-title">진행 방식</p>
        <div class="officers-mode-tabs" role="tablist">
          ${['president', 'vice', 'both'].map((m) => {
            const label = m === 'both' ? '동시 (반장+부반장)' : ROLE_LABEL[m];
            return `<button type="button" class="officers-mode-tab ${draft.mode === m ? 'is-active' : ''}" data-draft-mode="${m}">${deps.esc(label)}</button>`;
          }).join('')}
        </div>
        <div class="form-row officers-voter-row">
          <label class="field officers-voter-field">
            <span class="field-label">투표자 인원</span>
            <input type="number" class="input" id="officersVoterCount" min="1" max="${classSize}" value="${voterCount}" />
          </label>
          <button type="button" class="btn btn-secondary" id="officersVoterAll">전원 (${classSize}명)</button>
        </div>
        <p class="hint officers-hint">오늘 투표에 참여할 인원을 입력하세요. (학급 ${classSize}명 기준, 최대 ${classSize}명)</p>
        <p class="hint officers-hint">동시 모드에서는 학생이 교탁에 한 번 나올 때 반장 → 부반장 순으로 연속 투표합니다.</p>
      </div>`;

    const raceSetup = roles.map((role) => {
      const cfg = draft[role];
      const blocked = blockedIdsForRole(role);
      const picks = cfg.candidateIds.map((id, i) => {
        const s = studentById(id);
        if (!s) return '';
        const symbolHint = cfg.method === 'contest'
          ? `<span class="officers-symbol-badge">기호 ${i + 1}</span>`
          : `<span class="officers-symbol-badge">후보 ${i + 1}</span>`;
        return `
          <li class="officers-pick-item">
            ${symbolHint}
            <span class="officers-pick-name">${deps.esc(s.number)}. ${deps.esc(s.name)}</span>
            <span class="officers-pick-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-cand-move="${role}:${id}:-1" title="위로">↑</button>
              <button type="button" class="btn btn-secondary btn-sm" data-cand-move="${role}:${id}:1" title="아래로">↓</button>
              <button type="button" class="btn btn-secondary btn-sm" data-cand-remove="${role}:${id}">제거</button>
            </span>
          </li>`;
      }).join('');

      return `
        <div class="card officers-card" data-role-setup="${role}">
          <div class="officers-card-head">
            <p class="officers-section-title">${ROLE_LABEL[role]}</p>
            <div class="officers-method-tabs">
              <button type="button" class="officers-mode-tab ${cfg.method === 'approval' ? 'is-active' : ''}" data-method="${role}:approval">찬반</button>
              <button type="button" class="officers-mode-tab ${cfg.method === 'contest' ? 'is-active' : ''}" data-method="${role}:contest">경합</button>
            </div>
          </div>
          <p class="hint officers-hint">${cfg.method === 'approval'
            ? '후보마다 학생이 찬성(1)·반대(0)로 투표합니다. 찬성 득표가 가장 많은 학생이 당선됩니다.'
            : '후보에게 기호 번호를 부여하고, 학생이 기호 숫자를 눌러 한 표씩 투표합니다.'}</p>
          <p class="officers-sublabel">후보 목록 ${cfg.method === 'contest' ? '(선택 순 = 기호 순)' : ''}</p>
          <ul class="officers-pick-list">${picks || '<li class="officers-pick-empty">아래에서 후보를 선택하세요</li>'}</ul>
          <div class="officers-roster">
            ${students.map((s) => {
              const selected = cfg.candidateIds.includes(s.id);
              const blockedHere = blocked.has(s.id) && !selected;
              return `
                <button type="button"
                  class="officers-roster-chip ${selected ? 'is-selected' : ''} ${blockedHere ? 'is-blocked' : ''}"
                  data-cand-toggle="${role}:${s.id}"
                  ${blockedHere ? 'disabled' : ''}>
                  ${deps.esc(s.number)}. ${deps.esc(s.name)}
                </button>`;
            }).join('') || '<p class="hint">등록된 학생이 없습니다.</p>'}
          </div>
        </div>`;
    }).join('');

    root.innerHTML = `
      ${modeToggle}
      ${raceSetup}
      <div class="form-row officers-actions">
        <button type="button" class="btn btn-primary" id="officersStartBtn">투표 시작</button>
      </div>`;

    root.querySelectorAll('[data-draft-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        draft.mode = btn.dataset.draftMode;
        render();
      });
    });
    const voterInput = root.querySelector('#officersVoterCount');
    voterInput?.addEventListener('change', () => {
      draft.voterCount = Number(voterInput.value);
      resolveVoterCount();
      voterInput.value = String(draft.voterCount);
    });
    voterInput?.addEventListener('blur', () => {
      draft.voterCount = Number(voterInput.value);
      resolveVoterCount();
      voterInput.value = String(draft.voterCount);
    });
    root.querySelector('#officersVoterAll')?.addEventListener('click', () => {
      draft.voterCount = defaultVoterCount();
      render();
    });
    root.querySelectorAll('[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [role, method] = btn.dataset.method.split(':');
        draft[role].method = method;
        render();
      });
    });
    root.querySelectorAll('[data-cand-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [role, id] = btn.dataset.candToggle.split(':');
        toggleCandidate(role, id);
      });
    });
    root.querySelectorAll('[data-cand-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [role, id] = btn.dataset.candRemove.split(':');
        draft[role].candidateIds = draft[role].candidateIds.filter((x) => x !== id);
        render();
      });
    });
    root.querySelectorAll('[data-cand-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [role, id, dir] = btn.dataset.candMove.split(':');
        moveCandidate(role, id, Number(dir));
      });
    });
    root.querySelector('#officersStartBtn')?.addEventListener('click', startElection);
  }

  function raceStatusBadge(race) {
    if (race.phase === 'voting') return '<span class="officers-badge officers-badge--live">투표 중</span>';
    if (race.phase === 'closed') return '<span class="officers-badge">종료</span>';
    if (race.phase === 'revealed') return '<span class="officers-badge officers-badge--reveal">개표</span>';
    if (race.phase === 'confirmed') return '<span class="officers-badge officers-badge--done">확정</span>';
    return '';
  }

  function renderVotingBoard(role, kiosk) {
    const race = election.races[role];
    if (!race) return '';
    const focus = election.mode === 'both' && election.visitStep === role;
    const title = ROLE_LABEL[role];

    if (race.phase !== 'voting') {
      return `
        <div class="officers-vote-board ${kiosk ? 'is-kiosk' : ''} is-idle">
          <p class="officers-vote-role">${title} ${raceStatusBadge(race)}</p>
          <p class="hint">이 역할 투표는 종료되었습니다.</p>
        </div>`;
    }

    if (race.method === 'approval') {
      const cand = race.candidates[race.currentCandidateIndex];
      const s = studentById(cand.studentId);
      return `
        <div class="officers-vote-board ${kiosk ? 'is-kiosk' : ''} ${focus || election.mode !== 'both' ? 'is-focus' : ''}">
          <p class="officers-vote-role">${title} · 찬반 ${raceStatusBadge(race)}</p>
          <p class="officers-vote-progress">후보 ${race.currentCandidateIndex + 1} / ${race.candidates.length}</p>
          <p class="officers-vote-name">${deps.esc(s?.number || '')}. ${deps.esc(s?.name || '')}</p>
          <div class="officers-vote-btns">
            <button type="button" class="officers-vote-btn officers-vote-btn--no" data-vote="0" data-vote-role="${role}">
              <span class="officers-vote-num">0</span>
              <span class="officers-vote-label">반대</span>
            </button>
            <button type="button" class="officers-vote-btn officers-vote-btn--yes" data-vote="1" data-vote-role="${role}">
              <span class="officers-vote-num">1</span>
              <span class="officers-vote-label">찬성</span>
            </button>
          </div>
          <p class="officers-vote-count">이 후보 누적 표 · 비공개 (합계 ${(race.tallies[cand.studentId].yes || 0) + (race.tallies[cand.studentId].no || 0)} / ${election.expectedVoters || '–'})</p>
        </div>`;
    }

    const list = race.candidates.map((c) => {
      const s = studentById(c.studentId);
      return `<li><strong>기호 ${c.symbol}</strong> ${deps.esc(s?.number || '')}. ${deps.esc(s?.name || '')}</li>`;
    }).join('');
    const btns = race.candidates.map((c) =>
      `<button type="button" class="officers-vote-btn officers-vote-btn--symbol" data-vote="${c.symbol}" data-vote-role="${role}">
        <span class="officers-vote-num">${c.symbol}</span>
        <span class="officers-vote-label">${deps.esc(studentById(c.studentId)?.name || '')}</span>
      </button>`
    ).join('');

    return `
      <div class="officers-vote-board ${kiosk ? 'is-kiosk' : ''} ${focus || election.mode !== 'both' ? 'is-focus' : ''}">
        <p class="officers-vote-role">${title} · 경합 ${raceStatusBadge(race)}</p>
        <ul class="officers-symbol-list">${list}</ul>
        <div class="officers-vote-btns officers-vote-btns--grid">${btns}</div>
        <p class="officers-vote-count">접수 표 수 · 비공개 (합계 ${totalBallots(race)} / ${election.expectedVoters || '–'})</p>
      </div>`;
  }

  function bindVoteButtons(root) {
    root.querySelectorAll('[data-vote]').forEach((btn) => {
      if (voteGateOpen) {
        btn.disabled = true;
        return;
      }
      btn.addEventListener('click', () => {
        const role = btn.dataset.voteRole;
        if (election.mode === 'both' && election.visitStep !== role) {
          deps.showToast(`지금은 ${ROLE_LABEL[election.visitStep]} 투표 차례입니다.`);
          return;
        }
        handleVoteInput(Number(btn.dataset.vote));
      });
    });
  }

  function renderVoting(root) {
    const roles = activeRoles();
    const boards = roles.map((role) => `
      <div class="card officers-card officers-card--vote">
        ${renderVotingBoard(role, false)}
        <div class="officers-teacher-bar form-row">
          ${election.races[role].method === 'approval' && election.races[role].phase === 'voting'
            ? `<button type="button" class="btn btn-secondary" data-next-cand="${role}">다음 후보</button>` : ''}
          ${election.races[role].phase === 'voting'
            ? `<button type="button" class="btn btn-secondary" data-close-race="${role}">이 역할 투표 종료</button>` : ''}
        </div>
      </div>
    `).join('');

    const bothHint = election.mode === 'both'
      ? `<p class="hint officers-hint">동시 진행: 지금 입력 차례는 <strong>${ROLE_LABEL[election.visitStep]}</strong>입니다.</p>`
      : '';

    const done = election.completedVisits || 0;
    const total = election.expectedVoters || 0;
    const votersDone = total > 0 && done >= total;
    const progressHtml = `
      <p class="officers-progress ${votersDone ? 'is-done' : ''}">
        투표자 진행 <strong>${done} / ${total}</strong>명
        ${votersDone ? ' · 예정 인원 완료' : ''}
      </p>`;

    const gateBanner = voteGateOpen
      ? `<p class="officers-flash officers-flash--gate" aria-live="polite">투표 확인 모달이 열려 있습니다. 닫을 때까지 추가 입력은 되지 않습니다.</p>`
      : '';

    root.innerHTML = `
      <div class="card officers-card officers-live-head">
        <p class="officers-section-title">투표 진행 중</p>
        ${progressHtml}
        ${bothHint}
        ${gateBanner}
        <p class="hint">득표 상세는 숨깁니다. 종료 후 «결과 공개»로 함께 확인하세요.</p>
        <div class="form-row officers-actions">
          <button type="button" class="btn btn-secondary" id="officersKioskBtn">📺 투표기 전체화면</button>
          <button type="button" class="btn btn-primary" id="officersRevealBtn">결과 공개</button>
          <button type="button" class="btn btn-secondary" id="officersAbortBtn">투표 취소</button>
        </div>
      </div>
      ${boards}`;

    bindVoteButtons(root);
    root.querySelectorAll('[data-next-cand]').forEach((btn) => {
      btn.addEventListener('click', () => nextApprovalCandidate(btn.dataset.nextCand));
    });
    root.querySelectorAll('[data-close-race]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeRace(btn.dataset.closeRace);
        deps.showToast(`${ROLE_LABEL[btn.dataset.closeRace]} 투표를 종료했습니다.`);
      });
    });
    root.querySelector('#officersRevealBtn')?.addEventListener('click', () => {
      if (!confirm('투표를 마치고 결과를 공개할까요?')) return;
      revealResults();
    });
    root.querySelector('#officersAbortBtn')?.addEventListener('click', () => {
      if (!confirm('진행 중인 투표를 취소하고 설정으로 돌아갈까요?')) return;
      resetElection(true);
    });
    root.querySelector('#officersKioskBtn')?.addEventListener('click', openKiosk);

    // 키보드: 숫자키로 투표 (전체화면·패널 공통 document 한 번만 유지)
    ensureKeyHandler();
  }

  let keyHandlerBound = false;
  function ensureKeyHandler() {
    if (keyHandlerBound) return;
    keyHandlerBound = true;
    document.addEventListener('keydown', (e) => {
      if (!election || election.status !== 'voting') return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (!/^\d$/.test(e.key)) return;
      e.preventDefault();
      handleVoteInput(Number(e.key));
    });
  }

  function resultRows(race) {
    if (race.method === 'contest') {
      return race.candidates.map((c) => {
        const votes = race.tallies[c.studentId].votes || 0;
        const won = race.winnerId === c.studentId;
        return `
          <li class="officers-result-row ${won ? 'is-winner' : ''}">
            <span class="officers-symbol-badge">기호 ${c.symbol}</span>
            <span class="officers-result-name">${deps.esc(studentLabel(c.studentId))}</span>
            <span class="officers-result-count">${votes}표</span>
            ${won ? '<span class="officers-winner-tag">당선</span>' : ''}
          </li>`;
      }).join('');
    }
    return race.candidates.map((c) => {
      const t = race.tallies[c.studentId];
      const won = race.winnerId === c.studentId;
      return `
        <li class="officers-result-row ${won ? 'is-winner' : ''}">
          <span class="officers-result-name">${deps.esc(studentLabel(c.studentId))}</span>
          <span class="officers-result-count">찬성 ${t.yes || 0} · 반대 ${t.no || 0}</span>
          ${won ? '<span class="officers-winner-tag">당선</span>' : ''}
        </li>`;
    }).join('');
  }

  function renderResults(root) {
    const roles = activeRoles();
    const blocks = roles.map((role) => {
      const race = election.races[role];
      const tieMsg = race.tied
        ? `<p class="officers-tie">동점입니다. 재투표해 주세요.</p>`
        : '';
      const noWin = !race.winnerId && !race.tied
        ? `<p class="officers-tie">유효한 당선자가 없습니다.</p>`
        : '';
      return `
        <div class="card officers-card">
          <div class="officers-card-head">
            <p class="officers-section-title">${ROLE_LABEL[role]} 결과</p>
            ${raceStatusBadge(race)}
          </div>
          ${tieMsg}${noWin}
          <ul class="officers-result-list">${resultRows(race)}</ul>
          <div class="form-row officers-actions">
            ${race.phase === 'revealed' && race.winnerId
              ? `<button type="button" class="btn btn-primary" data-confirm-one="${role}">${ROLE_LABEL[role]} 확정</button>` : ''}
            ${race.phase !== 'confirmed'
              ? `<button type="button" class="btn btn-secondary" data-retake="${role}">재투표</button>` : ''}
          </div>
        </div>`;
    }).join('');

    const allRevealed = roles.every((r) => ['revealed', 'confirmed'].includes(election.races[r].phase));
    const canConfirmAll = roles.every((r) => election.races[r].winnerId && election.races[r].phase === 'revealed');

    root.innerHTML = `
      <div class="card officers-card officers-live-head">
        <p class="officers-section-title">결과 공개</p>
        <p class="hint">확정하면 자리배치의 반장·부반장에 반영됩니다.</p>
        <div class="form-row officers-actions">
          ${canConfirmAll ? '<button type="button" class="btn btn-primary" id="officersConfirmAll">모두 확정</button>' : ''}
          <button type="button" class="btn btn-secondary" id="officersNewBtn">새 투표 설정</button>
        </div>
      </div>
      ${blocks}`;

    root.querySelectorAll('[data-confirm-one]').forEach((btn) => {
      btn.addEventListener('click', () => confirmOne(btn.dataset.confirmOne));
    });
    root.querySelectorAll('[data-retake]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm(`${ROLE_LABEL[btn.dataset.retake]}을(를) 같은 후보로 다시 투표할까요?`)) return;
        retakeRace(btn.dataset.retake);
      });
    });
    root.querySelector('#officersConfirmAll')?.addEventListener('click', confirmWinners);
    root.querySelector('#officersNewBtn')?.addEventListener('click', () => {
      resetElection(false);
    });
    void allRevealed;
  }

  function openKiosk() {
    if (!deps.openFullscreen) {
      deps.showToast('전체화면을 열 수 없습니다.');
      return;
    }
    deps.openFullscreen({
      className: 'fullscreen-content fullscreen-officers',
      html: kioskHtml(),
      onReady: (content) => bindVoteButtons(content),
    });
  }

  function kioskHtml() {
    if (voteGateOpen) {
      return `
        <div class="officers-kiosk officers-kiosk--gate">
          <p class="officers-kiosk-step">투표 접수 완료</p>
          <p class="officers-gate-lead">표가 접수되었습니다.</p>
          <p class="officers-gate-detail">자리로 돌아가 주세요. 확인 후 다음 학생이 투표합니다.</p>
        </div>`;
    }
    const role = election.mode === 'both' ? election.visitStep : election.mode;
    const both = election.mode === 'both'
      ? `<p class="officers-kiosk-step">${ROLE_LABEL[election.visitStep]} 투표</p>`
      : '';
    return `
      <div class="officers-kiosk">
        ${both}
        ${renderVotingBoard(role, true)}
      </div>`;
  }

  function syncFullscreenVote() {
    const content = document.getElementById('fullscreenContent');
    if (!content || !election || election.status !== 'voting') return;
    content.className = 'fullscreen-content fullscreen-officers';
    content.innerHTML = kioskHtml();
    bindVoteButtons(content);
  }

  function render() {
    const root = document.getElementById('officersWorkspace');
    if (!root) return;
    const students = deps.getStudents();
    if (!students.length) {
      root.innerHTML = `<div class="card officers-card"><p class="hint">관리실에서 학급과 학생을 먼저 등록해주세요.</p></div>`;
      return;
    }
    if (!election) {
      renderSetup(root);
      return;
    }
    if (election.status === 'voting' || election.status === 'closed') {
      renderVoting(root);
      return;
    }
    renderResults(root);
  }

  global.CTOfficers = {
    init,
    render,
    onClassChange,
    syncFullscreenVote,
  };
})(window);
