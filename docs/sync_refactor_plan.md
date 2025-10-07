# Sync Logic Refactor Plan

## 1. Scope & Context
- Client: `index.html`, `railway_client.js`, `data_manager.js`
- Server: `railway-server/server.js`
- Existing flow: clients post to `/api/submit-answer`, server persists and broadcasts `answer_submitted`; clients fetch history via `/api/peer-data?since=`.

## 2. Functional Goals
- Partition data with a two-level Merkle-style structure: first by curriculum unit, then by lesson within that unit.
- Maintain cached manifests: `unitId -> unitHash` and `unitId -> { lessonId -> lessonHash }`, recomputing only affected unit/lesson on updates.
- Primary failure mode: holes from missed WebSocket messages; secondary: unnecessary data transfer. Two-level hashes ensure the initial scan is light while lesson-level resyncs stay narrow.

## 3. Interfaces & Protocols
- New endpoints:
  - `GET /api/sync/manifest` → `{ units: [{ unitId, hash }] }` for the top-level unit hashes.
  - `GET /api/sync/unit/<unitId>` → `{ lessons: [{ lessonId, hash }] }` for a specific unit’s lesson hashes when the unit hash mismatches.
  - `GET /api/data/lesson/<lessonId>` → canonical ordered answers for that lesson.
- WebSocket `answer_submitted` payload includes `unitId`, `lessonId`, new answer, and updated unit hash so listening clients can decide whether to fetch lesson manifests immediately.
- Client workflow:
  1. Fetch unit manifest on connect and at polling intervals.
  2. Compare server unit hashes with local digests; for mismatched units fetch the lesson manifest.
  3. Request only lessons whose hashes mismatch via `GET /api/data/lesson/<lessonId>` and merge using `data_manager`.

## 4. Operational Concerns
- Cache structure: `{ answersByLesson, lessonHashesByUnit, unitHashes, lastUpdated }` stored in-memory; recompute only the affected lesson hash and then its parent unit hash on submission.
- Hashing: canonicalize lesson payloads (sorted by student, question, timestamp) before hashing. Use `crypto.createHash('md5')` to satisfy the no-build-step/CommonJS constraint while keeping hashing fast.
- Limit concurrent lesson resyncs to avoid burst load; exponential backoff on retries.
- Logging: emit checksum mismatches, resync requests, recompute durations, and manifest fetch metrics.

## 5. Testing & Verification
- Server unit tests implemented in `railway-server/test.js` using `assert` to cover canonicalization, MD5 hash stability, and cache invalidation logic.
- Integration test script to replay submissions against the server and verify WebSocket payloads include updated hashes.
- Simulated disconnect test: drop WebSocket events in the browser and confirm manifest polling triggers targeted lesson resyncs.
- Performance spot-check: seed with 10k answers, ensure `GET /api/sync/manifest` returns in <50 ms and lesson fetches stay narrow.

## 6. Additional Requirements
- Type-safe helpers (JSDoc) for payload shapes to reduce drift.
- Document protocol in `/docs/sync_refactor_plan.md` and share with client team.
- No new external dependencies without review.

## Next Steps
1. Implement server-side lesson + unit hash cache and the three sync/data endpoints.
2. Update client data manager to track unit and lesson digests.
3. Wire WebSocket broadcasts, manifest polling, and targeted lesson reconciliation.
4. Add `test.js`, document manual disconnect procedure, and update deployment checklist.
