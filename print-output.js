/**
 * Class Tools — 인쇄 · 좌석표 미리보기 · 크게보기
 * script.js가 넘겨주는 app(공통 도구·상태)을 받아 동작합니다.
 */
function ctCreatePrintOutput(app) {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const closeModal = (...args) => app.closeModal(...args);
  const dutyHasPrintableData = (...args) => app.dutyHasPrintableData(...args);
  const ensureSeatMeta = (...args) => app.ensureSeatMeta(...args);
  const esc = (...args) => app.esc(...args);
  const getActiveStudents = (...args) => app.getActiveStudents(...args);
  const getClassDisplayLabel = (...args) => app.getClassDisplayLabel(...args);
  const getCleaningMeta = (...args) => app.getCleaningMeta(...args);
  const getDutyPrintMeta = (...args) => app.getDutyPrintMeta(...args);
  const getSeatClass = (...args) => app.getSeatClass(...args);
  const getUserSchool = (...args) => app.getUserSchool(...args);
  const showModal = (...args) => app.showModal(...args);
  const showToast = (...args) => app.showToast(...args);

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
    const cls = ctGetActiveClass(app.state);
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
    const cls = ctGetActiveClass(app.state);
    if (!app.presentationViewActive) { showToast('먼저 순서를 생성해주세요.'); return; }

    if (app.presentationMode === 'group') {
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
    const cls = ctGetActiveClass(app.state);
    if (!cls?.duties) { showToast('당번 정보가 없습니다.'); return; }

    const printMeta = getDutyPrintMeta(cls);
    const selected = app.DUTY_PRINT_TYPES.filter((key) => printMeta[key]);
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

  return {
    printHtml,
    sortStudentsBySchoolNumber,
    buildClassroomRosterRowsHtml,
    buildClassroomRosterHtml,
    getSeatsSortedForPrintVariant,
    buildSeatDeskHtml,
    buildClassroomSeatPrintHtml,
    buildClassroomSeatPreviewHtml,
    openSeatPrintPreview,
    openTeacherSeatPreview,
    openBoardSeatPreview,
    printSeats,
    openSeatEnlargeFullscreen,
    printGroups,
    buildPresentationPrintTableRows,
    buildPresentationPrintTable,
    buildPresentationPrintScaleCss,
    buildPresentationPrintHtml,
    printPresentation,
    printCleaningWeekTable,
    appendDutyPrintSection,
    printDuties,
  };
}
