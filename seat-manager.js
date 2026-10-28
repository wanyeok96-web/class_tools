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

/* ── 자리 규칙 ── */

const CT_SEAT_RULE_TYPES = {
  rowRange: { icon: '📏', label: '줄 범위', group: 'position', desc: '선택한 학생을 화면 위에서 N~M행 안에 배치' },
  colRange: { icon: '📐', label: '분단 범위', group: 'position', desc: '선택한 학생을 왼쪽에서 N~M열 안에 배치' },
  allowSeats: { icon: '🗺️', label: '허용 구역', group: 'position', desc: '교실 지도에서 고른 칸에만 배치' },
  fixedSeat: { icon: '📌', label: '좌석 고정', group: 'position', desc: '학생 1명을 정한 칸에 고정 (번호순 배치에도 적용)' },
  avoidSeats: { icon: '🚫', label: '금지 좌석', group: 'position', desc: '고른 칸에는 앉히지 않음' },
  separate: { icon: '🔒', label: '분리', group: 'relation', desc: '두 학생을 옆·앞뒤·대각선으로 붙이지 않음' },
  pair: { icon: '🤝', label: '짝 지정', group: 'relation', desc: '두 학생을 옆자리 또는 앞뒤로 붙여 앉힘' },
  avoidPrevious: { icon: '🔄', label: '지난 자리 피하기', group: 'change', desc: '확정한 지난 배치와 겹치지 않게' },
};

const CT_POSITION_RULE_TYPES = ['rowRange', 'colRange', 'allowSeats', 'fixedSeat', 'avoidSeats'];
const CT_SEAT_KEY_RULE_TYPES = ['allowSeats', 'fixedSeat', 'avoidSeats'];
const CT_RULE_PENALTY = 100;

function ctSeatLabel(seatOrKey) {
  const [row, col] = typeof seatOrKey === 'string'
    ? seatOrKey.split('-').map(Number)
    : [seatOrKey.row, seatOrKey.col];
  return `${row + 1}행 ${col + 1}열`;
}

function ctIsSeatRuleComplete(rule) {
  if (!rule) return false;
  switch (rule.type) {
    case 'rowRange':
    case 'colRange':
      return rule.studentIds?.length > 0 && rule.from >= 1 && rule.to >= rule.from;
    case 'allowSeats':
    case 'avoidSeats':
      return rule.studentIds?.length > 0 && rule.seatKeys?.length > 0;
    case 'fixedSeat':
      return !!rule.studentId && !!rule.seatKey;
    case 'separate':
      return !!rule.studentA && !!rule.studentB && rule.studentA !== rule.studentB
        && (rule.noAdjacent || rule.noFrontBack || rule.noDiagonal);
    case 'pair':
      return !!rule.studentA && !!rule.studentB && rule.studentA !== rule.studentB;
    case 'avoidPrevious':
      return (rule.target === 'all' || rule.studentIds?.length > 0)
        && (rule.sameSeat || rule.samePartner || rule.minRowShift > 0);
    default:
      return false;
  }
}

function ctIsSeatRuleActive(rule) {
  return !!rule && rule.enabled !== false && !rule.needsReview && ctIsSeatRuleComplete(rule);
}

function ctSeatRuleLabel(rule) {
  const meta = CT_SEAT_RULE_TYPES[rule.type];
  if (!meta) return '규칙';
  if (rule.type === 'rowRange') return `${meta.label}(${rule.from}~${rule.to}행)`;
  if (rule.type === 'colRange') return `${meta.label}(${rule.from}~${rule.to}열)`;
  if (rule.type === 'fixedSeat' && rule.seatKey) return `${meta.label}(${ctSeatLabel(rule.seatKey)})`;
  if (rule.type === 'pair') return `${meta.label}(${rule.direction === 'frontBack' ? '앞뒤' : '옆자리'})`;
  return meta.label;
}

function ctSeatMatchesPositionRule(rule, seat) {
  switch (rule.type) {
    case 'rowRange': return seat.row + 1 >= rule.from && seat.row + 1 <= rule.to;
    case 'colRange': return seat.col + 1 >= rule.from && seat.col + 1 <= rule.to;
    case 'allowSeats': return rule.seatKeys.includes(seat.key);
    case 'avoidSeats': return !rule.seatKeys.includes(seat.key);
    case 'fixedSeat': return seat.key === rule.seatKey;
    default: return true;
  }
}

/** 교실을 다시 만들어 칸이 사라진 칸 지정 규칙을 '확인 필요'로 표시하고 끈다. */
function ctFlagSeatRulesForLayout(rules, layout) {
  const keys = new Set(layout.seats.map((s) => s.key));
  let flagged = 0;
  (rules || []).forEach((rule) => {
    if (!CT_SEAT_KEY_RULE_TYPES.includes(rule.type)) return;
    const used = rule.type === 'fixedSeat' ? [rule.seatKey].filter(Boolean) : rule.seatKeys || [];
    if (used.some((k) => !keys.has(k))) {
      rule.needsReview = true;
      rule.enabled = false;
      flagged += 1;
    }
  });
  return flagged;
}

/** 확인 필요 규칙에서 없어진 칸을 빼고 다시 켤 수 있는 상태로 만든다. 뺀 칸 수를 돌려준다. */
function ctResolveSeatRuleReview(rule, layout) {
  const keys = new Set(layout.seats.map((s) => s.key));
  let removed = 0;
  if (rule.type === 'fixedSeat') {
    if (rule.seatKey && !keys.has(rule.seatKey)) {
      rule.seatKey = '';
      removed = 1;
    }
  } else if (Array.isArray(rule.seatKeys)) {
    const before = rule.seatKeys.length;
    rule.seatKeys = rule.seatKeys.filter((k) => keys.has(k));
    removed = before - rule.seatKeys.length;
  }
  rule.needsReview = false;
  return removed;
}

function ctCreateSeatSnapshot(layout) {
  return {
    at: new Date().toISOString(),
    rows: layout.rows,
    cols: layout.cols,
    seats: layout.seats
      .filter((s) => s.studentId && !s.isEmpty && !s.isAisle)
      .map((s) => ({ row: s.row, col: s.col, studentId: s.studentId })),
  };
}

function ctBuildPreviousIndex(confirmed) {
  const posById = new Map();
  const partnersById = new Map();
  if (!confirmed?.seats?.length) return { posById, partnersById, has: false };
  const byCell = new Map();
  confirmed.seats.forEach((s) => {
    posById.set(s.studentId, { row: s.row, col: s.col });
    byCell.set(`${s.row}-${s.col}`, s.studentId);
  });
  confirmed.seats.forEach((s) => {
    [-1, 1].forEach((dc) => {
      const other = byCell.get(`${s.row}-${s.col + dc}`);
      if (!other) return;
      if (!partnersById.has(s.studentId)) partnersById.set(s.studentId, new Set());
      partnersById.get(s.studentId).add(other);
    });
  });
  return { posById, partnersById, has: true };
}

function ctPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function ctBuildSeatRuleContext(students, layout, rules, options = {}) {
  const { confirmed = null, genderBalance = false } = options;
  const idSet = new Set(students.map((s) => s.id));
  const genderOf = new Map(students.map((s) => [s.id, s.gender || '']));
  const seats = ctGetAssignableSeats(layout)
    .slice()
    .sort((a, b) => a.row - b.row || a.col - b.col);
  const seatByKey = new Map(seats.map((s) => [s.key, s]));
  const neighbors = new Map();
  seats.forEach((seat) => {
    neighbors.set(seat.key, ctGetNeighbors(layout, seat.row, seat.col)
      .map(({ seat: n, type }) => ({ key: n.key, type })));
  });

  const active = (rules || []).filter(ctIsSeatRuleActive);
  const positionRules = new Map();
  const prevRules = new Map();
  const separateByPair = new Map();
  const pairsById = new Map();
  const push = (map, key, val) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  };

  active.forEach((rule) => {
    if (CT_POSITION_RULE_TYPES.includes(rule.type)) {
      const ids = rule.type === 'fixedSeat' ? [rule.studentId] : rule.studentIds;
      ids.filter((id) => idSet.has(id)).forEach((id) => push(positionRules, id, rule));
    } else if (rule.type === 'separate') {
      push(separateByPair, ctPairKey(rule.studentA, rule.studentB), rule);
    } else if (rule.type === 'pair') {
      if (!idSet.has(rule.studentA) || !idSet.has(rule.studentB)) return;
      push(pairsById, rule.studentA, { rule, other: rule.studentB });
      push(pairsById, rule.studentB, { rule, other: rule.studentA });
    } else if (rule.type === 'avoidPrevious') {
      const ids = rule.target === 'all' ? [...idSet] : rule.studentIds.filter((id) => idSet.has(id));
      ids.forEach((id) => push(prevRules, id, rule));
    }
  });

  return {
    students,
    idSet,
    genderOf,
    genderBalance,
    seats,
    seatByKey,
    neighbors,
    active,
    positionRules,
    prevRules,
    separateByPair,
    pairsById,
    previous: ctBuildPreviousIndex(confirmed),
  };
}

function ctNeighborType(ctx, keyA, keyB) {
  return (ctx.neighbors.get(keyA) || []).find((n) => n.key === keyB)?.type || null;
}

function ctPairDirectionType(rule) {
  return rule.direction === 'frontBack' ? 'frontBack' : 'adjacent';
}

function ctSeparateForbids(rule, type) {
  return (type === 'adjacent' && rule.noAdjacent)
    || (type === 'frontBack' && rule.noFrontBack)
    || (type === 'diagonal' && rule.noDiagonal);
}

function ctPreviousSeatProblems(ctx, rule, id, seat) {
  const prev = ctx.previous.posById.get(id);
  if (!prev) return [];
  const problems = [];
  if (rule.sameSeat && prev.row === seat.row && prev.col === seat.col) problems.push('sameSeat');
  if (rule.minRowShift > 0 && Math.abs(seat.row - prev.row) < rule.minRowShift) problems.push('rowShift');
  return problems;
}

function ctWantsNewPartner(ctx, id, other) {
  const rules = ctx.prevRules.get(id);
  if (!rules?.some((r) => r.samePartner)) return false;
  return !!ctx.previous.partnersById.get(id)?.has(other);
}

/** 좌석 위치만 따진 비용 (관계 규칙 제외) */
function ctPositionCost(ctx, id, seat) {
  let cost = 0;
  (ctx.positionRules.get(id) || []).forEach((rule) => {
    if (!ctSeatMatchesPositionRule(rule, seat)) cost += CT_RULE_PENALTY;
  });
  (ctx.prevRules.get(id) || []).forEach((rule) => {
    cost += CT_RULE_PENALTY * ctPreviousSeatProblems(ctx, rule, id, seat).length;
  });
  return cost;
}

function ctRelationCost(ctx, id, other, type) {
  let cost = 0;
  (ctx.separateByPair.get(ctPairKey(id, other)) || []).forEach((rule) => {
    if (ctSeparateForbids(rule, type)) cost += CT_RULE_PENALTY;
  });
  if (type === 'adjacent') {
    if (ctWantsNewPartner(ctx, id, other) || ctWantsNewPartner(ctx, other, id)) cost += CT_RULE_PENALTY;
    if (ctx.genderBalance) {
      const g1 = ctx.genderOf.get(id);
      if (g1 && g1 === ctx.genderOf.get(other)) cost += 1;
    }
  }
  return cost;
}

function ctSeatCost(ctx, id, seat, occupant, seatOf) {
  let cost = ctPositionCost(ctx, id, seat);
  const nbs = ctx.neighbors.get(seat.key) || [];
  nbs.forEach(({ key, type }) => {
    const other = occupant.get(key);
    if (other) cost += ctRelationCost(ctx, id, other, type);
  });
  (ctx.pairsById.get(id) || []).forEach(({ rule, other }) => {
    const want = ctPairDirectionType(rule);
    const otherSeat = seatOf.get(other);
    if (otherSeat) {
      if (ctNeighborType(ctx, seat.key, otherSeat.key) !== want) cost += CT_RULE_PENALTY;
      return;
    }
    const roomForPartner = nbs.some((n) => n.type === want && !occupant.has(n.key)
      && ctPositionCost(ctx, other, ctx.seatByKey.get(n.key)) === 0);
    if (!roomForPartner) cost += CT_RULE_PENALTY / 2;
  });
  return cost;
}

function ctOrderStudentsForRules(ctx, students) {
  const info = new Map(students.map((s) => {
    const rules = ctx.positionRules.get(s.id) || [];
    const fixed = rules.some((r) => r.type === 'fixedSeat');
    const constrained = rules.length || ctx.prevRules.has(s.id);
    const freeSeats = constrained
      ? ctx.seats.filter((seat) => ctPositionCost(ctx, s.id, seat) === 0).length
      : ctx.seats.length;
    const relations = (ctx.pairsById.get(s.id) || []).length
      + [...ctx.separateByPair.keys()].filter((k) => k.split('|').includes(s.id)).length;
    return [s.id, { fixed, freeSeats, relations }];
  }));
  return [...students].sort((a, b) => {
    const A = info.get(a.id);
    const B = info.get(b.id);
    if (A.fixed !== B.fixed) return A.fixed ? -1 : 1;
    if (A.freeSeats !== B.freeSeats) return A.freeSeats - B.freeSeats;
    return B.relations - A.relations;
  });
}

function ctRunSeatAttempt(ctx, orderedStudents, random) {
  const occupant = new Map();
  const seatOf = new Map();
  const queue = orderedStudents.map((s) => s.id);
  while (queue.length) {
    const id = queue.shift();
    let best = Infinity;
    let candidates = [];
    ctx.seats.forEach((seat) => {
      if (occupant.has(seat.key)) return;
      const cost = ctSeatCost(ctx, id, seat, occupant, seatOf);
      if (cost < best) {
        best = cost;
        candidates = [seat];
      } else if (cost === best) {
        candidates.push(seat);
      }
    });
    if (!candidates.length) continue;
    const seat = random ? candidates[Math.floor(Math.random() * candidates.length)] : candidates[0];
    occupant.set(seat.key, id);
    seatOf.set(id, seat);
    (ctx.pairsById.get(id) || []).forEach(({ other }) => {
      const idx = queue.indexOf(other);
      if (idx > 0) {
        queue.splice(idx, 1);
        queue.unshift(other);
      }
    });
  }
  return { occupant, seatOf };
}

/**
 * 배치 결과의 규칙 위반 목록.
 * @returns {{ rule: object, studentIds: string[], seatKeys: string[], message: string }[]}
 */
function ctCollectSeatRuleViolations(ctx, seatOf, nameOf = (id) => id) {
  const out = [];
  const occupant = new Map([...seatOf].map(([id, seat]) => [seat.key, id]));
  const add = (rule, ids, message) => {
    out.push({
      rule,
      studentIds: ids,
      seatKeys: ids.map((id) => seatOf.get(id)?.key).filter(Boolean),
      message,
    });
  };

  ctx.active.forEach((rule) => {
    const label = ctSeatRuleLabel(rule);
    switch (rule.type) {
      case 'rowRange':
      case 'colRange':
      case 'allowSeats':
      case 'avoidSeats':
      case 'fixedSeat': {
        const ids = rule.type === 'fixedSeat' ? [rule.studentId] : rule.studentIds;
        ids.forEach((id) => {
          const seat = seatOf.get(id);
          if (!seat || ctSeatMatchesPositionRule(rule, seat)) return;
          add(rule, [id], `${nameOf(id)} — ${label}을(를) 지키지 못했습니다 (현재 ${ctSeatLabel(seat)})`);
        });
        break;
      }
      case 'separate': {
        const sa = seatOf.get(rule.studentA);
        const sb = seatOf.get(rule.studentB);
        if (!sa || !sb) break;
        const type = ctNeighborType(ctx, sa.key, sb.key);
        if (type && ctSeparateForbids(rule, type)) {
          const where = { adjacent: '옆자리', frontBack: '앞뒤', diagonal: '대각선' }[type];
          add(rule, [rule.studentA, rule.studentB],
            `${nameOf(rule.studentA)} ↔ ${nameOf(rule.studentB)} — 분리 규칙 위반 (${where})`);
        }
        break;
      }
      case 'pair': {
        const sa = seatOf.get(rule.studentA);
        const sb = seatOf.get(rule.studentB);
        if (!sa || !sb) break;
        if (ctNeighborType(ctx, sa.key, sb.key) !== ctPairDirectionType(rule)) {
          add(rule, [rule.studentA, rule.studentB],
            `${nameOf(rule.studentA)} ↔ ${nameOf(rule.studentB)} — ${label}을(를) 지키지 못했습니다`);
        }
        break;
      }
      case 'avoidPrevious': {
        const ids = rule.target === 'all' ? [...ctx.idSet] : rule.studentIds.filter((id) => ctx.idSet.has(id));
        const seenPairs = new Set();
        ids.forEach((id) => {
          const seat = seatOf.get(id);
          if (!seat) return;
          ctPreviousSeatProblems(ctx, rule, id, seat).forEach((p) => {
            add(rule, [id], p === 'sameSeat'
              ? `${nameOf(id)} — 지난번과 같은 자리입니다 (${ctSeatLabel(seat)})`
              : `${nameOf(id)} — 지난 줄에서 ${rule.minRowShift}줄 이상 옮기지 못했습니다`);
          });
          if (!rule.samePartner) return;
          const partners = ctx.previous.partnersById.get(id);
          if (!partners) return;
          (ctx.neighbors.get(seat.key) || []).forEach(({ key, type }) => {
            if (type !== 'adjacent') return;
            const other = occupant.get(key);
            if (!other || !partners.has(other)) return;
            const pk = ctPairKey(id, other);
            if (seenPairs.has(pk)) return;
            seenPairs.add(pk);
            add(rule, [id, other], `${nameOf(id)} ↔ ${nameOf(other)} — 지난번 짝과 다시 짝이 되었습니다`);
          });
        });
        break;
      }
      default:
        break;
    }
  });
  return out;
}

function ctGenderPenalty(ctx, seatOf, occupant) {
  if (!ctx.genderBalance) return 0;
  let penalty = 0;
  seatOf.forEach((seat, id) => {
    const right = occupant.get(`${seat.row}-${seat.col + 1}`);
    if (!right) return;
    const g = ctx.genderOf.get(id);
    if (g && g === ctx.genderOf.get(right)) penalty += 1;
  });
  return penalty;
}

function ctSeatOfFromLayout(layout) {
  const seatOf = new Map();
  layout.seats.forEach((s) => {
    if (s.studentId && !s.isEmpty && !s.isAisle) seatOf.set(s.studentId, s);
  });
  return seatOf;
}

/** 현재 배치가 규칙을 어긴 목록 */
function ctEvaluateSeatRules(layout, students, rules, options = {}) {
  const ctx = ctBuildSeatRuleContext(students, layout, rules, options);
  return ctCollectSeatRuleViolations(ctx, ctSeatOfFromLayout(layout), options.nameOf);
}

function ctAutoAssignSeats(students, layout, options = {}) {
  const {
    random = true,
    genderBalance = false,
    rules = [],
    confirmed = null,
    maxAttempts = 400,
    timeBudgetMs = 350,
  } = options;

  const ctx = ctBuildSeatRuleContext(students, layout, rules, { confirmed, genderBalance });
  const attempts = random ? maxAttempts : 1;
  const deadline = Date.now() + timeBudgetMs;
  let best = null;

  for (let i = 0; i < attempts; i++) {
    if (i > 0 && Date.now() > deadline) break;
    const base = random ? ctShuffle(students) : [...students];
    const ordered = ctOrderStudentsForRules(ctx, base);
    const result = ctRunSeatAttempt(ctx, ordered, random);
    const violations = ctCollectSeatRuleViolations(ctx, result.seatOf).length;
    const score = violations * CT_RULE_PENALTY + ctGenderPenalty(ctx, result.seatOf, result.occupant);
    if (!best || score < best.score) best = { ...result, score };
    if (score === 0) break;
  }

  const newLayout = JSON.parse(JSON.stringify(layout));
  newLayout.seats.forEach((s) => { s.studentId = null; });
  newLayout.assignments = {};
  best?.occupant.forEach((id, key) => {
    const seat = newLayout.seats.find((s) => s.key === key);
    if (!seat) return;
    seat.studentId = id;
    newLayout.assignments[key] = id;
  });
  return newLayout;
}

/**
 * 배치 전에 규칙끼리 충돌하거나 지킬 수 없는 부분을 찾는다.
 * @returns {{ level: 'error'|'warn', message: string }[]}
 */
function ctCheckSeatRuleFeasibility(students, layout, rules, options = {}) {
  const { confirmed = null, nameOf = (id) => id } = options;
  const ctx = ctBuildSeatRuleContext(students, layout, rules, { confirmed });
  const issues = [];
  const error = (message) => issues.push({ level: 'error', message });
  const warn = (message) => issues.push({ level: 'warn', message });

  (rules || []).forEach((rule) => {
    const label = ctSeatRuleLabel(rule);
    if (rule.needsReview) warn(`${label} — 교실이 바뀌어 확인이 필요합니다 (꺼져 있음)`);
    else if (rule.enabled !== false && !ctIsSeatRuleComplete(rule)) warn(`${label} — 설정이 완성되지 않아 적용되지 않습니다`);
  });

  if (students.length > ctx.seats.length) {
    warn(`학생 ${students.length}명인데 앉을 수 있는 좌석은 ${ctx.seats.length}칸입니다`);
  }

  const fixedBySeat = new Map();
  ctx.active.forEach((rule) => {
    const label = ctSeatRuleLabel(rule);
    if (['rowRange', 'colRange', 'allowSeats'].includes(rule.type)) {
      const targets = rule.studentIds.filter((id) => ctx.idSet.has(id)).length;
      const capacity = ctx.seats.filter((seat) => ctSeatMatchesPositionRule(rule, seat)).length;
      if (targets > capacity) error(`${label} — 대상 ${targets}명인데 해당 좌석은 ${capacity}칸뿐입니다`);
    }
    if (rule.type === 'fixedSeat') {
      if (!ctx.seatByKey.has(rule.seatKey)) {
        error(`${label} — ${nameOf(rule.studentId)}의 고정 좌석이 빈 좌석이거나 없는 칸입니다`);
      }
      if (!fixedBySeat.has(rule.seatKey)) fixedBySeat.set(rule.seatKey, new Set());
      fixedBySeat.get(rule.seatKey).add(rule.studentId);
    }
    if (rule.type === 'avoidPrevious' && !ctx.previous.has) {
      warn(`${label} — 확정한 지난 자리가 없어 적용되지 않습니다 ('이번 자리 확정'을 먼저 눌러 주세요)`);
    }
  });
  fixedBySeat.forEach((ids, key) => {
    if (ids.size > 1) {
      error(`좌석 고정 — ${[...ids].map(nameOf).join(', ')}이(가) 같은 칸(${ctSeatLabel(key)})에 고정되어 있습니다`);
    }
  });

  ctx.students.forEach((s) => {
    if (!ctx.positionRules.has(s.id) && !ctx.prevRules.has(s.id)) return;
    const ok = ctx.seats.some((seat) => ctPositionCost(ctx, s.id, seat) === 0);
    if (!ok) error(`${nameOf(s.id)} — 위치 조건을 모두 만족하는 좌석이 없습니다 (규칙끼리 겹치지 않음)`);
  });

  ctx.active.filter((r) => r.type === 'pair').forEach((rule) => {
    const label = ctSeatRuleLabel(rule);
    const names = `${nameOf(rule.studentA)} ↔ ${nameOf(rule.studentB)}`;
    const want = ctPairDirectionType(rule);
    const blocked = (ctx.separateByPair.get(ctPairKey(rule.studentA, rule.studentB)) || [])
      .some((sep) => ctSeparateForbids(sep, want));
    if (blocked) {
      error(`${names} — ${label}과 분리 규칙이 서로 충돌합니다`);
      return;
    }
    const possible = ctx.seats.some((seat) => ctPositionCost(ctx, rule.studentA, seat) === 0
      && (ctx.neighbors.get(seat.key) || []).some((n) => n.type === want
        && ctPositionCost(ctx, rule.studentB, ctx.seatByKey.get(n.key)) === 0));
    if (!possible) error(`${names} — 위치 조건 때문에 ${label}이(가) 가능한 자리가 없습니다`);
  });

  return issues;
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

/** fixedSeats: [{ studentId, seatKey }] — 고정 학생을 먼저 앉히고 나머지는 번호순 */
function ctAssignSeatsByNumber(students, layout, direction = 'horizontal', options = {}) {
  const { fixedSeats = [] } = options;
  const newLayout = JSON.parse(JSON.stringify(layout));
  newLayout.seats.forEach((s) => { s.studentId = null; });
  newLayout.assignments = {};

  const idSet = new Set(students.map((s) => s.id));
  const fixedIds = new Set();
  fixedSeats.forEach(({ studentId, seatKey }) => {
    if (!idSet.has(studentId) || fixedIds.has(studentId)) return;
    const seat = newLayout.seats.find((s) => s.key === seatKey && !s.isEmpty && !s.isAisle);
    if (!seat || seat.studentId) return;
    seat.studentId = studentId;
    newLayout.assignments[seatKey] = studentId;
    fixedIds.add(studentId);
  });

  const availableSeats = ctSortSeatsForAssign(newLayout, direction).filter((s) => !s.studentId);

  const studentList = students.filter((s) => !fixedIds.has(s.id)).sort((a, b) => {
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
  CT_SEAT_RULE_TYPES, ctSeatLabel, ctIsSeatRuleComplete, ctIsSeatRuleActive, ctSeatRuleLabel,
  ctSeatMatchesPositionRule, ctFlagSeatRulesForLayout, ctResolveSeatRuleReview, ctCreateSeatSnapshot,
  ctEvaluateSeatRules, ctCheckSeatRuleFeasibility,
};
