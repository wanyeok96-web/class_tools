/**
 * Class Tools — 스코어보드
 */
const CT_SCOREBOARD_KEY = 'ct-scoreboard';

const CT_TEAM_COLORS = [
  '#007AFF', '#FF9500', '#34C759', '#AF52DE',
  '#FF3B30', '#5856D6', '#00C7BE', '#FF2D55',
];

const CT_SCOREBOARD_STEP_PRESETS = [1, 2, 3, 5, 10];

function ctDefaultScoreboard(teamCount = 4, step = 1) {
  const count = Math.max(2, Math.min(8, teamCount));
  return {
    teamCount: count,
    step: Math.max(1, step),
    teams: Array.from({ length: count }, (_, i) => ({
      name: `${i + 1}팀`,
      score: 0,
    })),
  };
}

function ctLoadScoreboard() {
  try {
    const raw = sessionStorage.getItem(CT_SCOREBOARD_KEY);
    if (!raw) return ctDefaultScoreboard();
    const parsed = JSON.parse(raw);
    if (!parsed?.teams?.length) return ctDefaultScoreboard();
    return ctNormalizeScoreboard(parsed);
  } catch {
    return ctDefaultScoreboard();
  }
}

function ctNormalizeScoreboard(data) {
  const teamCount = Math.max(2, Math.min(8, parseInt(data.teamCount, 10) || 4));
  const step = Math.max(1, parseInt(data.step, 10) || 1);
  const teams = [];
  for (let i = 0; i < teamCount; i++) {
    const prev = data.teams?.[i];
    teams.push({
      name: String(prev?.name ?? `${i + 1}팀`).trim() || `${i + 1}팀`,
      score: Number(prev?.score) || 0,
    });
  }
  return { teamCount, step, teams };
}

function ctSaveScoreboard(data) {
  try {
    sessionStorage.setItem(CT_SCOREBOARD_KEY, JSON.stringify(ctNormalizeScoreboard(data)));
  } catch { /* ignore */ }
}

function ctResizeScoreboardTeams(data, teamCount) {
  const next = ctNormalizeScoreboard({ ...data, teamCount });
  return next;
}

function ctSetScoreboardStep(data, step) {
  const next = { ...data, step: Math.max(1, parseInt(step, 10) || 1) };
  return ctNormalizeScoreboard(next);
}

function ctAdjustTeamScore(data, teamIndex, delta) {
  const next = ctNormalizeScoreboard(data);
  if (!next.teams[teamIndex]) return next;
  next.teams[teamIndex].score += delta;
  return next;
}

function ctResetScoreboardScores(data) {
  const next = ctNormalizeScoreboard(data);
  next.teams.forEach((t) => { t.score = 0; });
  return next;
}

function ctUpdateTeamName(data, teamIndex, name) {
  const next = ctNormalizeScoreboard(data);
  if (!next.teams[teamIndex]) return next;
  next.teams[teamIndex].name = String(name).trim() || `${teamIndex + 1}팀`;
  return next;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CT_SCOREBOARD_KEY,
    CT_TEAM_COLORS,
    CT_SCOREBOARD_STEP_PRESETS,
    ctLoadScoreboard,
    ctSaveScoreboard,
    ctDefaultScoreboard,
    ctResizeScoreboardTeams,
    ctSetScoreboardStep,
    ctAdjustTeamScore,
    ctResetScoreboardScores,
    ctUpdateTeamName,
  };
}
