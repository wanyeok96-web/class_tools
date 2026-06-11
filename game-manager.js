/**
 * Class Tools — 랜덤 게임 (사다리·세션 풀·알고리즘)
 */

const CT_LADDER_POOL_PREFIX = 'ct-ladder-pool:';
const CT_LADDER_WIN_COUNT_PREFIX = 'ct-ladder-win-count:';
const CT_ROULETTE_POOL_PREFIX = 'ct-roulette-pool:';
const CT_ROULETTE_MODE_PREFIX = 'ct-roulette-mode:';
const CT_ROULETTE_CUSTOM_PREFIX = 'ct-roulette-custom:';

const CT_DEFAULT_ROULETTE_CUSTOM = [
  { id: 'roulette-default-1', label: '꽝' },
  { id: 'roulette-default-2', label: '사탕' },
  { id: 'roulette-default-3', label: '청소 면제' },
  { id: 'roulette-default-4', label: '칭찬 스티커' },
  { id: 'roulette-default-5', label: '간식 쿠폰' },
  { id: 'roulette-default-6', label: '1번 문제' },
];
const CT_PINBALL_POOL_PREFIX = 'ct-pinball-pool:';
const CT_PINBALL_WIN_COUNT_PREFIX = 'ct-pinball-win-count:';

const CT_LADDER_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF3B30',
  '#5856D6', '#00C7BE', '#FF2D55', '#5AC8FA', '#FFCC00',
  '#8E8E93', '#A2845E', '#30B0C7', '#FF6482', '#64D2FF',
];

function ctGetLadderSurname(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '?';
  return trimmed[0];
}

function ctGetLadderPieceMeta(colIndex, student) {
  return {
    color: CT_LADDER_COLORS[colIndex % CT_LADDER_COLORS.length],
    char: ctGetLadderSurname(student?.name),
  };
}

function ctLadderPoolKey(classId) {
  return `${CT_LADDER_POOL_PREFIX}${classId}`;
}

function ctLoadLadderPool(classId, allStudentIds) {
  if (!classId || !allStudentIds?.length) return [...(allStudentIds || [])];
  try {
    const raw = sessionStorage.getItem(ctLadderPoolKey(classId));
    if (!raw) return [...allStudentIds];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...allStudentIds];
    const valid = new Set(allStudentIds);
    const filtered = parsed.filter((id) => valid.has(id));
    if (!parsed.length) return [];
    return filtered.length ? filtered : [...allStudentIds];
  } catch {
    return [...allStudentIds];
  }
}

function ctSaveLadderPool(classId, selectedIds) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctLadderPoolKey(classId), JSON.stringify(selectedIds));
  } catch { /* ignore */ }
}

function ctClearLadderPool(classId) {
  if (!classId) return;
  try {
    sessionStorage.removeItem(ctLadderPoolKey(classId));
  } catch { /* ignore */ }
}

function ctLadderWinCountKey(classId) {
  return `${CT_LADDER_WIN_COUNT_PREFIX}${classId}`;
}

function ctLoadLadderWinCount(classId, maxCount = 5) {
  if (!classId) return 1;
  try {
    const raw = sessionStorage.getItem(ctLadderWinCountKey(classId));
    const n = parseInt(raw, 10);
    if (!n || n < 1) return 1;
    return Math.min(maxCount, n);
  } catch {
    return 1;
  }
}

function ctSaveLadderWinCount(classId, count) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctLadderWinCountKey(classId), String(count));
  } catch { /* ignore */ }
}

function ctPickWinningBottomSlots(columnCount, winnerCount) {
  const slots = Array.from({ length: columnCount }, (_, i) => i);
  return ctPickRandom(slots, Math.min(winnerCount, columnCount), false);
}

function ctBuildLadderPathPoints(rungs, startCol, padX, padTop, colW, rowH, levels) {
  const points = [];
  let col = startCol;
  let x = padX + col * colW;
  let y = padTop;
  points.push({ x, y });
  for (let l = 0; l < levels; l++) {
    const nextY = padTop + rowH * (l + 1);
    const row = rungs[l];
    if (row.has(col)) {
      const nx = padX + (col + 1) * colW;
      points.push({ x, y: nextY - rowH * 0.5 });
      points.push({ x: nx, y: nextY - rowH * 0.5 });
      col += 1;
      x = nx;
    } else if (col > 0 && row.has(col - 1)) {
      const nx = padX + (col - 1) * colW;
      points.push({ x, y: nextY - rowH * 0.5 });
      points.push({ x: nx, y: nextY - rowH * 0.5 });
      col -= 1;
      x = nx;
    }
    points.push({ x, y: nextY });
  }
  return { points, endCol: col };
}

function ctInterpolatePath(points, t) {
  if (!points?.length) return { x: 0, y: 0 };
  if (points.length === 1 || t <= 0) return { x: points[0].x, y: points[0].y };
  if (t >= 1) {
    const last = points[points.length - 1];
    return { x: last.x, y: last.y };
  }
  const segLens = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return { x: points[0].x, y: points[0].y };
  let dist = t * total;
  for (let i = 0; i < segLens.length; i++) {
    if (dist <= segLens[i] || i === segLens.length - 1) {
      const ratio = segLens[i] ? dist / segLens[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    dist -= segLens[i];
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

function ctGetLadderWinners(rungs, participants, winningBottomSet) {
  const winners = [];
  participants.forEach((student, startCol) => {
    const endCol = ctTraceLadderColumn(rungs, startCol);
    if (winningBottomSet.has(endCol)) {
      const piece = ctGetLadderPieceMeta(startCol, student);
      winners.push({ student, startCol, endCol, color: piece.color, char: piece.char });
    }
  });
  return winners;
}

/** @returns {Set<number>[]} rungs[level] = Set of col (bridge between col and col+1) */
function ctGenerateLadder(columnCount, levelCount) {
  const levels = levelCount || Math.max(8, Math.min(14, columnCount + 4));
  const rungs = [];
  for (let l = 0; l < levels; l++) {
    const row = new Set();
    let prev = false;
    for (let c = 0; c < columnCount - 1; c++) {
      const place = !prev && Math.random() < 0.42;
      if (place) row.add(c);
      prev = place;
    }
    rungs.push(row);
  }
  return rungs;
}

function ctTraceLadderColumn(rungs, startCol) {
  let col = startCol;
  for (let l = 0; l < rungs.length; l++) {
    const row = rungs[l];
    if (row.has(col)) col += 1;
    else if (col > 0 && row.has(col - 1)) col -= 1;
  }
  return col;
}

function ctFindTopColumnForBottom(rungs, bottomCol, columnCount) {
  for (let c = 0; c < columnCount; c++) {
    if (ctTraceLadderColumn(rungs, c) === bottomCol) return c;
  }
  return 0;
}

function ctRoulettePoolKey(classId) {
  return `${CT_ROULETTE_POOL_PREFIX}${classId}`;
}

function ctLoadRoulettePool(classId, allStudentIds) {
  if (!classId || !allStudentIds?.length) return [...(allStudentIds || [])];
  try {
    const raw = sessionStorage.getItem(ctRoulettePoolKey(classId));
    if (!raw) return [...allStudentIds];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...allStudentIds];
    const valid = new Set(allStudentIds);
    const filtered = parsed.filter((id) => valid.has(id));
    if (!parsed.length) return [];
    return filtered.length ? filtered : [...allStudentIds];
  } catch {
    return [...allStudentIds];
  }
}

function ctSaveRoulettePool(classId, selectedIds) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctRoulettePoolKey(classId), JSON.stringify(selectedIds));
  } catch { /* ignore */ }
}

function ctClearRoulettePool(classId) {
  if (!classId) return;
  try {
    sessionStorage.removeItem(ctRoulettePoolKey(classId));
  } catch { /* ignore */ }
}

function ctRouletteModeKey(classId) {
  return `${CT_ROULETTE_MODE_PREFIX}${classId}`;
}

function ctLoadRouletteMode(classId) {
  if (!classId) return 'students';
  try {
    const raw = sessionStorage.getItem(ctRouletteModeKey(classId));
    return raw === 'custom' ? 'custom' : 'students';
  } catch {
    return 'students';
  }
}

function ctSaveRouletteMode(classId, mode) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctRouletteModeKey(classId), mode === 'custom' ? 'custom' : 'students');
  } catch { /* ignore */ }
}

function ctRouletteCustomKey(classId) {
  return `${CT_ROULETTE_CUSTOM_PREFIX}${classId}`;
}

function ctNormalizeRouletteCustomItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, i) => {
      if (typeof item === 'string') {
        const label = item.trim();
        return label ? { id: `roulette-item-${i}`, label } : null;
      }
      const label = String(item?.label || '').trim();
      const id = String(item?.id || '').trim() || `roulette-item-${i}`;
      return label ? { id, label } : null;
    })
    .filter(Boolean);
}

function ctLoadRouletteCustomItems(classId) {
  if (!classId) return [...CT_DEFAULT_ROULETTE_CUSTOM];
  try {
    const raw = sessionStorage.getItem(ctRouletteCustomKey(classId));
    if (!raw) return [...CT_DEFAULT_ROULETTE_CUSTOM];
    const parsed = JSON.parse(raw);
    const normalized = ctNormalizeRouletteCustomItems(parsed);
    return normalized.length ? normalized : [...CT_DEFAULT_ROULETTE_CUSTOM];
  } catch {
    return [...CT_DEFAULT_ROULETTE_CUSTOM];
  }
}

function ctSaveRouletteCustomItems(classId, items) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctRouletteCustomKey(classId), JSON.stringify(ctNormalizeRouletteCustomItems(items)));
  } catch { /* ignore */ }
}

function ctClearRouletteCustomItems(classId) {
  if (!classId) return;
  try {
    sessionStorage.removeItem(ctRouletteCustomKey(classId));
  } catch { /* ignore */ }
}

function ctPinballPoolKey(classId) {
  return `${CT_PINBALL_POOL_PREFIX}${classId}`;
}

function ctLoadPinballPool(classId, allStudentIds) {
  if (!classId || !allStudentIds?.length) return [...(allStudentIds || [])];
  try {
    const raw = sessionStorage.getItem(ctPinballPoolKey(classId));
    if (!raw) return [...allStudentIds];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...allStudentIds];
    const valid = new Set(allStudentIds);
    const filtered = parsed.filter((id) => valid.has(id));
    if (!parsed.length) return [];
    return filtered.length ? filtered : [...allStudentIds];
  } catch {
    return [...allStudentIds];
  }
}

function ctSavePinballPool(classId, selectedIds) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctPinballPoolKey(classId), JSON.stringify(selectedIds));
  } catch { /* ignore */ }
}

function ctClearPinballPool(classId) {
  if (!classId) return;
  try {
    sessionStorage.removeItem(ctPinballPoolKey(classId));
  } catch { /* ignore */ }
}

function ctPinballWinCountKey(classId) {
  return `${CT_PINBALL_WIN_COUNT_PREFIX}${classId}`;
}

function ctLoadPinballWinCount(classId, maxCount = 5) {
  if (!classId) return 1;
  try {
    const raw = sessionStorage.getItem(ctPinballWinCountKey(classId));
    const n = parseInt(raw, 10);
    if (!n || n < 1) return 1;
    return Math.min(maxCount, n);
  } catch {
    return 1;
  }
}

function ctSavePinballWinCount(classId, count) {
  if (!classId) return;
  try {
    sessionStorage.setItem(ctPinballWinCountKey(classId), String(count));
  } catch { /* ignore */ }
}

function ctPickTreasureReward(rewards) {
  if (!rewards?.length) return null;
  const idx = Math.floor(Math.random() * rewards.length);
  return rewards[idx];
}

function ctPickDiceStudentIndex(studentCount) {
  if (studentCount < 1) return { index: -1, d1: 1, d2: 1, sum: 2 };
  const index = Math.floor(Math.random() * studentCount);
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  return { index, d1, d2, sum: d1 + d2 };
}

if (typeof module !== 'undefined') {
  module.exports = {
    ctLadderPoolKey,
    ctLoadLadderPool,
    ctSaveLadderPool,
    ctClearLadderPool,
    ctGenerateLadder,
    ctTraceLadderColumn,
    ctFindTopColumnForBottom,
    ctPickDiceStudentIndex,
    CT_LADDER_COLORS,
    ctGetLadderSurname,
    ctGetLadderPieceMeta,
    ctLoadLadderWinCount,
    ctSaveLadderWinCount,
    ctPickWinningBottomSlots,
    ctBuildLadderPathPoints,
    ctInterpolatePath,
    ctGetLadderWinners,
    ctRoulettePoolKey,
    ctLoadRoulettePool,
    ctSaveRoulettePool,
    ctClearRoulettePool,
    ctRouletteModeKey,
    ctLoadRouletteMode,
    ctSaveRouletteMode,
    ctRouletteCustomKey,
    ctLoadRouletteCustomItems,
    ctSaveRouletteCustomItems,
    ctClearRouletteCustomItems,
    CT_DEFAULT_ROULETTE_CUSTOM,
    ctPinballPoolKey,
    ctLoadPinballPool,
    ctSavePinballPool,
    ctClearPinballPool,
    ctLoadPinballWinCount,
    ctSavePinballWinCount,
    ctPickTreasureReward,
  };
}
