# Merkle Sync Field Guide

This guide shows how to **prove that the new Merkle-driven sync is working** and how to contrast it with the legacy timestamp sync. The steps below assume you already deployed the latest Railway/Supabase stack.

---

## 1. Quick confidence checks

1. **Run the lightweight unit tests** (only needs Node.js):

   ```bash
   cd railway-server
   node test.js
   ```

   This validates the hashing utilities, timestamp normalization, and manifest builders.

2. **Load the app with Turbo Mode enabled** (`window.USE_RAILWAY = true`). Open the browser console and call:

   ```js
   computeLocalMerkleSnapshot();
   fetchRemoteMerkleManifest();
   compareMerkleWithServer();
   ```

   These helpers log tables of unit/lesson hashes and confirm that the local cache matches the server manifest.

---

## 2. Demonstrate the Merkle advantage in real time

### Scenario A — Missed WebSocket recovery

1. Open **Tab A** and **Tab B** on the live app (same class/login).
2. In Tab A, open DevTools → Network and toggle “Offline”. This simulates a brief disconnect so Tab A misses WebSocket broadcasts.
3. In Tab B, submit an answer for a lesson (e.g., U1-L4-Q02).
4. Bring Tab A back online. Within the next sync cycle you should see console logs similar to:

   ```
   ✅ Merkle sync: updated 1 lessons with 3 answers.
   ```

   Tab A uses the manifest hashes to detect the missing lesson and fetches only those answers. Repeat with the legacy mode (set `window.USE_RAILWAY = false` and reload) to see that the old timestamp poll may silently miss the update.

### Scenario B — Targeted lesson downloads

1. With Turbo Mode still active, run:

   ```js
   compareMerkleWithServer('1'); // focus on Unit 1
   ```

   Note the hash table. Now submit an answer in any Unit 1 lesson from another tab. Re-run the command—only the affected lesson hash flips.
2. Call:

   ```js
   fetchRemoteLessonData('U1-L4');
   verifyLessonHashAgainstServer('U1-L4');
   ```

   The helper prints the remote lesson payload and verifies that the local hash now matches after the Merkle sync completes.

### Scenario C — Local tampering detection

1. In the console run:

   ```js
   const answersU1 = JSON.parse(localStorage.getItem('classData')).users;
   // Pretend a stale record lingers locally
   answersU1['demo_user'].answers['U1-L4-Q99'] = { value: 'A', timestamp: Date.now() };
   localStorage.setItem('classData', JSON.stringify({ users: answersU1 }));
   computeLocalMerkleSnapshot();
   compareMerkleWithServer('1');
   ```

   The comparison call highlights the mismatch and lists the suspect lesson. This makes it easy to debug cache drift without downloading full peer datasets.

---

## 3. Compare with legacy sync

1. Set `window.USE_RAILWAY = false` in `railway_config.js` (or in DevTools before reload) and refresh.
2. Repeat Scenario A. You’ll notice the “incremental sync” log still reports success even though the lesson remains missing—this replicates the pre-Merkle failure mode.
3. Restore `window.USE_RAILWAY = true`, reload, and watch the Merkle diagnostics confirm that the missing lesson is recovered instantly.

---

## 4. Ideas for expanding Merkle coverage

- Use `computeLocalMerkleSnapshot()` as a lightweight audit when exporting grades or running nightly reports.
- Feed the per-lesson hashes into analytics to detect unusually active lessons or stale cohorts.
- Hook `compareMerkleWithServer()` into your teacher dashboard so staff can spot sync discrepancies without leaving the UI.

The diagnostic helpers introduced with the refactor are intentionally generic—you can reuse them anywhere a concise integrity check is useful.

