// Railway Server Integration for AP Stats Turbo Mode
// This replaces direct Supabase calls with Railway server calls

;(function () {
  // Configuration
  const DEFAULT_RAILWAY_URL = 'https://merklecurriculumrender-production.up.railway.app';
  const rawRailwayServerUrl =
      typeof window.RAILWAY_SERVER_URL === 'string'
          ? window.RAILWAY_SERVER_URL.trim()
          : '';
  const resolvedRailwayUrl = (rawRailwayServerUrl || DEFAULT_RAILWAY_URL)
      .replace(/^ws:\/\//i, 'http://')
      .replace(/^wss:\/\//i, 'https://');
  const RAILWAY_SERVER_URL = resolvedRailwayUrl.replace(/\/+$/, '');
  const USE_RAILWAY = !!window.USE_RAILWAY;

  const HashUtils = window.HashUtils || {};
  const manifestStorageKey = 'railway_manifest_cache_v1';

  let lastSyncSummary = null;
  const syncState = {
      activeMode: 'pending',
      merkleHealthy: false,
      lastModeChange: null,
      lastMerkleError: null,
      lastLegacyTimestamp: 0
  };
  window.railwaySyncMode = syncState.activeMode;

  function updateSyncMode(nextMode, options = {}) {
      if (!nextMode) {
          return;
      }

      if (nextMode === 'merkle') {
          syncState.merkleHealthy = true;
          syncState.lastMerkleError = null;
          syncState.lastLegacyTimestamp = 0;
      } else if (options.merkleError instanceof Error) {
          syncState.lastMerkleError = options.merkleError;
          syncState.merkleHealthy = false;
      }

      if (syncState.activeMode === nextMode) {
          return;
      }

      syncState.activeMode = nextMode;
      syncState.lastModeChange = Date.now();
      if (nextMode !== 'merkle' && nextMode !== 'pending') {
          syncState.merkleHealthy = false;
      }

      window.railwaySyncMode = nextMode;
      try {
          window.dispatchEvent(new CustomEvent('railway:sync-mode-changed', {
              detail: { mode: nextMode }
          }));
      } catch (error) {
          console.warn('Failed to dispatch railway:sync-mode-changed event', error);
      }

      console.log(`🚦 Railway sync mode switched to ${nextMode}`);
  }

  function callDirectSupabasePeerPull() {
      const fallbackFn = typeof window.originalPullPeerData === 'function'
          ? window.originalPullPeerData
          : window.pullPeerDataFromSupabase;

      if (typeof fallbackFn === 'function') {
          try {
              return fallbackFn();
          } catch (error) {
              console.error('Direct Supabase peer pull failed:', error);
          }
      }

      return null;
  }

  function buildRailwayUrl(path = '') {
      if (!RAILWAY_SERVER_URL) {
          return path;
      }

      const normalizedPath = `${path || ''}`
          .trim()
          .replace(/^\/+/, '');

      if (!normalizedPath) {
          return RAILWAY_SERVER_URL;
      }

      return `${RAILWAY_SERVER_URL}/${normalizedPath}`;
  }

  function buildWebSocketUrl(path = '') {
      const httpUrl = buildRailwayUrl(path);
      if (!httpUrl) return httpUrl;
      return httpUrl
          .replace(/^https:\/\//i, 'wss://')
          .replace(/^http:\/\//i, 'ws://');
  }

  function safeJsonParse(value, fallback = null) {
      try {
          return value ? JSON.parse(value) : fallback;
      } catch (error) {
          console.warn('Failed to parse JSON payload from storage', error);
          return fallback;
      }
  }

  function loadStoredManifest() {
      return safeJsonParse(localStorage.getItem(manifestStorageKey), { units: {} });
  }

  function saveStoredManifest(manifest) {
      try {
          localStorage.setItem(manifestStorageKey, JSON.stringify(manifest));
      } catch (error) {
          console.warn('Unable to store manifest cache', error);
      }
  }

  function updateStoredManifestUnit(unitId, unitInfo = {}) {
      const manifest = loadStoredManifest();
      manifest.units = manifest.units || {};
      manifest.units[unitId] = {
          ...(manifest.units[unitId] || {}),
          ...unitInfo,
          lessons: {
              ...(manifest.units[unitId]?.lessons || {}),
              ...(unitInfo.lessons || {})
          }
      };
      saveStoredManifest(manifest);
  }

  function updateStoredManifestLesson(unitId, lessonId, lessonInfo = {}) {
      const manifest = loadStoredManifest();
      manifest.units = manifest.units || {};
      manifest.units[unitId] = manifest.units[unitId] || { lessons: {} };
      manifest.units[unitId].lessons = manifest.units[unitId].lessons || {};
      manifest.units[unitId].lessons[lessonId] = {
          ...(manifest.units[unitId].lessons[lessonId] || {}),
          ...lessonInfo
      };
      saveStoredManifest(manifest);
  }

  async function fetchJson(url, options = {}) {
      const response = await fetch(url, options);
      if (!response.ok) {
          const text = await response.text();
          throw new Error(`Request failed (${response.status}): ${text}`);
      }
      return response.json();
  }

  function computeLocalSyncIndex() {
      if (HashUtils && typeof HashUtils.buildLocalSyncIndex === 'function') {
          return HashUtils.buildLocalSyncIndex();
      }
      return { units: {} };
  }

  function buildPeerDataSnapshot() {
      const answers = HashUtils && typeof HashUtils.gatherAllLocalAnswers === 'function'
          ? HashUtils.gatherAllLocalAnswers()
          : [];

      const peerData = {};
      answers.forEach((answer) => {
          if (!peerData[answer.username]) {
              peerData[answer.username] = { answers: {} };
          }
          peerData[answer.username].answers[answer.question_id] = {
              value: answer.answer_value,
              timestamp: answer.timestamp
          };
      });

      return peerData;
  }

  function normalizeDetail(detail, defaultSource = '') {
      return {
          username: (detail.username || '').trim(),
          question_id: detail.question_id,
          answer_value: detail.answer_value,
          timestamp: HashUtils && typeof HashUtils.normalizeTimestamp === 'function'
              ? HashUtils.normalizeTimestamp(detail.timestamp)
              : parseInt(detail.timestamp, 10) || Date.now(),
          source: detail.source || defaultSource || ''
      };
  }

  function applyLessonAnswer(detail, options = {}) {
      const { defaultSource = 'merkle-sync', dispatchEvent = true } = options || {};
      const normalized = normalizeDetail(detail, defaultSource);
      if (!normalized.username || !normalized.question_id) return false;

      if (typeof window.ensureClassDataInitialized === 'function') {
          window.ensureClassDataInitialized();
      }

      if (typeof window.mergePeerAnswer !== 'function') {
          console.warn('mergePeerAnswer is not available - skipping local merge');
          return false;
      }

      const updated = window.mergePeerAnswer(normalized);
      if (!updated) {
          return false;
      }

      const eventDetail = {
          username: normalized.username,
          question_id: normalized.question_id,
          answer_value: normalized.answer_value,
          timestamp: normalized.timestamp,
          alreadyMerged: true
      };

      try {
          window.dispatchEvent(new CustomEvent('peer:answer', {
              detail: eventDetail
          }));
      } catch (error) {
          console.warn("Failed to dispatch peer:answer event", error);
      }

          try {
              window.dispatchEvent(new CustomEvent('peer:answer', {
                  detail: eventDetail
              }));
          } catch (error) {
              console.warn("Failed to dispatch peer:answer event", error);
          }

          try {
              if (window.spriteManager && typeof window.checkIfAnswerCorrect === 'function') {
                  const isCorrect = window.checkIfAnswerCorrect(normalized.question_id, normalized.answer_value);
                  window.spriteManager.handlePeerAnswer(normalized.username, isCorrect);
              }
          } catch (error) {
              console.warn('Sprite update failed after lesson sync', error);
          }

          if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => {
                  try {
                      if (typeof window.refreshQuestionIfVisible === 'function') {
                          window.refreshQuestionIfVisible(normalized.question_id);
                      }
                      if (typeof window.updatePeerDataTimestamp === 'function') {
                          window.updatePeerDataTimestamp();
                      }
                  } catch (error) {
                      console.warn('UI refresh failed after lesson sync', error);
                  }
              });
          }
      }

      return true;
  }

  function ingestLessonAnswers(lessonId, answers = []) {
      let applied = 0;
      answers.forEach((answer) => {
          const detail = {
              username: answer.username,
              question_id: answer.question_id,
              answer_value: answer.answer_value,
              timestamp: answer.timestamp,
              source: 'merkle-sync'
          };
          if (applyLessonAnswer(detail, { defaultSource: 'merkle-sync' })) {
              applied += 1;
          }
      });
      return applied;
  }

  function clearLocalLessonData(lessonId) {
      if (!lessonId) return 0;
      if (typeof window.ensureClassDataInitialized === 'function') {
          window.ensureClassDataInitialized();
      }

      let removed = 0;
      const prefix = `${lessonId}-`;

      if (window.classData && window.classData.users) {
          Object.entries(window.classData.users).forEach(([username, data]) => {
              const answers = data.answers || {};
              const timestamps = data.timestamps || {};
              Object.keys(answers).forEach((questionId) => {
                  if (questionId.startsWith(prefix)) {
                      delete answers[questionId];
                      delete timestamps[questionId];
                      removed += 1;
                  }
              });
          });
          if (removed > 0 && typeof window.saveClassData === 'function') {
              window.saveClassData();
          }
      }

      Object.keys(localStorage)
          .filter((key) => key.startsWith('answers_'))
          .forEach((key) => {
              const stored = safeJsonParse(localStorage.getItem(key), {});
              let modified = false;
              Object.keys(stored).forEach((questionId) => {
                  if (questionId.startsWith(prefix)) {
                      delete stored[questionId];
                      modified = true;
                  }
              });
              if (modified) {
                  localStorage.setItem(key, JSON.stringify(stored));
              }
          });

      return removed;
  }

  async function performMerkleSync() {
      if (!USE_RAILWAY) return null;

      try {
          const manifest = await fetchJson(buildRailwayUrl('/api/sync/manifest'));
          saveStoredManifest({
              generatedAt: manifest.generatedAt,
              units: manifest.units || {}
          });

          const serverUnits = manifest.units || {};
          const localIndex = computeLocalSyncIndex();
          const localUnits = localIndex.units || {};

          const unitsNeedingDetail = [];
          Object.keys(serverUnits).forEach((unitId) => {
              const serverUnit = serverUnits[unitId];
              const localUnit = localUnits[unitId];
              if (!localUnit || localUnit.hash !== serverUnit.hash) {
                  unitsNeedingDetail.push(unitId);
              }
          });

          // Remove local units that no longer exist on the server
          Object.keys(localUnits).forEach((unitId) => {
              if (!serverUnits[unitId]) {
                  const lessons = localUnits[unitId]?.lessons || {};
                  Object.keys(lessons).forEach((lessonId) => {
                      clearLocalLessonData(lessonId);
                  });
              }
          });

          let lessonsFetched = 0;
          let answersApplied = 0;

          for (const unitId of unitsNeedingDetail) {
              const unitManifest = await fetchJson(buildRailwayUrl(`/api/sync/unit/${unitId}`));
              const serverLessons = unitManifest.lessons || {};
              const localLessons = localUnits[unitId]?.lessons || {};

              // Remove lessons that no longer exist on the server
              Object.keys(localLessons).forEach((lessonId) => {
                  if (!serverLessons[lessonId]) {
                      clearLocalLessonData(lessonId);
                  }
              });

              updateStoredManifestUnit(unitId, {
                  hash: unitManifest.hash,
                  lessonCount: unitManifest.lessonCount,
                  lessons: serverLessons
              });

              for (const [lessonId, lessonInfo] of Object.entries(serverLessons)) {
                  const localLesson = localLessons[lessonId];
                  if (localLesson && localLesson.hash === lessonInfo.hash) {
                      continue; // already in sync
                  }

                  const lessonPayload = await fetchJson(`${RAILWAY_SERVER_URL}/api/data/lesson/${lessonId}`);
                  lessonsFetched += 1;
                  const applied = ingestLessonAnswers(lessonId, lessonPayload.answers || []);
                  answersApplied += applied;

                  updateStoredManifestLesson(unitId, lessonId, {
                      hash: lessonPayload.hash,
                      answerCount: lessonPayload.answerCount,
                      updatedAt: lessonPayload.updatedAt
                  });
              }
          }

          lastSyncSummary = {
              generatedAt: manifest.generatedAt,
              unitCount: Object.keys(serverUnits).length,
              unitsUpdated: unitsNeedingDetail.length,
              lessonsFetched,
              answersApplied
          };

          if (lessonsFetched === 0) {
              console.log('✅ Merkle sync: local data already matches server manifest.');
          } else {
              console.log(`✅ Merkle sync: updated ${lessonsFetched} lessons with ${answersApplied} answers.`);
          }

          updateSyncMode('merkle');

          return lastSyncSummary;
      } catch (error) {
          updateSyncMode('merkle-error', { merkleError: error });
          console.error('Merkle sync failed:', error);
          throw error;
      }
  }

  function updateBroadcastManifest(data) {
      if (!data || !data.unitId) return;
      const lessons = {};
      if (Array.isArray(data.lessons)) {
          data.lessons.forEach((lesson) => {
              if (lesson?.lessonId) {
                  lessons[lesson.lessonId] = {
                      hash: lesson.hash,
                      answerCount: lesson.answerCount,
                      updatedAt: Date.now()
                  };
              }
          });
      } else if (data.lessonId) {
          lessons[data.lessonId] = {
              hash: data.lessonHash,
              answerCount: data.lessonAnswerCount,
              updatedAt: Date.now()
          };
      }

      updateStoredManifestUnit(data.unitId, {
          hash: data.unitHash,
          lessons
      });
  }

  // WebSocket connection
  let ws = null;
  let wsReconnectTimer = null;
  let wsConnected = false;
  let wsPingInterval = null;

  // Initialize Railway connection
  function initializeRailwayConnection() {
      if (!USE_RAILWAY) {
          console.log('Railway server disabled, using direct Supabase');
          return false;
      }

      console.log('🚂 Initializing Railway server connection...');

      // Test REST API connection
      fetch(buildRailwayUrl('/health'))
          .then(async res => {
              if (!res.ok) {
                  const bodyText = await res.text();
                  const snippet = bodyText ? bodyText.trim().replace(/\s+/g, ' ').slice(0, 200) : '<empty body>';
                  throw new Error(`Health check failed (status ${res.status}): ${snippet}`);
              }

              const contentType = res.headers.get('content-type') || '';
              if (!contentType.toLowerCase().includes('application/json')) {
                  const bodyText = await res.text();
                  const snippet = bodyText ? bodyText.trim().replace(/\s+/g, ' ').slice(0, 200) : '<empty body>';
                  const typeLabel = contentType || 'unknown';
                  throw new Error(`Health check returned non-JSON response (status ${res.status}, content-type ${typeLabel}): ${snippet}`);
              }

              return res.json();
          })
          .then(data => {
              console.log('✅ Railway server connected:', data);
              connectWebSocket();
              performMerkleSync().catch(error => {
                  console.warn('Initial Merkle sync failed after health check:', error);
              });
          })
          .catch(error => {
              console.error('❌ Railway server unavailable:', error);
              console.log('Falling back to direct Supabase');
              updateSyncMode('railway-offline', { merkleError: error });
          });

      return true;
  }

  // Connect to WebSocket for real-time updates
  function connectWebSocket() {
      if (!USE_RAILWAY) return;

      const wsUrl = buildWebSocketUrl();

      try {
          ws = new WebSocket(wsUrl);

          ws.onopen = () => {
              console.log('🔌 WebSocket connected to Railway server');
              wsConnected = true;

              // Enable turbo mode when WebSocket connects
              window.dispatchEvent(new CustomEvent('turboModeChanged', {
                  detail: { enabled: true }
              }));
              console.log('🏁 Turbo mode enabled via Railway connection');

              // Clear any reconnect timer
              if (wsReconnectTimer) {
                  clearTimeout(wsReconnectTimer);
                  wsReconnectTimer = null;
              }

              // Send ping every 30 seconds to keep connection alive
              if (wsPingInterval) clearInterval(wsPingInterval);
              wsPingInterval = setInterval(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                      const username = (window.currentUsername || localStorage.getItem('consensusUsername') || '').trim();
                      // Regular ping for latency
                      ws.send(JSON.stringify({ type: 'ping' }));
                      // Presence heartbeat
                      if (username) {
                          ws.send(JSON.stringify({ type: 'heartbeat', username }));
                      }
                  }
              }, 30000);
          };

          ws.onmessage = (event) => {
              try {
                  const data = JSON.parse(event.data);
                  handleWebSocketMessage(data);
              } catch (error) {
                  console.error('WebSocket message parse error:', error);
              }
          };

          ws.onclose = () => {
              console.log('WebSocket disconnected');
              wsConnected = false;
              lastIdentifiedUsername = null;

              // Disable turbo mode when WebSocket disconnects
              window.dispatchEvent(new CustomEvent('turboModeChanged', {
                  detail: { enabled: false }
              }));
              console.log('🛑 Turbo mode disabled due to WebSocket disconnect');

              if (wsPingInterval) {
                  clearInterval(wsPingInterval);
                  wsPingInterval = null;
              }

              // Attempt to reconnect after 5 seconds
              wsReconnectTimer = setTimeout(() => {
                  console.log('Attempting WebSocket reconnection...');
                  connectWebSocket();
              }, 5000);
          };

          ws.onerror = (error) => {
              console.error('WebSocket error:', error);
              wsConnected = false;
              lastIdentifiedUsername = null;

              // Disable turbo mode when WebSocket errors
              window.dispatchEvent(new CustomEvent('turboModeChanged', {
                  detail: { enabled: false }
              }));
              console.log('🛑 Turbo mode disabled due to WebSocket error');
          };

      } catch (error) {
          console.error('Failed to create WebSocket:', error);
          wsConnected = false;
      }
  }

  // Handle incoming WebSocket messages
  function handleWebSocketMessage(data) {
      switch (data.type) {
          case 'connected':
              console.log('✅ WebSocket:', data.message);
              // Also enable turbo mode when receiving connected message
              window.dispatchEvent(new CustomEvent('turboModeChanged', {
                  detail: { enabled: true }
              }));
              break;

      case 'presence_snapshot': {
        // Initialize online set
        window.onlineUsers = new Set(data.users || []);
        // Inform UI/sprite system
        window.dispatchEvent(new CustomEvent('presenceChanged', { detail: { users: Array.from(window.onlineUsers) } }));
        break;
      }

      case 'user_online': {
        if (!window.onlineUsers) window.onlineUsers = new Set();
        window.onlineUsers.add(data.username);
        window.dispatchEvent(new CustomEvent('presenceChanged', { detail: { users: Array.from(window.onlineUsers) } }));
        break;
      }

      case 'user_offline': {
        if (!window.onlineUsers) window.onlineUsers = new Set();
        window.onlineUsers.delete(data.username);
        window.dispatchEvent(new CustomEvent('presenceChanged', { detail: { users: Array.from(window.onlineUsers) } }));
        break;
      }

          case 'answer_submitted':
              if (!data?.username || !data?.question_id || data.answer_value === undefined || data.timestamp === undefined) {
                  console.error('[WebSocket] Invalid or incomplete answer_submitted data received:', data);
                  break;
              }
              updateBroadcastManifest(data);
              console.log(`📨 Received answer for ${data.question_id}, dispatching 'peer:answer' event.`);
              window.dispatchEvent(new CustomEvent('peer:answer', {
                  detail: {
                      username: data.username,
                      question_id: data.question_id,
                      answer_value: data.answer_value,
                      timestamp: data.timestamp,
                      source: 'railway-broadcast'
                  }
              }));
              break;

          case 'batch_submitted':
              console.log(`📦 Batch update: ${data.count} answers`);
              if (Array.isArray(data.units)) {
                  data.units.forEach((unit) => updateBroadcastManifest(unit));
              }
              // Pull latest data from server
              pullPeerDataFromRailway();
              break;

          case 'realtime_update':
              console.log('🔄 Real-time update:', data.event);
              // Handle Supabase real-time updates relayed through server
              break;

          case 'pong':
              // Keep-alive response
              break;

          default:
              console.log('Unknown WebSocket message type:', data.type);
      }
  }

  window.addEventListener('consensus:username-set', (event) => {
      if (!event) return;
      const nextUsername = event.detail && event.detail.username;
      // Username tracking for presence - stored in window.currentUsername
      if (nextUsername) {
          window.currentUsername = nextUsername;
      }
  });

  // Railway-enhanced answer submission
  async function submitAnswerViaRailway(username, questionId, answerValue, timestamp) {
      if (!USE_RAILWAY) {
          // Fall back to direct Supabase
          return window.originalPushAnswer(username, questionId, answerValue, timestamp);
      }

      try {
          const response = await fetch(buildRailwayUrl('/api/submit-answer'), {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  username,
                  question_id: questionId,
                  answer_value: answerValue,
                  timestamp: timestamp
              })
          });

          const result = await response.json();

          if (result.success) {
              console.log(`✅ Answer synced via Railway (broadcast to ${result.broadcast} clients)`);
              return true;  // SUCCESS - Don't fall back!
          } else {
              throw new Error(result.error || 'Railway sync failed');
          }
      } catch (error) {
          console.error('Railway submit failed, falling back to direct Supabase:', error);
          // Only fall back if Railway actually failed
          return window.originalPushAnswer(username, questionId, answerValue, timestamp);
      }
  }

  async function pullPeerDataFromRailwayLegacy(options = {}) {
      if (!USE_RAILWAY) {
          return callDirectSupabasePeerPull();
      }

      const sinceValue = Number.isFinite(options?.since) && options.since > 0
          ? Math.floor(options.since)
          : 0;
      const queryPath = sinceValue > 0
          ? `/api/peer-data?since=${sinceValue}`
          : '/api/peer-data';

      const endpoint = buildRailwayUrl(queryPath);

      const response = await fetch(endpoint);
      if (!response.ok) {
          const text = await response.text();
          throw new Error(`Legacy peer-data request failed (${response.status}): ${text}`);
      }

      const result = await response.json();
      const answers = Array.isArray(result?.data) ? result.data : [];

      let mergedCount = 0;
      const peerData = {};
      let latestTimestamp = sinceValue;

      answers.forEach((answer) => {
          if (!answer || !answer.username || !answer.question_id) {
              return;
          }

          const detail = {
              username: answer.username,
              question_id: answer.question_id,
              answer_value: answer.answer_value,
              timestamp: answer.timestamp,
              source: 'railway-legacy'
          };

          if (applyLessonAnswer(detail, { defaultSource: 'railway-legacy' })) {
              mergedCount += 1;
          }

          const normalizedTimestamp = HashUtils && typeof HashUtils.normalizeTimestamp === 'function'
              ? HashUtils.normalizeTimestamp(answer.timestamp)
              : parseInt(answer.timestamp, 10) || Date.now();

          latestTimestamp = Math.max(latestTimestamp, normalizedTimestamp);

          if (!peerData[answer.username]) {
              peerData[answer.username] = { answers: {} };
          }
          peerData[answer.username].answers[answer.question_id] = {
              value: answer.answer_value,
              timestamp: normalizedTimestamp
          };
      });

      const totalProcessed = typeof result?.filtered === 'number' ? result.filtered : answers.length;
      console.log(`📥 Legacy Railway sync processed ${totalProcessed} answers (${mergedCount} merged)`);

      if (latestTimestamp > sinceValue) {
          syncState.lastLegacyTimestamp = latestTimestamp;
      }

      if (typeof window.updatePeerDataTimestamp === 'function') {
          window.updatePeerDataTimestamp();
      }

      return peerData;
  }

  // Pull peer data from Railway server
  async function pullPeerDataFromRailway(options = {}) {
      if (!USE_RAILWAY) {
          // Fall back to direct Supabase
          return callDirectSupabasePeerPull();
      }

      try {
          const summary = await performMerkleSync();
          if (summary) {
              console.log('Merkle sync summary:', summary);
          }
          return buildPeerDataSnapshot();
      } catch (error) {
          console.error('Railway Merkle sync failed:', error);

          try {
              console.warn('⚠️ Falling back to legacy Railway peer sync.');
              const legacyData = await pullPeerDataFromRailwayLegacy({
                  since: syncState.lastLegacyTimestamp || 0,
                  ...options
              });
              updateSyncMode('railway-legacy', { merkleError: error });
              return legacyData;
          } catch (legacyError) {
              console.error('Railway legacy sync failed:', legacyError);
              console.warn('⚠️ Falling back to direct Supabase peer sync.');
              updateSyncMode('supabase-fallback', { merkleError: legacyError });
              // Fall back to direct Supabase for resilience
              return callDirectSupabasePeerPull();
          }
      }
  }

  // Get question statistics from Railway
  async function getQuestionStats(questionId) {
      if (!USE_RAILWAY) return null;

      try {
          const response = await fetch(buildRailwayUrl(`/api/question-stats/${questionId}`));
          const stats = await response.json();

          console.log(`📊 Stats for ${questionId}:`, stats);
          return stats;

      } catch (error) {
          console.error('Failed to get question stats:', error);
          return null;
      }
  }

  // Batch submit answers via Railway
  async function batchSubmitViaRailway(answers) {
      if (!USE_RAILWAY) {
          // Fall back to direct batch push
          return batchPushAnswersToSupabase(answers);
      }

      try {
          const response = await fetch(buildRailwayUrl('/api/batch-submit'), {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({ answers })
          });

          const result = await response.json();

          if (result.success) {
              console.log(`✅ Batch synced ${result.count} answers via Railway`);
              return result.count;
          } else {
              throw new Error(result.error);
          }
      } catch (error) {
          console.error('Railway batch submit failed:', error);
          // Fall back to direct Supabase
          return batchPushAnswersToSupabase(answers);
      }
  }

  // Override existing functions when Railway is enabled
  if (USE_RAILWAY) {
      console.log('🚂 Railway mode enabled - overriding sync functions');

      // Store original functions BEFORE overriding
      window.originalPushAnswer = window.pushAnswerToSupabase;
      window.originalPullPeerData = window.pullPeerDataFromSupabase;

      // Override with Railway-enhanced versions
      window.pushAnswerToSupabase = submitAnswerViaRailway;
      window.pullPeerDataFromSupabase = () => pullPeerDataFromRailway();

      // Add new Railway-specific functions
      window.getQuestionStats = getQuestionStats;
      window.batchSubmitViaRailway = batchSubmitViaRailway;

      // Initialize on page load
      document.addEventListener('DOMContentLoaded', () => {
          setTimeout(() => {
              initializeRailwayConnection();
          }, 1000); // Give Supabase time to initialize first
      });
  }

  // Export functions for external use
  window.railwayClient = {
      initialize: initializeRailwayConnection,
      connectWebSocket,
      submitAnswer: submitAnswerViaRailway,
      pullPeerData: pullPeerDataFromRailway,
      pullPeerDataLegacy: pullPeerDataFromRailwayLegacy,
      getStats: getQuestionStats,
      batchSubmit: batchSubmitViaRailway,
      isConnected: () => wsConnected,
      getLastSyncSummary: () => lastSyncSummary,
      getSyncMode: () => syncState.activeMode,
      isMerkleHealthy: () => syncState.merkleHealthy
  };

  console.log('🚂 Railway client loaded. Set USE_RAILWAY=true to enable.');
})();
