const crypto = require('crypto');

function normalizeTimestamp(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const numeric = parseInt(value, 10);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return Math.trunc(ms);
    }
  }
  return 0;
}

function parseUnitLesson(questionId) {
  if (typeof questionId !== 'string') return null;
  const match = questionId.match(/U(\d+)-L(\d+)/i);
  if (!match) return null;
  const unitNumber = match[1];
  const lessonNumber = match[2];
  const unitId = `unit${parseInt(unitNumber, 10)}`;
  const lessonId = `U${parseInt(unitNumber, 10)}-L${parseInt(lessonNumber, 10)}`;
  return { unitId, lessonId };
}

function canonicalizeLessonAnswers(answers) {
  const sorted = (answers || [])
    .map((answer) => ({
      username: (answer.username || '').trim(),
      question_id: answer.question_id,
      answer_value: answer.answer_value ?? null,
      timestamp: normalizeTimestamp(answer.timestamp)
    }))
    .filter((answer) => answer.username && typeof answer.question_id === 'string')
    .sort((a, b) => {
      const userCompare = a.username.localeCompare(b.username);
      if (userCompare !== 0) return userCompare;
      const questionCompare = a.question_id.localeCompare(b.question_id);
      if (questionCompare !== 0) return questionCompare;
      return a.timestamp - b.timestamp;
    });
  return JSON.stringify(sorted);
}

function hashString(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function computeLessonHash(answers) {
  return hashString(canonicalizeLessonAnswers(answers));
}

function computeUnitHash(lessonsMap) {
  const entries = Array.from(lessonsMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lessonId, lessonData]) => ({ lessonId, hash: lessonData.hash }));
  return hashString(JSON.stringify(entries));
}

function buildSyncIndexFromAnswers(rawAnswers) {
  const unitBuckets = new Map();

  (rawAnswers || []).forEach((raw) => {
    const bucketInfo = parseUnitLesson(raw.question_id);
    if (!bucketInfo) return;

    const normalized = {
      username: (raw.username || '').trim(),
      question_id: raw.question_id,
      answer_value: raw.answer_value ?? null,
      timestamp: normalizeTimestamp(raw.timestamp)
    };

    if (!normalized.username) return;

    let lessonBuckets = unitBuckets.get(bucketInfo.unitId);
    if (!lessonBuckets) {
      lessonBuckets = new Map();
      unitBuckets.set(bucketInfo.unitId, lessonBuckets);
    }

    let lessonMap = lessonBuckets.get(bucketInfo.lessonId);
    if (!lessonMap) {
      lessonMap = new Map();
      lessonBuckets.set(bucketInfo.lessonId, lessonMap);
    }

    const key = `${normalized.username}::${normalized.question_id}`;
    const existing = lessonMap.get(key);
    if (!existing || normalized.timestamp >= existing.timestamp) {
      lessonMap.set(key, normalized);
    }
  });

  const units = new Map();

  unitBuckets.forEach((lessonBuckets, unitId) => {
    const lessons = new Map();

    lessonBuckets.forEach((answerMap, lessonId) => {
      const answers = Array.from(answerMap.values()).sort((a, b) => {
        const userCompare = a.username.localeCompare(b.username);
        if (userCompare !== 0) return userCompare;
        const questionCompare = a.question_id.localeCompare(b.question_id);
        if (questionCompare !== 0) return questionCompare;
        return a.timestamp - b.timestamp;
      });

      const hash = computeLessonHash(answers);
      lessons.set(lessonId, {
        hash,
        answers,
        answerCount: answers.length,
        lastUpdated: Date.now()
      });
    });

    const unitHash = computeUnitHash(lessons);
    units.set(unitId, {
      hash: unitHash,
      lessons,
      lastUpdated: Date.now()
    });
  });

  return { units };
}

module.exports = {
  buildSyncIndexFromAnswers,
  canonicalizeLessonAnswers,
  computeLessonHash,
  computeUnitHash,
  normalizeTimestamp,
  parseUnitLesson
};
