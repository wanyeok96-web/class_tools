/**
 * Class Tools — 모둠편성 엔진
 */
function ctShuffleGroups(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ctAreSeparated(studentA, studentB, separationRules) {
  return separationRules.some(
    (r) => (r.studentA === studentA && r.studentB === studentB)
      || (r.studentA === studentB && r.studentB === studentA),
  );
}

function ctCanAddToGroup(group, student, separationRules) {
  return !group.some((s) => ctAreSeparated(s.id, student.id, separationRules));
}

function ctFormGroups(students, options = {}) {
  const {
    groupSize = 4,
    genderBalance = false,
    respectSeparation = true,
    separationRules = [],
    random = true,
  } = options;

  let pool = random ? ctShuffleGroups(students) : [...students];
  const groups = [];
  const rules = respectSeparation ? separationRules : [];

  if (genderBalance) {
    const males = ctShuffleGroups(pool.filter((s) => s.gender === 'M'));
    const females = ctShuffleGroups(pool.filter((s) => s.gender !== 'M'));
    pool = [];
    const maxLen = Math.max(males.length, females.length);
    for (let i = 0; i < maxLen; i++) {
      if (males[i]) pool.push(males[i]);
      if (females[i]) pool.push(females[i]);
    }
  }

  while (pool.length > 0) {
    const group = [];
    let i = 0;
    while (group.length < groupSize && i < pool.length) {
      const candidate = pool[i];
      if (ctCanAddToGroup(group, candidate, rules)) {
        group.push(candidate);
        pool.splice(i, 1);
      } else {
        i++;
      }
    }
    if (group.length === 0 && pool.length > 0) {
      group.push(pool.shift());
    }
    if (group.length > 0) groups.push(group);
  }

  const last = groups[groups.length - 1];
  if (last && last.length === 1 && groups.length > 1) {
    const prev = groups[groups.length - 2];
    if (prev.length < groupSize + 1) {
      prev.push(last.pop());
      if (last.length === 0) groups.pop();
    }
  }

  return groups.map((g, idx) => ({
    id: ctGenerateId('group'),
    number: idx + 1,
    members: g,
  }));
}

function ctGetGroupViolations(groups, separationRules) {
  const violations = [];
  groups.forEach((group) => {
    for (let i = 0; i < group.members.length; i++) {
      for (let j = i + 1; j < group.members.length; j++) {
        const a = group.members[i].id;
        const b = group.members[j].id;
        if (ctAreSeparated(a, b, separationRules)) {
          violations.push({ group: group.number, studentA: a, studentB: b });
        }
      }
    }
  });
  return violations;
}

if (typeof module !== 'undefined') module.exports = {
  ctFormGroups, ctGetGroupViolations, ctAreSeparated,
};
