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
  let timerInterval = null;
  let timerRemaining = 300;
  let timerMode = 'countdown';
  let stopwatchElapsed = 0;
  let timerRunning = false;
  let timerPausedMidRun = false;
  let activeDutyType = 'cleaning';
  const DUTY_PRINT_TYPES = ['cleaning', 'meal', 'environment'];
  let seatContext = { classId: null };
  let seatAutoAssignToken = 0;
  let seatRevealBusy = false;
  let seatAudioCtx = null;
  let rouletteMode = 'students';
  let rouletteSpinning = false;
  const rouletteState = {
    students: { excluded: new Set(), history: [], rotation: 0 },
    custom: { excluded: new Set(), history: [], rotation: 0 },
  };
  let isNavigating = false;
  const NAV_HUB_MS = 320;
  const NAV_PANEL_MS = 280;

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
          seatRuleAlert = null;
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
    seatRuleAlert = null;
    saveAndRefresh();
    renderSeats();
  }

  /* ── 자리 규칙 ── */
  const SEAT_RULE_TABS = [
    { id: 'all', label: '전체' },
    { id: 'position', label: '위치' },
    { id: 'relation', label: '관계' },
    { id: 'change', label: '변화' },
  ];
  const SEAT_RULE_PICKER = [
    { type: 'rowRange', preset: 'frontRow', icon: '🪑', label: '앞자리 배치', desc: '교탁 쪽 맨 앞줄에 배치 (기존 앞자리 희망)' },
    ...Object.keys(CT_SEAT_RULE_TYPES).map((type) => ({ type, ...CT_SEAT_RULE_TYPES[type] })),
  ];
  let seatRulesUi = { tab: 'all', pickerOpen: false, expanded: new Set(), report: '' };
  /** 자동 배치 후 지키지 못한 규칙 — { classId, violations } */
  let seatRuleAlert = null;

  function escAttr(str) {
    return esc(str).replace(/"/g, '&quot;');
  }

  function ensureSeatRules(cls) {
    if (!Array.isArray(cls.seatRules)) cls.seatRules = [];
    return cls.seatRules;
  }

  function getActiveSeatRules(cls) {
    return ensureSeatRules(cls).filter(ctIsSeatRuleActive);
  }

  /** 명단에서 빠진 학생을 규칙에서 정리 (대상이 사라진 규칙은 꺼짐) */
  function syncSeatRules(cls) {
    const ids = new Set((cls.students || []).map((s) => s.id));
    cls.seatRules = ensureSeatRules(cls).map((r) => ctNormalizeSeatRule(r, ids)).filter(Boolean);
    return cls.seatRules;
  }

  function getSeatRuleStudents(cls) {
    return [...(cls.students || [])].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  }

  function seatRuleNameOf(cls) {
    const byId = new Map((cls.students || []).map((s) => [s.id, s]));
    return (id) => {
      const s = byId.get(id);
      return s ? `${s.number}. ${s.name}` : getStudentName(id);
    };
  }

  function persistSeatRules(cls) {
    ctSaveState(state);
    updateSeatRulesButton(cls);
  }

  function updateSeatRulesButton(cls) {
    const btn = $('#btnOpenSeatRules');
    if (!btn) return;
    const review = cls ? ensureSeatRules(cls).some((r) => r.needsReview) : false;
    btn.textContent = `⚙️ 규칙 설정${review ? ' ⚠️' : ''}`;
    btn.title = review ? '교실 변경으로 확인이 필요한 규칙이 있습니다' : '';
  }

  function formatSeatConfirmDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function updateSeatConfirmHint(cls) {
    const el = $('#seatConfirmHint');
    if (!el) return;
    const c = cls?.seatConfirmed;
    el.textContent = c ? `마지막 확정 ${formatSeatConfirmDate(c.at)}` : '확정 기록 없음';
    el.title = c ? `${c.seats.length}명 배치를 지난 자리로 기억하고 있습니다` : '';
  }

  function confirmCurrentSeats() {
    const cls = getSeatClass();
    if (!cls?.seatLayout) return;
    if (seatRevealBusy) {
      showToast('자리 배치 연출이 진행 중입니다.');
      return;
    }
    const count = ctCountAssignedInLayout(cls.seatLayout);
    if (!count) {
      showToast('배치된 학생이 없습니다.');
      return;
    }
    const overwrite = cls.seatConfirmed
      ? `<br />이전 확정(${formatSeatConfirmDate(cls.seatConfirmed.at)})은 덮어씁니다.`
      : '';
    showModal(
      '📌 이번 자리 확정',
      `<p>현재 배치(${count}명)를 '지난 자리'로 기억합니다.${overwrite}</p>
       <p class="field-hint">규칙 설정의 '지난 자리 피하기'는 확정한 배치를 기준으로 동작합니다.</p>`,
      `<button type="button" class="btn btn-secondary" id="modalConfirmSeatsCancel">취소</button>
       <button type="button" class="btn btn-primary" id="modalConfirmSeatsOk">확정</button>`
    );
    $('#modalConfirmSeatsCancel').onclick = closeModal;
    $('#modalConfirmSeatsOk').onclick = () => {
      cls.seatConfirmed = ctCreateSeatSnapshot(cls.seatLayout);
      ctSaveState(state);
      updateSeatConfirmHint(cls);
      closeModal();
      showToast(`이번 자리를 확정했습니다. (${count}명)`);
    };
  }

  function setSeatRuleAlert(cls, violations) {
    seatRuleAlert = violations?.length ? { classId: cls.id, violations } : null;
    renderSeatRuleAlert(cls);
  }

  function clearSeatRuleAlert() {
    seatRuleAlert = null;
    renderSeatRuleAlert(getSeatClass());
  }

  function renderSeatRuleAlert(cls) {
    const el = $('#seatRuleAlert');
    if (!el) return;
    $$('.seat-cell--violation').forEach((c) => c.classList.remove('seat-cell--violation'));
    const active = !!(seatRuleAlert && cls && seatRuleAlert.classId === cls.id);
    el.hidden = !active;
    if (!active) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <span class="seat-rule-alert__text">⚠️ 규칙 위반 ${seatRuleAlert.violations.length}건이 있습니다. 빨간 좌석을 확인하세요.</span>
      <button type="button" class="btn btn-secondary seat-rule-alert__btn" data-act="detail">자세히</button>
      <button type="button" class="btn-icon-only seat-rule-alert__close" data-act="close" aria-label="알림 닫기">✕</button>`;
    const keys = new Set(seatRuleAlert.violations.flatMap((v) => v.seatKeys));
    keys.forEach((key) => {
      $(`.seat-cell[data-seat-key="${key}"]`)?.classList.add('seat-cell--violation');
    });
  }

  function renderSeatRuleReport(title, items) {
    return `
      <h4 class="seat-rules__report-title">${esc(title)}</h4>
      ${items.map((it) => `<div class="seat-rules__report-item seat-rules__report-item--${it.level}">${esc(it.message)}</div>`).join('')}`;
  }

  function seatViolationReport(title, violations) {
    if (!violations.length) {
      return renderSeatRuleReport(title, [{ level: 'ok', message: '✓ 켜진 규칙을 모두 지키고 있습니다.' }]);
    }
    return renderSeatRuleReport(`${title} — ${violations.length}건 위반`,
      violations.map((v) => ({ level: 'error', message: v.message })));
  }

  function checkCurrentSeatRules(cls) {
    const violations = ctEvaluateSeatRules(cls.seatLayout, getActiveStudents(), ensureSeatRules(cls), {
      confirmed: cls.seatConfirmed,
      nameOf: seatRuleNameOf(cls),
    });
    setSeatRuleAlert(cls, violations);
    seatRulesUi.report = seatViolationReport('현재 배치 검사', violations);
    renderSeatRulesModal(cls);
  }

  function checkSeatRuleFeasibility(cls) {
    const students = getActiveStudents();
    if (!students.length) {
      showToast('학생이 없습니다.');
      return;
    }
    const rules = syncSeatRules(cls);
    const nameOf = seatRuleNameOf(cls);
    const items = ctCheckSeatRuleFeasibility(students, cls.seatLayout, rules, {
      confirmed: cls.seatConfirmed,
      nameOf,
    });
    if (!getActiveSeatRules(cls).length) {
      items.push({ level: 'info', message: '켜진 규칙이 없습니다.' });
    } else {
      const trial = ctAutoAssignSeats(students, cls.seatLayout, {
        random: $('#optRandom')?.checked !== false,
        genderBalance: !!$('#optGender')?.checked,
        rules,
        confirmed: cls.seatConfirmed,
      });
      const trialViolations = ctEvaluateSeatRules(trial, students, rules, { confirmed: cls.seatConfirmed, nameOf });
      items.push(trialViolations.length
        ? {
          level: 'error',
          message: `모의 배치 결과: ${trialViolations.length}건은 지키기 어렵습니다 — ${trialViolations.slice(0, 3).map((v) => v.message).join(' / ')}${trialViolations.length > 3 ? ' …' : ''}`,
        }
        : { level: 'ok', message: '✓ 모의 배치 결과: 켜진 규칙을 모두 지킬 수 있습니다.' });
    }
    seatRulesUi.report = renderSeatRuleReport('가능 여부 검사', items);
    renderSeatRulesModal(cls);
  }

  function describeSeatRule(rule, nameOf) {
    switch (rule.type) {
      case 'rowRange': return `${rule.studentIds.length}명 · ${rule.from}~${rule.to}행`;
      case 'colRange': return `${rule.studentIds.length}명 · ${rule.from}~${rule.to}열`;
      case 'allowSeats':
      case 'avoidSeats': return `${rule.studentIds.length}명 · ${rule.seatKeys.length}칸`;
      case 'fixedSeat':
        return rule.studentId && rule.seatKey ? `${nameOf(rule.studentId)} → ${ctSeatLabel(rule.seatKey)}` : '';
      case 'separate':
      case 'pair':
        return rule.studentA && rule.studentB ? `${nameOf(rule.studentA)} ↔ ${nameOf(rule.studentB)}` : '';
      case 'avoidPrevious': return rule.target === 'all' ? '전원' : `${rule.studentIds.length}명`;
      default: return '';
    }
  }

  function seatRuleStudentLabel(s) {
    return `${esc(s.number)}. ${esc(s.name)}`;
  }

  function renderRuleStudentPicker(rule, students) {
    const selected = new Set(rule.studentIds || []);
    const expanded = seatRulesUi.expanded.has(rule.id);
    const chosen = students.filter((s) => selected.has(s.id));
    const content = expanded
      ? `<div class="seat-rule-student-grid">
          ${students.map((s) => `<button type="button" class="seat-rule-pick ${selected.has(s.id) ? 'is-on' : ''}" data-act="toggle-student" data-student-id="${s.id}" aria-pressed="${selected.has(s.id)}">${seatRuleStudentLabel(s)}</button>`).join('')}
        </div>`
      : `<div class="seat-rule-chips">${chosen.length
        ? chosen.map((s) => `<span class="seat-rule-chip">${seatRuleStudentLabel(s)}</span>`).join('')
        : '<span class="seat-rule-muted">선택한 학생이 없습니다</span>'}</div>`;
    return `
      <div class="seat-rule-students">
        <div class="seat-rule-students__head">
          <span class="field-label">대상 학생 (${chosen.length}명)</span>
          ${expanded && chosen.length ? '<button type="button" class="seat-rule-link" data-act="clear-students">모두 해제</button>' : ''}
          <button type="button" class="seat-rule-link" data-act="toggle-students">${expanded ? '접기 ▴' : '학생 선택 ▾'}</button>
        </div>
        ${content}
      </div>`;
  }

  function renderRuleStudentSelect(field, value, students) {
    return `<select class="input input-select seat-rule-select" data-field="${field}">
      <option value="">학생 선택</option>
      ${students.map((s) => `<option value="${s.id}" ${s.id === value ? 'selected' : ''}>${seatRuleStudentLabel(s)}</option>`).join('')}
    </select>`;
  }

  /** mode: preview(줄·분단 미리보기) | multi(칸 여러 개 선택) | single(칸 1개 선택) */
  function renderRuleSeatMap(rule, layout, mode) {
    const selected = mode === 'single'
      ? new Set([rule.seatKey].filter(Boolean))
      : new Set(mode === 'multi' ? rule.seatKeys : []);
    const pos = layout.teacherPosition || 'front';
    const deskLabel = { left: '교탁 (왼쪽)', right: '교탁 (오른쪽)' }[pos] || '교탁';
    const desk = `<div class="seat-rule-map__desk">${deskLabel}</div>`;
    const seatByKey = new Map(layout.seats.map((s) => [s.key, s]));

    let cells = '<span class="seat-rule-map__axis"></span>';
    for (let c = 0; c < layout.cols; c++) cells += `<span class="seat-rule-map__axis">${c + 1}</span>`;
    for (let r = 0; r < layout.rows; r++) {
      cells += `<span class="seat-rule-map__axis">${r + 1}</span>`;
      for (let c = 0; c < layout.cols; c++) {
        const key = `${r}-${c}`;
        const seat = seatByKey.get(key);
        const isVoid = !seat || seat.isEmpty || seat.isAisle;
        const hit = !isVoid && (mode === 'preview' ? ctSeatMatchesPositionRule(rule, seat) : selected.has(key));
        const name = seat?.studentId ? getStudentName(seat.studentId) : '';
        const title = `${r + 1}행 ${c + 1}열${name ? ` · ${name}` : ''}${isVoid ? ' (빈 좌석)' : ''}`;
        const cls = `seat-rule-map__cell${hit ? ' is-hit' : ''}${isVoid ? ' is-void' : ''}`;
        const label = `<span class="seat-rule-map__name">${esc(name)}</span>`;
        if (mode === 'preview' || isVoid) {
          cells += `<span class="${cls}" title="${escAttr(title)}">${label}</span>`;
        } else {
          const act = mode === 'single' ? 'pick-seat' : 'toggle-seat';
          cells += `<button type="button" class="${cls}" data-act="${act}" data-seat-key="${key}" title="${escAttr(title)}" aria-pressed="${hit}">${label}</button>`;
        }
      }
    }
    const tone = rule.type === 'avoidSeats' ? ' seat-rule-map--avoid' : '';
    return `
      <div class="seat-rule-map${tone}">
        ${pos === 'back' ? '' : desk}
        <div class="seat-rule-map__grid" style="grid-template-columns: 20px repeat(${layout.cols}, minmax(0, 1fr))">${cells}</div>
        ${pos === 'back' ? desk : ''}
      </div>`;
  }

  function renderRangePreview(rule, layout) {
    const isRow = rule.type === 'rowRange';
    const max = isRow ? layout.rows : layout.cols;
    const warn = rule.from > max
      ? `<p class="seat-rule-warn">교실은 ${max}${isRow ? '행' : '열'}까지입니다. 해당 좌석이 없습니다.</p>`
      : '';
    return warn + renderRuleSeatMap(rule, layout, 'preview');
  }

  function renderSeatRuleBadges(rule) {
    return [
      rule.needsReview ? '<span class="seat-rule-badge seat-rule-badge--warn" title="교실을 다시 만들면서 지정한 칸이 사라졌습니다. 칸을 다시 고르거나 켜면 없어진 칸을 빼고 적용합니다.">확인 필요</span>' : '',
      !rule.needsReview && !ctIsSeatRuleComplete(rule) ? '<span class="seat-rule-badge">미완성</span>' : '',
      !rule.needsReview && rule.enabled === false ? '<span class="seat-rule-badge">꺼짐</span>' : '',
    ].join('');
  }

  /** 입력 중인 칸은 그대로 두고 요약·배지·미리보기만 갱신 (다시 그리면 이어지는 클릭이 사라짐) */
  function refreshSeatRuleCard(cls, rule) {
    const card = $(`#seatRulesRoot [data-rule-id="${rule.id}"]`);
    if (!card) return;
    card.querySelector('.seat-rule-card__summary').textContent = describeSeatRule(rule, seatRuleNameOf(cls));
    card.querySelector('.seat-rule-card__badges').innerHTML = renderSeatRuleBadges(rule);
    card.querySelectorAll('input[type="number"][data-field]').forEach((input) => {
      if (String(rule[input.dataset.field]) !== input.value) input.value = rule[input.dataset.field];
    });
    const slot = card.querySelector('[data-slot="preview"]');
    if (slot) slot.innerHTML = renderRangePreview(rule, cls.seatLayout);
  }

  function renderSeatRuleBody(rule, cls, students) {
    const layout = cls.seatLayout;
    switch (rule.type) {
      case 'rowRange':
      case 'colRange': {
        const isRow = rule.type === 'rowRange';
        const unit = isRow ? '행' : '열';
        const max = isRow ? layout.rows : layout.cols;
        return `
          ${renderRuleStudentPicker(rule, students)}
          <div class="seat-rule-field-row">
            <span>${isRow ? '화면 위에서' : '왼쪽에서'}</span>
            <input type="number" class="input seat-rule-num" data-field="from" min="1" max="${max}" value="${rule.from}" aria-label="시작 ${unit}" />
            <span>${unit} ~</span>
            <input type="number" class="input seat-rule-num" data-field="to" min="1" max="${max}" value="${rule.to}" aria-label="끝 ${unit}" />
            <span>${unit}</span>
            <button type="button" class="seat-rule-link" data-act="front-preset">교탁 쪽 맨 앞줄로</button>
          </div>
          <div data-slot="preview">${renderRangePreview(rule, layout)}</div>`;
      }
      case 'allowSeats':
      case 'avoidSeats':
        return `
          ${renderRuleStudentPicker(rule, students)}
          <div class="seat-rule-field-row">
            <span class="field-label">${rule.type === 'allowSeats' ? '앉을 수 있는 칸' : '앉으면 안 되는 칸'} (${rule.seatKeys.length}칸) — 칸을 눌러 선택·해제</span>
            ${rule.seatKeys.length ? '<button type="button" class="seat-rule-link" data-act="clear-seats">모두 해제</button>' : ''}
          </div>
          ${renderRuleSeatMap(rule, layout, 'multi')}`;
      case 'fixedSeat':
        return `
          <div class="seat-rule-field-row">
            ${renderRuleStudentSelect('studentId', rule.studentId, students)}
            <span>→ ${rule.seatKey ? ctSeatLabel(rule.seatKey) : '아래에서 칸을 고르세요'}</span>
          </div>
          ${renderRuleSeatMap(rule, layout, 'single')}`;
      case 'separate':
        return `
          <div class="seat-rule-field-row">
            ${renderRuleStudentSelect('studentA', rule.studentA, students)}
            <span>↔</span>
            ${renderRuleStudentSelect('studentB', rule.studentB, students)}
          </div>
          <div class="seat-rule-field-row">
            <label class="checkbox"><input type="checkbox" data-field="noAdjacent" ${rule.noAdjacent ? 'checked' : ''} /> 옆자리 금지</label>
            <label class="checkbox"><input type="checkbox" data-field="noFrontBack" ${rule.noFrontBack ? 'checked' : ''} /> 앞뒤 금지</label>
            <label class="checkbox"><input type="checkbox" data-field="noDiagonal" ${rule.noDiagonal ? 'checked' : ''} /> 대각선 금지</label>
          </div>`;
      case 'pair':
        return `
          <div class="seat-rule-field-row">
            ${renderRuleStudentSelect('studentA', rule.studentA, students)}
            <span>↔</span>
            ${renderRuleStudentSelect('studentB', rule.studentB, students)}
          </div>
          <div class="seat-rule-field-row">
            <label class="checkbox"><input type="radio" name="pairDir-${rule.id}" data-field="direction" value="side" ${rule.direction !== 'frontBack' ? 'checked' : ''} /> 옆자리로 붙이기</label>
            <label class="checkbox"><input type="radio" name="pairDir-${rule.id}" data-field="direction" value="frontBack" ${rule.direction === 'frontBack' ? 'checked' : ''} /> 앞뒤로 붙이기</label>
          </div>`;
      case 'avoidPrevious': {
        const c = cls.seatConfirmed;
        return `
          <p class="seat-rule-muted">${c
            ? `기준: ${formatSeatConfirmDate(c.at)}에 확정한 배치 (${c.seats.length}명)`
            : "확정한 지난 자리가 없습니다. 자리배치 화면의 '📌 이번 자리 확정'을 먼저 눌러 주세요."}</p>
          <div class="seat-rule-field-row">
            <label class="checkbox"><input type="radio" name="prevTarget-${rule.id}" data-field="target" value="all" ${rule.target === 'all' ? 'checked' : ''} /> 전원</label>
            <label class="checkbox"><input type="radio" name="prevTarget-${rule.id}" data-field="target" value="selected" ${rule.target === 'selected' ? 'checked' : ''} /> 선택한 학생만</label>
          </div>
          ${rule.target === 'selected' ? renderRuleStudentPicker(rule, students) : ''}
          <div class="seat-rule-field-row">
            <label class="checkbox"><input type="checkbox" data-field="sameSeat" ${rule.sameSeat ? 'checked' : ''} /> 같은 자리 금지</label>
            <label class="checkbox"><input type="checkbox" data-field="samePartner" ${rule.samePartner ? 'checked' : ''} /> 같은 옆자리 짝 금지</label>
          </div>
          <div class="seat-rule-field-row">
            <span>지난 줄에서</span>
            <input type="number" class="input seat-rule-num" data-field="minRowShift" min="0" max="${layout.rows}" value="${rule.minRowShift}" aria-label="최소 이동 줄 수" />
            <span>줄 이상 이동 (0 = 사용 안 함)</span>
          </div>`;
      }
      default:
        return '';
    }
  }

  function renderSeatRuleCard(rule, cls, students, nameOf) {
    const meta = CT_SEAT_RULE_TYPES[rule.type];
    const on = rule.enabled !== false && !rule.needsReview;
    return `
      <article class="seat-rule-card${on ? '' : ' is-off'}" data-rule-id="${rule.id}">
        <header class="seat-rule-card__head">
          <label class="seat-rule-switch" title="켜기·끄기">
            <input type="checkbox" data-field="enabled" ${on ? 'checked' : ''} aria-label="${escAttr(meta.label)} 규칙 켜기" />
            <span class="seat-rule-switch__track" aria-hidden="true"></span>
          </label>
          <span class="seat-rule-card__title">${meta.icon} ${meta.label}</span>
          <span class="seat-rule-card__badges">${renderSeatRuleBadges(rule)}</span>
          <span class="seat-rule-card__summary">${esc(describeSeatRule(rule, nameOf))}</span>
          <button type="button" class="btn-icon-only seat-rule-card__del" data-act="delete" aria-label="규칙 삭제">✕</button>
        </header>
        <div class="seat-rule-card__body">
          ${renderSeatRuleBody(rule, cls, students)}
          <label class="seat-rule-memo">
            <span class="field-label">메모</span>
            <input type="text" class="input" data-field="memo" maxlength="40" value="${escAttr(rule.memo || '')}" placeholder="교사만 보는 메모 (선택)" />
          </label>
        </div>
      </article>`;
  }

  function renderSeatRulesModal(cls) {
    const root = $('#seatRulesRoot');
    if (!root) return;
    const rules = ensureSeatRules(cls);
    const students = getSeatRuleStudents(cls);
    const nameOf = seatRuleNameOf(cls);
    const groupOf = (r) => CT_SEAT_RULE_TYPES[r.type]?.group;
    const visible = seatRulesUi.tab === 'all' ? rules : rules.filter((r) => groupOf(r) === seatRulesUi.tab);
    const tabs = SEAT_RULE_TABS.map((t) => {
      const n = t.id === 'all' ? rules.length : rules.filter((r) => groupOf(r) === t.id).length;
      const active = seatRulesUi.tab === t.id;
      return `<button type="button" class="seat-rules__tab${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" data-act="tab" data-tab="${t.id}">${t.label} <span class="seat-rules__tab-count">${n}</span></button>`;
    }).join('');
    const picker = seatRulesUi.pickerOpen ? `
      <div class="seat-rules__picker">
        ${SEAT_RULE_PICKER.map((p) => `
          <button type="button" class="seat-rule-type" data-act="add-rule" data-type="${p.type}"${p.preset ? ` data-preset="${p.preset}"` : ''}>
            <span class="seat-rule-type__icon" aria-hidden="true">${p.icon}</span>
            <span class="seat-rule-type__label">${p.label}</span>
            <span class="seat-rule-type__desc">${p.desc}</span>
          </button>`).join('')}
      </div>` : '';
    const empty = rules.length
      ? '이 분류에 등록된 규칙이 없습니다.'
      : '등록된 규칙이 없습니다. 위의 종류를 눌러 규칙을 추가하세요.';

    root.innerHTML = `
      <p class="separation-modal-note">교사 전용 설정입니다. 자동 배치는 켜진 규칙을 최대한 지키고, 지키지 못한 규칙은 배치 후 알려 드립니다. 줄·분단 번호는 화면 기준(맨 위가 1행, 맨 왼쪽이 1열)입니다.</p>
      <div class="seat-rules__toolbar">
        <div class="seat-rules__tabs" role="tablist" aria-label="규칙 분류">${tabs}</div>
        <button type="button" class="btn ${seatRulesUi.pickerOpen ? 'btn-secondary' : 'btn-primary'} seat-rules__add" data-act="open-picker">${seatRulesUi.pickerOpen ? '닫기' : '+ 규칙 추가'}</button>
      </div>
      ${picker}
      <div class="seat-rules__list">
        ${visible.length ? visible.map((r) => renderSeatRuleCard(r, cls, students, nameOf)).join('') : `<p class="seat-rules__empty">${empty}</p>`}
      </div>
      <div class="seat-rules__report" aria-live="polite">${seatRulesUi.report}</div>`;
  }

  function addSeatRule(cls, type, preset) {
    if (!CT_SEAT_RULE_TYPES[type]) return;
    const layout = cls.seatLayout;
    let rule;
    if (preset === 'frontRow') rule = ctCreateFrontRowRule(layout, { memo: '앞자리 희망' });
    else if (type === 'rowRange') rule = ctCreateSeatRule(type, { from: 1, to: Math.min(2, layout.rows) });
    else if (type === 'colRange') rule = ctCreateSeatRule(type, { from: 1, to: Math.min(2, layout.cols) });
    else rule = ctCreateSeatRule(type);
    ensureSeatRules(cls).push(rule);
    if (Array.isArray(rule.studentIds) && rule.type !== 'avoidPrevious') seatRulesUi.expanded.add(rule.id);
    seatRulesUi.pickerOpen = false;
    seatRulesUi.tab = 'all';
    persistSeatRules(cls);
    renderSeatRulesModal(cls);
    $(`#seatRulesRoot [data-rule-id="${rule.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function reviveSeatRule(cls, rule) {
    if (!rule.needsReview) return;
    const removed = ctResolveSeatRuleReview(rule, cls.seatLayout);
    rule.enabled = true;
    if (removed) showToast(`없어진 칸 ${removed}개를 규칙에서 뺐습니다.`);
  }

  function handleSeatRulesClick(e, cls) {
    const el = e.target.closest('[data-act]');
    if (!el || !e.currentTarget.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'tab') {
      seatRulesUi.tab = el.dataset.tab;
      renderSeatRulesModal(cls);
      return;
    }
    if (act === 'open-picker') {
      seatRulesUi.pickerOpen = !seatRulesUi.pickerOpen;
      renderSeatRulesModal(cls);
      return;
    }
    if (act === 'add-rule') {
      addSeatRule(cls, el.dataset.type, el.dataset.preset);
      return;
    }

    const card = el.closest('[data-rule-id]');
    const rules = ensureSeatRules(cls);
    const rule = card && rules.find((r) => r.id === card.dataset.ruleId);
    if (!rule) return;

    switch (act) {
      case 'delete':
        rules.splice(rules.indexOf(rule), 1);
        seatRulesUi.expanded.delete(rule.id);
        showToast(`${CT_SEAT_RULE_TYPES[rule.type].label} 규칙을 삭제했습니다.`);
        break;
      case 'toggle-students':
        if (seatRulesUi.expanded.has(rule.id)) seatRulesUi.expanded.delete(rule.id);
        else seatRulesUi.expanded.add(rule.id);
        renderSeatRulesModal(cls);
        return;
      case 'toggle-student': {
        const ids = new Set(rule.studentIds);
        const id = el.dataset.studentId;
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        rule.studentIds = getSeatRuleStudents(cls).map((s) => s.id).filter((sid) => ids.has(sid));
        break;
      }
      case 'clear-students':
        rule.studentIds = [];
        break;
      case 'toggle-seat': {
        reviveSeatRule(cls, rule);
        const key = el.dataset.seatKey;
        rule.seatKeys = rule.seatKeys.includes(key)
          ? rule.seatKeys.filter((k) => k !== key)
          : [...rule.seatKeys, key];
        break;
      }
      case 'clear-seats':
        rule.seatKeys = [];
        break;
      case 'pick-seat':
        reviveSeatRule(cls, rule);
        rule.seatKey = el.dataset.seatKey;
        break;
      case 'front-preset': {
        const preset = ctCreateFrontRowRule(cls.seatLayout);
        if (preset.type !== rule.type) {
          showToast(`교탁이 ${cls.seatLayout.teacherPosition === 'left' ? '왼쪽' : '오른쪽'}이라 분단 범위 규칙으로 바꿨습니다.`);
        }
        rule.type = preset.type;
        rule.from = preset.from;
        rule.to = preset.to;
        break;
      }
      default:
        return;
    }
    persistSeatRules(cls);
    renderSeatRulesModal(cls);
  }

  function handleSeatRulesChange(e, cls) {
    const el = e.target;
    const field = el.dataset.field;
    const card = el.closest('[data-rule-id]');
    const rule = card && ensureSeatRules(cls).find((r) => r.id === card.dataset.ruleId);
    if (!rule || !field) return;

    switch (field) {
      case 'enabled':
        if (el.checked) reviveSeatRule(cls, rule);
        rule.enabled = el.checked;
        break;
      case 'memo':
        rule.memo = el.value.trim().slice(0, 40);
        persistSeatRules(cls);
        return;
      case 'from':
      case 'to': {
        const n = Math.max(1, parseInt(el.value, 10) || 1);
        rule[field] = n;
        if (rule.from > rule.to) {
          if (field === 'from') rule.to = n;
          else rule.from = n;
        }
        persistSeatRules(cls);
        refreshSeatRuleCard(cls, rule);
        return;
      }
      case 'minRowShift':
        rule.minRowShift = Math.max(0, parseInt(el.value, 10) || 0);
        persistSeatRules(cls);
        refreshSeatRuleCard(cls, rule);
        return;
      case 'studentId':
      case 'studentA':
      case 'studentB':
        rule[field] = el.value;
        if (rule.studentA && rule.studentA === rule.studentB) showToast('서로 다른 두 학생을 골라주세요.');
        break;
      case 'noAdjacent':
      case 'noFrontBack':
      case 'noDiagonal':
      case 'sameSeat':
      case 'samePartner':
        rule[field] = el.checked;
        break;
      case 'direction':
        rule.direction = el.value === 'frontBack' ? 'frontBack' : 'side';
        break;
      case 'target':
        rule.target = el.value === 'selected' ? 'selected' : 'all';
        if (rule.target === 'selected') seatRulesUi.expanded.add(rule.id);
        break;
      default:
        return;
    }
    persistSeatRules(cls);
    renderSeatRulesModal(cls);
  }

  function openSeatRulesModal(options = {}) {
    const cls = getSeatClass();
    if (!cls) {
      showToast('학급을 먼저 선택해주세요.');
      return;
    }
    if (seatRevealBusy) {
      showToast('자리 배치 연출이 끝난 뒤 열어주세요.');
      return;
    }
    if (!cls.seatLayout) {
      cls.seatLayout = ctCreateSeatGrid(5, 6, { teacherPosition: 'front' });
    }
    const rules = syncSeatRules(cls);
    ctSaveState(state);
    seatRulesUi = {
      tab: 'all',
      pickerOpen: !rules.length,
      expanded: new Set(),
      report: options.report || '',
    };
    showModal(
      '⚙️ 규칙 설정',
      '<div class="seat-rules" id="seatRulesRoot"></div>',
      `<button type="button" class="btn btn-secondary" id="modalSeatRulesCheck">현재 배치 검사</button>
       <button type="button" class="btn btn-secondary" id="modalSeatRulesFeasibility">가능 여부 검사</button>
       <button type="button" class="btn btn-primary" id="modalSeatRulesDone">완료</button>`,
      { wide: true }
    );
    const root = $('#seatRulesRoot');
    root.addEventListener('click', (e) => handleSeatRulesClick(e, cls));
    root.addEventListener('change', (e) => handleSeatRulesChange(e, cls));
    $('#modalSeatRulesCheck').onclick = () => checkCurrentSeatRules(cls);
    $('#modalSeatRulesFeasibility').onclick = () => checkSeatRuleFeasibility(cls);
    $('#modalSeatRulesDone').onclick = () => {
      closeModal();
      updateSeatRulesButton(cls);
    };
    renderSeatRulesModal(cls);
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

  /* ── 당번관리 ── */
  function getCleaningMeta(cls) {
    if (!cls.dutyMeta) cls.dutyMeta = {};
    if (!cls.dutyMeta.cleaning) cls.dutyMeta.cleaning = { slots: 4, mode: 'single' };
    const meta = cls.dutyMeta.cleaning;
    meta.slots = Math.min(12, Math.max(1, parseInt(meta.slots, 10) || 4));
    if (meta.mode !== 'weekly') meta.mode = 'single';
    return meta;
  }

  function getDutyPrintMeta(cls) {
    if (!cls.dutyMeta) cls.dutyMeta = {};
    if (!cls.dutyMeta.print) {
      cls.dutyMeta.print = { cleaning: true, meal: true, environment: true };
    }
    return cls.dutyMeta.print;
  }

  function dutyHasPrintableData(cls, key) {
    if (key === 'cleaning') {
      const meta = getCleaningMeta(cls);
      if (meta.mode === 'weekly') {
        const week = ctEnsureWeeklyCleaning(cls.cleaningWeek, meta.slots);
        return week.some((day) => day.assignments.some((a) => a.studentId));
      }
      return (cls.duties?.cleaning || []).some((d) => d.studentId);
    }
    return (cls.duties?.[key] || []).some((d) => d.studentId);
  }

  function getDutyPrintHint(cls) {
    const printMeta = getDutyPrintMeta(cls);
    const selected = DUTY_PRINT_TYPES.filter((key) => printMeta[key]);
    if (!selected.length) return '출력할 항목을 1개 이상 선택해주세요.';
    const ready = selected.filter((key) => dutyHasPrintableData(cls, key));
    if (!ready.length) return '선택한 항목에 배정된 당번이 없습니다.';
    const labels = ready.map((key) => CT_DUTY_TYPES[key].label);
    return `출력 예정: ${labels.join(', ')}`;
  }

  function renderDutyPrintSettings(cls, panel) {
    const printMeta = getDutyPrintMeta(cls);
    panel.innerHTML = `
      <p class="duty-print-desc">출력할 당번 항목을 선택한 뒤 당번표를 생성하세요.</p>
      <div class="duty-print-options">
        ${DUTY_PRINT_TYPES.map((key) => {
          const val = CT_DUTY_TYPES[key];
          const hasData = dutyHasPrintableData(cls, key);
          return `<label class="checkbox duty-print-option${hasData ? '' : ' duty-print-option--empty'}">
            <input type="checkbox" class="duty-print-check" data-print-type="${key}" ${printMeta[key] ? 'checked' : ''} />
            <span>${val.icon} ${val.label}${hasData ? '' : ' <span class="field-hint">(배정 없음)</span>'}</span>
          </label>`;
        }).join('')}
      </div>
      <div class="form-row duty-print-actions">
        <button type="button" class="btn btn-primary" id="btnPrintDuties">🖨️ 당번표 출력</button>
        <button type="button" class="btn btn-secondary" id="btnSelectAllDutyPrint">전체 선택</button>
        <button type="button" class="btn btn-secondary" id="btnDeselectAllDutyPrint">전체 해제</button>
      </div>
      <p class="field-hint duty-print-hint" id="dutyPrintHint">${esc(getDutyPrintHint(cls))}</p>`;

    const updateHint = () => {
      const hint = $('#dutyPrintHint');
      if (hint) hint.textContent = getDutyPrintHint(cls);
    };

    panel.querySelectorAll('.duty-print-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        printMeta[cb.dataset.printType] = cb.checked;
        saveAndRefresh();
        updateHint();
      });
    });

    $('#btnSelectAllDutyPrint').onclick = () => {
      DUTY_PRINT_TYPES.forEach((key) => { printMeta[key] = true; });
      saveAndRefresh();
      renderDuties();
    };
    $('#btnDeselectAllDutyPrint').onclick = () => {
      DUTY_PRINT_TYPES.forEach((key) => { printMeta[key] = false; });
      saveAndRefresh();
      renderDuties();
    };
    $('#btnPrintDuties').onclick = () => printDuties();
  }

  function bindCleaningSettings(cls, students, panel) {
    const meta = getCleaningMeta(cls);
    const slotsInput = $('#dutyCleaningSlots');
    if (slotsInput) {
      slotsInput.addEventListener('change', () => {
        meta.slots = Math.min(12, Math.max(1, parseInt(slotsInput.value, 10) || 4));
        slotsInput.value = String(meta.slots);
        if (meta.mode === 'weekly') {
          cls.cleaningWeek = ctEnsureWeeklyCleaning(cls.cleaningWeek, meta.slots);
        } else {
          cls.duties.cleaning = ctResizeDutySlots(cls.duties.cleaning, meta.slots, 'cleaning');
        }
        saveAndRefresh();
        renderDuties();
      });
    }
    panel.querySelectorAll('[data-cleaning-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        meta.mode = btn.dataset.cleaningMode === 'weekly' ? 'weekly' : 'single';
        if (meta.mode === 'weekly') {
          cls.cleaningWeek = ctEnsureWeeklyCleaning(cls.cleaningWeek, meta.slots);
        } else {
          cls.duties.cleaning = ctResizeDutySlots(cls.duties.cleaning, meta.slots, 'cleaning');
        }
        saveAndRefresh();
        renderDuties();
      });
    });
  }

  function renderCleaningWeekly(cls, students, panel, meta) {
    cls.cleaningWeek = ctEnsureWeeklyCleaning(cls.cleaningWeek, meta.slots);
    const week = cls.cleaningWeek;
    const slotHeaders = week[0]?.assignments?.map((a) => `<th>${esc(a.label)}</th>`).join('') || '';
    const opts = `<option value="">선택</option>${students.map((s) =>
      `<option value="${s.id}">${s.number}. ${esc(s.name)}</option>`
    ).join('')}`;

    panel.innerHTML = `
      ${renderCleaningSettingsHtml(meta)}
      <div class="form-row duty-cleaning-actions">
        <button type="button" class="btn btn-primary" id="btnAssignCleaningWeek">주간 랜덤 배정</button>
        <button type="button" class="btn btn-secondary" id="btnClearCleaningWeek">표 비우기</button>
      </div>
      <div class="duty-week-wrap">
        <table class="duty-week-table">
          <thead>
            <tr><th>요일</th>${slotHeaders}</tr>
          </thead>
          <tbody>
            ${week.map((day, dayIdx) => `
              <tr>
                <th scope="row">${esc(day.short)}</th>
                ${day.assignments.map((a, slotIdx) => `
                  <td>
                    <select class="input input-select duty-week-select"
                      data-day-idx="${dayIdx}" data-slot-idx="${slotIdx}">${opts}</select>
                  </td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    bindCleaningSettings(cls, students, panel);

    panel.querySelectorAll('.duty-week-select').forEach((sel) => {
      const dayIdx = parseInt(sel.dataset.dayIdx, 10);
      const slotIdx = parseInt(sel.dataset.slotIdx, 10);
      const assignment = week[dayIdx]?.assignments?.[slotIdx];
      if (assignment) sel.value = assignment.studentId || '';
      sel.addEventListener('change', () => {
        const student = students.find((s) => s.id === sel.value);
        const target = week[dayIdx].assignments[slotIdx];
        target.studentId = student?.id || null;
        target.name = student?.name || '';
        target.number = student?.number || 0;
        saveAndRefresh();
      });
    });

    $('#btnAssignCleaningWeek').onclick = () => {
      cls.cleaningWeek = ctAssignWeeklyCleaning(students, meta.slots);
      saveAndRefresh();
      renderDuties();
      showToast('주간 청소 당번표가 배정되었습니다.');
    };
    $('#btnClearCleaningWeek').onclick = () => {
      cls.cleaningWeek = ctCreateEmptyWeeklyCleaning(meta.slots);
      saveAndRefresh();
      renderDuties();
      showToast('주간 당번표를 비웠습니다.');
    };
  }

  function renderCleaningSettingsHtml(meta) {
    return `
      <div class="duty-cleaning-settings">
        <div class="form-row duty-cleaning-settings__row">
          <label class="field">
            <span class="field-label">청소 인원</span>
            <input type="number" id="dutyCleaningSlots" class="input" min="1" max="12" value="${meta.slots}" />
          </label>
          <div class="duty-mode-tabs" role="tablist" aria-label="청소 당번 모드">
            <button type="button" class="duty-mode-tab${meta.mode === 'single' ? ' is-active' : ''}" data-cleaning-mode="single">당번 배정</button>
            <button type="button" class="duty-mode-tab${meta.mode === 'weekly' ? ' is-active' : ''}" data-cleaning-mode="weekly">주간 당번표</button>
          </div>
        </div>
        <p class="field-hint duty-cleaning-hint">
          ${meta.mode === 'weekly' ? '월~금요일 청소 당번표를 만들고 수정할 수 있습니다.' : '이번 당번을 인원 수에 맞게 배정합니다.'}
        </p>
      </div>`;
  }

  function renderCleaningDuties(cls, students, panel) {
    const meta = getCleaningMeta(cls);
    if (meta.mode === 'weekly') {
      renderCleaningWeekly(cls, students, panel, meta);
      return;
    }

    let duties = ctResizeDutySlots(cls.duties.cleaning, meta.slots, 'cleaning');
    cls.duties.cleaning = duties;
    const opts = `<option value="">선택</option>${students.map((s) =>
      `<option value="${s.id}">${s.number}. ${esc(s.name)}</option>`
    ).join('')}`;

    const hasAssigned = duties.some((d) => d.studentId);
    panel.innerHTML = `
      ${renderCleaningSettingsHtml(meta)}
      <div class="form-row duty-cleaning-actions">
        <button type="button" class="btn btn-primary" id="btnAssignDuty">${hasAssigned ? '다시 랜덤 배정' : '랜덤 배정'}</button>
        ${hasAssigned ? '<button type="button" class="btn btn-secondary" id="btnRotateDuty">한 칸 로테이션</button>' : ''}
      </div>
      ${duties.map((d, i) => `
        <div class="duty-slot">
          <label>${esc(d.label)}</label>
          <select class="input input-select duty-select" data-idx="${i}">${opts}</select>
        </div>
      `).join('')}`;

    bindCleaningSettings(cls, students, panel);

    panel.querySelectorAll('.duty-select').forEach((sel, i) => {
      sel.value = duties[i].studentId || '';
      sel.addEventListener('change', () => {
        const student = students.find((s) => s.id === sel.value);
        duties[i].studentId = student?.id || null;
        duties[i].name = student?.name || '';
        duties[i].number = student?.number || 0;
        saveAndRefresh();
      });
    });

    $('#btnAssignDuty').onclick = () => {
      cls.duties.cleaning = ctAssignDuties(students, 'cleaning', meta.slots);
      saveAndRefresh();
      renderDuties();
    };
    const rotateBtn = $('#btnRotateDuty');
    if (rotateBtn) {
      rotateBtn.onclick = () => {
        cls.duties.cleaning = ctRotateDuties(duties, students);
        saveAndRefresh();
        renderDuties();
      };
    }
  }

  function renderDuties() {
    const tabs = $('#dutyTabs');
    const dutyTabHtml = Object.entries(CT_DUTY_TYPES).map(([key, val]) =>
      `<button type="button" class="duty-tab ${key === activeDutyType ? 'is-active' : ''}" data-duty="${key}">${val.icon} ${val.label}</button>`
    ).join('');
    const printTabHtml = `<button type="button" class="duty-tab duty-tab--print ${activeDutyType === 'print' ? 'is-active' : ''}" data-duty="print">🖨️ 출력 설정</button>`;
    tabs.innerHTML = dutyTabHtml + printTabHtml;
    tabs.querySelectorAll('.duty-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeDutyType = btn.dataset.duty;
        renderDuties();
      });
    });

    const cls = ctGetActiveClass(state);
    if (!cls) return;
    if (!cls.duties) cls.duties = { cleaning: [], meal: [], environment: [], other: [] };
    const students = cls.students || [];
    const panel = $('#dutyPanel');

    if (activeDutyType === 'print') {
      renderDutyPrintSettings(cls, panel);
      return;
    }

    if (activeDutyType === 'cleaning') {
      if (!students.length) {
        panel.innerHTML = '<p class="field-hint">학생 명단이 없습니다. 관리실에서 학생을 등록해주세요.</p>';
        return;
      }
      renderCleaningDuties(cls, students, panel);
      return;
    }

    const duties = cls.duties[activeDutyType] || [];

    if (!duties.length) {
      panel.innerHTML = `
        <p>당번 슬롯 수를 설정하고 배정하세요.</p>
        <div class="form-row">
          <label class="field"><span class="field-label">슬롯 수</span><input type="number" id="dutySlots" class="input" min="1" max="20" value="4" /></label>
          <button type="button" class="btn btn-primary" id="btnAssignDuty">랜덤 배정</button>
        </div>`;
      $('#btnAssignDuty').onclick = () => {
        const slots = parseInt($('#dutySlots').value, 10) || 4;
        cls.duties[activeDutyType] = ctAssignDuties(students, activeDutyType, slots);
        saveAndRefresh();
        renderDuties();
      };
      return;
    }

    const opts = students.map((s) => `<option value="${s.id}">${s.number}. ${esc(s.name)}</option>`).join('');
    panel.innerHTML = `
      <div class="form-row" style="margin-bottom:14px">
        <button type="button" class="btn btn-primary" id="btnReassignDuty">다시 랜덤 배정</button>
        <button type="button" class="btn btn-secondary" id="btnRotateDuty">한 칸 로테이션</button>
      </div>
      ${duties.map((d, i) => `
        <div class="duty-slot">
          <label>${esc(d.label)}</label>
          <select class="input input-select duty-select" data-idx="${i}">${opts}</select>
        </div>
      `).join('')}`;

    panel.querySelectorAll('.duty-select').forEach((sel, i) => {
      sel.value = duties[i].studentId || '';
      sel.addEventListener('change', () => {
        const student = students.find((s) => s.id === sel.value);
        duties[i].studentId = student?.id || null;
        duties[i].name = student?.name || '';
        duties[i].number = student?.number || 0;
        saveAndRefresh();
      });
    });
    $('#btnReassignDuty').onclick = () => {
      cls.duties[activeDutyType] = ctAssignDuties(students, activeDutyType, duties.length);
      saveAndRefresh();
      renderDuties();
    };
    $('#btnRotateDuty').onclick = () => {
      cls.duties[activeDutyType] = ctRotateDuties(duties, students);
      saveAndRefresh();
      renderDuties();
    };
  }

  /* ── 랜덤추첨 / 룰렛 ── */
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
    const classId = state.activeClassId;
    const poolIds = new Set(ctLoadRoulettePool(classId, students.map((s) => s.id)));
    let participants = students.filter((s) => poolIds.has(s.id));
    if (!participants.length && poolIds.size === 0 && students.length) {
      participants = students;
    }
    return participants.filter((s) => !rouletteState.students.excluded.has(s.id));
  }

  function getRouletteCustomPool() {
    const classId = state.activeClassId;
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
      const allItems = ctLoadRouletteCustomItems(state.activeClassId);
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
    const classId = state.activeClassId;
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
    const classId = state.activeClassId;
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
      getClassId: () => state.activeClassId,
      getTreasureRewards: () => state.treasureRewards || [],
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
        const classId = state.activeClassId;
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
        const rewards = state.treasureRewards || [];
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

  /* ── 타이머 / 스톱워치 ── */
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

  /* ── 출력 ── */
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function printHtml(contentHtml, options = {}) {
    const { landscape = false } = options;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', '인쇄');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const base = document.baseURI || window.location.href;
    const printCss = new URL('print.css', base).href;
    const fontCss = window.location.protocol === 'file:'
      ? 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css'
      : new URL('vendor/pretendard/pretendard.css', base).href;
    const pageRule = landscape
      ? '@page { size: landscape; margin: 8mm; }'
      : '@page { size: portrait; margin: 12mm; }';
    const bodyClass = landscape ? ' class="print-seat-mode"' : '';

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<link rel="stylesheet" href="${fontCss}">
<link rel="stylesheet" href="${printCss}">
<style>
${pageRule}
html, body { margin: 0; padding: 0; background: #fff; font-family: Pretendard, -apple-system, sans-serif; }
</style></head><body${bodyClass}>${contentHtml}</body></html>`);
    doc.close();

    const win = iframe.contentWindow;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      iframe.remove();
    };

    const doPrint = () => {
      win.focus();
      win.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 60000);
      try {
        win.print();
      } catch {
        cleanup();
        showToast('인쇄를 시작할 수 없습니다. 브라우저 팝업 차단을 확인해주세요.');
      }
    };

    const waitForStyles = () => {
      const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
      if (!links.length) {
        setTimeout(doPrint, 50);
        return;
      }
      let pending = links.length;
      let printed = false;
      const tryPrint = () => {
        if (printed) return;
        printed = true;
        setTimeout(doPrint, 80);
      };
      const onLinkDone = () => {
        pending -= 1;
        if (pending <= 0) tryPrint();
      };
      links.forEach((link) => {
        if (link.sheet) onLinkDone();
        else {
          link.addEventListener('load', onLinkDone, { once: true });
          link.addEventListener('error', onLinkDone, { once: true });
        }
      });
      setTimeout(tryPrint, 2500);
    };

    if (iframe.contentDocument?.readyState === 'complete') {
      waitForStyles();
    } else {
      iframe.onload = waitForStyles;
    }
  }

  function sortStudentsBySchoolNumber(students) {
    return [...students].sort((a, b) => {
      const na = Number(a.number);
      const nb = Number(b.number);
      const aNum = Number.isFinite(na) ? na : 0;
      const bNum = Number.isFinite(nb) ? nb : 0;
      if (aNum !== bNum) return aNum - bNum;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  }

  function buildClassroomRosterRowsHtml(students, rowCount) {
    const sorted = sortStudentsBySchoolNumber(students);
    let rows = '';
    for (let i = 0; i < rowCount; i++) {
      const st = sorted[i];
      const numCell = st?.number != null && st.number !== '' ? esc(String(st.number)) : '';
      rows += `<tr><td>${numCell}</td><td>${st ? esc(st.name) : ''}</td></tr>`;
    }
    return rows;
  }

  function buildClassroomRosterHtml(students, scale) {
    const rows = buildClassroomRosterRowsHtml(students, scale.rosterRows);
    return `
      <aside class="print-seat-roster" style="width:${scale.rosterMm}mm">
        <div class="print-seat-roster__title">☺ 명단 ☺</div>
        <table class="print-seat-roster__table" style="font-size:${scale.rosterFontPt}pt">
          <tbody>${rows}</tbody>
        </table>
      </aside>`;
  }

  function getSeatsSortedForPrintVariant(layout, variant) {
    if (variant === 'board') {
      return [...layout.seats].sort(
        (a, b) => a.row * layout.cols + a.col - (b.row * layout.cols + b.col)
      );
    }
    return ctSortSeatsForPrint(layout, true);
  }

  function buildSeatDeskHtml(variant, { preview = false } = {}) {
    const deskLabel = '교탁';
    if (preview) {
      return `<div class="seat-preview-desk-wrap"><div class="seat-preview-desk seat-preview-desk--compact">${deskLabel}</div></div>`;
    }
    const posClass = variant === 'board' ? 'print-seat-desk--top' : 'print-seat-desk--bottom';
    return `<div class="print-seat-desk-wrap"><div class="print-seat-desk ${posClass} print-seat-desk--compact">${deskLabel}</div></div>`;
  }

  function buildClassroomSeatPrintHtml(cls, layout, students, variant, scale, meta) {
    const president = students.find((s) => s.id === meta.classPresidentId);
    const vice = students.find((s) => s.id === meta.vicePresidentId);
    const enrolled = students.length;
    const classLabel = getClassDisplayLabel(cls);
    const notice = meta.printNotice || '아이들이 자리를 임의로 바꿀 시 담임에게 꼭 이야기 해주세요~~~';
    const deskTop = variant === 'board';

    let html = `<style>
      .print-page--seat .print-seat-grid { gap: ${scale.gapMm}mm; grid-template-rows: repeat(${scale.rows}, 1fr); }
      .print-page--seat .print-seat-cell { font-size: ${scale.fontPt}pt; }
      .print-seat-roster { width: ${scale.rosterMm}mm; }
    </style>`;

    html += `<div class="print-page print-page--seat print-seat-sheet print-seat-sheet--teacher${deskTop ? ' print-seat-sheet--board' : ''}">
      <p class="print-seat-notice">${esc(notice)}</p>
      <table class="print-seat-info">
        <tr>
          <td class="print-seat-info__class">${esc(classLabel)}</td>
          <td class="print-seat-info__cell"><span class="print-seat-info__label">재적</span>${enrolled}명</td>
          <td class="print-seat-info__cell"><span class="print-seat-info__label">담임</span>${esc(meta.homeroomTeacher || '')}</td>
          <td class="print-seat-info__cell"><span class="print-seat-info__label">반장</span>${esc(president?.name || '')}</td>
          <td class="print-seat-info__cell"><span class="print-seat-info__label">부반장</span>${esc(vice?.name || '')}</td>
        </tr>
      </table>
      <div class="print-seat-body">
        <div class="print-seat-main">
          <div class="print-seat-center">`;

    if (deskTop) html += buildSeatDeskHtml(variant);

    html += `<div class="print-seat-grid" style="grid-template-columns:repeat(${layout.cols},1fr)">`;
    getSeatsSortedForPrintVariant(layout, variant).forEach((seat) => {
      if (seat.isAisle) {
        html += `<div class="print-seat-cell print-seat-cell--aisle"></div>`;
      } else if (seat.isEmpty) {
        html += `<div class="print-seat-cell print-seat-cell--empty"></div>`;
      } else {
        const st = students.find((s) => s.id === seat.studentId);
        html += `<div class="print-seat-cell">${esc(st?.name || '')}</div>`;
      }
    });
    html += `</div>`;

    if (!deskTop) html += buildSeatDeskHtml(variant);

    html += `</div></div>`;
    html += buildClassroomRosterHtml(students, scale);
    html += `</div></div>`;
    return html;
  }

  function buildClassroomSeatPreviewHtml(cls, layout, students, variant, meta) {
    const president = students.find((s) => s.id === meta.classPresidentId);
    const vice = students.find((s) => s.id === meta.vicePresidentId);
    const enrolled = students.length;
    const classLabel = getClassDisplayLabel(cls);
    const notice = meta.printNotice || '아이들이 자리를 임의로 바꿀 시 담임에게 꼭 이야기 해주세요~~~';
    const deskTop = variant === 'board';

    const rosterRows = Math.max(30, students.length);
    const rosterHtml = buildClassroomRosterRowsHtml(students, rosterRows);

    let gridHtml = '';
    getSeatsSortedForPrintVariant(layout, variant).forEach((seat) => {
      if (seat.isAisle) {
        gridHtml += `<div class="seat-preview-cell seat-preview-cell--aisle"></div>`;
      } else if (seat.isEmpty) {
        gridHtml += `<div class="seat-preview-cell seat-preview-cell--empty"></div>`;
      } else {
        const st = students.find((s) => s.id === seat.studentId);
        gridHtml += `<div class="seat-preview-cell">${esc(st?.name || '')}</div>`;
      }
    });

    const deskHtml = buildSeatDeskHtml(variant, { preview: true });
    const boardBlock = deskTop
      ? `${deskHtml}<div class="seat-preview-grid" style="grid-template-columns:repeat(${layout.cols},1fr)">${gridHtml}</div>`
      : `<div class="seat-preview-grid" style="grid-template-columns:repeat(${layout.cols},1fr)">${gridHtml}</div>${deskHtml}`;

    return `
      <div class="seat-preview-sheet seat-preview-sheet--teacher${deskTop ? ' seat-preview-sheet--board' : ''}">
        <p class="seat-preview-notice">${esc(notice)}</p>
        <table class="seat-preview-info">
          <tr>
            <td class="seat-preview-info__class">${esc(classLabel)}</td>
            <td class="seat-preview-info__cell"><span class="seat-preview-info__label">재적</span>${enrolled}명</td>
            <td class="seat-preview-info__cell"><span class="seat-preview-info__label">담임</span>${esc(meta.homeroomTeacher || '')}</td>
            <td class="seat-preview-info__cell"><span class="seat-preview-info__label">반장</span>${esc(president?.name || '')}</td>
            <td class="seat-preview-info__cell"><span class="seat-preview-info__label">부반장</span>${esc(vice?.name || '')}</td>
          </tr>
        </table>
        <div class="seat-preview-body">
          <div class="seat-preview-main">
            <div class="seat-preview-center">
              ${boardBlock}
            </div>
          </div>
          <aside class="seat-preview-roster">
            <div class="seat-preview-roster__title">☺ 명단 ☺</div>
            <table class="seat-preview-roster__table"><tbody>${rosterHtml}</tbody></table>
          </aside>
        </div>
      </div>`;
  }

  function openSeatPrintPreview(variant = 'teacher') {
    const cls = getSeatClass();
    if (!cls?.seatLayout) { showToast('자리배치가 없습니다.'); return; }
    const layout = variant === 'teacher'
      ? ctMirrorLayoutForTeacher(cls.seatLayout)
      : cls.seatLayout;
    const students = getActiveStudents();
    const meta = ensureSeatMeta(cls);
    const previewHtml = buildClassroomSeatPreviewHtml(cls, layout, students, variant, meta);
    const title = variant === 'board' ? '칠판 부착용 좌석표' : '교탁 부착용 좌석표';

    showModal(
      title,
      `<div class="seat-preview-wrap">${previewHtml}</div>`,
      `
        <button type="button" class="btn btn-secondary" id="btnCloseSeatPreview">닫기</button>
        <button type="button" class="btn btn-primary" id="btnPrintSeatPreview">🖨️ 출력하기</button>
      `,
      { wide: true }
    );

    $('#btnCloseSeatPreview')?.addEventListener('click', closeModal);
    $('#btnPrintSeatPreview')?.addEventListener('click', () => {
      closeModal();
      printSeats(variant);
    });
  }

  function openTeacherSeatPreview() {
    openSeatPrintPreview('teacher');
  }

  function openBoardSeatPreview() {
    openSeatPrintPreview('board');
  }

  function printSeats(variant = 'teacher') {
    const cls = getSeatClass();
    if (!cls?.seatLayout) { showToast('자리배치가 없습니다.'); return; }
    const layout = variant === 'teacher'
      ? ctMirrorLayoutForTeacher(cls.seatLayout)
      : cls.seatLayout;
    const students = getActiveStudents();
    const meta = ensureSeatMeta(cls);
    const scale = ctComputeSeatPrintScale(layout, {
      hasRoster: true,
      studentCount: students.length,
      forTeacher: true,
    });

    const html = buildClassroomSeatPrintHtml(cls, layout, students, variant, scale, meta);
    printHtml(html, { landscape: true });
  }

  function openSeatEnlargeFullscreen() {
    const cls = getSeatClass();
    if (!cls?.seatLayout) { showToast('자리배치가 없습니다.'); return; }
    // 학생 화면용: 교탁이 위, 그 아래가 앞자리(편집 화면과 동일 방향)
    const layout = cls.seatLayout;
    const students = getActiveStudents();
    const meta = ensureSeatMeta(cls);
    const classLabel = getClassDisplayLabel(cls);
    const president = students.find((s) => s.id === meta.classPresidentId);
    const vice = students.find((s) => s.id === meta.vicePresidentId);

    const sortedSeats = [...layout.seats].sort(
      (a, b) => a.row * layout.cols + a.col - (b.row * layout.cols + b.col)
    );
    const cells = sortedSeats.map((seat) => {
      if (seat.isAisle) return '<div class="seat-fs-cell seat-fs-cell--aisle"></div>';
      if (seat.isEmpty) return '<div class="seat-fs-cell seat-fs-cell--empty"></div>';
      const st = students.find((s) => s.id === seat.studentId);
      if (!st) return '<div class="seat-fs-cell seat-fs-cell--vacant"></div>';
      const isPres = meta.classPresidentId === st.id;
      const isVice = meta.vicePresidentId === st.id;
      const role = isPres ? '<span class="seat-fs-role seat-fs-role--president">반</span>'
        : isVice ? '<span class="seat-fs-role seat-fs-role--vice">부</span>' : '';
      return `<div class="seat-fs-cell">
        ${role}
        <span class="seat-fs-num">${esc(st.number)}</span>
        <span class="seat-fs-name">${esc(st.name)}</span>
      </div>`;
    }).join('');

    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = false;
    overlay.classList.add('is-open', 'fullscreen-overlay--seats');
    overlay.setAttribute('aria-hidden', 'false');
    content.className = 'fullscreen-content fullscreen-seats';
    content.innerHTML = `
      <div class="seat-fs">
        <header class="seat-fs__head">
          <h2 class="seat-fs__title">${esc(classLabel)} 자리배치</h2>
          <p class="seat-fs__meta">
            재적 ${students.length}명
            ${meta.homeroomTeacher ? ` · 담임 ${esc(meta.homeroomTeacher)}` : ''}
            ${president ? ` · 반장 ${esc(president.name)}` : ''}
            ${vice ? ` · 부반장 ${esc(vice.name)}` : ''}
          </p>
        </header>
        <div class="seat-fs__board">
          <div class="seat-fs-desk">교탁</div>
          <div class="seat-fs-grid" style="grid-template-columns:repeat(${layout.cols}, minmax(0, 1fr))">${cells}</div>
        </div>
        <p class="seat-fs__hint">본인 자리를 확인하세요</p>
      </div>`;
  }

  function printGroups() {
    const cls = ctGetActiveClass(state);
    if (!cls?.groupResult?.length) { showToast('모둠 편성 결과가 없습니다.'); return; }
    let html = `<div class="print-page">
      <div class="print-title">모둠표</div>
      <div class="print-meta">${esc(getUserSchool())} ${esc(cls.name)}</div>
      <div class="print-groups">`;
    cls.groupResult.forEach((g) => {
      html += `<div class="print-group-card"><h3>${g.number}모둠</h3><ul>`;
      g.members.forEach((m) => { html += `<li>${m.number}. ${esc(m.name)}</li>`; });
      html += `</ul></div>`;
    });
    html += `</div></div>`;
    printHtml(html);
  }

  function buildPresentationPrintTableRows(items) {
    return items.map((p) => `<tr><td>${p.order}</td><td>${p.number}</td><td>${esc(p.name)}</td></tr>`).join('');
  }

  function buildPresentationPrintTable(items) {
    return `<table class="print-table"><thead><tr><th>순서</th><th>학번</th><th>이름</th></tr></thead><tbody>${buildPresentationPrintTableRows(items)}</tbody></table>`;
  }

  function buildPresentationPrintScaleCss(scale) {
    const metaPt = Math.max(8, scale.titlePt - 3);
    let css = `
      .print-page--presentation { max-height: 273mm; overflow: hidden; }
      .print-page--presentation .print-title { font-size: ${scale.titlePt}pt; margin-bottom: 3mm; }
      .print-page--presentation .print-meta { font-size: ${metaPt}pt; margin-bottom: 3mm; }
      .print-page--presentation .print-table { font-size: ${scale.fontPt}pt; line-height: 1.2; }
      .print-page--presentation .print-table th,
      .print-page--presentation .print-table td { padding: ${scale.padMm}mm ${(scale.padMm * 1.3).toFixed(1)}mm; }
    `;
    if (scale.mode === 'class') {
      css += `.print-presentation-cols { grid-template-columns: repeat(${scale.cols}, 1fr); gap: ${scale.colGapMm}mm; }`;
    } else {
      css += `
        .print-presentation-groups { display: grid; grid-template-columns: repeat(${scale.gridCols}, 1fr); gap: ${scale.gridGapMm}mm; }
        .print-page--presentation .print-group-card { padding: ${scale.cardPadMm}mm; }
        .print-page--presentation .print-group-card h3 { font-size: ${scale.h3Pt}pt; margin: 0 0 ${Math.max(1, scale.padMm)}mm; }
      `;
    }
    return css;
  }

  function buildPresentationPrintHtml(cls, mode) {
    const scale = mode === 'group'
      ? ctComputePresentationPrintScale({ mode: 'group', byGroup: cls.presentationByGroup })
      : ctComputePresentationPrintScale({ mode: 'class', order: cls.presentationOrder });
    const title = mode === 'group' ? '모둠별 발표순서표' : '발표순서표';
    let body = '';

    if (mode === 'group') {
      body = `<div class="print-presentation-groups">${cls.presentationByGroup.map((g) => `
        <div class="print-group-card">
          <h3>${g.groupNumber}모둠</h3>
          ${buildPresentationPrintTable(g.order)}
        </div>
      `).join('')}</div>`;
    } else {
      const columns = ctSplitPresentationPrintColumns(cls.presentationOrder, scale.cols);
      body = `<div class="print-presentation-cols">${columns.map((col) => buildPresentationPrintTable(col)).join('')}</div>`;
    }

    return `<style>${buildPresentationPrintScaleCss(scale)}</style>
      <div class="print-page print-page--presentation">
        <div class="print-title">${title}</div>
        <div class="print-meta">${esc(getUserSchool())} ${esc(cls.name)}</div>
        <div class="print-presentation-body">${body}</div>
      </div>`;
  }

  function printPresentation() {
    const cls = ctGetActiveClass(state);
    if (!presentationViewActive) { showToast('먼저 순서를 생성해주세요.'); return; }

    if (presentationMode === 'group') {
      if (!cls?.presentationByGroup?.length) { showToast('발표순서가 없습니다.'); return; }
      printHtml(buildPresentationPrintHtml(cls, 'group'));
      return;
    }

    if (!cls?.presentationOrder?.length) { showToast('발표순서가 없습니다.'); return; }
    printHtml(buildPresentationPrintHtml(cls, 'class'));
  }

  function printCleaningWeekTable(week) {
    if (!week?.length) return '';
    const headers = week[0].assignments.map((a) => `<th>${esc(a.label)}</th>`).join('');
    const rows = week.map((day) => `
      <tr>
        <th>${esc(day.short)}</th>
        ${day.assignments.map((a) => `<td>${a.number ? `${a.number}. ` : ''}${esc(a.name || '-')}</td>`).join('')}
      </tr>
    `).join('');
    return `<table class="print-table duty-week-print"><thead><tr><th>요일</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function appendDutyPrintSection(html, cls, key) {
    const val = CT_DUTY_TYPES[key];
    if (key === 'cleaning') {
      const cleaningMeta = getCleaningMeta(cls);
      if (cleaningMeta.mode === 'weekly' && cls.cleaningWeek?.length) {
        const week = ctEnsureWeeklyCleaning(cls.cleaningWeek, cleaningMeta.slots);
        if (!week.some((day) => day.assignments.some((a) => a.studentId))) return html;
        return `${html}<h3 style="margin:16px 0 8px">${val.icon} ${val.label} (주간)</h3>${printCleaningWeekTable(week)}`;
      }
      const cleaning = cls.duties.cleaning || [];
      if (!cleaning.some((d) => d.studentId)) return html;
      let section = `${html}<h3 style="margin:16px 0 8px">${val.icon} ${val.label}</h3>
        <table class="print-table"><thead><tr><th>역할</th><th>학번</th><th>이름</th></tr></thead><tbody>`;
      cleaning.forEach((d) => {
        if (!d.studentId) return;
        section += `<tr><td>${esc(d.label)}</td><td>${d.number}</td><td>${esc(d.name)}</td></tr>`;
      });
      return `${section}</tbody></table>`;
    }

    const duties = cls.duties[key] || [];
    if (!duties.some((d) => d.studentId)) return html;
    let section = `${html}<h3 style="margin:16px 0 8px">${val.icon} ${val.label}</h3>
      <table class="print-table"><thead><tr><th>역할</th><th>학번</th><th>이름</th></tr></thead><tbody>`;
    duties.forEach((d) => {
      if (!d.studentId) return;
      section += `<tr><td>${esc(d.label)}</td><td>${d.number}</td><td>${esc(d.name)}</td></tr>`;
    });
    return `${section}</tbody></table>`;
  }

  function printDuties() {
    const cls = ctGetActiveClass(state);
    if (!cls?.duties) { showToast('당번 정보가 없습니다.'); return; }

    const printMeta = getDutyPrintMeta(cls);
    const selected = DUTY_PRINT_TYPES.filter((key) => printMeta[key]);
    if (!selected.length) {
      showToast('출력할 항목을 1개 이상 선택해주세요.');
      return;
    }
    const printable = selected.filter((key) => dutyHasPrintableData(cls, key));
    if (!printable.length) {
      showToast('선택한 항목에 배정된 당번이 없습니다.');
      return;
    }

    let html = `<div class="print-page">
      <div class="print-title">당번표</div>
      <div class="print-meta">${esc(getUserSchool())} ${esc(cls.name)}</div>`;
    printable.forEach((key) => {
      html = appendDutyPrintSection(html, cls, key);
    });
    html += `</div>`;
    printHtml(html);
  }

  function openFullscreen(mode) {
    const overlay = $('#fullscreenOverlay');
    const content = $('#fullscreenContent');
    overlay.hidden = false;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');

    if (mode === 'timer') {
      content.className = 'fullscreen-content fullscreen-timer';
      const label = timerMode === 'stopwatch' ? '스톱워치' : '타이머';
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

    $('#btnExport').addEventListener('click', ctExportData);
    $('#btnImport').addEventListener('click', () => $('#importFileInput').click());
    $('#importFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await ctImportData(file);
        state = ctLoadState();
        renderOffice();
        refreshHeader();
        showToast('데이터가 복원되었습니다.');
      } catch (err) {
        showToast(err.message);
      }
      e.target.value = '';
    });

    $('#btnReset').addEventListener('click', () => {
      if (confirm('모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        ctResetAll();
        state = ctLoadState();
        seatContext = { classId: null };
        renderOffice();
        refreshHeader();
        showToast('초기화되었습니다.');
      }
    });

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
      seatRuleAlert = null;
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
      seatRuleAlert = null;
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
      } else if (act === 'detail' && seatRuleAlert) {
        openSeatRulesModal({ report: seatViolationReport('자동 배치 결과', seatRuleAlert.violations) });
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
