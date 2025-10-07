const assert = require('assert');
const {
  buildSyncIndexFromAnswers,
  canonicalizeLessonAnswers,
  computeLessonHash,
  computeUnitHash,
  normalizeTimestamp,
  parseUnitLesson
} = require('./sync_utils');

function testParseUnitLesson() {
  const parsed = parseUnitLesson('U3-L7-Q09');
  assert.deepStrictEqual(parsed, { unitId: 'unit3', lessonId: 'U3-L7' });
  assert.strictEqual(parseUnitLesson('invalid'), null);
}

function testNormalizeTimestamp() {
  assert.strictEqual(normalizeTimestamp(1234), 1234);
  assert.strictEqual(normalizeTimestamp('5678'), 5678);
  const approx = normalizeTimestamp('2024-01-01T00:00:00Z');
  assert.ok(approx > 0, 'ISO timestamp should parse to milliseconds');
  const isoWithMillis = '2024-01-01T00:00:00.123Z';
  assert.strictEqual(
    normalizeTimestamp(isoWithMillis),
    Math.trunc(Date.parse(isoWithMillis)),
    'ISO strings should truncate milliseconds'
  );
  assert.strictEqual(normalizeTimestamp('not-a-date'), 0);
}

function testBuildSyncIndex() {
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L2-Q02', answer_value: 'B', timestamp: '2000' },
    { username: 'alice', question_id: 'U1-L3-Q01', answer_value: 'C', timestamp: '2024-01-01T00:00:00Z' },
    { username: 'alice', question_id: 'U2-L1-Q01', answer_value: 'D', timestamp: 3000 },
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'A+', timestamp: 1500 } // newer duplicate
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  assert.strictEqual(units.size, 2, 'Should have two units');

  const unit1 = units.get('unit1');
  assert.ok(unit1, 'unit1 should exist');
  assert.strictEqual(unit1.lessons.size, 2, 'unit1 should have two lessons');

  const lessonL2 = unit1.lessons.get('U1-L2');
  assert.ok(lessonL2, 'Lesson U1-L2 should be tracked');
  assert.strictEqual(lessonL2.answerCount, 2, 'Lesson should dedupe to two answers');
  const aliceAnswer = lessonL2.answers.find((a) => a.username === 'alice' && a.question_id === 'U1-L2-Q01');
  assert.ok(aliceAnswer, 'Alice answer should exist');
  assert.strictEqual(aliceAnswer.answer_value, 'A+', 'Newer duplicate should win');

  const lessonHashes = canonicalizeLessonAnswers(lessonL2.answers);
  assert.strictEqual(typeof lessonHashes, 'string', 'Canonical form should be a string');
  assert.strictEqual(computeLessonHash(lessonL2.answers), computeLessonHash(lessonL2.answers), 'Lesson hash should be stable');

  const expectedUnitHash = computeUnitHash(unit1.lessons);
  assert.strictEqual(unit1.hash, expectedUnitHash, 'Unit hash should reflect lesson hashes');
}

function run() {
  testParseUnitLesson();
  testNormalizeTimestamp();
  testBuildSyncIndex();
  console.log('All sync utility tests passed.');
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  testParseUnitLesson,
  testNormalizeTimestamp,
  testBuildSyncIndex
};
