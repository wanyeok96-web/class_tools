/**
 * Class Tools — 랜덤추첨 / 발표순서 / 당번관리
 */
function ctPickRandom(items, count = 1, allowDuplicate = false) {
  if (!items.length) return [];
  const results = [];
  const pool = [...items];
  for (let i = 0; i < count; i++) {
    if (!allowDuplicate && pool.length === 0) break;
    const source = allowDuplicate ? items : pool;
    const idx = Math.floor(Math.random() * source.length);
    results.push(source[idx]);
    if (!allowDuplicate) pool.splice(idx, 1);
  }
  return results;
}

function ctGeneratePresentationOrder(students, random = true) {
  const list = random ? ctShuffleGroups(students) : [...students];
  return list.map((s, i) => ({
    order: i + 1,
    studentId: s.id,
    name: s.name,
    number: s.number,
    gender: s.gender,
  }));
}

function ctShufflePresentationOrder(order) {
  const shuffled = ctShuffleGroups(order);
  return shuffled.map((item, i) => ({ ...item, order: i + 1 }));
}

function ctGenerateGroupPresentationOrders(groupResult, random = true) {
  if (!groupResult?.length) return [];
  return groupResult.map((g) => ({
    groupId: g.id,
    groupNumber: g.number,
    order: ctGeneratePresentationOrder(g.members, random),
  }));
}

function ctShuffleGroupPresentationOrders(byGroup) {
  if (!byGroup?.length) return [];
  return byGroup.map((g) => ({
    ...g,
    order: ctShufflePresentationOrder(g.order),
  }));
}

const CT_PRESENTATION_PRINT_BODY_MM = 251;

function ctSplitPresentationPrintColumns(items, cols) {
  if (cols <= 1) return [items];
  const perCol = Math.ceil(items.length / cols);
  return Array.from({ length: cols }, (_, i) => items.slice(i * perCol, (i + 1) * perCol)).filter((c) => c.length);
}

function ctComputePresentationPrintScale({ mode, order, byGroup }) {
  if (mode === 'group') {
    const groups = byGroup || [];
    const gCount = groups.length || 1;
    const maxRows = Math.max(...groups.map((g) => g.order?.length || 0), 1);
    let gridCols = 1;
    if (gCount >= 2) gridCols = 2;
    if (gCount >= 5) gridCols = 3;
    if (gCount >= 7) gridCols = 4;
    const gridRows = Math.ceil(gCount / gridCols);
    const cardHeaderMm = 5.5;
    const theadMm = 4;
    const gridGapMm = 2.5;
    const availPerCardH = (CT_PRESENTATION_PRINT_BODY_MM - (gridRows - 1) * gridGapMm) / gridRows;
    const rowMm = Math.max(3.8, Math.min(8, (availPerCardH - cardHeaderMm - theadMm) / maxRows));
    const fontPt = Math.max(6, Math.min(10, rowMm * 2.5));
    const padMm = Math.max(0.5, Math.min(2.2, rowMm * 0.22));
    const titlePt = gCount > 4 ? 13 : 15;
    const cardPadMm = Math.max(1.5, Math.min(3.5, rowMm * 0.45));
    const h3Pt = Math.max(7, Math.min(10, fontPt + 1.5));
    return {
      mode: 'group', gridCols, gridGapMm, fontPt, padMm, rowMm, titlePt, cardPadMm, h3Pt,
    };
  }

  const n = order?.length || 1;
  let cols = 1;
  if (n > 15) cols = 2;
  if (n > 30) cols = 3;
  const rowsPerCol = Math.ceil(n / cols);
  const theadMm = 5;
  const rowMm = Math.max(4, Math.min(9, (CT_PRESENTATION_PRINT_BODY_MM - theadMm) / rowsPerCol));
  const fontPt = Math.max(6.5, Math.min(11, rowMm * 2.7));
  const padMm = Math.max(0.7, Math.min(3, rowMm * 0.24));
  const titlePt = n > 25 ? 13 : 16;
  const colGapMm = cols > 1 ? 3 : 0;
  return { mode: 'class', cols, colGapMm, fontPt, padMm, rowMm, titlePt };
}

const CT_DUTY_TYPES = {
  cleaning: { label: '청소당번', icon: '🧹' },
  meal: { label: '급식당번', icon: '🍽️' },
  environment: { label: '환경정리', icon: '🌿' },
  other: { label: '기타 역할', icon: '📌' },
};

const CT_CLEANING_WEEKDAYS = [
  { key: 'mon', label: '월요일', short: '월' },
  { key: 'tue', label: '화요일', short: '화' },
  { key: 'wed', label: '수요일', short: '수' },
  { key: 'thu', label: '목요일', short: '목' },
  { key: 'fri', label: '금요일', short: '금' },
];

function ctAssignDuties(students, dutyType, slots, random = true) {
  const pool = random ? ctShuffleGroups(students) : [...students];
  const assignments = [];
  for (let i = 0; i < slots; i++) {
    const student = pool[i % pool.length];
    assignments.push({
      slot: i + 1,
      label: `${CT_DUTY_TYPES[dutyType]?.label || '당번'} ${i + 1}`,
      studentId: student?.id || null,
      name: student?.name || '',
      number: student?.number || 0,
    });
  }
  return assignments;
}

function ctCreateCleaningSlot(index) {
  return {
    slot: index + 1,
    label: `청소 ${index + 1}`,
    studentId: null,
    name: '',
    number: 0,
  };
}

function ctResizeDutySlots(assignments, slots, dutyType) {
  const typeLabel = CT_DUTY_TYPES[dutyType]?.label || '당번';
  const result = [...(assignments || [])];
  while (result.length < slots) {
    result.push({
      slot: result.length + 1,
      label: `${typeLabel} ${result.length + 1}`,
      studentId: null,
      name: '',
      number: 0,
    });
  }
  return result.slice(0, slots).map((item, i) => ({
    ...item,
    slot: i + 1,
    label: dutyType === 'cleaning' ? `청소 ${i + 1}` : `${typeLabel} ${i + 1}`,
  }));
}

function ctCreateEmptyWeeklyCleaning(slots) {
  return CT_CLEANING_WEEKDAYS.map((day) => ({
    key: day.key,
    label: day.label,
    short: day.short,
    assignments: Array.from({ length: slots }, (_, i) => ctCreateCleaningSlot(i)),
  }));
}

function ctEnsureWeeklyCleaning(week, slots) {
  const source = week?.length ? week : [];
  return CT_CLEANING_WEEKDAYS.map((day, dayIdx) => {
    const existing = source.find((d) => d.key === day.key) || source[dayIdx] || {};
    const assignments = ctResizeDutySlots(existing.assignments, slots, 'cleaning').map((a, i) => ({
      ...a,
      slot: i + 1,
      label: `청소 ${i + 1}`,
    }));
    return { key: day.key, label: day.label, short: day.short, assignments };
  });
}

function ctAssignWeeklyCleaning(students, slots) {
  if (!students?.length) return ctCreateEmptyWeeklyCleaning(slots);
  const pool = ctShuffleGroups(students);
  return CT_CLEANING_WEEKDAYS.map((day, dayIdx) => ({
    key: day.key,
    label: day.label,
    short: day.short,
    assignments: Array.from({ length: slots }, (_, i) => {
      const student = pool[(dayIdx * slots + i) % pool.length];
      return {
        slot: i + 1,
        label: `청소 ${i + 1}`,
        studentId: student?.id || null,
        name: student?.name || '',
        number: student?.number || 0,
      };
    }),
  }));
}

function ctRotateDuties(currentDuties, students) {
  if (!currentDuties?.length || !students?.length) return currentDuties;
  const ids = students.map((s) => s.id);
  const rotated = [...currentDuties];
  const lastStudentId = rotated[rotated.length - 1]?.studentId;
  const lastIdx = ids.indexOf(lastStudentId);
  let nextIdx = (lastIdx + 1) % ids.length;
  for (let i = 0; i < rotated.length; i++) {
    rotated[i] = {
      ...rotated[i],
      studentId: ids[nextIdx],
      name: students.find((s) => s.id === ids[nextIdx])?.name || '',
      number: students.find((s) => s.id === ids[nextIdx])?.number || 0,
    };
    nextIdx = (nextIdx + 1) % ids.length;
  }
  return rotated;
}

const CT_ROULETTE_COLORS = [
  '#FFC9D4', '#FFD9B8', '#FFF3B0', '#C8F5D5', '#B8E4FF', '#E4C8F0',
  '#FFB8D1', '#D0F0F5', '#FFE8C2', '#D5EFE8', '#FCE8E4', '#E2EDE6',
  '#FFD4E5', '#D4E6FA', '#FFF0C4', '#C8EBDD', '#F0DDF8', '#FFE0B8',
];

function ctBuildRouletteSegments(students) {
  return students.map((student, i) => ({
    id: student.id,
    number: student.number,
    name: student.name,
    label: student.name,
    color: CT_ROULETTE_COLORS[i % CT_ROULETTE_COLORS.length],
  }));
}

function ctBuildRouletteCustomSegments(items) {
  return items.map((item, i) => ({
    id: item.id,
    number: null,
    name: item.label,
    label: item.label,
    color: CT_ROULETTE_COLORS[i % CT_ROULETTE_COLORS.length],
  }));
}

function ctCalcRouletteTargetRotation(winnerIndex, segmentCount, currentRotation = 0) {
  if (segmentCount <= 0) return currentRotation;
  const segmentAngle = 360 / segmentCount;
  const extraSpins = 5 + Math.floor(Math.random() * 4);
  const targetMod = (360 - ((winnerIndex + 0.5) * segmentAngle) % 360) % 360;
  const currentMod = ((currentRotation % 360) + 360) % 360;
  let delta = (targetMod - currentMod + 360) % 360;
  if (delta < 90) delta += 360;
  return currentRotation + extraSpins * 360 + delta;
}

function ctPickRouletteWinnerIndex(segmentCount) {
  return Math.floor(Math.random() * segmentCount);
}

if (typeof module !== 'undefined') module.exports = {
  ctPickRandom, ctGeneratePresentationOrder, ctShufflePresentationOrder,
  ctGenerateGroupPresentationOrders, ctShuffleGroupPresentationOrders,
  ctComputePresentationPrintScale, ctSplitPresentationPrintColumns,
  ctAssignDuties, ctRotateDuties, CT_DUTY_TYPES, CT_CLEANING_WEEKDAYS,
  ctResizeDutySlots, ctCreateEmptyWeeklyCleaning, ctEnsureWeeklyCleaning, ctAssignWeeklyCleaning,
  ctBuildRouletteSegments, ctBuildRouletteCustomSegments,
  ctCalcRouletteTargetRotation, ctPickRouletteWinnerIndex,
  CT_ROULETTE_COLORS,
};
