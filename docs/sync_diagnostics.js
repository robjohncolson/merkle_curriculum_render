// Diagnostic functions for Turbo Mode sync
// Run these in browser console to diagnose sync issues

// Function to see all local peer data
function checkLocalPeerData() {
    const allKeys = Object.keys(localStorage);
    const answerKeys = allKeys.filter(key => key.startsWith('answers_'));

    console.log('=== Local Peer Data Summary ===');
    console.log(`Found ${answerKeys.length} users with local data:`);

    let totalAnswers = 0;
    const summary = [];

    answerKeys.forEach(key => {
        const username = key.replace('answers_', '');
        const answers = JSON.parse(localStorage.getItem(key) || '{}');
        const answerCount = Object.keys(answers).length;
        totalAnswers += answerCount;

        if (answerCount > 0) {
            summary.push(`  ${username}: ${answerCount} answers`);
        }
    });

    summary.forEach(s => console.log(s));
    console.log(`Total: ${totalAnswers} answers across ${answerKeys.length} users`);

    return { users: answerKeys.length, answers: totalAnswers };
}

// Function to check classData
function checkClassData() {
    const classData = JSON.parse(localStorage.getItem('classData') || '{}');

    if (!classData.users) {
        console.log('No classData.users found');
        return;
    }

    console.log('=== ClassData Summary ===');
    const users = Object.keys(classData.users);
    console.log(`Found ${users.length} users in classData:`);

    let totalAnswers = 0;

    users.forEach(username => {
        const userData = classData.users[username];
        if (userData.answers) {
            const answerCount = Object.keys(userData.answers).length;
            totalAnswers += answerCount;
            console.log(`  ${username}: ${answerCount} answers`);
        }
    });

    console.log(`Total: ${totalAnswers} answers in classData`);

    return { users: users.length, answers: totalAnswers };
}

// Function to sync all peer data manually
async function manualSyncAllPeers() {
    if (!turboModeActive) {
        console.log('❌ Turbo mode not active. Check connection first.');
        return;
    }

    console.log('Starting full peer data sync...');

    // Try both sync methods
    console.log('Method 1: Syncing from individual answer keys...');
    const result1 = await syncAllLocalAnswersToSupabase();

    console.log('Method 2: Syncing from classData...');
    const result2 = await syncClassDataToSupabase();

    console.log('Sync complete! Check Supabase dashboard.');

    return { method1: result1, method2: result2 };
}

// Function to compare local vs Supabase data
async function compareLocalVsSupabase() {
    if (!supabase) {
        console.log('❌ Supabase not initialized');
        return;
    }

    // Get Supabase data
    const { data: supabaseData, error } = await supabase
        .from('answers')
        .select('*');

    if (error) {
        console.error('Failed to fetch from Supabase:', error);
        return;
    }

    // Get local data count
    const local = checkLocalPeerData();

    // Analyze Supabase data
    const supabaseUsers = new Set(supabaseData.map(a => a.username));
    const supabaseCount = supabaseData.length;

    console.log('\n=== Comparison ===');
    console.log(`Local: ${local.answers} answers from ${local.users} users`);
    console.log(`Supabase: ${supabaseCount} answers from ${supabaseUsers.size} users`);

    if (local.answers > supabaseCount) {
        console.log(`⚠️ Local has ${local.answers - supabaseCount} more answers - run manualSyncAllPeers()`);
    } else if (supabaseCount > local.answers) {
        console.log(`📥 Supabase has ${supabaseCount - local.answers} more answers - pull peer data`);
    } else {
        console.log('✅ Data appears to be in sync');
    }

    return {
        local: { answers: local.answers, users: local.users },
        supabase: { answers: supabaseCount, users: supabaseUsers.size }
    };
}

// Function to pull all peer data from Supabase and update local
async function pullAllPeerData() {
    if (!supabase) {
        console.log('❌ Supabase not initialized');
        return;
    }

    const currentUser = localStorage.getItem('consensusUsername');

    const { data, error } = await supabase
        .from('answers')
        .select('*');

    if (error) {
        console.error('Failed to pull from Supabase:', error);
        return;
    }

    console.log(`Pulled ${data.length} answers from Supabase`);

    // Group by user and update localStorage
    const userGroups = {};
    data.forEach(answer => {
        if (!userGroups[answer.username]) {
            userGroups[answer.username] = {};
        }
        userGroups[answer.username][answer.question_id] = {
            value: answer.answer_value,
            timestamp: parseInt(answer.timestamp)
        };
    });

    let updateCount = 0;
    Object.entries(userGroups).forEach(([username, answers]) => {
        // Don't overwrite current user's data
        if (username !== currentUser) {
            const key = `answers_${username}`;
            localStorage.setItem(key, JSON.stringify(answers));
            updateCount++;
            console.log(`  Updated ${username}: ${Object.keys(answers).length} answers`);
        }
    });

    console.log(`✅ Updated ${updateCount} users' data in localStorage`);

    // Update timestamp display
    updatePeerDataTimestamp();

    return updateCount;
}

// Export functions to global scope
window.checkLocalPeerData = checkLocalPeerData;
window.checkClassData = checkClassData;
window.manualSyncAllPeers = manualSyncAllPeers;
window.compareLocalVsSupabase = compareLocalVsSupabase;
window.pullAllPeerData = pullAllPeerData;

// Audit: Compare a specific user's local answers vs Supabase
async function auditUserUploads(username) {
    const user = (username || '').trim();
    if (!user) {
        console.log('Usage: auditUserUploads("student_username")');
        return;
    }
    if (!supabase) {
        console.log('❌ Supabase not initialized');
        return;
    }

    const localKey = `answers_${user}`;
    const local = JSON.parse(localStorage.getItem(localKey) || '{}');
    const localCount = Object.keys(local).length;

    const { data: remote, error } = await supabase
        .from('answers')
        .select('question_id, answer_value, timestamp')
        .eq('username', user);
    if (error) {
        console.error('Failed to fetch from Supabase:', error);
        return;
    }

    const remoteMap = new Map(remote.map(r => [r.question_id, r]));

    const missingOnCloud = [];
    const olderOnCloud = [];
    const upToDate = [];

    Object.entries(local).forEach(([qid, localAns]) => {
        const localTs = typeof localAns?.timestamp === 'string' ? new Date(localAns.timestamp).getTime() : (localAns?.timestamp || 0);
        const remoteAns = remoteMap.get(qid);
        if (!remoteAns) {
            missingOnCloud.push(qid);
            return;
        }
        const remoteTs = typeof remoteAns.timestamp === 'string' ? new Date(remoteAns.timestamp).getTime() : (remoteAns.timestamp || 0);
        if (remoteTs < localTs) {
            olderOnCloud.push({ question_id: qid, localTs, remoteTs });
        } else {
            upToDate.push(qid);
        }
    });

    console.log(`\n=== Audit for ${user} ===`);
    console.log(`Local answers: ${localCount}`);
    console.log(`Cloud answers: ${remote.length}`);
    if (missingOnCloud.length) {
        console.log(`❗ Missing on cloud (${missingOnCloud.length}):`, missingOnCloud.slice(0, 20), missingOnCloud.length > 20 ? '...(truncated)' : '');
    }
    if (olderOnCloud.length) {
        console.log(`⚠️ Cloud older than local (${olderOnCloud.length}) - consider re-sync:`, olderOnCloud.slice(0, 10));
    }
    console.log(`✅ Up-to-date (${upToDate.length})`);

    return { missingOnCloud, olderOnCloud, upToDate, localCount, cloudCount: remote.length };
}

// Verify last N locally saved answers exist on Supabase with >= timestamps
async function verifyLastNAnswers(username, n = 10) {
    const user = (username || '').trim();
    if (!user) {
        console.log('Usage: verifyLastNAnswers("student_username", N)');
        return;
    }
    if (!supabase) {
        console.log('❌ Supabase not initialized');
        return;
    }

    const localKey = `answers_${user}`;
    const local = JSON.parse(localStorage.getItem(localKey) || '{}');
    const entries = Object.entries(local)
        .map(([qid, ans]) => ({
            question_id: qid,
            timestamp: typeof ans?.timestamp === 'string' ? new Date(ans.timestamp).getTime() : (ans?.timestamp || 0)
        }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, Math.max(0, n));

    if (entries.length === 0) {
        console.log(`No local answers for ${user}`);
        return { verified: [], failures: [] };
    }

    // Fetch those question IDs from cloud
    const qids = entries.map(e => e.question_id);
    const { data: remote, error } = await supabase
        .from('answers')
        .select('question_id, timestamp')
        .eq('username', user)
        .in('question_id', qids);
    if (error) {
        console.error('Failed to fetch from Supabase:', error);
        return;
    }
    const remoteMap = new Map(remote.map(r => [r.question_id, r]));

    const verified = [];
    const failures = [];
    entries.forEach(e => {
        const r = remoteMap.get(e.question_id);
        const rTs = r ? (typeof r.timestamp === 'string' ? new Date(r.timestamp).getTime() : (r.timestamp || 0)) : -1;
        if (r && rTs >= e.timestamp) {
            verified.push(e.question_id);
        } else {
            failures.push({ question_id: e.question_id, localTs: e.timestamp, cloudTs: rTs });
        }
    });

    console.log(`\n=== Verify last ${entries.length} for ${user} ===`);
    console.log(`Verified (${verified.length}):`, verified);
    if (failures.length) console.log(`❌ Failures (${failures.length}):`, failures);

    return { verified, failures };
}

// Export audit helpers
window.auditUserUploads = auditUserUploads;
window.verifyLastNAnswers = verifyLastNAnswers;

function resolveRailwayRestBase() {
    const rawUrl = window.RAILWAY_SERVER_URL;
    if (typeof rawUrl !== 'string') {
        return '';
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return '';
    }

    return trimmed
        .replace(/^ws:\/\//i, 'http://')
        .replace(/^wss:\/\//i, 'https://')
        .replace(/\/+$/, '');
}

function ensureHashUtils() {
    if (!window.HashUtils) {
        console.log('HashUtils not available yet – ensure js/hash_utils.js has loaded.');
        return null;
    }
    return window.HashUtils;
}

function summarizeManifest(manifest = { units: {} }) {
    const units = manifest.units || {};
    const summary = Object.entries(units).map(([unitId, data]) => ({
        unit: unitId,
        hash: data.hash,
        lessons: data.lessons ? Object.keys(data.lessons).length : 0,
        answers: Object.values(data.lessons || {}).reduce((total, lesson) => total + (lesson.answerCount || 0), 0)
    }));

    console.table(summary);
    return summary;
}

async function fetchJsonWithDiagnostics(url, label) {
    console.log(`Fetching ${label || url} → ${url}`);

    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    const textBody = await response.text();

    if (!response.ok) {
        throw new Error(`${label || 'Request'} failed (${response.status}). Body snippet: ${textBody.slice(0, 200)}`);
    }

    if (!/application\/json/i.test(contentType)) {
        throw new Error(`${label || 'Request'} returned ${contentType || 'no content-type'}: ${textBody.slice(0, 200)}`);
    }

    try {
        return JSON.parse(textBody);
    } catch (error) {
        throw new Error(`${label || 'Request'} returned invalid JSON: ${error.message}`);
    }
}

function buildLessonLookup(snapshot) {
    const lookup = {};
    const units = snapshot.units || {};
    Object.entries(units).forEach(([unitId, unit]) => {
        const lessons = unit.lessons || {};
        Object.entries(lessons).forEach(([lessonId, lesson]) => {
            lookup[lessonId] = { unitId, hash: lesson.hash, answerCount: lesson.answerCount };
        });
    });
    return lookup;
}

function computeLocalManifest() {
    const HashUtils = ensureHashUtils();
    if (!HashUtils || typeof HashUtils.buildLocalSyncIndex !== 'function') {
        console.log('Local manifest unavailable – HashUtils.buildLocalSyncIndex missing.');
        return { units: {} };
    }

    const snapshot = HashUtils.buildLocalSyncIndex();
    console.log('=== Local Merkle Snapshot ===');
    summarizeManifest(snapshot);
    return snapshot;
}

async function fetchRemoteManifest() {
    const base = resolveRailwayRestBase();
    if (!base) {
        console.log('Set window.RAILWAY_SERVER_URL to your Railway deployment first.');
        return { units: {} };
    }

    const manifest = await fetchJsonWithDiagnostics(`${base}/api/sync/manifest`, 'Manifest');
    console.log('=== Remote Manifest ===');
    summarizeManifest(manifest);
    return manifest;
}

async function fetchRemoteUnitManifest(unitId) {
    if (!unitId) {
        throw new Error('Provide a unit id, e.g. fetchRemoteUnitManifest("1").');
    }

    const base = resolveRailwayRestBase();
    if (!base) {
        console.log('Set window.RAILWAY_SERVER_URL to your Railway deployment first.');
        return null;
    }

    const unitManifest = await fetchJsonWithDiagnostics(`${base}/api/sync/unit/${encodeURIComponent(unitId)}`, `Unit ${unitId} manifest`);
    console.log(`=== Remote Lesson Hashes for Unit ${unitId} ===`);
    const lessons = unitManifest.lessons || {};
    const table = Object.entries(lessons).map(([lessonId, data]) => ({
        lesson: lessonId,
        hash: data.hash,
        answers: data.answerCount,
        updated: data.latestTimestamp
    }));
    console.table(table);
    return unitManifest;
}

async function fetchRemoteLessonData(lessonId) {
    if (!lessonId) {
        throw new Error('Provide a lesson id, e.g. fetchRemoteLessonData("U1-L4").');
    }

    const base = resolveRailwayRestBase();
    if (!base) {
        console.log('Set window.RAILWAY_SERVER_URL to your Railway deployment first.');
        return { answers: [] };
    }

    const payload = await fetchJsonWithDiagnostics(`${base}/api/data/lesson/${encodeURIComponent(lessonId)}`, `Lesson ${lessonId} data`);
    console.log(`=== Remote Lesson Data for ${lessonId} ===`);
    console.log(payload);
    return payload;
}

async function compareMerkleWithServer(targetUnitId) {
    const localManifest = computeLocalManifest();
    const remoteManifest = await fetchRemoteManifest();

    const localUnits = localManifest.units || {};
    const remoteUnits = remoteManifest.units || {};
    const allUnitIds = Array.from(new Set([...Object.keys(localUnits), ...Object.keys(remoteUnits)]));

    const unitDiffs = allUnitIds.map((unitId) => ({
        unit: unitId,
        local: localUnits[unitId]?.hash || '—',
        remote: remoteUnits[unitId]?.hash || '—',
        match: localUnits[unitId]?.hash === remoteUnits[unitId]?.hash
    }));

    console.log('=== Unit Hash Comparison ===');
    console.table(unitDiffs);

    const mismatchedUnits = unitDiffs.filter((row) => row.match === false).map((row) => row.unit);
    const focusUnits = targetUnitId ? [targetUnitId] : mismatchedUnits;

    for (const unitId of focusUnits) {
        const unitManifest = await fetchRemoteUnitManifest(unitId);
        const localLessons = (localUnits[unitId] && localUnits[unitId].lessons) || {};
        const remoteLessons = (unitManifest && unitManifest.lessons) || {};

        const lessonIds = Array.from(new Set([...Object.keys(localLessons), ...Object.keys(remoteLessons)]));
        const lessonDiffs = lessonIds.map((lessonId) => ({
            lesson: lessonId,
            local: localLessons[lessonId]?.hash || '—',
            remote: remoteLessons[lessonId]?.hash || '—',
            match: localLessons[lessonId]?.hash === remoteLessons[lessonId]?.hash
        }));

        console.log(`=== Lesson Hash Comparison for Unit ${unitId} ===`);
        console.table(lessonDiffs);
    }

    if (mismatchedUnits.length === 0) {
        console.log('✅ Local data matches the remote manifest.');
    } else {
        console.log('⚠️ Found mismatched unit hashes. Lesson breakdown above.');
    }

    return { unitDiffs };
}

async function verifyLessonHashAgainstServer(lessonId) {
    const HashUtils = ensureHashUtils();
    if (!HashUtils || typeof HashUtils.computeLessonHash !== 'function') {
        console.log('HashUtils.computeLessonHash unavailable.');
        return null;
    }

    const lessonData = await fetchRemoteLessonData(lessonId);
    const answers = lessonData.answers || [];
    const hash = HashUtils.computeLessonHash(answers.map((answer) => ({
        username: answer.username,
        question_id: answer.question_id,
        answer_value: answer.answer_value,
        timestamp: HashUtils.normalizeTimestamp(answer.timestamp)
    })));

    console.log(`Lesson ${lessonId} hash from remote payload: ${hash}`);

    const localManifest = computeLocalManifest();
    const lookup = buildLessonLookup(localManifest);
    const localHash = lookup[lessonId]?.hash;

    if (localHash) {
        console.log(`Local lesson hash: ${localHash}`);
        console.log(hash === localHash ? '✅ Hashes match.' : '⚠️ Hash mismatch detected.');
    } else {
        console.log('Local lesson hash unavailable – lesson missing locally.');
    }

    return { remoteHash: hash, localHash };
}

window.computeLocalMerkleSnapshot = computeLocalManifest;
window.fetchRemoteMerkleManifest = fetchRemoteManifest;
window.fetchRemoteUnitManifest = fetchRemoteUnitManifest;
window.fetchRemoteLessonData = fetchRemoteLessonData;
window.compareMerkleWithServer = compareMerkleWithServer;
window.verifyLessonHashAgainstServer = verifyLessonHashAgainstServer;

console.log('🔧 Sync diagnostic functions loaded. Available commands:');
console.log('  checkLocalPeerData() - See all local peer data');
console.log('  checkClassData() - See classData structure');
console.log('  manualSyncAllPeers() - Sync all local data to Supabase');
console.log('  compareLocalVsSupabase() - Compare local vs cloud data');
console.log('  pullAllPeerData() - Pull all peer data from Supabase');
console.log('  auditUserUploads(username) - Audit one user\'s local vs cloud');
console.log('  verifyLastNAnswers(username, n) - Verify last N uploads reached cloud');
console.log('  computeLocalMerkleSnapshot() - Summarize local unit/lesson hashes');
console.log('  fetchRemoteMerkleManifest() - View the server manifest');
console.log('  compareMerkleWithServer(unit?) - Diff local vs remote hashes');
console.log('  verifyLessonHashAgainstServer(lessonId) - Check one lesson payload');