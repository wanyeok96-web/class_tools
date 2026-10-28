/**
 * Class Tools — LocalStorage 데이터 관리
 */
const CT_STORAGE_KEY = 'class-tools-v1';

const CT_DEFAULT_TREASURE_REWARDS = ['꽝', '사탕', '청소 면제권', '칭찬 스티커', '간식 쿠폰'];

const CT_DEFAULT_STATE = () => ({
  version: '1.0',
  user: { school: '', name: '' },
  classes: [],
  activeClassId: null,
  teachingClasses: [],
  treasureRewards: [...CT_DEFAULT_TREASURE_REWARDS],
});

function ctGenerateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 읽을 수 없게 된 저장 데이터를 덮어쓰기 전에 옮겨 두는 곳 (수동 복구용) */
const CT_CORRUPT_KEY = 'class-tools-v1-corrupt';

function ctLoadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(CT_STORAGE_KEY);
    if (!raw) return CT_DEFAULT_STATE();
    const parsed = JSON.parse(raw);
    return ctNormalizeState({ ...CT_DEFAULT_STATE(), ...parsed });
  } catch {
    if (raw) {
      try {
        if (localStorage.getItem(CT_CORRUPT_KEY) === null) localStorage.setItem(CT_CORRUPT_KEY, raw);
      } catch { /* 공간 부족 — 보존 실패 */ }
    }
    return CT_DEFAULT_STATE();
  }
}

/**
 * @returns {boolean} 저장 성공 여부. 실패하면 window에 'ct-save-failed' 이벤트를 보낸다.
 */
function ctSaveState(state) {
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(CT_STORAGE_KEY, json);
    return true;
  } catch (err) {
    // 공간이 부족하면 되돌리기용 사본을 비우고 한 번 더 시도 (현재 데이터 저장이 우선)
    if (localStorage.getItem(CT_UNDO_KEY) !== null) {
      localStorage.removeItem(CT_UNDO_KEY);
      try {
        localStorage.setItem(CT_STORAGE_KEY, json);
        return true;
      } catch { /* 아래에서 알림 */ }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ct-save-failed', { detail: err }));
    }
    return false;
  }
}

/* ── 백업 · 복원 · 되돌리기 ── */

/** 이 브라우저의 백업 기록 — 학급 데이터와 따로 두어 복원·초기화에 휩쓸리지 않게 한다. */
const CT_BACKUP_META_KEY = 'class-tools-backup-meta';
/** 복원·초기화 직전 데이터 (한 번 되돌리기용) */
const CT_UNDO_KEY = 'class-tools-v1-undo';
const CT_BACKUP_REMIND_DAYS = 14;

function ctReadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function ctGetBackupMeta() {
  const meta = ctReadJson(CT_BACKUP_META_KEY) || {};
  return { lastBackupAt: meta.lastBackupAt || null, snoozeUntil: meta.snoozeUntil || null };
}

function ctSetBackupMeta(patch) {
  try {
    localStorage.setItem(CT_BACKUP_META_KEY, JSON.stringify({ ...ctGetBackupMeta(), ...patch }));
  } catch { /* 저장 공간 부족 — 알림 기록만 못 남김 */ }
}

function ctSummarizeState(state) {
  const classes = Array.isArray(state?.classes) ? state.classes : [];
  return {
    classes: classes.length,
    students: classes.reduce((n, c) => n + (Array.isArray(c?.students) ? c.students.length : 0), 0),
  };
}

/** 백업 알림을 띄울지: 학생 데이터가 있는데 오래 백업하지 않았고, '나중에'를 누른 기간이 지났을 때 */
function ctBackupReminder(state, now = Date.now()) {
  if (!ctSummarizeState(state).students) return null;
  const meta = ctGetBackupMeta();
  if (meta.snoozeUntil && now < Date.parse(meta.snoozeUntil)) return null;
  const last = Date.parse(meta.lastBackupAt || '');
  if (!Number.isFinite(last)) return { never: true, days: null };
  const days = Math.floor((now - last) / 86400000);
  return days >= CT_BACKUP_REMIND_DAYS ? { never: false, days } : null;
}

function ctSnoozeBackupReminder(days = 7) {
  ctSetBackupMeta({ snoozeUntil: new Date(Date.now() + days * 86400000).toISOString() });
}

function ctExportData() {
  const state = ctLoadState();
  const payload = { ...state, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `class-tools-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  ctSetBackupMeta({ lastBackupAt: payload.exportedAt, snoozeUntil: null });
}

/** 클래스툴 백업 파일인지 검사. 문제가 있으면 사용자에게 보여 줄 문구를 담아 throw. */
function ctValidateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('클래스툴 백업 파일이 아닙니다.');
  }
  if (!Array.isArray(data.classes) || !('activeClassId' in data || 'version' in data)) {
    throw new Error('클래스툴 백업 파일이 아닙니다. (학급 정보가 없습니다)');
  }
  data.classes.forEach((cls, i) => {
    if (!cls || typeof cls !== 'object' || !cls.id) {
      throw new Error(`백업 파일이 손상되었습니다. (${i + 1}번째 학급 정보 오류)`);
    }
    const label = cls.name || `${i + 1}번째 학급`;
    if (cls.students != null && !Array.isArray(cls.students)) {
      throw new Error(`백업 파일이 손상되었습니다. (${label} 학생 명단 오류)`);
    }
    (cls.students || []).forEach((s) => {
      if (!s || typeof s !== 'object' || !s.id) {
        throw new Error(`백업 파일이 손상되었습니다. (${label} 학생 정보 오류)`);
      }
    });
  });
  return { ...ctSummarizeState(data), exportedAt: data.exportedAt || null };
}

/** 백업 파일을 읽고 검사만 한다 (저장하지 않음). */
function ctReadBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch {
        reject(new Error('백업 파일을 읽을 수 없습니다. (JSON 형식이 아닙니다)'));
        return;
      }
      try {
        resolve({ data, summary: ctValidateBackup(data) });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsText(file);
  });
}

function ctSaveUndo(reason) {
  const raw = localStorage.getItem(CT_STORAGE_KEY);
  if (!raw) return true;
  try {
    localStorage.setItem(CT_UNDO_KEY, JSON.stringify({ at: new Date().toISOString(), reason, raw }));
    return true;
  } catch {
    // 이전 작업의 사본이 남아 있으면 '최근 상태'로 오해할 수 있으므로 지운다
    localStorage.removeItem(CT_UNDO_KEY);
    return false;
  }
}

/** @returns {{ at: string, reason: 'import'|'reset', summary: object } | null} */
function ctGetUndo() {
  const undo = ctReadJson(CT_UNDO_KEY);
  if (!undo?.raw) return null;
  let summary = { classes: 0, students: 0 };
  try {
    summary = ctSummarizeState(JSON.parse(undo.raw));
  } catch { /* 요약만 실패 */ }
  return { at: undo.at, reason: undo.reason, summary };
}

function ctRestoreUndo() {
  const undo = ctReadJson(CT_UNDO_KEY);
  if (!undo?.raw) return false;
  try {
    // 사본을 먼저 비워 공간을 확보한 뒤 되살린다 (실패하면 사본을 원래대로 둔다)
    localStorage.removeItem(CT_UNDO_KEY);
    localStorage.setItem(CT_STORAGE_KEY, undo.raw);
    return true;
  } catch {
    try { localStorage.setItem(CT_UNDO_KEY, JSON.stringify(undo)); } catch { /* 공간 부족 */ }
    return false;
  }
}

/**
 * 검사를 마친 백업 데이터를 적용. 현재 데이터는 되돌리기용으로 보관한다.
 * @returns {{ applied: boolean, undoSaved: boolean }}
 */
function ctApplyBackup(data) {
  ctSaveUndo('import');
  const rest = { ...data };
  delete rest.exportedAt;
  const applied = ctSaveState(ctNormalizeState({ ...CT_DEFAULT_STATE(), ...rest }));
  return { applied, undoSaved: applied && ctGetUndo() !== null };
}

/** @returns {{ undoSaved: boolean }} */
function ctResetAll() {
  const undoSaved = ctSaveUndo('reset');
  localStorage.removeItem(CT_STORAGE_KEY);
  return { undoSaved };
}

function ctNormalizeClass(cls) {
  if (!cls) return cls;
  if (!cls.classLabel && cls.classNumber != null && cls.classNumber !== '') {
    cls.classLabel = String(cls.classNumber);
  }
  cls.classLabel = String(cls.classLabel ?? '').trim();
  if (!cls.name) {
    cls.name = ctBuildClassName(cls.grade, cls.classLabel);
  }
  if (!cls.seatMeta) {
    cls.seatMeta = {
      homeroomTeacher: '',
      classPresidentId: null,
      vicePresidentId: null,
      printNotice: '아이들이 자리를 임의로 바꿀 시 담임에게 꼭 이야기 해주세요~~~',
      numberAssignDirection: 'horizontal',
    };
  } else {
    const dir = cls.seatMeta.numberAssignDirection === 'vertical' ? 'vertical' : 'horizontal';
    cls.seatMeta = {
      homeroomTeacher: cls.seatMeta.homeroomTeacher || '',
      classPresidentId: cls.seatMeta.classPresidentId || null,
      vicePresidentId: cls.seatMeta.vicePresidentId || null,
      printNotice: cls.seatMeta.printNotice
        || '아이들이 자리를 임의로 바꿀 시 담임에게 꼭 이야기 해주세요~~~',
      numberAssignDirection: dir,
    };
  }
  const studentIds = new Set((cls.students || []).map((s) => s.id));
  let rules = Array.isArray(cls.seatRules) ? cls.seatRules : [];
  if (Array.isArray(cls.separationRules) && cls.separationRules.length) {
    rules = rules.concat(cls.separationRules.map((r, i) => ctCreateSeatRule('separate', {
      id: `${cls.id}-mig-sep-${i}`,
      studentA: r.studentA || '',
      studentB: r.studentB || '',
      noAdjacent: !!r.noAdjacent,
      noFrontBack: !!r.noFrontBack,
      noDiagonal: !!r.noDiagonal,
    })));
  }
  const frontIds = (Array.isArray(cls.frontRowRequestIds) ? cls.frontRowRequestIds : [])
    .filter((id) => studentIds.has(id));
  if (frontIds.length) {
    rules.push(ctCreateFrontRowRule(cls.seatLayout, {
      id: `${cls.id}-mig-front`,
      studentIds: frontIds,
      memo: '앞자리 희망',
    }));
  }
  delete cls.separationRules;
  delete cls.frontRowRequestIds;
  cls.seatRules = rules.map((r) => ctNormalizeSeatRule(r, studentIds)).filter(Boolean);
  if (!cls.seatConfirmed || !Array.isArray(cls.seatConfirmed.seats)) cls.seatConfirmed = null;
  return cls;
}

const CT_SEAT_RULE_TYPE_IDS = [
  'rowRange', 'colRange', 'allowSeats', 'fixedSeat', 'avoidSeats', 'separate', 'pair', 'avoidPrevious',
];

const CT_SEAT_RULE_DEFAULTS = {
  rowRange: () => ({ studentIds: [], from: 1, to: 1 }),
  colRange: () => ({ studentIds: [], from: 1, to: 1 }),
  allowSeats: () => ({ studentIds: [], seatKeys: [] }),
  avoidSeats: () => ({ studentIds: [], seatKeys: [] }),
  fixedSeat: () => ({ studentId: '', seatKey: '' }),
  separate: () => ({ studentA: '', studentB: '', noAdjacent: true, noFrontBack: false, noDiagonal: false }),
  pair: () => ({ studentA: '', studentB: '', direction: 'side' }),
  avoidPrevious: () => ({ target: 'all', studentIds: [], sameSeat: true, samePartner: true, minRowShift: 0 }),
};

function ctCreateSeatRule(type, fields = {}) {
  return {
    id: ctGenerateId('rule'),
    type,
    enabled: true,
    needsReview: false,
    memo: '',
    ...CT_SEAT_RULE_DEFAULTS[type](),
    ...fields,
  };
}

/** 교탁 쪽 맨 앞줄 — 교탁이 왼쪽·오른쪽이면 분단(열) 규칙으로 만든다. */
function ctCreateFrontRowRule(layout, fields = {}) {
  const pos = layout?.teacherPosition || 'front';
  const rows = layout?.rows || 5;
  const cols = layout?.cols || 6;
  if (pos === 'left' || pos === 'right') {
    const col = pos === 'left' ? 1 : cols;
    return ctCreateSeatRule('colRange', { from: col, to: col, ...fields });
  }
  const row = pos === 'back' ? rows : 1;
  return ctCreateSeatRule('rowRange', { from: row, to: row, ...fields });
}

function ctNormalizeSeatRule(rule, studentIds) {
  if (!rule || !CT_SEAT_RULE_TYPE_IDS.includes(rule.type)) return null;
  const r = { ...ctCreateSeatRule(rule.type), ...rule };
  if (!r.id) r.id = ctGenerateId('rule');
  r.enabled = r.enabled !== false;
  r.needsReview = !!r.needsReview;
  r.memo = String(r.memo ?? '').slice(0, 40);
  let lostTarget = false;

  if ('studentIds' in r) {
    const before = Array.isArray(r.studentIds) ? r.studentIds : [];
    r.studentIds = [...new Set(before.filter((id) => studentIds.has(id)))];
    const needsList = r.type !== 'avoidPrevious' || r.target === 'selected';
    if (needsList && before.length && !r.studentIds.length) lostTarget = true;
  }
  ['studentId', 'studentA', 'studentB'].forEach((field) => {
    if (!(field in r)) return;
    r[field] = String(r[field] ?? '');
    if (r[field] && !studentIds.has(r[field])) {
      r[field] = '';
      lostTarget = true;
    }
  });
  if (lostTarget) r.enabled = false;

  const toInt = (v, min, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(min, n) : fallback;
  };
  if ('from' in r) {
    r.from = toInt(r.from, 1, 1);
    r.to = toInt(r.to, 1, r.from);
    if (r.to < r.from) [r.from, r.to] = [r.to, r.from];
  }
  if ('seatKeys' in r) {
    r.seatKeys = [...new Set((Array.isArray(r.seatKeys) ? r.seatKeys : [])
      .map(String).filter((k) => /^\d+-\d+$/.test(k)))];
  }
  if ('seatKey' in r) {
    r.seatKey = /^\d+-\d+$/.test(String(r.seatKey ?? '')) ? String(r.seatKey) : '';
  }
  if (r.type === 'separate') {
    r.noAdjacent = !!r.noAdjacent;
    r.noFrontBack = !!r.noFrontBack;
    r.noDiagonal = !!r.noDiagonal;
  }
  if (r.type === 'pair') {
    r.direction = r.direction === 'frontBack' ? 'frontBack' : 'side';
  }
  if (r.type === 'avoidPrevious') {
    r.target = r.target === 'selected' ? 'selected' : 'all';
    r.sameSeat = !!r.sameSeat;
    r.samePartner = !!r.samePartner;
    r.minRowShift = toInt(r.minRowShift, 0, 0);
  }
  return r;
}

function ctNormalizeState(state) {
  if (state.classes?.length) {
    state.classes = state.classes.map(ctNormalizeClass);
  }
  if (state.activeClassId && !state.classes.find((c) => c.id === state.activeClassId)) {
    state.activeClassId = state.classes[0]?.id || null;
  }
  if (!Array.isArray(state.treasureRewards) || !state.treasureRewards.length) {
    state.treasureRewards = [...CT_DEFAULT_TREASURE_REWARDS];
  } else {
    state.treasureRewards = state.treasureRewards
      .map((r) => String(r ?? '').trim())
      .filter(Boolean);
    if (!state.treasureRewards.length) state.treasureRewards = [...CT_DEFAULT_TREASURE_REWARDS];
  }
  const legacySchool = state.school?.name || '';
  state.user = {
    school: String(state.user?.school ?? legacySchool).trim(),
    name: String(state.user?.name ?? '').trim(),
  };
  return state;
}

function ctBuildClassName(grade, classLabel) {
  const label = String(classLabel ?? '').trim();
  const gradePart = grade != null && grade !== '' ? `${grade}학년` : '';
  if (gradePart && label) return `${gradePart} ${label}`;
  if (gradePart) return gradePart;
  if (label) return label;
  return '새 학급';
}

function ctGetActiveClass(state = ctLoadState()) {
  if (!state.activeClassId) return null;
  return state.classes.find((c) => c.id === state.activeClassId) || null;
}

function ctSetActiveClass(classId) {
  const state = ctLoadState();
  state.activeClassId = classId;
  ctSaveState(state);
  return state;
}

function ctUpsertClass(classData) {
  const state = ctLoadState();
  const idx = state.classes.findIndex((c) => c.id === classData.id);
  if (idx >= 0) {
    state.classes[idx] = { ...state.classes[idx], ...classData };
  } else {
    state.classes.push(classData);
    if (!state.activeClassId) state.activeClassId = classData.id;
  }
  ctSaveState(state);
  return state;
}

function ctDeleteClass(classId) {
  const state = ctLoadState();
  state.classes = state.classes.filter((c) => c.id !== classId);
  if (state.activeClassId === classId) {
    state.activeClassId = state.classes[0]?.id || null;
  }
  state.teachingClasses = state.teachingClasses.map((tc) => ({
    ...tc,
    studentIds: (tc.studentIds || []).filter((sid) => {
      const cls = state.classes.find((c) => c.students?.some((s) => s.id === sid));
      return cls && cls.id !== classId;
    }),
  }));
  ctSaveState(state);
  return state;
}

function ctCreateClass({ grade, classLabel, classNumber, name }) {
  const id = ctGenerateId('class');
  const label = String(classLabel ?? classNumber ?? '').trim();
  const cls = ctNormalizeClass({
    id,
    grade: grade === '' || grade == null ? '' : Number(grade) || grade,
    classLabel: label,
    name: name || ctBuildClassName(grade, label),
    students: [],
    seatLayout: null,
    seatRules: [],
    seatConfirmed: null,
    groupResult: null,
    presentationOrder: [],
    presentationByGroup: [],
    duties: {
      cleaning: [],
      meal: [],
      environment: [],
      other: [],
    },
    dutyMeta: {
      cleaning: { slots: 4, mode: 'single' },
      print: { cleaning: true, meal: true, environment: true },
    },
    cleaningWeek: null,
    groupSettings: { size: 4, genderBalance: true, respectSeparation: true },
    seatMeta: {
      homeroomTeacher: '',
      classPresidentId: null,
      vicePresidentId: null,
      printNotice: '아이들이 자리를 임의로 바꿀 시 담임에게 꼭 이야기 해주세요~~~',
      numberAssignDirection: 'horizontal',
    },
  });
  ctUpsertClass(cls);
  return cls;
}

function ctUpdateUser({ school, name }) {
  const state = ctLoadState();
  state.user = {
    school: String(school ?? '').trim(),
    name: String(name ?? '').trim(),
  };
  ctSaveState(state);
  return state;
}

function ctSetStudents(classId, students) {
  const state = ctLoadState();
  const cls = state.classes.find((c) => c.id === classId);
  if (!cls) return state;
  cls.students = students;
  ctSaveState(state);
  return state;
}

function ctGetMergedStudentsForTeachingClass(teachingClassId) {
  const state = ctLoadState();
  const tc = state.teachingClasses.find((t) => t.id === teachingClassId);
  if (!tc) return [];
  if (tc.studentIds?.length) {
    const all = [];
    state.classes.forEach((cls) => {
      cls.students.forEach((s) => {
        if (tc.studentIds.includes(s.id)) {
          all.push({ ...s, sourceClass: cls.name, sourceClassId: cls.id });
        }
      });
    });
    return all;
  }
  if (tc.classIds?.length) {
    const all = [];
    tc.classIds.forEach((cid) => {
      const cls = state.classes.find((c) => c.id === cid);
      if (cls) {
        cls.students.forEach((s) => {
          all.push({ ...s, sourceClass: cls.name, sourceClassId: cls.id });
        });
      }
    });
    return all;
  }
  return [];
}

function ctGetStudentsForContext(classId, teachingClassId) {
  if (teachingClassId) return ctGetMergedStudentsForTeachingClass(teachingClassId);
  const state = ctLoadState();
  const cls = state.classes.find((c) => c.id === classId);
  return cls?.students || [];
}

if (typeof module !== 'undefined') module.exports = {
  CT_STORAGE_KEY, ctLoadState, ctSaveState, ctExportData,
  ctResetAll, ctValidateBackup, ctReadBackupFile, ctApplyBackup, ctGetUndo, ctRestoreUndo,
  ctGetBackupMeta, ctBackupReminder, ctSnoozeBackupReminder, ctSummarizeState, ctGenerateId, ctGetActiveClass, ctSetActiveClass,
  ctUpsertClass, ctDeleteClass, ctCreateClass, ctUpdateUser,
  ctSetStudents, ctGetMergedStudentsForTeachingClass, ctGetStudentsForContext,
  ctNormalizeClass, ctNormalizeState, ctBuildClassName,
  CT_SEAT_RULE_TYPE_IDS, ctCreateSeatRule, ctCreateFrontRowRule, ctNormalizeSeatRule,
};
