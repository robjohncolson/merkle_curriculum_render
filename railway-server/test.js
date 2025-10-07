const assert = require('assert');
const {
  buildSyncIndexFromAnswers,
  canonicalizeLessonAnswers,
  computeLessonHash,
  computeUnitHash,
  normalizeTimestamp,
  parseUnitLesson
} = require('./sync_utils');

// ============================
// NORMALIZE TIMESTAMP TESTS
// ============================

function testNormalizeTimestamp() {
  // Happy path - numeric timestamps
  assert.strictEqual(normalizeTimestamp(1234), 1234);
  assert.strictEqual(normalizeTimestamp(1234.567), 1234);
  
  // String numeric timestamps
  assert.strictEqual(normalizeTimestamp('5678'), 5678);
  assert.strictEqual(normalizeTimestamp('9999.123'), 9999);
  
  // ISO timestamp parsing
  const approx = normalizeTimestamp('2024-01-01T00:00:00Z');
  assert.ok(approx > 0, 'ISO timestamp should parse to some value');
  
  // Edge cases - null/undefined
  assert.strictEqual(normalizeTimestamp(null), 0);
  assert.strictEqual(normalizeTimestamp(undefined), 0);
  
  // Edge cases - invalid strings
  assert.strictEqual(normalizeTimestamp('invalid'), 0);
  assert.strictEqual(normalizeTimestamp('not-a-date'), 0);
  assert.strictEqual(normalizeTimestamp(''), 0);
  
  // Edge cases - special numbers
  assert.strictEqual(normalizeTimestamp(0), 0);
  assert.strictEqual(normalizeTimestamp(-1), -1);
  assert.strictEqual(normalizeTimestamp(Infinity), 0);
  assert.strictEqual(normalizeTimestamp(-Infinity), 0);
  assert.strictEqual(normalizeTimestamp(NaN), 0);
  
  // Mixed date formats
  assert.ok(normalizeTimestamp('2024-12-31') > 0);
  assert.ok(normalizeTimestamp('Jan 1, 2024') > 0);
  
  console.log('✅ testNormalizeTimestamp passed');
}

// ============================
// PARSE UNIT LESSON TESTS
// ============================

function testParseUnitLesson() {
  // Happy path - standard format
  const parsed1 = parseUnitLesson('U3-L7-Q09');
  assert.deepStrictEqual(parsed1, { unitId: 'unit3', lessonId: 'U3-L7' });
  
  const parsed2 = parseUnitLesson('U1-L2-Q01');
  assert.deepStrictEqual(parsed2, { unitId: 'unit1', lessonId: 'U1-L2' });
  
  // Different unit/lesson numbers
  const parsed3 = parseUnitLesson('U10-L15-Q20');
  assert.deepStrictEqual(parsed3, { unitId: 'unit10', lessonId: 'U10-L15' });
  
  // Case insensitivity
  const parsed4 = parseUnitLesson('u5-l8-q12');
  assert.deepStrictEqual(parsed4, { unitId: 'unit5', lessonId: 'U5-L8' });
  
  // Edge cases - invalid formats
  assert.strictEqual(parseUnitLesson('invalid'), null);
  assert.strictEqual(parseUnitLesson(''), null);
  assert.strictEqual(parseUnitLesson('U1-Q01'), null);
  assert.strictEqual(parseUnitLesson('L1-Q01'), null);
  assert.strictEqual(parseUnitLesson('U-L-Q'), null);
  
  // Edge cases - wrong types
  assert.strictEqual(parseUnitLesson(null), null);
  assert.strictEqual(parseUnitLesson(undefined), null);
  assert.strictEqual(parseUnitLesson(123), null);
  assert.strictEqual(parseUnitLesson({}), null);
  
  // Partial matches
  assert.strictEqual(parseUnitLesson('U1'), null);
  assert.strictEqual(parseUnitLesson('U1-L'), null);
  
  console.log('✅ testParseUnitLesson passed');
}

// ============================
// CANONICALIZE LESSON ANSWERS TESTS
// ============================

function testCanonicalizeLessonAnswers() {
  // Happy path - basic canonicalization
  const answers1 = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  const canonical1 = canonicalizeLessonAnswers(answers1);
  assert.strictEqual(typeof canonical1, 'string');
  const parsed1 = JSON.parse(canonical1);
  assert.strictEqual(parsed1.length, 2);
  assert.strictEqual(parsed1[0].username, 'alice');
  assert.strictEqual(parsed1[1].username, 'bob');
  
  // Sorting by username
  const answers2 = [
    { username: 'bob', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'alice', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  const canonical2 = canonicalizeLessonAnswers(answers2);
  const parsed2 = JSON.parse(canonical2);
  assert.strictEqual(parsed2[0].username, 'alice');
  assert.strictEqual(parsed2[1].username, 'bob');
  
  // Sorting by question_id when username is same
  const answers3 = [
    { username: 'alice', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 }
  ];
  const canonical3 = canonicalizeLessonAnswers(answers3);
  const parsed3 = JSON.parse(canonical3);
  assert.strictEqual(parsed3[0].question_id, 'U1-L1-Q01');
  assert.strictEqual(parsed3[1].question_id, 'U1-L1-Q02');
  
  // Sorting by timestamp when username and question_id are same
  const answers4 = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'B', timestamp: 2000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 }
  ];
  const canonical4 = canonicalizeLessonAnswers(answers4);
  const parsed4 = JSON.parse(canonical4);
  assert.strictEqual(parsed4[0].timestamp, 1000);
  assert.strictEqual(parsed4[1].timestamp, 2000);
  
  // Trimming whitespace in username
  const answers5 = [
    { username: '  alice  ', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 }
  ];
  const canonical5 = canonicalizeLessonAnswers(answers5);
  const parsed5 = JSON.parse(canonical5);
  assert.strictEqual(parsed5[0].username, 'alice');
  
  // Filtering out empty usernames
  const answers6 = [
    { username: '', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'alice', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  const canonical6 = canonicalizeLessonAnswers(answers6);
  const parsed6 = JSON.parse(canonical6);
  assert.strictEqual(parsed6.length, 1);
  assert.strictEqual(parsed6[0].username, 'alice');
  
  // Handling null answer_value
  const answers7 = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: null, timestamp: 1000 }
  ];
  const canonical7 = canonicalizeLessonAnswers(answers7);
  const parsed7 = JSON.parse(canonical7);
  assert.strictEqual(parsed7[0].answer_value, null);
  
  // Edge cases - empty array
  const canonical8 = canonicalizeLessonAnswers([]);
  assert.strictEqual(canonical8, '[]');
  
  // Edge cases - null/undefined
  const canonical9 = canonicalizeLessonAnswers(null);
  assert.strictEqual(canonical9, '[]');
  
  const canonical10 = canonicalizeLessonAnswers(undefined);
  assert.strictEqual(canonical10, '[]');
  
  // Filtering out invalid question_id types
  const answers11 = [
    { username: 'alice', question_id: null, answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q01', answer_value: 'B', timestamp: 2000 }
  ];
  const canonical11 = canonicalizeLessonAnswers(answers11);
  const parsed11 = JSON.parse(canonical11);
  assert.strictEqual(parsed11.length, 1);
  assert.strictEqual(parsed11[0].username, 'bob');
  
  console.log('✅ testCanonicalizeLessonAnswers passed');
}

// ============================
// COMPUTE LESSON HASH TESTS
// ============================

function testComputeLessonHash() {
  // Hash should be deterministic
  const answers1 = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 }
  ];
  const hash1a = computeLessonHash(answers1);
  const hash1b = computeLessonHash(answers1);
  assert.strictEqual(hash1a, hash1b, 'Hash should be deterministic');
  
  // Hash should be MD5 hex (32 characters)
  assert.strictEqual(typeof hash1a, 'string');
  assert.strictEqual(hash1a.length, 32);
  assert.ok(/^[0-9a-f]{32}$/.test(hash1a), 'Hash should be hex format');
  
  // Different data should produce different hashes
  const answers2 = [
    { username: 'bob', question_id: 'U1-L1-Q01', answer_value: 'B', timestamp: 2000 }
  ];
  const hash2 = computeLessonHash(answers2);
  assert.notStrictEqual(hash1a, hash2, 'Different data should have different hashes');
  
  // Order should not matter (due to canonicalization)
  const answers3a = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  const answers3b = [
    { username: 'bob', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 }
  ];
  const hash3a = computeLessonHash(answers3a);
  const hash3b = computeLessonHash(answers3b);
  assert.strictEqual(hash3a, hash3b, 'Order should not affect hash');
  
  // Empty array should produce consistent hash
  const hashEmpty = computeLessonHash([]);
  assert.strictEqual(typeof hashEmpty, 'string');
  assert.strictEqual(hashEmpty.length, 32);
  
  console.log('✅ testComputeLessonHash passed');
}

// ============================
// COMPUTE UNIT HASH TESTS
// ============================

function testComputeUnitHash() {
  // Hash should be deterministic
  const lessons1 = new Map([
    ['U1-L1', { hash: 'abc123def456' }],
    ['U1-L2', { hash: 'ghi789jkl012' }]
  ]);
  const hash1a = computeUnitHash(lessons1);
  const hash1b = computeUnitHash(lessons1);
  assert.strictEqual(hash1a, hash1b, 'Unit hash should be deterministic');
  
  // Hash should be MD5 hex
  assert.strictEqual(typeof hash1a, 'string');
  assert.strictEqual(hash1a.length, 32);
  assert.ok(/^[0-9a-f]{32}$/.test(hash1a), 'Unit hash should be hex format');
  
  // Different lessons should produce different hashes
  const lessons2 = new Map([
    ['U1-L1', { hash: 'different123' }],
    ['U1-L2', { hash: 'hashes456789' }]
  ]);
  const hash2 = computeUnitHash(lessons2);
  assert.notStrictEqual(hash1a, hash2, 'Different lessons should have different hashes');
  
  // Lesson order should not matter (sorted by lessonId)
  const lessons3a = new Map([
    ['U1-L2', { hash: 'second' }],
    ['U1-L1', { hash: 'first' }]
  ]);
  const lessons3b = new Map([
    ['U1-L1', { hash: 'first' }],
    ['U1-L2', { hash: 'second' }]
  ]);
  const hash3a = computeUnitHash(lessons3a);
  const hash3b = computeUnitHash(lessons3b);
  assert.strictEqual(hash3a, hash3b, 'Lesson order should not affect unit hash');
  
  // Empty map should produce consistent hash
  const hashEmpty = computeUnitHash(new Map());
  assert.strictEqual(typeof hashEmpty, 'string');
  assert.strictEqual(hashEmpty.length, 32);
  
  console.log('✅ testComputeUnitHash passed');
}

// ============================
// BUILD SYNC INDEX TESTS
// ============================

function testBuildSyncIndex() {
  // Basic index building
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L2-Q02', answer_value: 'B', timestamp: '2000' },
    { username: 'alice', question_id: 'U1-L3-Q01', answer_value: 'C', timestamp: '2024-01-01T00:00:00Z' },
    { username: 'alice', question_id: 'U2-L1-Q01', answer_value: 'D', timestamp: 3000 },
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'A+', timestamp: 1500 } // newer duplicate
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  
  // Should have two units
  assert.strictEqual(units.size, 2, 'Should have two units');
  assert.ok(units.has('unit1'));
  assert.ok(units.has('unit2'));

  const unit1 = units.get('unit1');
  assert.ok(unit1, 'unit1 should exist');
  assert.strictEqual(unit1.lessons.size, 2, 'unit1 should have two lessons');

  // Check lesson deduplication
  const lessonL2 = unit1.lessons.get('U1-L2');
  assert.ok(lessonL2, 'Lesson U1-L2 should be tracked');
  assert.strictEqual(lessonL2.answerCount, 2, 'Lesson should dedupe to two answers');
  
  // Check that newer duplicate wins
  const aliceAnswer = lessonL2.answers.find((a) => a.username === 'alice' && a.question_id === 'U1-L2-Q01');
  assert.ok(aliceAnswer, 'Alice answer should exist');
  assert.strictEqual(aliceAnswer.answer_value, 'A+', 'Newer duplicate should win');

  // Check lesson hash stability
  const lessonHashes = canonicalizeLessonAnswers(lessonL2.answers);
  assert.strictEqual(typeof lessonHashes, 'string', 'Canonical form should be a string');
  assert.strictEqual(computeLessonHash(lessonL2.answers), computeLessonHash(lessonL2.answers), 'Lesson hash should be stable');

  // Check unit hash
  const expectedUnitHash = computeUnitHash(unit1.lessons);
  assert.strictEqual(unit1.hash, expectedUnitHash, 'Unit hash should reflect lesson hashes');
  
  // Check unit2
  const unit2 = units.get('unit2');
  assert.ok(unit2, 'unit2 should exist');
  assert.strictEqual(unit2.lessons.size, 1, 'unit2 should have one lesson');
  
  console.log('✅ testBuildSyncIndex passed');
}

function testBuildSyncIndexEmptyInput() {
  // Empty array
  const { units: units1 } = buildSyncIndexFromAnswers([]);
  assert.strictEqual(units1.size, 0, 'Empty input should produce empty index');
  
  // Null input
  const { units: units2 } = buildSyncIndexFromAnswers(null);
  assert.strictEqual(units2.size, 0, 'Null input should produce empty index');
  
  // Undefined input
  const { units: units3 } = buildSyncIndexFromAnswers(undefined);
  assert.strictEqual(units3.size, 0, 'Undefined input should produce empty index');
  
  console.log('✅ testBuildSyncIndexEmptyInput passed');
}

function testBuildSyncIndexInvalidData() {
  // Answers with invalid question IDs
  const rawAnswers1 = [
    { username: 'alice', question_id: 'invalid', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L2-Q01', answer_value: 'B', timestamp: 2000 }
  ];
  const { units: units1 } = buildSyncIndexFromAnswers(rawAnswers1);
  assert.strictEqual(units1.size, 1, 'Invalid question IDs should be filtered out');
  assert.ok(units1.has('unit1'));
  
  // Answers with empty usernames
  const rawAnswers2 = [
    { username: '', question_id: 'U1-L2-Q01', answer_value: 'A', timestamp: 1000 },
    { username: '  ', question_id: 'U1-L2-Q02', answer_value: 'B', timestamp: 2000 },
    { username: 'charlie', question_id: 'U1-L2-Q03', answer_value: 'C', timestamp: 3000 }
  ];
  const { units: units2 } = buildSyncIndexFromAnswers(rawAnswers2);
  const unit = units2.get('unit1');
  const lesson = unit.lessons.get('U1-L2');
  assert.strictEqual(lesson.answerCount, 1, 'Empty usernames should be filtered out');
  
  // Answers with missing fields
  const rawAnswers3 = [
    { username: 'alice', question_id: 'U1-L2-Q01', timestamp: 1000 }, // missing answer_value
    { username: 'bob', question_id: 'U1-L2-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  const { units: units3 } = buildSyncIndexFromAnswers(rawAnswers3);
  const unit3 = units3.get('unit1');
  const lesson3 = unit3.lessons.get('U1-L2');
  assert.strictEqual(lesson3.answerCount, 2, 'Missing answer_value should be allowed (null)');
  
  console.log('✅ testBuildSyncIndexInvalidData passed');
}

function testBuildSyncIndexDuplicates() {
  // Multiple answers from same user for same question
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'B', timestamp: 2000 },
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'C', timestamp: 1500 }
  ];
  
  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  const unit = units.get('unit1');
  const lesson = unit.lessons.get('U1-L2');
  
  // Should keep only the newest (highest timestamp)
  assert.strictEqual(lesson.answerCount, 1, 'Should dedupe to one answer');
  assert.strictEqual(lesson.answers[0].answer_value, 'B', 'Should keep newest answer');
  assert.strictEqual(lesson.answers[0].timestamp, 2000, 'Should have newest timestamp');
  
  console.log('✅ testBuildSyncIndexDuplicates passed');
}

function testBuildSyncIndexTimestampNormalization() {
  // Mixed timestamp formats
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L2-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L2-Q02', answer_value: 'B', timestamp: '2000' },
    { username: 'charlie', question_id: 'U1-L2-Q03', answer_value: 'C', timestamp: '2024-01-01T00:00:00Z' },
    { username: 'dave', question_id: 'U1-L2-Q04', answer_value: 'D', timestamp: null }
  ];
  
  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  const unit = units.get('unit1');
  const lesson = unit.lessons.get('U1-L2');
  
  // All timestamps should be normalized
  lesson.answers.forEach((answer) => {
    assert.strictEqual(typeof answer.timestamp, 'number', 'Timestamp should be normalized to number');
  });
  
  // Check specific normalizations
  const aliceAnswer = lesson.answers.find(a => a.username === 'alice');
  assert.strictEqual(aliceAnswer.timestamp, 1000);
  
  const bobAnswer = lesson.answers.find(a => a.username === 'bob');
  assert.strictEqual(bobAnswer.timestamp, 2000);
  
  const charlieAnswer = lesson.answers.find(a => a.username === 'charlie');
  assert.ok(charlieAnswer.timestamp > 1700000000000, 'ISO timestamp should be parsed');
  
  const daveAnswer = lesson.answers.find(a => a.username === 'dave');
  assert.strictEqual(daveAnswer.timestamp, 0, 'Null timestamp should normalize to 0');
  
  console.log('✅ testBuildSyncIndexTimestampNormalization passed');
}

function testBuildSyncIndexMultipleUnitsAndLessons() {
  // Complex scenario with multiple units and lessons
  const rawAnswers = [
    // Unit 1
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 },
    { username: 'charlie', question_id: 'U1-L2-Q01', answer_value: 'C', timestamp: 3000 },
    // Unit 2
    { username: 'dave', question_id: 'U2-L1-Q01', answer_value: 'D', timestamp: 4000 },
    { username: 'eve', question_id: 'U2-L2-Q01', answer_value: 'E', timestamp: 5000 },
    // Unit 3
    { username: 'frank', question_id: 'U3-L1-Q01', answer_value: 'F', timestamp: 6000 }
  ];
  
  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  
  assert.strictEqual(units.size, 3, 'Should have three units');
  
  const unit1 = units.get('unit1');
  assert.strictEqual(unit1.lessons.size, 2, 'Unit 1 should have 2 lessons');
  assert.ok(unit1.lessons.has('U1-L1'));
  assert.ok(unit1.lessons.has('U1-L2'));
  
  const unit2 = units.get('unit2');
  assert.strictEqual(unit2.lessons.size, 2, 'Unit 2 should have 2 lessons');
  
  const unit3 = units.get('unit3');
  assert.strictEqual(unit3.lessons.size, 1, 'Unit 3 should have 1 lesson');
  
  // Verify hash uniqueness
  const hashes = new Set([unit1.hash, unit2.hash, unit3.hash]);
  assert.strictEqual(hashes.size, 3, 'Each unit should have unique hash');
  
  console.log('✅ testBuildSyncIndexMultipleUnitsAndLessons passed');
}

function testBuildSyncIndexAnswerSorting() {
  // Answers should be sorted within each lesson
  const rawAnswers = [
    { username: 'charlie', question_id: 'U1-L1-Q03', answer_value: 'C', timestamp: 3000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  
  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  const lesson = units.get('unit1').lessons.get('U1-L1');
  
  // Should be sorted by username first
  assert.strictEqual(lesson.answers[0].username, 'alice');
  assert.strictEqual(lesson.answers[1].username, 'bob');
  assert.strictEqual(lesson.answers[2].username, 'charlie');
  
  // Within same username, sorted by question_id
  const rawAnswers2 = [
    { username: 'alice', question_id: 'U1-L1-Q03', answer_value: 'C', timestamp: 3000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'alice', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 }
  ];
  
  const { units: units2 } = buildSyncIndexFromAnswers(rawAnswers2);
  const lesson2 = units2.get('unit1').lessons.get('U1-L1');
  
  assert.strictEqual(lesson2.answers[0].question_id, 'U1-L1-Q01');
  assert.strictEqual(lesson2.answers[1].question_id, 'U1-L1-Q02');
  assert.strictEqual(lesson2.answers[2].question_id, 'U1-L1-Q03');
  
  console.log('✅ testBuildSyncIndexAnswerSorting passed');
}

// ============================
// RUN ALL TESTS
// ============================

function run() {
  console.log('\n🧪 Running comprehensive sync utility tests...\n');
  
  // Basic function tests
  testParseUnitLesson();
  testNormalizeTimestamp();
  testCanonicalizeLessonAnswers();
  testComputeLessonHash();
  testComputeUnitHash();
  
  // Build sync index tests
  testBuildSyncIndex();
  testBuildSyncIndexEmptyInput();
  testBuildSyncIndexInvalidData();
  testBuildSyncIndexDuplicates();
  testBuildSyncIndexTimestampNormalization();
  testBuildSyncIndexMultipleUnitsAndLessons();
  testBuildSyncIndexAnswerSorting();
  
  console.log('\n✅ All sync utility tests passed\!\n');
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  testParseUnitLesson,
  testNormalizeTimestamp,
  testCanonicalizeLessonAnswers,
  testComputeLessonHash,
  testComputeUnitHash,
  testBuildSyncIndex,
  testBuildSyncIndexEmptyInput,
  testBuildSyncIndexInvalidData,
  testBuildSyncIndexDuplicates,
  testBuildSyncIndexTimestampNormalization,
  testBuildSyncIndexMultipleUnitsAndLessons,
  testBuildSyncIndexAnswerSorting
};