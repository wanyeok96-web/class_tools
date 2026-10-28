/**
 * Class Tools v1.0 — 메인 앱
 */
(function () {
  'use strict';

  /** 방문 기록 API — 백엔드: gas/visitor-counter/Code.gs */
  const VISITOR_API_URL =
    'https://script.google.com/macros/s/AKfycbzkoq_3DyvPsX05x1YX2qTy2eNWKLt5fP_6fPBOIIJtZWrL2d6cyPW3kLP9eiPdvWQm/exec?action=visit';

  /** 메인 타일 (동일 계층 그리드) */
  const HUB_ITEMS = [
    { id: 'seats', icon: '🪑', label: '자리배치', color: '#7c3aed' },
    { id: 'groups', icon: '👥', label: '모둠편성', color: '#16a34a' },
    { id: 'random', icon: '🎲', label: '랜덤게임', color: '#9333ea' },
    { id: 'presentation', icon: '📋', label: '발표순서', color: '#dc2626' },
    { id: 'officers', icon: '🗳️', label: '임원투표', color: '#1d4ed8' },
    { id: 'duties', icon: '🧹', label: '당번관리', color: '#ea580c' },
    { id: 'timer', icon: '⏱️', label: '타이머', color: '#0d9488' },
    { id: 'signature', icon: '✍️', label: '서명·도장', color: '#ca8a04' },
    { id: 'convert', icon: '📄', label: '문서변환', color: '#475569' },
  ];

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  let state = { version: '1.0', user: { school: '', name: '' }, classes: [], activeClassId: null, teachingClasses: [] };
  let currentPanel = null;
  let seatSortables = [];
  let seatMoveHighlightIds = null;
  let presentationSortables = [];
  let presentationMode = 'class';
  let presentationViewActive = false;
  let seatContext = { classId: null };
  let seatAutoAssignToken = 0;
  let seatRevealBusy = false;
  let seatAudioCtx = null;
  let isNavigating = false;
  const NAV_HUB_MS = 320;
  const NAV_PANEL_MS = 280;

  /* ── 기능별 모듈 연결 (seat-rules-panel.js · duties-panel.js · random-panel.js · timer-panel.js · print-output.js) ── */
  const app = {
    get state() { return state; },
    get seatRevealBusy() { return seatRevealBusy; },
    get presentationMode() { return presentationMode; },
    get presentationViewActive() { return presentationViewActive; },
    closeModal,
    ensureSeatMeta,
    esc,
    getActiveStudents,
    getClassDisplayLabel,
    getSeatClass,
    getStudentName,
    getUserSchool,
    saveAndRefresh,
    showModal,
    showToast,
  };
  const seatRulesPanel = ctCreateSeatRulesPanel(app);
  const dutiesPanel = ctCreateDutiesPanel(app);
  const randomPanel = ctCreateRandomPanel(app);
  const timerPanel = ctCreateTimerPanel(app);
  const printOutput = ctCreatePrintOutput(app);
  Object.assign(app, seatRulesPanel, dutiesPanel, randomPanel, timerPanel, printOutput);
  const {
    ensureSeatRules,
    getActiveSeatRules,
    syncSeatRules,
    seatRuleNameOf,
    updateSeatRulesButton,
    updateSeatConfirmHint,
    confirmCurrentSeats,
    setSeatRuleAlert,
    clearSeatRuleAlert,
    resetSeatRuleAlert,
    getSeatRuleAlert,
    renderSeatRuleAlert,
    seatViolationReport,
    openSeatRulesModal,
  } = seatRulesPanel;
  const {
    renderDuties,
  } = dutiesPanel;
  const {
    spinRoulette,
    resetRoulette,
    openRouletteFullscreen,
    renderGamesPanel,
    initGamesModule,
  } = randomPanel;
  const {
    formatTime,
    getTimerDisplayValue,
    getTimerMode,
    pauseTimer,
    switchTimerMode,
    startTimer,
    resetTimer,
  } = timerPanel;
  const {
    openTeacherSeatPreview,
    openBoardSeatPreview,
    openSeatEnlargeFullscreen,
    printGroups,
    printPresentation,
  } = printOutput;

  /* ── 유틸 ── */
  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, 2800);
  }
  window.ctShowToast = showToast;

  function showModal(title, bodyHtml, footerHtml = '', options = {}) {
    const backdrop = $('#modalBackdrop');
    const modal = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#modalFooter').innerHTML = footerHtml;
    modal.classList.toggle('modal--wide', !!options.wide);
    backdrop.hidden = false;
    backdrop.classList.add('is-open');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const backdrop = $('#modalBackdrop');
    $('#modal').classList.remove('modal--wide');
    backdrop.hidden = true;
    backdrop.classList.remove('is-open');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  function getStudentName(id) {
    for (const cls of state.classes) {
      const s = cls.students.find((st) => st.id === id);
      if (s) return s.name;
    }
    return '알 수 없음';
  }

  function getActiveStudents() {
    const cls = ctGetActiveClass(state);
    return cls?.students || [];
  }

  function saveAndRefresh() {
    ctSaveState(state);
    refreshHeader();
  }

  /* ── 허브 타일 그리드 ── */
  function createHubTile(item, index) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hub-tile';
    el.style.setProperty('--hub-i', index);
    el.style.setProperty('--accent', item.color);
    el.style.setProperty('--hub-enter-delay', `${(0.08 + index * 0.045).toFixed(2)}s`);
    el.dataset.panel = item.id;
    el.setAttribute('aria-label', item.label);
    el.innerHTML = `
      <span class="hub-tile__icon" aria-hidden="true">${item.icon}</span>
      <span class="hub-tile__title">${item.label}</span>`;
    return el;
  }

  function pulseHubNode(node) {
    node.classList.remove('is-pulse');
    void node.offsetWidth;
    node.classList.add('is-pulse');
  }

  function renderHub(onReady) {
    const nodes = $('#hubNodes');
    if (!nodes) {
      onReady?.();
      return;
    }
    nodes.innerHTML = '';
    HUB_ITEMS.forEach((item, i) => {
      nodes.appendChild(createHubTile(item, i));
    });
    if ($('#hubDashboard')?.classList.contains('hub-enter-done')) {
      $$('.hub-tile').forEach((c) => { c.style.opacity = '1'; });
    }
    onReady?.();
  }

  function renderHeroWelcome() {
    const el = $('#heroWelcome');
    if (!el) return;
    const name = state.user?.name?.trim();
    el.textContent = name ? `환영합니다! ${name} 선생님👋` : '환영합니다! 선생님👋';
  }

  function playHeroEnterAnimation() {
    const hero = $('#homeHero');
    if (!hero) return;
    hero.classList.remove('hero-animate-in');
    void hero.offsetWidth;
    hero.classList.add('hero-animate-in');
  }

  function playHubEnterAnimation() {
    const hub = $('#hubDashboard');
    if (!hub) return;
    hub.classList.remove('hub-enter-done', 'hub-animate-in');
    void hub.offsetWidth;
    hub.classList.add('hub-animate-in');
    clearTimeout(playHubEnterAnimation._doneT);
    playHubEnterAnimation._doneT = setTimeout(() => {
      hub.classList.add('hub-enter-done');
      hub.classList.remove('hub-animate-in');
    }, 900);
  }

  function playHomeEnterAnimation() {
    playHeroEnterAnimation();
    playHubEnterAnimation();
  }

  function setToolbarMode(isPanel) {
    $('#appToolbar')?.classList.toggle('is-panel-mode', isPanel);
    const panelField = $('#panelClassField');
    if (panelField) panelField.hidden = !isPanel;
  }

  function runPanelRenderer(panelId) {
    if (panelId === 'presentation') {
      presentationViewActive = false;
      destroyPresentationSortables();
    }
    const renderers = {
      office: renderOffice,
      seats: renderSeats,
      groups: renderGroups,
      random: renderGamesPanel,
      presentation: renderPresentation,
      officers: () => window.CTOfficers?.render(),
      duties: renderDuties,
      timer: () => {},
      signature: () => window.CTSignature?.init(),
      convert: () => window.CTConvert?.init(),
    };
    renderers[panelId]?.();
  }

  function showPanel(panelId) {
    $$('.panel').forEach((p) => {
      const active = p.dataset.panel === panelId;
      p.hidden = !active;
      p.classList.remove('panel-enter', 'panel-exit');
      if (active) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            p.classList.add('panel-enter');
            // fill-mode both의 transform이 툴바 클릭을 가리지 않도록 애니 후 제거
            setTimeout(() => p.classList.remove('panel-enter'), 450);
          });
        });
      }
    });
    $('#btnOffice')?.classList.toggle('is-active', panelId === 'office');
    runPanelRenderer(panelId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── 네비게이션 ── */
  function openPanel(panelId) {
    if (currentPanel === panelId) return;
    // 애니·자동배치 등으로 플래그가 남더라도 네비게이션은 살림
    if (isNavigating) {
      isNavigating = false;
    }

    if (currentPanel) {
      isNavigating = true;
      const prev = $(`.panel[data-panel="${currentPanel}"]`);
      prev?.classList.add('panel-exit');
      setTimeout(() => {
        currentPanel = panelId;
        showPanel(panelId);
        isNavigating = false;
      }, NAV_PANEL_MS);
      return;
    }

    isNavigating = true;
    const landing = $('#homeLanding');
    landing?.classList.add('is-exiting');
    $('#hubDashboard')?.classList.remove('hub-animate-in');
    $('#homeHero')?.classList.remove('hero-animate-in');

    setTimeout(() => {
      currentPanel = panelId;
      if (landing) {
        landing.hidden = true;
        landing.classList.remove('is-exiting');
      }
      setToolbarMode(true);
      $('#panels').hidden = false;
      $('#btnBack').hidden = false;
      showPanel(panelId);
      isNavigating = false;
    }, NAV_HUB_MS);
  }

  function goHome() {
    if (!currentPanel) return;
    if (isNavigating) {
      isNavigating = false;
    }

    seatAutoAssignToken += 1;
    seatRevealBusy = false;
    const autoBtn = $('#btnAutoAssign');
    if (autoBtn) autoBtn.disabled = false;

    isNavigating = true;
    const active = $(`.panel[data-panel="${currentPanel}"]`);
    active?.classList.add('panel-exit');

    setTimeout(() => {
      currentPanel = null;
      $$('.panel').forEach((p) => {
        p.hidden = true;
        p.classList.remove('panel-enter', 'panel-exit');
      });
      $('#panels').hidden = true;
      $('#btnBack').hidden = true;
      $('#btnOffice')?.classList.remove('is-active');

      const landing = $('#homeLanding');
      if (landing) {
        landing.hidden = false;
        landing.classList.add('is-returning');
        renderHub(playHomeEnterAnimation);
        renderHeroWelcome();
        renderBackupReminder();
        setTimeout(() => landing.classList.remove('is-returning'), 500);
      }
      setToolbarMode(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      isNavigating = false;
    }, NAV_PANEL_MS);
  }

  function ensureActiveClass() {
    if (!state.classes.length) {
      state.activeClassId = null;
      seatContext.classId = null;
      return;
    }
    const valid = state.classes.some((c) => c.id === state.activeClassId);
    if (!valid) {
      state.activeClassId = state.classes[0].id;
      seatContext.classId = state.activeClassId;
    }
  }

  function setActiveClass(classId) {
    if (!classId || !state.classes.find((c) => c.id === classId)) return;
    state.activeClassId = classId;
    seatContext.classId = classId;
    saveAndRefresh();
    CTGames?.onClassChange();
    if (currentPanel === 'presentation') {
      presentationViewActive = false;
      destroyPresentationSortables();
    }
    if (currentPanel === 'office') {
      renderClassList();
      renderStudentClassSelect();
    } else if (currentPanel) {
      if (currentPanel === 'officers') {
        window.CTOfficers?.onClassChange();
      }
      const panelRenderers = {
        seats: renderSeats,
        groups: renderGroups,
        presentation: renderPresentation,
        officers: () => window.CTOfficers?.render(),
        duties: renderDuties,
      };
      panelRenderers[currentPanel]?.();
    }
  }

  function renderClassSelects() {
    ensureActiveClass();
    const empty = '<option value="">학급을 등록해주세요</option>';
    const options = !state.classes.length
      ? empty
      : state.classes.map((c) =>
          `<option value="${c.id}" ${c.id === state.activeClassId ? 'selected' : ''}>${esc(c.name)}</option>`
        ).join('');
    $$('#heroClassSelect, #panelClassSelect').forEach((sel) => {
      if (!sel) return;
      sel.innerHTML = options;
      sel.disabled = !state.classes.length;
      if (state.classes.length && state.activeClassId) {
        sel.value = state.activeClassId;
      }
    });
  }

  function refreshHeader() {
    renderClassSelects();
  }

  /* ── 관리실 ── */
  function getUserSchool() {
    return state.user?.school || state.school?.name || '';
  }

  function renderOffice() {
    $('#userSchool').value = state.user?.school || '';
    $('#userName').value = state.user?.name || '';
    renderClassList();
    renderStudentClassSelect();
    renderStudentTable();
    renderTreasureRewards();
    renderDataStatus();
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderDataStatus() {
    const status = $('#backupStatus');
    if (status) {
      const { lastBackupAt } = ctGetBackupMeta();
      status.textContent = lastBackupAt
        ? `마지막 백업: ${formatDateTime(lastBackupAt)} (이 브라우저 기준)`
        : '이 브라우저에서 백업한 기록이 없습니다.';
    }
    const undo = ctGetUndo();
    const box = $('#undoBox');
    if (box) {
      box.hidden = !undo;
      if (undo) {
        const what = undo.reason === 'reset' ? '전체 초기화' : '백업 복원';
        $('#undoText').textContent = `${formatDateTime(undo.at)} ${what} 직전 데이터(학급 ${undo.summary.classes}개 · 학생 ${undo.summary.students}명)로 되돌릴 수 있습니다.`;
      }
    }
    renderBackupReminder();
  }

  function renderBackupReminder() {
    const el = $('#backupReminder');
    if (!el) return;
    const reminder = ctBackupReminder(state);
    el.hidden = !reminder;
    if (!reminder) return;
    $('#backupReminderText').textContent = reminder.never
      ? '💡 아직 백업한 적이 없습니다. 브라우저 기록을 지우거나 PC를 바꾸면 학급 데이터가 사라질 수 있어요.'
      : `💡 마지막 백업 후 ${reminder.days}일이 지났습니다. 학급 데이터를 백업해 두세요.`;
  }

  function reloadStateFromStorage() {
    state = ctLoadState();
    ensureActiveClass();
    seatContext = { classId: state.activeClassId };
    renderOffice();
    refreshHeader();
    renderHeroWelcome();
  }

  function confirmImportBackup(data, summary) {
    const current = ctSummarizeState(state);
    const when = summary.exportedAt ? ` (${formatDateTime(summary.exportedAt)} 백업)` : '';
    showModal(
      '📂 백업 복원',
      `<p>백업 파일${esc(when)}: <strong>학급 ${summary.classes}개 · 학생 ${summary.students}명</strong></p>
       <p>현재 데이터(학급 ${current.classes}개 · 학생 ${current.students}명)를 이 백업으로 바꿉니다.</p>
       <p class="field-hint">복원 직전 데이터는 관리실의 '되돌리기'로 한 번 되살릴 수 있습니다.</p>`,
      `<button type="button" class="btn btn-secondary" id="modalImportCancel">취소</button>
       <button type="button" class="btn btn-primary" id="modalImportOk">복원</button>`
    );
    $('#modalImportCancel').onclick = closeModal;
    $('#modalImportOk').onclick = () => {
      const undoSaved = ctApplyBackup(data);
      closeModal();
      reloadStateFromStorage();
      showToast(undoSaved ? '데이터가 복원되었습니다.' : '복원했습니다. (저장 공간이 부족해 되돌리기는 준비하지 못했습니다)');
    };
  }

  function confirmResetAll() {
    const current = ctSummarizeState(state);
    showModal(
      '🗑️ 전체 초기화',
      `<p>학급 ${current.classes}개 · 학생 ${current.students}명의 데이터를 모두 지웁니다.</p>
       <p class="field-hint">초기화 직전 데이터는 관리실의 '되돌리기'로 한 번 되살릴 수 있습니다. 확실히 보관하려면 먼저 백업을 받아 두세요.</p>`,
      `<button type="button" class="btn btn-secondary" id="modalResetCancel">취소</button>
       <button type="button" class="btn btn-danger" id="modalResetOk">초기화</button>`
    );
    $('#modalResetCancel').onclick = closeModal;
    $('#modalResetOk').onclick = () => {
      const undoSaved = ctResetAll();
      closeModal();
      reloadStateFromStorage();
      showToast(undoSaved ? '초기화되었습니다.' : '초기화했습니다. (저장 공간이 부족해 되돌리기는 준비하지 못했습니다)');
    };
  }

  function confirmUndoData() {
    const undo = ctGetUndo();
    if (!undo) return;
    const current = ctSummarizeState(state);
    showModal(
      '↩️ 되돌리기',
      `<p>${esc(formatDateTime(undo.at))} 직전 데이터(학급 ${undo.summary.classes}개 · 학생 ${undo.summary.students}명)로 되돌립니다.</p>
       <p class="field-hint">지금 데이터(학급 ${current.classes}개 · 학생 ${current.students}명)는 사라집니다.</p>`,
      `<button type="button" class="btn btn-secondary" id="modalUndoCancel">취소</button>
       <button type="button" class="btn btn-primary" id="modalUndoOk">되돌리기</button>`
    );
    $('#modalUndoCancel').onclick = closeModal;
    $('#modalUndoOk').onclick = () => {
      ctRestoreUndo();
      closeModal();
      reloadStateFromStorage();
      showToast('이전 데이터로 되돌렸습니다.');
    };
  }

  function renderTreasureRewards() {
    const list = $('#treasureRewardList');
    if (!list) return;
    const rewards = state.treasureRewards || [];
    if (!rewards.length) {
      list.innerHTML = '<p class="field-hint">등록된 보상이 없습니다.</p>';
      return;
    }
    list.innerHTML = rewards.map((r, i) => `
      <li class="treasure-reward-item">
        <span class="treasure-reward-item__text">${esc(r)}</span>
        <button type="button" class="btn-icon-only btn-delete-reward" data-idx="${i}" title="삭제" aria-label="삭제">✕</button>
      </li>
    `).join('');
    list.querySelectorAll('.btn-delete-reward').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx < 0 || idx >= state.treasureRewards.length) return;
        state.treasureRewards.splice(idx, 1);
        ctSaveState(state);
        renderTreasureRewards();
        showToast('보상이 삭제되었습니다.');
      });
    });
  }

  function renderClassList() {
    const list = $('#classList');
    if (!state.classes.length) {
      list.innerHTML = '<p class="field-hint">등록된 학급이 없습니다.</p>';
      return;
    }
    list.innerHTML = state.classes.map((c) => {
      const isActive = c.id === state.activeClassId;
      const meta = [c.grade ? `${c.grade}학년` : '', c.classLabel].filter(Boolean).join(' · ');
      return `
      <div class="class-item ${isActive ? 'is-active' : ''}" data-class-id="${c.id}" role="button" tabindex="0" aria-pressed="${isActive}">
        <div class="class-item__radio" aria-hidden="true">${isActive ? '●' : '○'}</div>
        <div class="class-item__info">
          <div class="class-item__name">${esc(c.name)}</div>
          <div class="class-item__meta">${esc(meta || '학급')} · 학생 ${c.students.length}명</div>
        </div>
        ${isActive ? '<span class="class-item__badge">사용 중</span>' : ''}
        <button type="button" class="btn-icon-only btn-delete-class" data-class-id="${c.id}" title="삭제">🗑</button>
      </div>`;
    }).join('');

    list.querySelectorAll('.class-item').forEach((item) => {
      const select = () => setActiveClass(item.dataset.classId);
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-class')) return;
        select();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
    });
    list.querySelectorAll('.btn-delete-class').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('이 학급을 삭제하시겠습니까?')) {
          state = ctDeleteClass(btn.dataset.classId);
          renderOffice();
          refreshHeader();
        }
      });
    });
  }

  function renderStudentClassSelect() {
    const sel = $('#studentClassSelect');
    sel.innerHTML = state.classes.map((c) =>
      `<option value="${c.id}" ${c.id === state.activeClassId ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  }

  function getSelectedClassForStudents() {
    const id = $('#studentClassSelect').value || state.activeClassId;
    return state.classes.find((c) => c.id === id);
  }

  function renderStudentTable() {
    const cls = getSelectedClassForStudents();
    const tbody = $('#studentTableBody');
    if (!cls) {
      tbody.innerHTML = '<tr><td colspan="5">학급을 먼저 추가해주세요.</td></tr>';
      return;
    }
    tbody.innerHTML = cls.students.map((s) => `
      <tr data-student-id="${s.id}">
        <td><input class="input input-sm" type="text" inputmode="numeric" value="${s.number}" data-field="number" style="width:72px" /></td>
        <td><input class="input input-sm" type="text" value="${esc(s.name)}" data-field="name" /></td>
        <td>
          <select class="input input-sm input-select" data-field="gender" style="width:70px">
            <option value="M" ${s.gender === 'M' ? 'selected' : ''}>남</option>
            <option value="F" ${s.gender === 'F' ? 'selected' : ''}>여</option>
          </select>
        </td>
        <td><input class="input input-sm" type="text" value="${esc(s.note || '')}" data-field="note" /></td>
        <td><button type="button" class="btn-icon-only btn-del-student" data-id="${s.id}">✕</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('change', () => {
        const row = el.closest('tr');
        const sid = row.dataset.studentId;
        const student = cls.students.find((st) => st.id === sid);
        if (!student) return;
        const field = el.dataset.field;
        student[field] = field === 'number' ? parseInt(el.value, 10) || 0
          : field === 'seatNumber' ? parseInt(el.value, 10) || 0
          : el.value;
        saveAndRefresh();
      });
    });
    tbody.querySelectorAll('.btn-del-student').forEach((btn) => {
      btn.addEventListener('click', () => {
        cls.students = cls.students.filter((s) => s.id !== btn.dataset.id);
        saveAndRefresh();
        renderStudentTable();
        renderClassList();
      });
    });
  }

  function showStudentPreview(students, onSave) {
    const preview = students.slice(0, 5).map((s) =>
      `학번 ${s.number} ${s.name} (${s.gender === 'M' ? '남' : '여'})`
    ).join('<br>');
    showModal(
      '명단 미리보기',
      `<p>총 <strong>${students.length}명</strong>이 추출되었습니다.</p>
       <div style="margin:12px 0;padding:12px;background:#f5f7fb;border-radius:10px;font-size:0.88rem">${preview}${students.length > 5 ? '<br>...' : ''}</div>
       <p class="field-hint">민감 정보(생년월일, 주소 등)는 자동 제외됩니다.</p>`,
      `<button type="button" class="btn btn-secondary" id="modalCancel">취소</button>
       <button type="button" class="btn btn-primary" id="modalSave">저장</button>`
    );
    $('#modalCancel').onclick = closeModal;
    $('#modalSave').onclick = () => { onSave(students); closeModal(); };
  }

  function showPasteModal() {
    showModal(
      '엑셀 붙여넣기',
      `<p>나이스 명렬표를 복사하여 아래에 붙여넣으세요.</p>
       <textarea id="pasteArea" class="input" style="width:100%;height:200px;resize:vertical" placeholder="Ctrl+V"></textarea>`,
      `<button type="button" class="btn btn-secondary" id="modalCancel">취소</button>
       <button type="button" class="btn btn-primary" id="modalParse">분석</button>`
    );
    $('#modalCancel').onclick = closeModal;
    $('#modalParse').onclick = () => {
      try {
        const cls = getSelectedClassForStudents();
        const students = ctParsePasteText($('#pasteArea').value, {
          grade: cls?.grade, classLabel: cls?.classLabel || cls?.classNumber,
        });
        closeModal();
        showStudentPreview(students, (parsed) => {
          if (cls) {
            cls.students = parsed;
            saveAndRefresh();
            renderStudentTable();
            renderClassList();
            showToast(`${parsed.length}명 저장되었습니다.`);
          }
        });
      } catch (err) {
        showToast(err.message);
      }
    };
  }

  /* ── 자리배치 ── */
  function getSeatClass() {
    return state.classes.find((c) => c.id === (seatContext.classId || state.activeClassId));
  }

  function ensureSeatMeta(cls) {
    if (!cls.seatMeta) {
      cls.seatMeta = {
        homeroomTeacher: '',
        classPresidentId: null,
        vicePresidentId: null,
        printNotice: '아이들이 자리를 임의로 바꿀 시 담임에게 꼭 이야기 해주세요~~~',
        numberAssignDirection: 'horizontal',
      };
    } else if (cls.seatMeta.numberAssignDirection !== 'vertical') {
      cls.seatMeta.numberAssignDirection = 'horizontal';
    }
    return cls.seatMeta;
  }

  function getAssignedStudentsForRoles(cls) {
    const layout = cls.seatLayout;
    if (!layout) return [];
    const students = getActiveStudents();
    const ids = new Set(layout.seats.filter((s) => s.studentId).map((s) => s.studentId));
    return students.filter((s) => ids.has(s.id)).sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  }

  function setClassRole(cls, role, studentId) {
    const meta = ensureSeatMeta(cls);
    const id = studentId || null;
    if (role === 'president') {
      if (meta.vicePresidentId === id) meta.vicePresidentId = null;
      meta.classPresidentId = id;
    } else if (role === 'vice') {
      if (meta.classPresidentId === id) meta.classPresidentId = null;
      meta.vicePresidentId = id;
    } else if (role === 'clear') {
      if (meta.classPresidentId === id) meta.classPresidentId = null;
      if (meta.vicePresidentId === id) meta.vicePresidentId = null;
    }
    saveAndRefresh();
  }

  function clearRoleForStudent(cls, studentId) {
    if (!studentId) return;
    const meta = ensureSeatMeta(cls);
    if (meta.classPresidentId === studentId) meta.classPresidentId = null;
    if (meta.vicePresidentId === studentId) meta.vicePresidentId = null;
  }

  function renderSeatMetaFields(cls) {
    const meta = ensureSeatMeta(cls);
    const assigned = getAssignedStudentsForRoles(cls);
    const opts = '<option value="">선택</option>' + assigned.map((s) =>
      `<option value="${s.id}">${esc(s.number)}. ${esc(s.name)}</option>`
    ).join('');

    const homeroom = $('#seatHomeroomTeacher');
    const notice = $('#seatPrintNotice');
    const president = $('#seatClassPresident');
    const vice = $('#seatVicePresident');

    if (homeroom) homeroom.value = meta.homeroomTeacher || '';
    if (notice) notice.value = meta.printNotice || '';
    if (president) {
      president.innerHTML = opts;
      president.value = meta.classPresidentId || '';
    }
    if (vice) {
      vice.innerHTML = opts;
      vice.value = meta.vicePresidentId || '';
    }

    const dir = meta.numberAssignDirection === 'vertical' ? 'vertical' : 'horizontal';
    document.querySelectorAll('input[name="numberAssignDir"]').forEach((el) => {
      el.checked = el.value === dir;
    });
  }

  function getClassDisplayLabel(cls) {
    if (cls.grade && cls.classLabel) return `${cls.grade}-${cls.classLabel}`;
    return cls.name || '';
  }

  function setSeatAssignMode(mode) {
    const valid = mode === 'number' ? 'number' : 'auto';
    try { sessionStorage.setItem('ct-seat-assign-mode', valid); } catch { /* ignore */ }
    $$('.seat-assign-nav__btn').forEach((btn) => {
      const active = btn.dataset.assignMode === valid;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.seat-assign-panel').forEach((panel) => {
      const active = panel.dataset.assignMode === valid;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  }

  function renderSeats() {
    const cls = getSeatClass();
    if (!cls) {
      showToast('먼저 관리실에서 학급과 학생을 등록해주세요.');
      return;
    }

    const activeId = seatContext.classId || state.activeClassId;
    const contextHtml = `
      <div class="seat-context-bar__inner">
        <label class="seat-context-bar__class">
          <span class="seat-context-bar__label">학급</span>
          <select id="seatClassSelect" class="input input-select seat-context-bar__select" aria-label="학급 선택">
            ${state.classes.map((c) =>
              `<option value="${c.id}" ${c.id === activeId ? 'selected' : ''}>${esc(c.name)}</option>`
            ).join('')}
          </select>
        </label>
        <div class="seat-context-bar__actions">
          <span class="seat-context-bar__confirmed" id="seatConfirmHint"></span>
          <button type="button" class="btn btn-secondary seat-context-bar__confirm" id="btnConfirmSeats" title="현재 배치를 '지난 자리'로 기억합니다">📌 이번 자리 확정</button>
          <button type="button" class="btn btn-primary seat-context-bar__enlarge" id="btnSeatEnlarge" title="학생용 전체화면">📺 크게보기</button>
        </div>
      </div>`;
    $('#seatContextBar').innerHTML = contextHtml;

    $('#seatClassSelect')?.addEventListener('change', (e) => {
      if (seatRevealBusy) {
        e.target.value = activeId;
        showToast('자리 배치 연출이 진행 중입니다.');
        return;
      }
      setActiveClass(e.target.value);
    });
    $('#btnConfirmSeats')?.addEventListener('click', confirmCurrentSeats);
    $('#btnSeatEnlarge')?.addEventListener('click', openSeatEnlargeFullscreen);

    if (!cls.seatLayout) {
      cls.seatLayout = ctCreateSeatGrid(5, 6, { teacherPosition: 'front' });
      saveAndRefresh();
    }

    const layout = cls.seatLayout;
    $('#seatRows').value = layout.rows;
    $('#seatCols').value = layout.cols;
    $('#teacherPosition').value = layout.teacherPosition || 'front';

    renderSeatGrid(cls);
    renderSeatRuleAlert(cls);
    renderSeatMetaFields(cls);
    updateSeatRulesButton(cls);
    updateSeatConfirmHint(cls);
    renderUnassigned(cls);
    if (!seatRevealBusy) attachSeatSortables(cls);
    applySeatMoveHighlights();
  }

  function getSeatDropAffectedIds(fromKey, toKey, studentId, layout) {
    const affected = new Set([studentId]);
    if (toKey) {
      const toSeat = layout.seats.find((s) => s.key === toKey);
      if (toSeat?.studentId && toSeat.studentId !== studentId) {
        affected.add(toSeat.studentId);
      }
    }
    return affected;
  }

  function applySeatMoveHighlights() {
    if (!seatMoveHighlightIds?.size) return;
    const ids = [...seatMoveHighlightIds];
    seatMoveHighlightIds = null;
    requestAnimationFrame(() => {
      ids.forEach((id) => {
        document.querySelectorAll(`.seat-card[data-student-id="${id}"]`).forEach((card) => {
          card.classList.remove('seat-card--moved');
          void card.offsetWidth;
          card.classList.add('seat-card--moved');
        });
      });
      setTimeout(() => {
        document.querySelectorAll('.seat-card--moved').forEach((card) => {
          card.classList.remove('seat-card--moved');
        });
      }, 2100);
    });
  }

  function playSeatRevealSound(stepIndex = 0) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!seatAudioCtx) seatAudioCtx = new AudioCtx();
      if (seatAudioCtx.state === 'suspended') seatAudioCtx.resume();
      const t = seatAudioCtx.currentTime;
      const osc = seatAudioCtx.createOscillator();
      const gain = seatAudioCtx.createGain();
      const base = 520 + (stepIndex % 5) * 40;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.05);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain);
      gain.connect(seatAudioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch {
      /* autoplay / unsupported */
    }
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pulseSeatReveal(seatKey) {
    const card = document.querySelector(`.seat-cell[data-seat-key="${seatKey}"] .seat-card`);
    if (!card) return;
    card.classList.remove('seat-card--reveal');
    void card.offsetWidth;
    card.classList.add('seat-card--reveal');
  }

  function destroySeatSortables() {
    seatSortables.forEach((s) => {
      try { s.destroy(); } catch { /* detached node */ }
    });
    seatSortables = [];
  }

  function createSeatSortable(el, cls) {
    if (typeof Sortable === 'undefined') return;
    seatSortables.push(Sortable.create(el, {
      group: 'seats',
      animation: 150,
      draggable: '.seat-card',
      ghostClass: 'seat-card--ghost',
      emptyInsertThreshold: 40,
      onEnd: (evt) => handleSeatDrop(evt, cls),
    }));
  }

  function attachSeatSortables(cls) {
    destroySeatSortables();
    $$('#seatGrid .seat-pool').forEach((pool) => createSeatSortable(pool, cls));
    const unassignedEl = $('#unassignedPool');
    if (unassignedEl) createSeatSortable(unassignedEl, cls);
  }

  async function runAnimatedAutoAssign(cls, students, options) {
    const token = ++seatAutoAssignToken;
    const btn = $('#btnAutoAssign');
    if (btn) btn.disabled = true;
    seatRevealBusy = true;

    const finalLayout = ctAutoAssignSeats(students, cls.seatLayout, options);
    const placements = finalLayout.seats
      .filter((s) => s.studentId && !s.isAisle && !s.isEmpty)
      .map((s) => ({ key: s.key, studentId: s.studentId }));
    const revealOrder = typeof ctShuffle === 'function'
      ? ctShuffle([...placements])
      : [...placements].sort(() => Math.random() - 0.5);

    // 빈 자리부터 시작 후 한 명씩 등장
    const animLayout = JSON.parse(JSON.stringify(finalLayout));
    animLayout.seats.forEach((s) => { s.studentId = null; });
    animLayout.assignments = {};
    cls.seatLayout = animLayout;
    renderSeatGrid(cls);
    renderUnassigned(cls);

    const delay = Math.max(180, Math.min(420, 5200 / Math.max(revealOrder.length, 1)));

    for (let i = 0; i < revealOrder.length; i++) {
      if (token !== seatAutoAssignToken || currentPanel !== 'seats') {
        cls.seatLayout = finalLayout;
        seatRevealBusy = false;
        if (btn) btn.disabled = false;
        saveAndRefresh();
        if (currentPanel === 'seats') renderSeats();
        return false;
      }
      const { key, studentId } = revealOrder[i];
      const seat = cls.seatLayout.seats.find((s) => s.key === key);
      if (seat) {
        seat.studentId = studentId;
        cls.seatLayout.assignments[key] = studentId;
      }
      renderSeatGrid(cls);
      renderUnassigned(cls);
      pulseSeatReveal(key);
      playSeatRevealSound(i);
      await sleepMs(delay);
    }

    if (token !== seatAutoAssignToken) {
      seatRevealBusy = false;
      if (btn) btn.disabled = false;
      return false;
    }

    // 마지막 프레임에 이미 전원 표시됨 → 그리드를 비우지 않고 저장·드래그만 활성화
    cls.seatLayout.assignments = {};
    cls.seatLayout.seats.forEach((s) => {
      if (s.studentId) cls.seatLayout.assignments[s.key] = s.studentId;
    });
    seatRevealBusy = false;
    if (btn) btn.disabled = false;
    saveAndRefresh();
    attachSeatSortables(cls);
    renderSeatMetaFields(cls);
    updateSeatRulesButton(cls);
    return true;
  }

  function renderSeatGrid(cls) {
    const layout = cls.seatLayout;
    const students = getActiveStudents();
    const meta = ensureSeatMeta(cls);
    const grid = $('#seatGrid');
    if (!grid || !layout) return;

    grid.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;

    const desk = $('#teacherDesk');
    const pos = layout.teacherPosition || 'front';
    if (desk) {
      desk.textContent = '교탁';
      desk.style.order = pos === 'back' ? 2 : -1;
    }

    destroySeatSortables();
    grid.innerHTML = '';

    const sortedSeats = [...layout.seats].sort((a, b) => a.row * layout.cols + a.col - (b.row * layout.cols + b.col));

    sortedSeats.forEach((seat) => {
      const cell = document.createElement('div');
      cell.className = 'seat-cell';
      cell.dataset.seatKey = seat.key;
      if (seat.isAisle) cell.classList.add('seat-cell--aisle');
      if (seat.isEmpty && !seat.isAisle) cell.classList.add('seat-cell--empty');

      if (!seat.isAisle) {
        const hasStudent = !!seat.studentId;
        cell.innerHTML = `
          <div class="seat-cell__actions">
            ${hasStudent ? `
              <button type="button" class="seat-action seat-action--role ${meta.classPresidentId === seat.studentId ? 'is-active' : ''}" data-action="president" title="반장">반</button>
              <button type="button" class="seat-action seat-action--role ${meta.vicePresidentId === seat.studentId ? 'is-active' : ''}" data-action="vice" title="부반장">부</button>
            ` : ''}
            <button type="button" class="seat-action" data-action="empty" title="빈좌석">✕</button>
          </div>`;
        cell.querySelector('[data-action="president"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const sid = layout.seats.find((s) => s.key === seat.key)?.studentId;
          if (!sid) return;
          if (meta.classPresidentId === sid) setClassRole(cls, 'clear', sid);
          else setClassRole(cls, 'president', sid);
          renderSeats();
        });
        cell.querySelector('[data-action="vice"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const sid = layout.seats.find((s) => s.key === seat.key)?.studentId;
          if (!sid) return;
          if (meta.vicePresidentId === sid) setClassRole(cls, 'clear', sid);
          else setClassRole(cls, 'vice', sid);
          renderSeats();
        });
        cell.querySelector('[data-action="empty"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (seatRevealBusy) return;
          cls.seatLayout = ctToggleEmptySeat(layout, seat.key);
          resetSeatRuleAlert();
          saveAndRefresh();
          renderSeats();
        });
      }

      if (!seat.isEmpty && !seat.isAisle) {
        const pool = document.createElement('div');
        pool.className = 'seat-pool';
        pool.dataset.seatKey = seat.key;
        if (seat.studentId) {
          const student = students.find((s) => s.id === seat.studentId);
          if (student) {
            const roleBadge = meta.classPresidentId === student.id
              ? '<span class="seat-role seat-role--president">반장</span>'
              : meta.vicePresidentId === student.id
                ? '<span class="seat-role seat-role--vice">부반장</span>'
                : '';
            pool.innerHTML = `<div class="seat-card" data-student-id="${student.id}">
              ${roleBadge}
              <div class="seat-card__num">${student.number}</div>
              <div class="seat-card__name">${esc(student.name)}</div>
            </div>`;
          }
        }
        cell.appendChild(pool);
      }

      grid.appendChild(cell);
    });
  }

  function handleSeatDrop(evt, cls) {
    const fromPool = evt.from;
    const toPool = evt.to;
    const card = evt.item;
    const studentId = card.dataset.studentId;
    if (!studentId) return;

    const fromKey = fromPool.dataset.seatKey || null;
    const toKey = toPool.dataset.seatKey || null;

    if (fromKey === toKey) return;

    let layout = cls.seatLayout;
    seatMoveHighlightIds = getSeatDropAffectedIds(fromKey, toKey, studentId, layout);

    if (!toKey) {
      const seat = layout.seats.find((s) => s.studentId === studentId);
      if (seat) seat.studentId = null;
      clearRoleForStudent(cls, studentId);
    } else if (!fromKey) {
      layout = ctAssignStudentToSeat(layout, studentId, toKey);
    } else {
      const toSeat = layout.seats.find((s) => s.key === toKey);
      const fromSeat = layout.seats.find((s) => s.key === fromKey);
      if (toSeat?.studentId && fromSeat) {
        const displaced = toSeat.studentId;
        layout = ctAssignStudentToSeat(layout, studentId, toKey);
        if (fromSeat) {
          const fs = layout.seats.find((s) => s.key === fromKey);
          if (fs) fs.studentId = displaced;
        }
      } else {
        layout = ctAssignStudentToSeat(layout, studentId, toKey);
      }
    }

    layout.assignments = {};
    layout.seats.forEach((s) => {
      if (s.studentId) layout.assignments[s.key] = s.studentId;
    });

    cls.seatLayout = layout;
    resetSeatRuleAlert();
    saveAndRefresh();
    renderSeats();
  }

  function renderUnassigned(cls) {
    const students = getActiveStudents();
    const unassigned = ctGetUnassignedStudents(students, cls.seatLayout);
    const pool = $('#unassignedPool');
    pool.innerHTML = unassigned.length
      ? unassigned.map((s) =>
        `<div class="unassigned-chip seat-card" data-student-id="${s.id}">${s.number}. ${esc(s.name)}</div>`
      ).join('')
      : '<span class="unassigned-pool__empty">미배치 학생이 없습니다</span>';
  }

  /* ── 모둠편성 ── */
  function renderGroups() {
    const cls = ctGetActiveClass(state);
    if (!cls) { showToast('학급을 먼저 등록해주세요.'); return; }
    const container = $('#groupsResult');
    if (!cls.groupResult?.length) {
      container.innerHTML = '<p class="field-hint" style="padding:20px">모둠 편성 버튼을 눌러주세요.</p>';
      return;
    }
    container.innerHTML = cls.groupResult.map((g) => `
      <div class="card group-card">
        <h4>${g.number}모둠</h4>
        <ul>${g.members.map((m) => `<li>${m.number}. ${esc(m.name)}</li>`).join('')}</ul>
      </div>
    `).join('');
  }

  /* ── 발표순서 ── */
  function destroyPresentationSortables() {
    presentationSortables.forEach((s) => s.destroy());
    presentationSortables = [];
  }

  function syncPresentationTabs() {
    $$('[data-presentation-tab]').forEach((btn) => {
      const active = btn.dataset.presentationTab === presentationMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('#presentationClassView').hidden = presentationMode !== 'class';
    $('#presentationGroupView').hidden = presentationMode !== 'group';
  }

  function presentationPlaceholderHtml(mode) {
    if (mode === 'group') {
      return '<p class="field-hint presentation-empty">순서 생성 버튼을 눌러 모둠별 발표 순서를 만들어주세요.</p>';
    }
    return '<li class="presentation-empty">순서 생성 버튼을 눌러주세요.</li>';
  }

  const PRESENTATION_DRAG_ICON = `<svg class="presentation-drag__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="3.5" r="1.25"/><circle cx="11" cy="3.5" r="1.25"/><circle cx="5" cy="8" r="1.25"/><circle cx="11" cy="8" r="1.25"/><circle cx="5" cy="12.5" r="1.25"/><circle cx="11" cy="12.5" r="1.25"/></svg>`;

  function renderPresentationListItems(order) {
    return order.map((item) => `
      <li data-student-id="${item.studentId}">
        <span class="presentation-drag" title="드래그하여 순서 변경">${PRESENTATION_DRAG_ICON}</span>
        <span class="presentation-order">${item.order}</span>
        <span class="presentation-name">${item.number}. ${esc(item.name)}</span>
      </li>
    `).join('');
  }

  function bindPresentationSortable(list, getOrder, onSave) {
    if (typeof Sortable === 'undefined') return;
    const sortable = Sortable.create(list, {
      animation: 200,
      handle: '.presentation-drag',
      ghostClass: 'sortable-ghost',
      onEnd: () => {
        const current = getOrder();
        const items = [...list.children].map((li, i) => {
          const sid = li.dataset.studentId;
          const orig = current.find((p) => p.studentId === sid);
          return { ...orig, order: i + 1 };
        });
        onSave(items);
        saveAndRefresh();
        renderPresentation();
      },
    });
    presentationSortables.push(sortable);
  }

  function renderClassPresentation(cls) {
    const list = $('#presentationList');
    if (!cls.presentationOrder?.length) {
      list.innerHTML = presentationPlaceholderHtml('class');
      return;
    }
    list.innerHTML = renderPresentationListItems(cls.presentationOrder);
    bindPresentationSortable(
      list,
      () => cls.presentationOrder,
      (items) => { cls.presentationOrder = items; },
    );
  }

  function renderGroupPresentation(cls) {
    const container = $('#presentationGroupList');
    if (!cls.presentationByGroup?.length) {
      container.innerHTML = presentationPlaceholderHtml('group');
      return;
    }
    container.innerHTML = cls.presentationByGroup.map((g) => `
      <div class="presentation-group-card" data-group-id="${g.groupId}">
        <h4>${g.groupNumber}모둠</h4>
        <ol class="presentation-list sortable-list" data-group-id="${g.groupId}">
          ${renderPresentationListItems(g.order)}
        </ol>
      </div>
    `).join('');

    container.querySelectorAll('.presentation-list').forEach((list) => {
      const groupId = list.dataset.groupId;
      bindPresentationSortable(
        list,
        () => cls.presentationByGroup.find((g) => g.groupId === groupId)?.order || [],
        (items) => {
          const group = cls.presentationByGroup.find((g) => g.groupId === groupId);
          if (group) group.order = items;
        },
      );
    });
  }

  function renderPresentation() {
    const cls = ctGetActiveClass(state);
    if (!cls) return;
    syncPresentationTabs();
    destroyPresentationSortables();

    if (!presentationViewActive) {
      $('#presentationList').innerHTML = presentationPlaceholderHtml('class');
      $('#presentationGroupList').innerHTML = presentationPlaceholderHtml('group');
      return;
    }

    if (presentationMode === 'group') {
      renderGroupPresentation(cls);
    } else {
      renderClassPresentation(cls);
    }
  }

  function switchPresentationMode(mode) {
    if (presentationMode === mode) return;
    presentationMode = mode;
    presentationViewActive = false;
    renderPresentation();
  }

  /* ── 출력 ── */
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function openFullscreen(mode) {
    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');

    if (mode === 'timer') {
      content.className = 'fullscreen-content fullscreen-timer';
      const label = getTimerMode() === 'stopwatch' ? '스톱워치' : '타이머';
      content.innerHTML = `
        <p class="fullscreen-timer__mode">${label}</p>
        <div class="timer-display">${formatTime(getTimerDisplayValue())}</div>`;
    }
  }

  function closeFullscreen() {
    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = true;
    overlay.classList.remove('is-open', 'fullscreen-overlay--seats');
    overlay.setAttribute('aria-hidden', 'true');
    if (content) {
      content.className = 'fullscreen-content';
      content.innerHTML = '';
    }
  }

  function openOfficersFullscreen({ className, html, onReady }) {
    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    content.className = className || 'fullscreen-content fullscreen-officers';
    content.innerHTML = html || '';
    onReady?.(content);
  }

  function initOfficersModule() {
    if (!window.CTOfficers) return;
    CTOfficers.init({
      esc,
      showToast,
      showModal,
      closeModal,
      getStudents: getActiveStudents,
      confirmRole: (role, studentId) => {
        const cls = ctGetActiveClass(state);
        if (!cls) return;
        setClassRole(cls, role === 'president' ? 'president' : 'vice', studentId);
      },
      openFullscreen: openOfficersFullscreen,
      closeFullscreen,
      isFullscreenOpen: () => {
        const overlay = $('#fullscreenOverlay');
        return Boolean(overlay && !overlay.hidden);
      },
    });
  }

  /* ── 이벤트 바인딩 ── */
  function bindEvents() {
    document.getElementById('hubNodes')?.addEventListener('click', (e) => {
      const node = e.target.closest('.hub-tile[data-panel]');
      if (!node?.dataset.panel) return;
      pulseHubNode(node);
      openPanel(node.dataset.panel);
    });

    $('#btnBack').addEventListener('click', goHome);
    $('#btnOffice').addEventListener('click', () => openPanel('office'));
    const onClassSelectChange = (e) => {
      if (e.target.value) setActiveClass(e.target.value);
    };
    $('#heroClassSelect')?.addEventListener('change', onClassSelectChange);
    $('#panelClassSelect')?.addEventListener('change', onClassSelectChange);
    window.addEventListener('resize', () => {
      /* tile grid is CSS-driven; no orbit relayout */
    });

    $('#treasureRewardForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#newTreasureReward');
      const label = input?.value.trim();
      if (!label) {
        showToast('보상 이름을 입력해주세요.');
        return;
      }
      if (!state.treasureRewards) state.treasureRewards = [];
      if (state.treasureRewards.includes(label)) {
        showToast('이미 등록된 보상입니다.');
        return;
      }
      state.treasureRewards.push(label);
      ctSaveState(state);
      input.value = '';
      renderTreasureRewards();
      showToast('보상이 추가되었습니다.');
    });

    $('#btnTreasureRewardsReset')?.addEventListener('click', () => {
      if (!confirm('보물상자 보상을 기본 목록으로 되돌리시겠습니까?')) return;
      state.treasureRewards = [...CT_DEFAULT_TREASURE_REWARDS];
      ctSaveState(state);
      renderTreasureRewards();
      showToast('기본 보상 목록으로 초기화되었습니다.');
    });

    $('#userForm').addEventListener('submit', (e) => {
      e.preventDefault();
      state = ctUpdateUser({
        school: $('#userSchool').value.trim(),
        name: $('#userName').value.trim(),
      });
      refreshHeader();
      renderHeroWelcome();
      showToast('사용자 설정이 저장되었습니다.');
    });

    $('#classForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const grade = $('#newGrade').value;
      const classLabel = $('#newClassLabel').value.trim();
      const name = $('#newClassName').value.trim();
      if (!classLabel) {
        showToast('반을 입력해주세요. (예: 1, A, B)');
        return;
      }
      ctCreateClass({ grade, classLabel, name: name || undefined });
      state = ctLoadState();
      renderOffice();
      $('#newClassLabel').value = '';
      $('#newClassName').value = '';
      showToast('학급이 추가되었습니다.');
    });

    $('#studentClassSelect').addEventListener('change', renderStudentTable);

    $('#btnExcelUpload').addEventListener('click', () => $('#excelFileInput').click());
    $('#excelFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const students = await ctParseExcelFile(file);
        const cls = getSelectedClassForStudents();
        showStudentPreview(students, (parsed) => {
          if (cls) {
            cls.students = parsed;
            saveAndRefresh();
            renderStudentTable();
            renderClassList();
            showToast(`${parsed.length}명 저장되었습니다.`);
          }
        });
      } catch (err) {
        showToast(err.message);
      }
      e.target.value = '';
    });

    $('#btnCsvUpload').addEventListener('click', () => $('#csvFileInput').click());
    $('#csvFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const cls = getSelectedClassForStudents();
          const students = ctParseCsvText(reader.result, { grade: cls?.grade, classLabel: cls?.classLabel || cls?.classNumber });
          showStudentPreview(students, (parsed) => {
            if (cls) {
              cls.students = parsed;
              saveAndRefresh();
              renderStudentTable();
              renderClassList();
              showToast(`${parsed.length}명 저장되었습니다.`);
            }
          });
        } catch (err) {
          showToast(err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    $('#btnPasteStudents').addEventListener('click', showPasteModal);

    $('#btnAddStudent').addEventListener('click', () => {
      const cls = getSelectedClassForStudents();
      if (!cls) return;
      const maxSeat = cls.students.reduce((m, s) => Math.max(m, s.seatNumber || 0), 0);
      const seatNumber = maxSeat + 1;
      cls.students.push({
        id: ctGenerateId('student'),
        grade: cls.grade,
        classLabel: cls.classLabel || cls.classNumber,
        seatNumber,
        number: ctBuildSchoolNumber(cls.grade, cls.classLabel || cls.classNumber, seatNumber),
        name: '새 학생',
        gender: 'M',
        note: '',
      });
      saveAndRefresh();
      renderStudentTable();
      renderClassList();
    });

    const exportBackup = () => {
      ctExportData();
      renderDataStatus();
      showToast('백업 파일을 내려받았습니다.');
    };
    $('#btnExport').addEventListener('click', exportBackup);
    $('#btnReminderBackup')?.addEventListener('click', exportBackup);
    $('#btnReminderSnooze')?.addEventListener('click', () => {
      ctSnoozeBackupReminder(7);
      renderBackupReminder();
    });
    $('#btnImport').addEventListener('click', () => $('#importFileInput').click());
    $('#importFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const { data, summary } = await ctReadBackupFile(file);
        confirmImportBackup(data, summary);
      } catch (err) {
        showToast(err.message);
      }
    });

    $('#btnReset').addEventListener('click', confirmResetAll);
    $('#btnUndoData')?.addEventListener('click', confirmUndoData);

    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', (e) => {
      if (e.target === $('#modalBackdrop')) closeModal();
    });

    /* 자리배치 */
    $$('.seat-assign-nav__btn').forEach((btn) => {
      btn.addEventListener('click', () => setSeatAssignMode(btn.dataset.assignMode));
    });
    let savedAssignMode = 'auto';
    try { savedAssignMode = sessionStorage.getItem('ct-seat-assign-mode') || 'auto'; } catch { /* ignore */ }
    setSeatAssignMode(savedAssignMode);

    $('#btnCreateGrid').addEventListener('click', () => {
      const cls = getSeatClass();
      if (!cls) return;
      if (seatRevealBusy) {
        showToast('자리 배치 연출이 진행 중입니다.');
        return;
      }
      const rows = parseInt($('#seatRows').value, 10) || 5;
      const cols = parseInt($('#seatCols').value, 10) || 6;
      const teacherPosition = $('#teacherPosition').value;
      cls.seatLayout = ctCreateSeatGrid(rows, cols, { teacherPosition });
      const flagged = ctFlagSeatRulesForLayout(ensureSeatRules(cls), cls.seatLayout);
      resetSeatRuleAlert();
      saveAndRefresh();
      renderSeats();
      showToast(flagged
        ? `교실이 생성되었습니다. 칸 지정 규칙 ${flagged}개는 확인이 필요해 꺼 두었습니다.`
        : '교실이 생성되었습니다.');
    });

    $('#teacherPosition').addEventListener('change', () => {
      const cls = getSeatClass();
      if (!cls?.seatLayout) return;
      if (seatRevealBusy) {
        $('#teacherPosition').value = cls.seatLayout.teacherPosition || 'front';
        showToast('자리 배치 연출이 진행 중입니다.');
        return;
      }
      cls.seatLayout.teacherPosition = $('#teacherPosition').value;
      saveAndRefresh();
      renderSeats();
    });

    $('#btnAutoAssign').addEventListener('click', async () => {
      const cls = getSeatClass();
      if (!cls) return;
      if (seatRevealBusy) {
        showToast('자리 배치 연출이 진행 중입니다.');
        return;
      }
      const students = getActiveStudents();
      if (!students.length) { showToast('학생이 없습니다.'); return; }
      clearSeatRuleAlert();
      showToast('자리를 한 명씩 뽑는 중입니다…');
      const rules = syncSeatRules(cls);
      const done = await runAnimatedAutoAssign(cls, students, {
        random: $('#optRandom').checked,
        genderBalance: $('#optGender').checked,
        rules,
        confirmed: cls.seatConfirmed,
      });
      if (!done) return;
      const violations = ctEvaluateSeatRules(cls.seatLayout, students, rules, {
        confirmed: cls.seatConfirmed,
        nameOf: seatRuleNameOf(cls),
      });
      setSeatRuleAlert(cls, violations);
      const activeCount = getActiveSeatRules(cls).length;
      if (violations.length) showToast(`자동 배치 완료 — 규칙 위반 ${violations.length}건이 있습니다.`);
      else if (activeCount) showToast(`자동 배치가 완료되었습니다. (규칙 ${activeCount}개 적용)`);
      else showToast('자동 배치가 완료되었습니다.');
    });

    document.querySelectorAll('input[name="numberAssignDir"]').forEach((el) => {
      el.addEventListener('change', () => {
        const cls = getSeatClass();
        if (!cls) return;
        ensureSeatMeta(cls).numberAssignDirection = el.value === 'vertical' ? 'vertical' : 'horizontal';
        ctSaveState(state);
      });
    });

    $('#btnAssignByNumber').addEventListener('click', () => {
      const cls = getSeatClass();
      if (!cls) return;
      if (seatRevealBusy) {
        showToast('자리 배치 연출이 진행 중입니다.');
        return;
      }
      const students = getActiveStudents();
      if (!students.length) { showToast('학생이 없습니다.'); return; }
      const meta = ensureSeatMeta(cls);
      const direction = meta.numberAssignDirection === 'vertical' ? 'vertical' : 'horizontal';
      const fixedSeats = syncSeatRules(cls)
        .filter(ctIsSeatRuleActive)
        .filter((r) => r.type === 'fixedSeat')
        .map((r) => ({ studentId: r.studentId, seatKey: r.seatKey }));
      cls.seatLayout = ctAssignSeatsByNumber(students, cls.seatLayout, direction, { fixedSeats });
      resetSeatRuleAlert();
      saveAndRefresh();
      renderSeats();
      const dirLabel = direction === 'vertical' ? '세로(열 우선)' : '가로(행 우선)';
      showToast(fixedSeats.length
        ? `번호순으로 배치했습니다. (${dirLabel}, 좌석 고정 ${fixedSeats.length}명)`
        : `번호순으로 배치했습니다. (${dirLabel})`);
    });

    $('#btnOpenSeatRules').addEventListener('click', () => openSeatRulesModal());
    $('#seatRuleAlert').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') {
        clearSeatRuleAlert();
      } else if (act === 'detail' && getSeatRuleAlert()) {
        openSeatRulesModal({ report: seatViolationReport('자동 배치 결과', getSeatRuleAlert().violations) });
      }
    });
    $('#seatHomeroomTeacher')?.addEventListener('change', (e) => {
      const cls = getSeatClass();
      if (!cls) return;
      ensureSeatMeta(cls).homeroomTeacher = e.target.value.trim();
      ctSaveState(state);
    });
    $('#seatPrintNotice')?.addEventListener('change', (e) => {
      const cls = getSeatClass();
      if (!cls) return;
      ensureSeatMeta(cls).printNotice = e.target.value.trim();
      ctSaveState(state);
    });
    $('#seatClassPresident')?.addEventListener('change', (e) => {
      const cls = getSeatClass();
      if (!cls) return;
      const val = e.target.value;
      if (!val) setClassRole(cls, 'clear', ensureSeatMeta(cls).classPresidentId);
      else setClassRole(cls, 'president', val);
      renderSeats();
    });
    $('#seatVicePresident')?.addEventListener('change', (e) => {
      const cls = getSeatClass();
      if (!cls) return;
      const val = e.target.value;
      if (!val) setClassRole(cls, 'clear', ensureSeatMeta(cls).vicePresidentId);
      else setClassRole(cls, 'vice', val);
      renderSeats();
    });

    $('#btnViewTeacherSeats').addEventListener('click', openTeacherSeatPreview);
    $('#btnViewBoardSeats').addEventListener('click', openBoardSeatPreview);

    /* 모둠 */
    $('#btnFormGroups').addEventListener('click', () => {
      const cls = ctGetActiveClass(state);
      if (!cls) return;
      const size = parseInt($('#groupSize').value, 10) || 4;
      cls.groupResult = ctFormGroups(cls.students, {
        groupSize: size,
        genderBalance: $('#groupGender').checked,
        respectSeparation: $('#groupSeparation').checked,
        separationRules: syncSeatRules(cls).filter((r) => r.type === 'separate' && ctIsSeatRuleActive(r)),
      });
      saveAndRefresh();
      renderGroups();
      showToast('모둠 편성이 완료되었습니다.');
    });
    $('#btnPrintGroups').addEventListener('click', printGroups);

    /* 랜덤 게임 / 룰렛 */
    $('#btnSpinRoulette')?.addEventListener('click', spinRoulette);
    $('#btnRouletteReset')?.addEventListener('click', resetRoulette);
    $('#btnRouletteFullscreen')?.addEventListener('click', openRouletteFullscreen);

    /* 발표순서 */
    $$('[data-presentation-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchPresentationMode(btn.dataset.presentationTab));
    });
    $('#btnGenPresentation').addEventListener('click', () => {
      const cls = ctGetActiveClass(state);
      if (!cls?.students?.length) { showToast('학생이 없습니다.'); return; }
      if (presentationMode === 'group') {
        if (!cls.groupResult?.length) {
          showToast('먼저 모둠편성을 해주세요.');
          return;
        }
        cls.presentationByGroup = ctGenerateGroupPresentationOrders(cls.groupResult);
      } else {
        cls.presentationOrder = ctGeneratePresentationOrder(cls.students);
      }
      presentationViewActive = true;
      saveAndRefresh();
      renderPresentation();
    });
    $('#btnShufflePresentation').addEventListener('click', () => {
      const cls = ctGetActiveClass(state);
      if (!presentationViewActive) return;
      if (presentationMode === 'group') {
        if (!cls?.presentationByGroup?.length) return;
        cls.presentationByGroup = ctShuffleGroupPresentationOrders(cls.presentationByGroup);
      } else {
        if (!cls?.presentationOrder?.length) return;
        cls.presentationOrder = ctShufflePresentationOrder(cls.presentationOrder);
      }
      saveAndRefresh();
      renderPresentation();
    });
    $('#btnPrintPresentation').addEventListener('click', printPresentation);

    /* 타이머 */
    $$('.timer-mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTimerMode(btn.dataset.timerMode));
    });
    $('#btnTimerStart').addEventListener('click', startTimer);
    $('#btnTimerPause').addEventListener('click', pauseTimer);
    $('#btnTimerReset').addEventListener('click', resetTimer);
    $('#btnTimerFullscreen').addEventListener('click', () => openFullscreen('timer'));
    $('#fullscreenClose').addEventListener('click', closeFullscreen);
  }

  function showBootError(message) {
    const el = document.getElementById('bootError');
    if (!el) return;
    el.textContent = `앱을 불러오지 못했습니다: ${message}`;
    el.classList.add('is-visible');
  }

  function applyVisitorData(data, todayEl, totalEl) {
    if (data?.success === true && typeof data.today === 'number' && typeof data.total === 'number') {
      todayEl.textContent = String(data.today);
      totalEl.textContent = String(data.total);
      return true;
    }
    return false;
  }

  function fetchVisitorCountsJsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = `_visitorCb_${Date.now()}`;
      const script = document.createElement('script');
      window[cb] = (data) => {
        delete window[cb];
        script.remove();
        resolve(data);
      };
      const sep = url.includes('?') ? '&' : '?';
      script.src = `${url}${sep}callback=${encodeURIComponent(cb)}`;
      script.onerror = () => {
        delete window[cb];
        script.remove();
        reject(new Error('JSONP failed'));
      };
      document.head.appendChild(script);
    });
  }

  async function fetchVisitorCounts() {
    if (!VISITOR_API_URL) return;
    const todayEl = $('#todayCount');
    const totalEl = $('#totalCount');
    if (!todayEl || !totalEl) return;

    try {
      const res = await fetch(VISITOR_API_URL, { method: 'GET', mode: 'cors' });
      if (res.ok) {
        const data = await res.json();
        if (applyVisitorData(data, todayEl, totalEl)) return;
        console.warn('[visitor-counter] 응답 형식이 올바르지 않습니다:', data);
        return;
      }
      console.warn('[visitor-counter] HTTP 오류:', res.status);
    } catch (err) {
      console.warn('[visitor-counter] fetch 실패, JSONP 시도:', err);
    }

    try {
      const data = await fetchVisitorCountsJsonp(VISITOR_API_URL);
      if (!applyVisitorData(data, todayEl, totalEl)) {
        console.warn('[visitor-counter] JSONP 응답 형식이 올바르지 않습니다:', data);
      }
    } catch (err) {
      console.warn('[visitor-counter] JSONP 오류:', err);
    }
  }

  /* ── 초기화 ── */
  function init() {
    try {
      if (typeof ctLoadState !== 'function') {
        throw new Error('storage.js가 로드되지 않았습니다. index.html과 같은 폴더에서 열어주세요.');
      }
      state = ctLoadState();
      ensureActiveClass();
      if (state.activeClassId) {
        seatContext.classId = state.activeClassId;
        ctSaveState(state);
      }
      renderHub(playHomeEnterAnimation);
      renderHeroWelcome();
      renderBackupReminder();
      initGamesModule();
      initOfficersModule();
      bindEvents();
      refreshHeader();
      closeModal();
      closeFullscreen();
      $('#appShell')?.classList.add('is-ready');
      void fetchVisitorCounts();
    } catch (err) {
      console.error(err);
      showBootError(err.message || String(err));
    }
  }

  window.addEventListener('error', (e) => {
    if (!document.querySelector('#hubNodes .hub-tile')) {
      showBootError(e.message || '스크립트 오류');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
