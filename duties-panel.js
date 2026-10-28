/**
 * Class Tools — 당번관리 화면
 * script.js가 넘겨주는 app(공통 도구·상태)을 받아 동작합니다.
 */
function ctCreateDutiesPanel(app) {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const esc = (...args) => app.esc(...args);
  const printDuties = (...args) => app.printDuties(...args);
  const saveAndRefresh = (...args) => app.saveAndRefresh(...args);
  const showToast = (...args) => app.showToast(...args);

  let activeDutyType = 'cleaning';
  const DUTY_PRINT_TYPES = ['cleaning', 'meal', 'environment'];

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

    const cls = ctGetActiveClass(app.state);
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

  return {
    DUTY_PRINT_TYPES,
    getCleaningMeta,
    getDutyPrintMeta,
    dutyHasPrintableData,
    getDutyPrintHint,
    renderDutyPrintSettings,
    bindCleaningSettings,
    renderCleaningWeekly,
    renderCleaningSettingsHtml,
    renderCleaningDuties,
    renderDuties,
  };
}
