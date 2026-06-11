/**
 * Class Tools — 자리배치 엔진
 */
const CT_TEACHER_POSITIONS = ['front', 'back', 'left', 'right'];

function ctCreateSeatGrid(rows, cols, options = {}) {
  const { aisleCols = [], emptyCells = [], teacherPosition = 'front' } = options;
  const seats = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r}-${c}`;
      const isAisle = aisleCols.includes(c);
      const isEmpty = emptyCells.includes(key) || isAisle;
      seats.push({ row: r, col: c, key, isAisle, isEmpty, studentId: null });
    }
  }
  return {
    rows, cols, aisleCols, emptyCells, teacherPosition,
    seats, assignments: {},
  };
}

function ctGetAssignableSeats(layout) {
  return layout.seats.filter((s) => !s.isEmpty && !s.isAisle);
}

function ctSeatKey(row, col) {
  return `${row}-${col}`;
}

function ctFindSeat(layout, row, col) {
  return layout.seats.find((s) => s.row === row && s.col === col);
}

function ctGetNeighbors(layout, row, col) {
  const neighbors = [];
  const dirs = [
    [-1, 0, 'frontBack'], [1, 0, 'frontBack'],
    [0, -1, 'adjacent'], [0, 1, 'adjacent'],
    [-1, -1, 'diagonal'], [-1, 1, 'diagonal'],
    [1, -1, 'diagonal'], [1, 1, 'diagonal'],
  ];
  dirs.forEach(([dr, dc, type]) => {
    const seat = ctFindSeat(layout, row + dr, col + dc);
    if (seat && !seat.isEmpty && !seat.isAisle) {
      neighbors.push({ seat, type });
    }
  });
  return neighbors;
}

function ctGetFrontPriority(layout, seat) {
  const { teacherPosition, rows, cols } = layout;
  const { row, col } = seat;
  switch (teacherPosition) {
    case 'front': return row;
    case 'back': return rows - 1 - row;
    case 'left': return col;
    case 'right': return cols - 1 - col;
    default: return row;
  }
}

function ctShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ctGetFrontRowSeats(layout) {
  const assignable = ctGetAssignableSeats(layout);
  if (!assignable.length) return [];
  const minPri = Math.min(...assignable.map((s) => ctGetFrontPriority(layout, s)));
  return assignable.filter((s) => ctGetFrontPriority(layout, s) === minPri);
}

function ctAssignStudentsToSeats(newLayout, students, seats, separationRules, { ignoreRules = false } = {}) {
  const unassigned = [];
  students.forEach((student) => {
    let placed = false;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i];
      if (seat.studentId) continue;
      if (!ignoreRules) {
        const tempLayout = JSON.parse(JSON.stringify(newLayout));
        const target = tempLayout.seats.find((s) => s.key === seat.key);
        target.studentId = student.id;
        if (ctCheckAllViolations(tempLayout, separationRules).length > 0) continue;
      }
      const realSeat = newLayout.seats.find((s) => s.key === seat.key);
      realSeat.studentId = student.id;
      newLayout.assignments[seat.key] = student.id;
      seat.studentId = student.id;
      placed = true;
      break;
    }
    if (!placed) unassigned.push(student);
  });
  return unassigned;
}

function ctCheckSeparationViolation(layout, studentA, studentB, rule) {
  const seatA = layout.seats.find((s) => s.studentId === studentA);
  const seatB = layout.seats.find((s) => s.studentId === studentB);
  if (!seatA || !seatB) return false;
  const neighbors = ctGetNeighbors(layout, seatA.row, seatA.col);
  for (const { seat, type } of neighbors) {
    if (seat.studentId !== studentB) continue;
    if (rule.noAdjacent && type === 'adjacent') return true;
    if (rule.noFrontBack && type === 'frontBack') return true;
    if (rule.noDiagonal && type === 'diagonal') return true;
  }
  return false;
}

function ctCheckAllViolations(layout, rules) {
  const violations = [];
  rules.forEach((rule) => {
    const a = rule.studentA;
    const b = rule.studentB;
    if (ctCheckSeparationViolation(layout, a, b, rule)) {
      violations.push({ rule, studentA: a, studentB: b });
    }
  });
  return violations;
}

function ctWouldViolate(layout, studentId, targetSeat, rules) {
  const temp = JSON.parse(JSON.stringify(layout));
  const oldSeat = temp.seats.find((s) => s.studentId === studentId);
  if (oldSeat) oldSeat.studentId = null;
  const target = temp.seats.find((s) => s.key === targetSeat.key);
  if (!target) return true;
  if (target.studentId) {
    const swap = temp.seats.find((s) => s.studentId === studentId);
    if (swap) swap.studentId = target.studentId;
  }
  target.studentId = studentId;
  return ctCheckAllViolations(temp, rules).length > 0;
}

function ctAutoAssignSeats(students, layout, options = {}) {
  const {
    random = true,
    genderBalance = false,
    respectPrevious = false,
    previousLayout = null,
    separationRules = [],
    frontRowRequestIds = [],
  } = options;

  const newLayout = JSON.parse(JSON.stringify(layout));
  newLayout.seats.forEach((s) => { s.studentId = null; });
  newLayout.assignments = {};

  let availableSeats = ctGetAssignableSeats(newLayout);
  if (random) {
    availableSeats = ctShuffle(availableSeats);
  }

  let studentList = [...students];
  if (random) studentList = ctShuffle(studentList);

  if (respectPrevious && previousLayout) {
    studentList.sort((a, b) => {
      const prevA = previousLayout.seats.find((s) => s.studentId === a.id);
      const prevB = previousLayout.seats.find((s) => s.studentId === b.id);
      const priA = prevA ? ctGetFrontPriority(previousLayout, prevA) : 999;
      const priB = prevB ? ctGetFrontPriority(previousLayout, prevB) : 999;
      return priA - priB;
    });
  }

  if (genderBalance) {
    const males = studentList.filter((s) => s.gender === 'M');
    const females = studentList.filter((s) => !s.gender || s.gender === 'F');
    studentList = [];
    const maxLen = Math.max(males.length, females.length);
    for (let i = 0; i < maxLen; i++) {
      if (males[i]) studentList.push(males[i]);
      if (females[i]) studentList.push(females[i]);
    }
  }

  const frontIdSet = new Set(
    (frontRowRequestIds || []).filter((id) => students.some((s) => s.id === id))
  );
  const frontStudents = studentList.filter((s) => frontIdSet.has(s.id));
  const otherStudents = studentList.filter((s) => !frontIdSet.has(s.id));

  let unplacedFront = frontStudents;
  if (frontStudents.length) {
    let frontRowSeats = ctGetFrontRowSeats(newLayout);
    if (random) frontRowSeats = ctShuffle(frontRowSeats);
    if (frontRowSeats.length) {
      unplacedFront = ctAssignStudentsToSeats(
        newLayout, frontStudents, frontRowSeats, separationRules
      );
    }
  }

  const remainingStudents = [...unplacedFront, ...otherStudents];
  const remainingSeats = availableSeats.filter((s) => !s.studentId);
  let unassigned = ctAssignStudentsToSeats(
    newLayout, remainingStudents, remainingSeats, separationRules
  );
  ctAssignStudentsToSeats(newLayout, unassigned, remainingSeats, separationRules, { ignoreRules: true });

  return newLayout;
}

function ctSortSeatsForAssign(layout, direction = 'horizontal') {
  const seats = ctGetAssignableSeats(layout);
  if (direction === 'vertical') {
    return seats.sort(
      (a, b) => a.col * layout.rows + a.row - (b.col * layout.rows + b.row)
    );
  }
  return seats.sort(
    (a, b) => a.row * layout.cols + a.col - (b.row * layout.cols + b.col)
  );
}

function ctAssignSeatsByNumber(students, layout, direction = 'horizontal') {
  const newLayout = JSON.parse(JSON.stringify(layout));
  newLayout.seats.forEach((s) => { s.studentId = null; });
  newLayout.assignments = {};

  const availableSeats = ctSortSeatsForAssign(newLayout, direction);

  const studentList = [...students].sort((a, b) => {
    const na = Number(a.number);
    const nb = Number(b.number);
    const aNum = Number.isFinite(na) ? na : 0;
    const bNum = Number.isFinite(nb) ? nb : 0;
    if (aNum !== bNum) return aNum - bNum;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });

  studentList.forEach((student, i) => {
    const slot = availableSeats[i];
    if (!slot) return;
    const seat = newLayout.seats.find((s) => s.key === slot.key);
    if (seat) {
      seat.studentId = student.id;
      newLayout.assignments[slot.key] = student.id;
    }
  });

  return newLayout;
}

function ctSwapStudents(layout, studentAId, studentBId) {
  const newLayout = JSON.parse(JSON.stringify(layout));
  const seatA = newLayout.seats.find((s) => s.studentId === studentAId);
  const seatB = newLayout.seats.find((s) => s.studentId === studentBId);
  if (seatA) seatA.studentId = studentBId;
  if (seatB) seatB.studentId = studentAId;
  newLayout.assignments = {};
  newLayout.seats.forEach((s) => {
    if (s.studentId) newLayout.assignments[s.key] = s.studentId;
  });
  return newLayout;
}

function ctAssignStudentToSeat(layout, studentId, seatKey) {
  const newLayout = JSON.parse(JSON.stringify(layout));
  const target = newLayout.seats.find((s) => s.key === seatKey);
  if (!target || target.isEmpty || target.isAisle) return layout;
  const oldSeat = newLayout.seats.find((s) => s.studentId === studentId);
  const displaced = target.studentId;
  if (oldSeat) oldSeat.studentId = displaced;
  target.studentId = studentId;
  newLayout.assignments = {};
  newLayout.seats.forEach((s) => {
    if (s.studentId) newLayout.assignments[s.key] = s.studentId;
  });
  return newLayout;
}

function ctGetUnassignedStudents(students, layout) {
  const assigned = new Set(layout.seats.filter((s) => s.studentId).map((s) => s.studentId));
  return students.filter((s) => !assigned.has(s.id));
}

function ctMirrorLayoutForTeacher(layout) {
  const mirrored = JSON.parse(JSON.stringify(layout));
  const { rows, cols } = mirrored;
  mirrored.seats = mirrored.seats.map((s) => {
    const newRow = rows - 1 - s.row;
    const newCol = cols - 1 - s.col;
    return { ...s, row: newRow, col: newCol, key: ctSeatKey(newRow, newCol) };
  });
  mirrored.assignments = {};
  mirrored.seats.forEach((s) => {
    if (s.studentId) mirrored.assignments[s.key] = s.studentId;
  });
  return mirrored;
}

function ctToggleAisleCol(layout, col) {
  const newLayout = JSON.parse(JSON.stringify(layout));
  const idx = newLayout.aisleCols.indexOf(col);
  if (idx >= 0) newLayout.aisleCols.splice(idx, 1);
  else newLayout.aisleCols.push(col);
  newLayout.seats.forEach((s) => {
    if (s.col === col) {
      s.isAisle = newLayout.aisleCols.includes(col);
      s.isEmpty = s.isAisle || newLayout.emptyCells.includes(s.key);
      if (s.isEmpty) s.studentId = null;
    }
  });
  return newLayout;
}

function ctSortSeatsForPrint(layout, forTeacher) {
  return [...layout.seats].sort((a, b) => {
    const rowA = forTeacher ? a.row : layout.rows - 1 - a.row;
    const rowB = forTeacher ? b.row : layout.rows - 1 - b.row;
    if (rowA !== rowB) return rowA - rowB;
    return a.col - b.col;
  });
}

function ctCountAssignedInLayout(layout) {
  return layout.seats.filter((s) => s.studentId && !s.isEmpty && !s.isAisle).length;
}

function ctComputeSeatPrintScale(layout, options = {}) {
  const rows = layout.rows || 5;
  const cols = layout.cols || 6;
  const studentCount = options.studentCount || 0;
  const rosterMm = options.hasRoster ? 48 : 0;
  const headerMm = 34;
  const deskMm = options.forTeacher ? 6 : 9;
  const pageH = 190;
  const pageW = 281 - rosterMm;
  const gapMm = Math.max(0.6, Math.min(1.8, 10 / Math.max(rows, cols)));
  const gridH = pageH - headerMm - deskMm - gapMm * (rows - 1);
  const cellH = gridH / rows;
  const cellW = (pageW - gapMm * (cols - 1)) / cols;
  const fontPt = Math.max(5, Math.min(9.5, Math.min(cellH, cellW) * 0.38));
  const rosterFontPt = Math.max(5, Math.min(7, 380 / Math.max(studentCount, 20)));
  const rosterRows = Math.max(30, studentCount);
  return { rows, cols, gapMm, fontPt, rosterFontPt, rosterMm, rosterRows, deskMm };
}

function ctToggleEmptySeat(layout, key) {
  const newLayout = JSON.parse(JSON.stringify(layout));
  const seat = newLayout.seats.find((s) => s.key === key);
  if (!seat || seat.isAisle) return layout;
  const idx = newLayout.emptyCells.indexOf(key);
  if (idx >= 0) {
    newLayout.emptyCells.splice(idx, 1);
    seat.isEmpty = false;
  } else {
    newLayout.emptyCells.push(key);
    seat.isEmpty = true;
    seat.studentId = null;
  }
  return newLayout;
}

if (typeof module !== 'undefined') module.exports = {
  ctCreateSeatGrid, ctAutoAssignSeats, ctAssignSeatsByNumber, ctGetFrontRowSeats, ctCheckAllViolations, ctGetNeighbors,
  ctAssignStudentToSeat, ctSwapStudents, ctGetUnassignedStudents,
  ctMirrorLayoutForTeacher, ctComputeSeatPrintScale, ctSortSeatsForPrint, ctCountAssignedInLayout,
  ctToggleAisleCol, ctToggleEmptySeat,
  ctGetAssignableSeats, ctWouldViolate,
};
