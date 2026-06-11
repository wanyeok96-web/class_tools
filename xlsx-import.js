/**
 * Class Tools — 나이스 명렬표 / CSV / 붙여넣기 파싱
 */
const CT_SENSITIVE_HEADERS = [
  '생년월일', '주민등록', '주소', '전화', '휴대', '보호자', '학부모',
  '이메일', '계좌', '건강', '특기', '취미',
];

const CT_HEADER_MAP = {
  학년: 'grade', grade: 'grade',
  반: 'classNumber', class: 'classNumber', 학급: 'classNumber',
  번호: 'seatNumber', num: 'seatNumber', no: 'seatNumber',
  학번: 'schoolNumber', studentid: 'schoolNumber', studentno: 'schoolNumber',
  이름: 'name', 성명: 'name', name: 'name',
  성별: 'gender', gender: 'gender', sex: 'gender',
  비고: 'note', remark: 'note', note: 'note',
};

function ctNormalizeGender(val) {
  if (!val) return '';
  const s = String(val).trim().toLowerCase();
  if (['남', 'm', 'male', '남자', '男'].includes(s)) return 'M';
  if (['여', 'f', 'female', '여자', '女'].includes(s)) return 'F';
  return s.toUpperCase().slice(0, 1);
}

function ctIsSensitiveHeader(header) {
  const h = String(header || '').toLowerCase();
  return CT_SENSITIVE_HEADERS.some((k) => h.includes(k.toLowerCase()));
}

function ctMapHeaders(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || '').trim();
    if (!key || ctIsSensitiveHeader(key)) return;
    const normalized = key.replace(/\s/g, '').toLowerCase();
    for (const [pattern, field] of Object.entries(CT_HEADER_MAP)) {
      const pat = pattern.toLowerCase();
      if (normalized.includes(pat) || normalized === pat) {
        if (map[field] === undefined) map[field] = i;
        break;
      }
    }
  });
  return map;
}

/** 반 라벨 → 학번용 2자리 코드 (1→01, A→10, B→11) */
function ctClassLabelToCode(classLabel) {
  const raw = String(classLabel ?? '').trim().replace(/반$/i, '');
  if (!raw) return '00';
  if (/^\d+$/.test(raw)) {
    return String(parseInt(raw, 10)).padStart(2, '0');
  }
  if (/^[A-Za-z]$/.test(raw)) {
    return String(10 + raw.toUpperCase().charCodeAt(0) - 65).padStart(2, '0');
  }
  return raw.slice(0, 2).padStart(2, '0');
}

/**
 * 학번 생성: 학년(1) + 반(2) + 번호(2)
 * 예) 2학년 1반 1번 → 20101
 */
function ctBuildSchoolNumber(grade, classLabel, seatNumber) {
  const g = parseInt(grade, 10);
  const gradePart = Number.isFinite(g) && g > 0 ? String(g) : '0';
  const classPart = ctClassLabelToCode(classLabel);
  const seat = parseInt(seatNumber, 10);
  const seatPart = String(Number.isFinite(seat) && seat > 0 ? seat : 0).padStart(2, '0');
  return parseInt(`${gradePart}${classPart}${seatPart}`, 10);
}

function ctRowToStudent(row, headerMap, defaults = {}) {
  const get = (field) => {
    const idx = headerMap[field];
    if (idx === undefined) return defaults[field] ?? '';
    return row[idx] != null ? String(row[idx]).trim() : '';
  };

  const name = get('name');
  if (!name) return null;

  const gradeRaw = get('grade') || defaults.grade || '';
  const classRaw = get('classNumber') || defaults.classLabel || defaults.classNumber || '';
  const seatRaw = get('seatNumber');
  const seatNumber = parseInt(seatRaw, 10)
    || parseInt(defaults.seatNumber, 10)
    || parseInt(defaults.rowIndex, 10)
    || 0;

  let schoolNumber = parseInt(get('schoolNumber').replace(/\D/g, ''), 10);
  if (!Number.isFinite(schoolNumber) || schoolNumber <= 0) {
    if (gradeRaw && classRaw && seatNumber > 0) {
      schoolNumber = ctBuildSchoolNumber(gradeRaw, classRaw, seatNumber);
    } else if (defaults.grade && defaults.classLabel && seatNumber > 0) {
      schoolNumber = ctBuildSchoolNumber(defaults.grade, defaults.classLabel, seatNumber);
    } else if (seatNumber > 0) {
      schoolNumber = seatNumber;
    } else {
      schoolNumber = 0;
    }
  }

  if (!schoolNumber) return null;

  return {
    id: ctGenerateId('student'),
    grade: parseInt(gradeRaw, 10) || parseInt(defaults.grade, 10) || 0,
    classLabel: String(classRaw).trim(),
    seatNumber: seatNumber > 0 ? seatNumber : (schoolNumber % 100) || 0,
    number: schoolNumber,
    name,
    gender: ctNormalizeGender(get('gender')),
    note: get('note') || '',
  };
}

function ctParseRows(rows, defaults = {}) {
  if (!rows?.length) return [];
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    const joined = row.map((c) => String(c || '')).join('');
    if (/이름|성명|번호|학번/.test(joined)) {
      headerRowIdx = i;
      break;
    }
  }
  const headers = rows[headerRowIdx].map((c) => String(c || '').trim());
  const headerMap = ctMapHeaders(headers);
  if (!headerMap.name) {
    throw new Error('이름 열을 찾을 수 없습니다. 나이스 명렬표 형식을 확인해주세요.');
  }
  const students = [];
  let rowIndex = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c && c !== 0)) continue;
    rowIndex += 1;
    const student = ctRowToStudent(row, headerMap, { ...defaults, rowIndex });
    if (student) students.push(student);
  }
  students.sort((a, b) => a.number - b.number);
  return students;
}

function ctParseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (typeof XLSX === 'undefined') throw new Error('엑셀 라이브러리가 로드되지 않았습니다.');
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        resolve(ctParseRows(rows));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsArrayBuffer(file);
  });
}

function ctParseCsvText(text, defaults = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.map((line) => {
    const parts = line.split(/[,\t]/).map((p) => p.replace(/^"|"$/g, '').trim());
    return parts;
  });
  return ctParseRows(rows, defaults);
}

function ctParsePasteText(text, defaults = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.map((line) => line.split(/\t/).map((p) => p.trim()));
  return ctParseRows(rows, defaults);
}

if (typeof module !== 'undefined') module.exports = {
  ctParseExcelFile, ctParseCsvText, ctParsePasteText, ctParseRows, ctIsSensitiveHeader,
  ctBuildSchoolNumber, ctClassLabelToCode,
};
