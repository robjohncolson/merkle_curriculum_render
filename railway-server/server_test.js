const assert = require('assert');
const {
  normalizeTimestamp,
  parseUnitLesson,
  buildSyncIndexFromAnswers,
  computeUnitHash
} = require('./sync_utils');

console.log('\n🧪 Running Server Integration Tests...\n');

// ============================
// HELPER FUNCTION TESTS
// ============================

function testGetUnitIdFromLessonId() {
  // Mock the function from server.js
  function getUnitIdFromLessonId(lessonId) {
    if (typeof lessonId !== 'string') return null;
    const match = lessonId.match(/U(\d+)-L/i);
    if (!match) return null;
    return `unit${parseInt(match[1], 10)}`;
  }

  assert.strictEqual(getUnitIdFromLessonId('U1-L2'), 'unit1', 'Should extract unit1');
  assert.strictEqual(getUnitIdFromLessonId('U10-L5'), 'unit10', 'Should extract unit10');
  assert.strictEqual(getUnitIdFromLessonId('invalid'), null, 'Should return null for invalid');
  assert.strictEqual(getUnitIdFromLessonId(null), null, 'Should handle null');
  
  console.log('✅ getUnitIdFromLessonId tests passed');
}

// ============================
// CACHE VALIDATION TESTS
// ============================

function testIsCacheValid() {
  // Mock the function
  function isCacheValid(lastUpdate, ttl = 30000) {
    if (!lastUpdate) return false;
    return Date.now() - lastUpdate < ttl;
  }

  const now = Date.now();
  assert.strictEqual(isCacheValid(now), true, 'Fresh cache should be valid');
  assert.strictEqual(isCacheValid(now - 10000, 30000), true, 'Recent cache should be valid');
  assert.strictEqual(isCacheValid(now - 40000, 30000), false, 'Old cache should be invalid');
  assert.strictEqual(isCacheValid(0), false, 'Zero timestamp should be invalid');
  assert.strictEqual(isCacheValid(null), false, 'Null should be invalid');
  
  console.log('✅ isCacheValid tests passed');
}

// ============================
// SYNC CACHE OPERATIONS TESTS
// ============================

function testSyncCacheStructure() {
  const syncCache = {
    units: new Map(),
    lessonToUnit: new Map(),
    lastBuilt: 0,
    ttl: 60000
  };

  assert.ok(syncCache.units instanceof Map, 'Units should be a Map');
  assert.ok(syncCache.lessonToUnit instanceof Map, 'LessonToUnit should be a Map');
  assert.strictEqual(typeof syncCache.ttl, 'number', 'TTL should be a number');
  
  console.log('✅ Sync cache structure tests passed');
}

function testUpdateLessonMappingsForUnit() {
  // Mock the function
  function updateLessonMappingsForUnit(unitId, unitData, syncCache) {
    const activeLessons = new Set();
    if (unitData && unitData.lessons) {
      unitData.lessons.forEach((_, lessonId) => {
        activeLessons.add(lessonId);
        syncCache.lessonToUnit.set(lessonId, unitId);
      });
    }

    Array.from(syncCache.lessonToUnit.entries()).forEach(([lessonId, mappedUnit]) => {
      if (mappedUnit === unitId && !activeLessons.has(lessonId)) {
        syncCache.lessonToUnit.delete(lessonId);
      }
    });
  }

  const syncCache = {
    units: new Map(),
    lessonToUnit: new Map(),
    lastBuilt: 0,
    ttl: 60000
  };

  const unitData = {
    hash: 'test',
    lessons: new Map([
      ['U1-L1', { hash: 'lesson1' }],
      ['U1-L2', { hash: 'lesson2' }]
    ])
  };

  updateLessonMappingsForUnit('unit1', unitData, syncCache);
  
  assert.strictEqual(syncCache.lessonToUnit.get('U1-L1'), 'unit1', 'Should map lesson1 to unit1');
  assert.strictEqual(syncCache.lessonToUnit.get('U1-L2'), 'unit1', 'Should map lesson2 to unit1');
  assert.strictEqual(syncCache.lessonToUnit.size, 2, 'Should have 2 mappings');
  
  console.log('✅ updateLessonMappingsForUnit tests passed');
}

// ============================
// DATA NORMALIZATION TESTS
// ============================

function testAnswerNormalization() {
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: '2000' },
    { username: 'charlie', question_id: 'U1-L2-Q01', answer_value: 'C', timestamp: 3000000000 }
  ];

  const normalized = rawAnswers.map(answer => ({
    ...answer,
    timestamp: normalizeTimestamp(answer.timestamp)
  }));

  assert.strictEqual(normalized[0].timestamp, 1000, 'Numeric timestamp should stay numeric');
  assert.strictEqual(normalized[1].timestamp, 2000, 'String numeric should be normalized');
  assert.ok(normalized[2].timestamp > 1000000000, 'Large timestamp should be preserved');
  
  console.log('✅ Answer normalization tests passed');
}

// ============================
// UNIT/LESSON GROUPING TESTS
// ============================

function testBuildSyncIndexMultipleUnits() {
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L2-Q01', answer_value: 'B', timestamp: 2000 },
    { username: 'charlie', question_id: 'U2-L1-Q01', answer_value: 'C', timestamp: 3000 },
    { username: 'dave', question_id: 'U3-L1-Q01', answer_value: 'D', timestamp: 4000 }
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  
  assert.strictEqual(units.size, 3, 'Should have 3 units');
  assert.ok(units.has('unit1'), 'Should have unit1');
  assert.ok(units.has('unit2'), 'Should have unit2');
  assert.ok(units.has('unit3'), 'Should have unit3');
  
  const unit1 = units.get('unit1');
  assert.strictEqual(unit1.lessons.size, 2, 'Unit1 should have 2 lessons');
  
  const unit2 = units.get('unit2');
  assert.strictEqual(unit2.lessons.size, 1, 'Unit2 should have 1 lesson');
  
  console.log('✅ Build sync index with multiple units tests passed');
}

// ============================
// HASH COMPUTATION TESTS
// ============================

function testUnitHashComputation() {
  const lessons = new Map([
    ['U1-L1', { hash: 'abc123', answerCount: 5 }],
    ['U1-L2', { hash: 'def456', answerCount: 3 }]
  ]);

  const hash1 = computeUnitHash(lessons);
  const hash2 = computeUnitHash(lessons);
  
  assert.strictEqual(hash1, hash2, 'Unit hash should be deterministic');
  assert.strictEqual(hash1.length, 32, 'Unit hash should be 32 characters');
  assert.ok(/^[0-9a-f]{32}$/.test(hash1), 'Unit hash should be hex');
  
  console.log('✅ Unit hash computation tests passed');
}

// ============================
// MANIFEST GENERATION TESTS
// ============================

function testManifestGeneration() {
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L2-Q01', answer_value: 'B', timestamp: 2000 },
    { username: 'charlie', question_id: 'U2-L1-Q01', answer_value: 'C', timestamp: 3000 }
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  
  // Simulate manifest structure
  const manifest = {
    generatedAt: Date.now(),
    unitCount: units.size,
    units: {}
  };

  units.forEach((unitData, unitId) => {
    manifest.units[unitId] = {
      hash: unitData.hash,
      lessonCount: (unitData.lessons && unitData.lessons.size) || 0,
      updatedAt: unitData.lastUpdated || Date.now()
    };
  });

  assert.strictEqual(manifest.unitCount, 2, 'Manifest should have 2 units');
  assert.ok(manifest.units.unit1, 'Manifest should include unit1');
  assert.ok(manifest.units.unit2, 'Manifest should include unit2');
  assert.strictEqual(manifest.units.unit1.lessonCount, 2, 'Unit1 should show 2 lessons');
  assert.strictEqual(manifest.units.unit2.lessonCount, 1, 'Unit2 should show 1 lesson');
  
  console.log('✅ Manifest generation tests passed');
}

// ============================
// DEDUPLICATION TESTS
// ============================

function testAnswerDeduplication() {
  const rawAnswers = [
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'B', timestamp: 2000 },
    { username: 'alice', question_id: 'U1-L1-Q01', answer_value: 'C', timestamp: 1500 }
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  const unit = units.get('unit1');
  const lesson = unit.lessons.get('U1-L1');

  assert.strictEqual(lesson.answerCount, 1, 'Should deduplicate to 1 answer');
  assert.strictEqual(lesson.answers[0].answer_value, 'B', 'Should keep newest answer');
  assert.strictEqual(lesson.answers[0].timestamp, 2000, 'Should have newest timestamp');
  
  console.log('✅ Answer deduplication tests passed');
}

// ============================
// EDGE CASES TESTS
// ============================

function testEmptyAnswersArray() {
  const { units } = buildSyncIndexFromAnswers([]);
  assert.strictEqual(units.size, 0, 'Empty array should produce no units');
  
  console.log('✅ Empty answers array tests passed');
}

function testInvalidQuestionIds() {
  const rawAnswers = [
    { username: 'alice', question_id: 'invalid', answer_value: 'A', timestamp: 1000 },
    { username: 'bob', question_id: 'U1-L1-Q01', answer_value: 'B', timestamp: 2000 }
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  assert.strictEqual(units.size, 1, 'Should filter invalid question IDs');
  assert.ok(units.has('unit1'), 'Should only have valid unit');
  
  console.log('✅ Invalid question IDs tests passed');
}

function testEmptyUsernames() {
  const rawAnswers = [
    { username: '', question_id: 'U1-L1-Q01', answer_value: 'A', timestamp: 1000 },
    { username: '  ', question_id: 'U1-L1-Q02', answer_value: 'B', timestamp: 2000 },
    { username: 'charlie', question_id: 'U1-L1-Q03', answer_value: 'C', timestamp: 3000 }
  ];

  const { units } = buildSyncIndexFromAnswers(rawAnswers);
  const unit = units.get('unit1');
  const lesson = unit.lessons.get('U1-L1');

  assert.strictEqual(lesson.answerCount, 1, 'Should filter empty usernames');
  assert.strictEqual(lesson.answers[0].username, 'charlie', 'Should only have valid username');
  
  console.log('✅ Empty usernames tests passed');
}

// ============================
// CACHE FRESHNESS TESTS
// ============================

function testCacheFreshness() {
  function isSyncCacheFresh(syncCache) {
    return syncCache.units.size > 0 && (Date.now() - syncCache.lastBuilt) < syncCache.ttl;
  }

  const freshCache = {
    units: new Map([['unit1', { hash: 'test' }]]),
    lastBuilt: Date.now(),
    ttl: 60000
  };

  const staleCache = {
    units: new Map([['unit1', { hash: 'test' }]]),
    lastBuilt: Date.now() - 70000,
    ttl: 60000
  };

  const emptyCache = {
    units: new Map(),
    lastBuilt: Date.now(),
    ttl: 60000
  };

  assert.strictEqual(isSyncCacheFresh(freshCache), true, 'Fresh cache should be valid');
  assert.strictEqual(isSyncCacheFresh(staleCache), false, 'Stale cache should be invalid');
  assert.strictEqual(isSyncCacheFresh(emptyCache), false, 'Empty cache should be invalid');
  
  console.log('✅ Cache freshness tests passed');
}

// ============================
// RUN ALL TESTS
// ============================

function runAllTests() {
  // Helper function tests
  testGetUnitIdFromLessonId();
  testIsCacheValid();
  testSyncCacheStructure();
  testUpdateLessonMappingsForUnit();
  
  // Data processing tests
  testAnswerNormalization();
  testBuildSyncIndexMultipleUnits();
  testUnitHashComputation();
  
  // Manifest generation tests
  testManifestGeneration();
  
  // Data integrity tests
  testAnswerDeduplication();
  
  // Edge cases
  testEmptyAnswersArray();
  testInvalidQuestionIds();
  testEmptyUsernames();
  
  // Cache tests
  testCacheFreshness();
  
  console.log('\n✅ All server integration tests passed!\n');
}

if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests
};