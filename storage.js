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

function ctLoadState() {
  try {
    const raw = localStorage.getItem(CT_STORAGE_KEY);
    if (!raw) return CT_DEFAULT_STATE();
    const parsed = JSON.parse(raw);
    return ctNormalizeState({ ...CT_DEFAULT_STATE(), ...parsed });
  } catch {
    return CT_DEFAULT_STATE();
  }
}

function ctSaveState(state) {
  localStorage.setItem(CT_STORAGE_KEY, JSON.stringify(state));
}

function ctExportData() {
  const state = ctLoadState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `class-tools-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ctImportData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== 'object') throw new Error('잘못된 파일 형식입니다.');
        ctSaveState({ ...CT_DEFAULT_STATE(), ...data });
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsText(file);
  });
}

function ctResetAll() {
  localStorage.removeItem(CT_STORAGE_KEY);
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
  if (!Array.isArray(cls.frontRowRequestIds)) {
    cls.frontRowRequestIds = [];
  } else {
    const studentIds = new Set((cls.students || []).map((s) => s.id));
    cls.frontRowRequestIds = cls.frontRowRequestIds.filter((id) => studentIds.has(id));
  }
  return cls;
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
    separationRules: [],
    frontRowRequestIds: [],
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
  CT_STORAGE_KEY, ctLoadState, ctSaveState, ctExportData, ctImportData,
  ctResetAll, ctGenerateId, ctGetActiveClass, ctSetActiveClass,
  ctUpsertClass, ctDeleteClass, ctCreateClass, ctUpdateUser,
  ctSetStudents, ctGetMergedStudentsForTeachingClass, ctGetStudentsForContext,
  ctNormalizeClass, ctNormalizeState, ctBuildClassName,
};
