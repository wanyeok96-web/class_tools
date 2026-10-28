/**
 * Class Tools — 자리배치 규칙 설정 화면 (규칙 창 · 위반 알림 · 이번 자리 확정)
 * script.js가 넘겨주는 app(공통 도구·상태)을 받아 동작합니다.
 */
function ctCreateSeatRulesPanel(app) {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const closeModal = (...args) => app.closeModal(...args);
  const esc = (...args) => app.esc(...args);
  const getActiveStudents = (...args) => app.getActiveStudents(...args);
  const getSeatClass = (...args) => app.getSeatClass(...args);
  const getStudentName = (...args) => app.getStudentName(...args);
  const showModal = (...args) => app.showModal(...args);
  const showToast = (...args) => app.showToast(...args);

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
    ctSaveState(app.state);
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
    if (app.seatRevealBusy) {
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
      ctSaveState(app.state);
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

  /** 다음 renderSeats에서 알림이 사라지도록 상태만 비운다 */
  function resetSeatRuleAlert() {
    seatRuleAlert = null;
  }

  function getSeatRuleAlert() {
    return seatRuleAlert;
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
    if (app.seatRevealBusy) {
      showToast('자리 배치 연출이 끝난 뒤 열어주세요.');
      return;
    }
    if (!cls.seatLayout) {
      cls.seatLayout = ctCreateSeatGrid(5, 6, { teacherPosition: 'front' });
    }
    const rules = syncSeatRules(cls);
    ctSaveState(app.state);
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

  return {
    escAttr,
    ensureSeatRules,
    getActiveSeatRules,
    syncSeatRules,
    getSeatRuleStudents,
    seatRuleNameOf,
    persistSeatRules,
    updateSeatRulesButton,
    formatSeatConfirmDate,
    updateSeatConfirmHint,
    confirmCurrentSeats,
    setSeatRuleAlert,
    clearSeatRuleAlert,
    resetSeatRuleAlert,
    getSeatRuleAlert,
    renderSeatRuleAlert,
    renderSeatRuleReport,
    seatViolationReport,
    checkCurrentSeatRules,
    checkSeatRuleFeasibility,
    describeSeatRule,
    seatRuleStudentLabel,
    renderRuleStudentPicker,
    renderRuleStudentSelect,
    renderRuleSeatMap,
    renderRangePreview,
    renderSeatRuleBadges,
    refreshSeatRuleCard,
    renderSeatRuleBody,
    renderSeatRuleCard,
    renderSeatRulesModal,
    addSeatRule,
    reviveSeatRule,
    handleSeatRulesClick,
    handleSeatRulesChange,
    openSeatRulesModal,
  };
}
